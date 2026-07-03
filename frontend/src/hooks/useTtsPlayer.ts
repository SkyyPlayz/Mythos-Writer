import { useState, useCallback, useEffect, useRef } from 'react';

/** Minimal TTS engine config needed to decide which playback path to use. */
export interface TtsEngineSettings {
  enabled?: boolean;
  provider: 'local' | 'cloud' | 'auto';
  localBinaryPath?: string;
  cloudApiKey?: string;
}

/**
 * Stored voice preferences (AppSettings.voice) that shape playback.
 * Field names match the persisted VoiceSettings shape so call sites can pass
 * `appSettings?.voice` straight through.
 */
export interface TtsVoicePrefs {
  /** TTS output volume, 0–1. Default 1.0. */
  ttsVolume?: number;
  /** TTS speech rate, 0.5–2.0. Default 1.0. */
  ttsRate?: number;
  /** Voice identifier — forwarded to the engine (Piper/OpenAI voice) or matched against OS voices. */
  ttsVoiceId?: string;
  /** When true, the session starts muted until explicitly unmuted. */
  persistentMute?: boolean;
}

export interface UseTtsPlayer {
  /** ID of the suggestion card currently playing, or null. */
  playingCardId: string | null;
  /** When true, TTS is silenced and speakCard is a no-op. */
  sessionMuted: boolean;
  /**
   * Speak the given text, tagging it with `cardId` so the caller can know
   * which card is playing. Cancels any prior playback first.
   * No-op when session is muted.
   */
  speakCard: (text: string, cardId: string, announce: (msg: string) => void) => void;
  /** Cancel any active TTS playback. */
  cancelCurrent: (announce?: (msg: string) => void) => void;
  /** Toggle the session mute; stops playback when muting. */
  toggleMute: (announce: (msg: string) => void) => void;
}

/**
 * Returns true when a Piper-local or cloud TTS backend is explicitly configured.
 * When false, the hook falls back to OS speechSynthesis (zero-config default).
 */
function hasTtsEngine(settings?: TtsEngineSettings): boolean {
  if (!settings?.enabled) return false;
  const { provider, localBinaryPath, cloudApiKey } = settings;
  if (provider === 'local') return !!localBinaryPath;
  if (provider === 'cloud') return !!cloudApiKey;
  // auto: use configured engine if any
  return !!(localBinaryPath || cloudApiKey);
}

