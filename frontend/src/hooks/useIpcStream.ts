import { useState, useEffect, useCallback, useRef } from 'react';

export interface IpcStreamResult {
  text: string;
  done: boolean;
  error: string | null;
  cancel: () => void;
}

/**
 * Accumulates tokens from stream:token / stream:end / stream:error IPC events
 * for the given streamId. Returns an empty, not-done state when streamId is null.
 *
 * Caller is responsible for starting the stream (window.api.streamStart) and
 * passing the returned streamId here. The cancel() function sends stream:cancel
 * and immediately resets local state.
 */
export function useIpcStream(streamId: string | null): IpcStreamResult {
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevents late-arriving IPC events from updating state after cancel.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!streamId) {
      setText('');
      setDone(false);
      setError(null);
      return;
    }

    cancelledRef.current = false;
    setText('');
    setDone(false);
    setError(null);

    const unsubToken = window.api.onStreamToken(({ streamId: sid, token }: { streamId: string; token: string }) => {
      if (sid !== streamId || cancelledRef.current) return;
      setText((prev) => prev + token);
      window.api.streamAck(streamId, 1);
    });

    const unsubEnd = window.api.onStreamEnd(({ streamId: sid }: { streamId: string }) => {
      if (sid !== streamId || cancelledRef.current) return;
      setDone(true);
    });

    const unsubError = window.api.onStreamError(
      ({ streamId: sid, error: errMsg }: { streamId: string; category: string; error: string }) => {
        if (sid !== streamId || cancelledRef.current) return;
        setError(errMsg);
        setDone(true);
      },
    );

    return () => {
      unsubToken();
      unsubEnd();
      unsubError();
    };
  }, [streamId]);

  const cancel = useCallback(() => {
    if (!streamId || cancelledRef.current) return;
    cancelledRef.current = true;
    void window.api.streamCancel(streamId);
    setText('');
    setDone(false);
    setError(null);
  }, [streamId]);

  return { text, done, error, cancel };
}
