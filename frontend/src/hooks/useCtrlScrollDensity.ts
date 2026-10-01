/**
 * F2#17 — Ctrl/Cmd + wheel adjusts interface density in the app shell.
 * Timeline / Realm / Boards canvases keep their own Ctrl-scroll zoom (excluded).
 * MUST go through lib/uiDensity (same setter as F2#9).
 */
import { useEffect } from 'react';
import {
  densFromWheelDelta,
  getPendingOrRegisteredDensity,
  previewAndScheduleCommit,
} from '../lib/uiDensity';

/** Real canvas roots (Probe/Critic H4) — dead selectors removed. */
const CANVAS_ZOOM_SELECTOR = [
  '.ax-root',
  '.board-canvas__root',
  '.vgv-root',
  '.msv-sheet',
].join(',');

export function isCanvasZoomTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(CANVAS_ZOOM_SELECTOR));
}

export function useCtrlScrollDensity(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // Canvas zoom handlers preventDefault first — dens must not steal.
      if (e.defaultPrevented) return;
      if (isCanvasZoomTarget(e.target)) return;
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;

      e.preventDefault();
      const next = densFromWheelDelta(getPendingOrRegisteredDensity(), e.deltaY);
      previewAndScheduleCommit(next);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled]);
}
