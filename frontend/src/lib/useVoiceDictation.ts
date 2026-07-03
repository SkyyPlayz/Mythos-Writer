/**
 * useVoiceDictation — single-shot STT via MediaRecorder + voice:transcribe IPC.
 *
 * Replaces the broken Web Speech API path in packaged Electron. Records mic
 * audio with MediaRecorder, posts the full recording to the main-process
 * voice:transcribe handler (Whisper-backed), then fires onTranscript with the
 * result text.
 *
 * State machine: idle ↔ listening → processing → idle | error
 */

import { useCallback, useRef, useState } from 'react';

export type VoiceDictationState = 'idle' | 'listening' | 'processing' | 'error';

export interface UseVoiceDictationOptions {
  /** Called with the transcribed text on success. */
  onTranscript: (text: string) => void;
  /** Called with a human-readable error message on failure. */
  onError?: (message: string) => void;
  /**
   * Silence auto-stop: stop recording after this many ms of continuous audio
   * with no explicit stop call. Defaults to 30 000 (30 s) as a safety cap.
   * Set to 0 to disable.
   */
  maxDurationMs?: number;
  /**
   * Preferred microphone deviceId (settings.voice.micDeviceId). Falls back to
   * the default mic when the device is unavailable (e.g. unplugged).
   */
  micDeviceId?: string;
  /** BCP-47 STT language hint (settings.voice.inputLanguage), e.g. 'en-US'. Absent = auto-detect. */
  inputLanguage?: string;
}

export interface UseVoiceDictationResult {
  state: VoiceDictationState;
  errorMessage: string;
  /** Start recording. No-op if already listening or processing. */
  start: () => Promise<void>;
  /** Stop recording and trigger transcription. No-op when idle. */
  stop: () => void;
  /** Stop recording and discard audio. No-op when idle. */
  cancel: () => void;
}

/** Convert a Blob to ArrayBuffer via FileReader (works in all environments). */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Pick the best supported MIME type for Whisper compatibility. */
function pickMimeType(): string {
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const mime of preferred) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function useVoiceDictation({
  onTranscript,
  onError,
  maxDurationMs = 30_000,
  micDeviceId,
  inputLanguage,
}: UseVoiceDictationOptions): UseVoiceDictationResult {
  const [state, _setState] = useState<VoiceDictationState>('idle');
  const stateRef = useRef<VoiceDictationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether a stop was a cancel so the ondataavailable handler can skip transcription
  const cancelledRef = useRef(false);

  const setState = useCallback((s: VoiceDictationState) => {
    stateRef.current = s;
    _setState(s);
  }, []);

  const cleanup = useCallback(() => {
    if (maxDurationTimerRef.current !== null) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;

    cancelledRef.current = false;
    setErrorMessage('');

    let stream: MediaStream;
    try {
      if (micDeviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micDeviceId } },
          });
        } catch (err) {
          // A stored deviceId may reference an unplugged/renamed mic — fall
          // back to the default device instead of failing the dictation.
          const name = (err as { name?: string } | null)?.name;
          if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied';
      setErrorMessage(msg);
      setState('error');
      onError?.(msg);
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      // Snapshot chunks before cleanup() resets the ref.
      const capturedChunks = [...chunksRef.current];
      cleanup();
      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      setState('processing');
      const blob = new Blob(capturedChunks, { type: mimeType || 'audio/webm' });
      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await blobToArrayBuffer(blob);
      } catch {
        const msg = 'Failed to read recorded audio.';
        setErrorMessage(msg);
        setState('error');
        onError?.(msg);
        return;
      }

      try {
        const result = await window.api.voiceTranscribe(arrayBuffer, mimeType || undefined, inputLanguage) as
          | { text: string; confidence?: number }
          | { error: string };

        if ('error' in result) {
          setErrorMessage(result.error);
          setState('error');
          onError?.(result.error);
        } else {
          const text = result.text.trim();
          if (text) onTranscript(text);
          setState('idle');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription failed.';
        setErrorMessage(msg);
        setState('error');
        onError?.(msg);
      }
    };

    recorder.start();
    setState('listening');

    if (maxDurationMs > 0) {
      maxDurationTimerRef.current = setTimeout(() => {
        if (stateRef.current === 'listening') {
          recorderRef.current?.stop();
        }
      }, maxDurationMs);
    }
  }, [cleanup, inputLanguage, maxDurationMs, micDeviceId, onError, onTranscript, setState]);

  const stop = useCallback(() => {
    if (stateRef.current !== 'listening') return;
    cancelledRef.current = false;
    if (maxDurationTimerRef.current !== null) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    if (stateRef.current === 'idle') return;
    cancelledRef.current = true;
    if (maxDurationTimerRef.current !== null) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanup();
      setState('idle');
    }
  }, [cleanup, setState]);

  return { state, errorMessage, start, stop, cancel };
}
