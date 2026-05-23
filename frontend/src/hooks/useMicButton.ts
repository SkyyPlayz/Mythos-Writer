import { useState, useRef, useCallback, useEffect } from 'react';

export type MicState = 'idle' | 'recording' | 'error';

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((event: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): AnyConstructor | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseMicButtonOptions {
  micDeviceId?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (msg: string) => void;
}

export function useMicButton({ micDeviceId, onTranscript, onError }: UseMicButtonOptions) {
  const [micState, setMicState] = useState<MicState>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) {
      window.api.voiceStop(sid).catch(() => {});
    }
    setMicState('idle');
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (micState === 'recording') {
      stopRecording();
      return;
    }

    try {
      const result = await window.api.voiceStart(micDeviceId);
      const sessionId = result.sessionId;
      sessionIdRef.current = sessionId;

      unsubscribeRef.current = window.api.onVoiceTranscript((ev) => {
        if (ev.sessionId !== sessionId) return;
        onTranscript(ev.text, ev.isFinal);
      });

      const SpeechRecognitionCtor = getSpeechRecognition();
      if (SpeechRecognitionCtor) {
        const rec = new SpeechRecognitionCtor();
        rec.continuous = true;
        rec.interimResults = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (event: any) => {
          const r = event.results[event.results.length - 1];
          const text: string = r[0].transcript;
          const isFinal: boolean = r.isFinal;
          window.api.voiceLocalTranscript(sessionId, text, isFinal);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onerror = (event: any) => {
          onError?.(`Speech recognition error: ${event.error}`);
          stopRecording();
        };
        rec.onend = () => {
          if (sessionIdRef.current === sessionId) stopRecording();
        };
        rec.start();
        recognitionRef.current = rec;
      }

      setMicState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone error';
      onError?.(msg);
      setMicState('error');
      setTimeout(() => setMicState('idle'), 2000);
    }
  }, [micState, micDeviceId, onTranscript, onError, stopRecording]);

  return { micState, startRecording, stopRecording };
}
