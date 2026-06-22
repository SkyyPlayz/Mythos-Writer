import { useState, useCallback, useEffect, useRef } from 'react';

/** Minimal TTS engine config needed to decide which playback path to use. */
export interface TtsEngineSettings {
  enabled?: boolean;
  provider: 'local' | 'cloud' | 'auto';
  localBinaryPath?: string;
  cloudApiKey?: string;
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

/**
 * Manages TTS playback for "Hear" buttons.
 *
 * Engine priority:
 * 1. Piper (local) or cloud TTS via IPC — when `ttsSettings` has a configured path/key.
 * 2. OS `window.speechSynthesis` — zero-config default when no engine is configured.
 */
export function useTtsPlayer(ttsSettings?: TtsEngineSettings): UseTtsPlayer {
  const [playingCardId, setPlayingCardId] = useState<string | null>(null);
  const [sessionMuted, setSessionMuted] = useState(false);

  // Refs mirror state for use in async callbacks / event handlers.
  const activeSpeakIdRef = useRef<string | null>(null);
  const sessionMutedRef = useRef(false);
  const playingCardIdRef = useRef<string | null>(null);
  // Incremented on each speakCard call so stale IPC promise resolutions are ignored.
  const speakRequestRef = useRef(0);
  // Active OS utterance; non-null only when using the speechSynthesis path.
  const osUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Stable ref to latest ttsSettings so callbacks pick up changes without re-creating.
  const ttsSettingsRef = useRef(ttsSettings);

  useEffect(() => { sessionMutedRef.current = sessionMuted; }, [sessionMuted]);
  useEffect(() => { playingCardIdRef.current = playingCardId; }, [playingCardId]);
  useEffect(() => { ttsSettingsRef.current = ttsSettings; }, [ttsSettings]);

  // Subscribe to IPC push events (only relevant on the Piper/cloud path).
  useEffect(() => {
    const clear = (speakId: string) => {
      if (activeSpeakIdRef.current !== speakId) return;
      activeSpeakIdRef.current = null;
      setPlayingCardId(null);
      playingCardIdRef.current = null;
    };
    const unsubDone = window.api.onVoiceSpeakDone(({ speakId }) => clear(speakId));
    const unsubError = window.api.onVoiceSpeakError(({ speakId }) => clear(speakId));
    return () => {
      unsubDone();
      unsubError();
    };
  }, []);

  const cancelCurrent = useCallback((announce?: (msg: string) => void) => {
    speakRequestRef.current += 1; // discard any in-flight IPC promise
    // OS path
    if (osUtteranceRef.current) {
      window.speechSynthesis.cancel();
      osUtteranceRef.current = null;
    }
    // IPC path
    const id = activeSpeakIdRef.current;
    if (id) {
      window.api.voiceSpeakCancel(id);
      activeSpeakIdRef.current = null;
    }
    const wasPlaying = playingCardIdRef.current !== null;
    setPlayingCardId(null);
    playingCardIdRef.current = null;
    if (wasPlaying) announce?.('Playback stopped.');
  }, []);

  const speakCard = useCallback((
    text: string,
    cardId: string,
    announce: (msg: string) => void,
  ) => {
    if (sessionMutedRef.current) return;

    // Cancel any existing playback silently before starting the new one.
    if (osUtteranceRef.current) {
      window.speechSynthesis.cancel();
      osUtteranceRef.current = null;
    }
    const currentIpcId = activeSpeakIdRef.current;
    if (currentIpcId) {
      window.api.voiceSpeakCancel(currentIpcId);
      activeSpeakIdRef.current = null;
    }

    speakRequestRef.current += 1;
    const token = speakRequestRef.current;

    setPlayingCardId(cardId);
    playingCardIdRef.current = cardId;
    announce('Playing suggestion…');

    if (!hasTtsEngine(ttsSettingsRef.current)) {
      // OS speechSynthesis fallback — works in Electron, offline, zero setup.
      if (typeof window.speechSynthesis === 'undefined') {
        setPlayingCardId(null);
        playingCardIdRef.current = null;
        announce('Voice unavailable — configure a TTS engine in Settings.');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
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

    // IPC path — Piper (local binary) or cloud TTS.
    void window.api.voiceSpeak(text).then((res) => {
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
  }, []);

  const toggleMute = useCallback((announce: (msg: string) => void) => {
    const next = !sessionMutedRef.current;
    sessionMutedRef.current = next;
    setSessionMuted(next);

    if (next) {
      // Stop any active playback when muting.
      if (osUtteranceRef.current) {
        window.speechSynthesis.cancel();
        osUtteranceRef.current = null;
      }
      const id = activeSpeakIdRef.current;
      if (id) {
        window.api.voiceSpeakCancel(id);
        activeSpeakIdRef.current = null;
        speakRequestRef.current += 1;
      }
      setPlayingCardId(null);
      playingCardIdRef.current = null;
      announce('Voice muted.');
    } else {
      announce('Voice unmuted.');
    }
  }, []);

  return { playingCardId, sessionMuted, speakCard, cancelCurrent, toggleMute };
}
