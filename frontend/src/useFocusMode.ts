import { useState, useEffect, useCallback, useRef } from 'react';

export interface FocusModeState {
  distractionFree: boolean;
  toggle: () => void;
  exit: () => void;
}

export function useFocusMode(): FocusModeState {
  const [distractionFree, setDistractionFree] = useState(false);
  const dfRef = useRef(false);
  dfRef.current = distractionFree;

  const toggle = useCallback(() => setDistractionFree(v => !v), []);
  const exit = useCallback(() => setDistractionFree(false), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        setDistractionFree(v => !v);
      } else if (e.key === 'Escape' && dfRef.current) {
        setDistractionFree(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { distractionFree, toggle, exit };
}
