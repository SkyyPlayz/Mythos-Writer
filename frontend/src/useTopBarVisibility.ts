/**
 * SKY-3207 (B4): Part C integration hook for the hideable top bar.
 *
 * Part C focus modes should call `setTopBarHidden(true/false)` to request a
 * hide/reveal without needing to know about AppSettings internals.  DesktopShell
 * listens for the DOM event dispatched here and owns the authoritative state.
 *
 * Usage in a Part C component:
 *   const { setTopBarHidden } = useTopBarVisibility();
 *   setTopBarHidden(true);  // hide on focus-mode enter
 *   setTopBarHidden(false); // restore on focus-mode exit
 */
import { useCallback } from 'react';

/** DOM event name used as the stable Part C ↔ DesktopShell contract. */
export const TOPBAR_HIDE_EVENT = 'mythos:set-topbar-hidden' as const;

export interface TopBarVisibilityControl {
  /**
   * Request the top bar to be shown or hidden.
   * DesktopShell handles persistence; callers don't need to manage AppSettings.
   */
  setTopBarHidden: (hidden: boolean) => void;
}

export function useTopBarVisibility(): TopBarVisibilityControl {
  const setTopBarHidden = useCallback((hidden: boolean) => {
    window.dispatchEvent(
      new CustomEvent<{ hidden: boolean }>(TOPBAR_HIDE_EVENT, { detail: { hidden } }),
    );
  }, []);

  return { setTopBarHidden };
}
