import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastLevel = 'info' | 'warn' | 'error';

export interface ToastState {
  message: string;
  level: ToastLevel;
}

/** Encapsulates the state and timer for an ephemeral toast notification. */
export function useToast(duration = 3000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, level: ToastLevel = 'info') => {
      setToast({ message, level });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  const clearToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast, clearToast };
}
