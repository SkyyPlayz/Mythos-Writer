import { useState, useCallback } from 'react';

/**
 * Returns an `announce` function and a `liveText` string.
 * Render a visually-hidden element with aria-live="polite" that displays `liveText`.
 * Calling `announce(msg)` sets the text so screen readers read it once.
 */
export function useLiveAnnounce() {
  const [liveText, setLiveText] = useState('');

  const announce = useCallback((message: string) => {
    // Clear first so re-announcing the same string still fires
    setLiveText('');
    requestAnimationFrame(() => setLiveText(message));
  }, []);

  return { announce, liveText };
}