/** Clamp stored volume to the valid 0–1 range; non-numeric → default 1. */
function clampVolume(volume: number | undefined): number {
  if (typeof volume !== 'number' || Number.isNaN(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/** Clamp stored rate to the documented 0.5–2.0 range; non-numeric → default 1. */
function clampRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

/** Concatenate streamed audio chunks into a single contiguous byte array. */
function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Piper's common default rate — used when main omits sampleRate on the done event. */
const PCM_DEFAULT_SAMPLE_RATE = 22050;

/**
 * Manages TTS playback for "Hear" buttons.
 *
 * Engine priority:
 * 1. Piper (local) or cloud TTS via IPC — when `ttsSettings` has a configured path/key.
 *    Audio chunks are buffered per speakId and decoded + played via Web Audio
 *    once the voice:speak:done event arrives (raw PCM from Piper, mp3 from cloud).
 * 2. OS `window.speechSynthesis` — zero-config default when no engine is configured.
 *
 * `voicePrefs` (settings.voice) applies volume/rate on both paths, forwards
 * the configured voice, and seeds the initial mute state from persistentMute.
 */
export function useTtsPlayer(ttsSettings?: TtsEngineSettings, voicePrefs?: TtsVoicePrefs): UseTtsPlayer {
  const [playingCardId, setPlayingCardId] = useState<string | null>(null);
  const [sessionMuted, setSessionMuted] = useState(voicePrefs?.persistentMute ?? false);

  // Refs mirror state for use in async callbacks / event handlers.
  const activeSpeakIdRef = useRef<string | null>(null);
  const sessionMutedRef = useRef(voicePrefs?.persistentMute ?? false);
  const playingCardIdRef = useRef<string | null>(null);
  // Incremented on each speakCard call so stale IPC promise resolutions are ignored.
  const speakRequestRef = useRef(0);
  // Active OS utterance; non-null only when using the speechSynthesis path.
  const osUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Stable refs to latest settings so callbacks pick up changes without re-creating.
  const ttsSettingsRef = useRef(ttsSettings);
  const voicePrefsRef = useRef(voicePrefs);
  // Buffered IPC audio chunks awaiting the done event, keyed by speakId.
  const chunkBuffersRef = useRef<Map<string, Uint8Array[]>>(new Map());
  // Lazily created Web Audio context (IPC playback path only).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Currently playing Web Audio source; non-null only during IPC playback.
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Set once the user explicitly toggles mute — stored persistentMute stops driving state.
  const userToggledMuteRef = useRef(false);

  useEffect(() => { sessionMutedRef.current = sessionMuted; }, [sessionMuted]);
  useEffect(() => { playingCardIdRef.current = playingCardId; }, [playingCardId]);
  useEffect(() => { ttsSettingsRef.current = ttsSettings; }, [ttsSettings]);
  useEffect(() => { voicePrefsRef.current = voicePrefs; }, [voicePrefs]);

  // Settings often load after mount — follow the stored persistentMute value
  // until the user takes over by toggling manually.
  const persistentMute = voicePrefs?.persistentMute;
  useEffect(() => {
    if (userToggledMuteRef.current || typeof persistentMute !== 'boolean') return;
    sessionMutedRef.current = persistentMute;
    setSessionMuted(persistentMute);
  }, [persistentMute]);

  /** Stop the Web Audio source (if playing) without touching playing-card state. */
  const stopAudioSource = useCallback(() => {
    const source = activeSourceRef.current;
    if (!source) return;
    activeSourceRef.current = null; // detach first so onended becomes a no-op
    try { source.stop(); } catch { /* already stopped */ }
  }, []);

  // Subscribe to IPC push events (only relevant on the Piper/cloud path).
  useEffect(() => {
    const clear = (speakId: string) => {
      if (activeSpeakIdRef.current !== speakId) return;
      activeSpeakIdRef.current = null;
      setPlayingCardId(null);
      playingCardIdRef.current = null;
    };

    // Decode the buffered synthesis output and play it through a GainNode so
    // the stored volume/rate preferences take effect.
    const playBuffered = async (
      speakId: string,
      chunks: Uint8Array[],
      format?: 'pcm' | 'mp3',
      sampleRate?: number,
    ) => {
      const AudioContextCtor = window.AudioContext;
      const bytes = concatChunks(chunks);
      if (!AudioContextCtor || bytes.byteLength === 0) {
        clear(speakId);
        return;
      }
      try {
        const ctx = audioCtxRef.current ?? new AudioContextCtor();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') void ctx.resume();

        let audioBuffer: AudioBuffer;
        if (format === 'pcm') {
          // Piper --output-raw: headerless 16-bit mono little-endian PCM.
          const sampleCount = Math.floor(bytes.byteLength / 2);
          if (sampleCount === 0) { clear(speakId); return; }
          const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
          audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate ?? PCM_DEFAULT_SAMPLE_RATE);
          const channel = audioBuffer.getChannelData(0);
          for (let i = 0; i < sampleCount; i++) channel[i] = pcm[i] / 32768;
        } else {
          // Cloud path streams an encoded container (mp3) — let Web Audio decode it.
          audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        }

        if (activeSpeakIdRef.current !== speakId) return; // cancelled during decode

        const prefs = voicePrefsRef.current;
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = clampRate(prefs?.ttsRate);
        const gain = ctx.createGain();
        gain.gain.value = clampVolume(prefs?.ttsVolume);
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => {
          if (activeSourceRef.current !== source) return; // stopped/superseded
          activeSourceRef.current = null;
          clear(speakId);
        };
        activeSourceRef.current = source;
        source.start();
      } catch {
        clear(speakId); // decode/playback failure — reset UI state
      }
    };

    // Chunks can arrive before the voice:speak invoke resolves with our
    // speakId, so buffer everything; stale entries are dropped on done/error
    // and whenever a new speak starts.
    const unsubChunk = window.api.onVoiceSpeakChunk?.(({ speakId, chunk }) => {
      const buffered = chunkBuffersRef.current.get(speakId);
      if (buffered) buffered.push(chunk);
      else chunkBuffersRef.current.set(speakId, [chunk]);
    });
    const unsubDone = window.api.onVoiceSpeakDone(({ speakId, format, sampleRate }) => {
      const chunks = chunkBuffersRef.current.get(speakId);
      chunkBuffersRef.current.delete(speakId);
      if (activeSpeakIdRef.current !== speakId) return; // stale/cancelled session
      if (!chunks || chunks.length === 0) {
        clear(speakId); // engine produced no audio — nothing to play
        return;
      }
      void playBuffered(speakId, chunks, format, sampleRate);
    });
    const unsubError = window.api.onVoiceSpeakError(({ speakId }) => {
      chunkBuffersRef.current.delete(speakId);
      clear(speakId);
    });
    return () => {
      unsubChunk?.();
      unsubDone();
      unsubError();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => { /* already closed */ });
        audioCtxRef.current = null;
      }
    };
  }, []);

  /** Silently stop every playback path (OS utterance, Web Audio, in-flight IPC). */
  const stopAllPlayback = useCallback(() => {
    if (osUtteranceRef.current) {
      window.speechSynthesis.cancel();
      osUtteranceRef.current = null;
    }
    stopAudioSource();
    const id = activeSpeakIdRef.current;
    if (id) {
      window.api.voiceSpeakCancel(id);
      activeSpeakIdRef.current = null;
    }
    chunkBuffersRef.current.clear();
  }, [stopAudioSource]);

  const cancelCurrent = useCallback((announce?: (msg: string) => void) => {
    speakRequestRef.current += 1; // discard any in-flight IPC promise
    stopAllPlayback();
    const wasPlaying = playingCardIdRef.current !== null;
    setPlayingCardId(null);
    playingCardIdRef.current = null;
    if (wasPlaying) announce?.('Playback stopped.');
  }, [stopAllPlayback]);

  const speakCard = useCallback((
    text: string,
    cardId: string,
    announce: (msg: string) => void,
  ) => {
    if (sessionMutedRef.current) return;

    // Cancel any existing playback silently before starting the new one.
    stopAllPlayback();

    speakRequestRef.current += 1;
    const token = speakRequestRef.current;

    setPlayingCardId(cardId);
    playingCardIdRef.current = cardId;
    announce('Playing suggestion…');

    const prefs = voicePrefsRef.current;

    if (!hasTtsEngine(ttsSettingsRef.current)) {
      // OS speechSynthesis fallback — works in Electron, offline, zero setup.
      if (typeof window.speechSynthesis === 'undefined') {
        setPlayingCardId(null);
        playingCardIdRef.current = null;
        announce('Voice unavailable — configure a TTS engine in Settings.');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = clampVolume(prefs?.ttsVolume);
      utterance.rate = clampRate(prefs?.ttsRate);
      // Match the stored voice against the OS voice list when possible.
      if (prefs?.ttsVoiceId && typeof window.speechSynthesis.getVoices === 'function') {
        const match = window.speechSynthesis.getVoices().find(
          (v) => v.name === prefs.ttsVoiceId || v.voiceURI === prefs.ttsVoiceId,
        );
        if (match) utterance.voice = match;
      }
      osUtteranceRef.current = utterance;
      utterance.onend = () => {
        if (osUtteranceRef.current !== utterance) return; // stale (cancelled or superseded)
        osUtteranceRef.current = null;
        setPlayingCardId(null);
        playingCardIdRef.current = null;
      };
      utterance.onerror = () => {
        if (osUtteranceRef.current !== utterance) return;
        osUtteranceRef.current = null;
        setPlayingCardId(null);
        playingCardIdRef.current = null;
        announce('Voice playback failed.');
      };
      window.speechSynthesis.speak(utterance);
      return;
    }

    // IPC path — Piper (local binary) or cloud TTS. Forward the stored voice
    // when set; main falls back to tts.voiceId otherwise.
    const voiceId = prefs?.ttsVoiceId;
    const speakPromise = voiceId ? window.api.voiceSpeak(text, voiceId) : window.api.voiceSpeak(text);
    void speakPromise.then((res) => {
      if (speakRequestRef.current !== token) return; // superseded
      const r = res as { speakId?: string; error?: string };
      if (!r.speakId || r.error) {
        activeSpeakIdRef.current = null;
        setPlayingCardId(null);
        playingCardIdRef.current = null;
        if (r.error) announce(`Voice error: ${r.error}`);
        return;
      }
      activeSpeakIdRef.current = r.speakId;
    }).catch(() => {
      if (speakRequestRef.current !== token) return;
      activeSpeakIdRef.current = null;
      setPlayingCardId(null);
      playingCardIdRef.current = null;
      announce('Voice playback failed.');
    });
  }, [stopAllPlayback]);

  const toggleMute = useCallback((announce: (msg: string) => void) => {
    userToggledMuteRef.current = true;
    const next = !sessionMutedRef.current;
    sessionMutedRef.current = next;
    setSessionMuted(next);

    if (next) {
      // Stop any active playback when muting.
      speakRequestRef.current += 1;
      stopAllPlayback();
      setPlayingCardId(null);
      playingCardIdRef.current = null;
      announce('Voice muted.');
    } else {
      announce('Voice unmuted.');
    }
  }, [stopAllPlayback]);

  return { playingCardId, sessionMuted, speakCard, cancelCurrent, toggleMute };
}
