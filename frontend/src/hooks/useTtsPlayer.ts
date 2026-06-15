import { useState, useCallback, useEffect, useRef } from 'react';

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

export function useTtsPlayer(): UseTtsPlayer {
  const [playingCardId, setPlayingCardId] = useState<string | null>(null);
  const [sessionMuted, setSessionMuted] = useState(false);

  // Refs mirror state for use in async callbacks / event handlers.
  const activeSpeakIdRef = useRef<string | null>(null);
  const sessionMutedRef = useRef(false);
  const playingCardIdRef = useRef<string | null>(null);
  // Incremented on each speakCard call so stale promise resolutions are ignored.
  const speakRequestRef = useRef(0);

  useEffect(() => { sessionMutedRef.current = sessionMuted; }, [sessionMuted]);
  useEffect(() => { playingCardIdRef.current = playingCardId; }, [playingCardId]);

  // Subscribe to TTS push events for the lifetime of the component.
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
    speakRequestRef.current += 1; // discard any in-flight speakCard promise
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

    // Cancel any existing playback silently.
    const currentId = activeSpeakIdRef.current;
    if (currentId) {
      window.api.voiceSpeakCancel(currentId);
      activeSpeakIdRef.current = null;
    }

    speakRequestRef.current += 1;
    const token = speakRequestRef.current;

    setPlayingCardId(cardId);
    playingCardIdRef.current = cardId;
    announce('Playing suggestion…');

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
