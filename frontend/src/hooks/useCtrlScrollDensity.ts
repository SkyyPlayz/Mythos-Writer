/**
 * F2#17 — Ctrl/Cmd + wheel adjusts interface density in the app shell.
 * Timeline / Realm / Boards canvases keep their own Ctrl-scroll zoom (excluded).
 * MUST go through lib/uiDensity (same setter as F2#9).
 */
import { useEffect } from 'react';
import {
  densFromWheelDelta,
  getRegisteredDensity,
  previewAndScheduleCommit,
} from '../lib/uiDensity';

const CANVAS_ZOOM_SELECTOR = [
  '[data-timeline-canvas]',
  '[data-realm-canvas]',
  '[data-boards-canvas]',
  '.timeline2-root',
  '.vault-graph-view',
  '.board-canvas',
  '.brainstorm-board',
  '.msv-sheet',
].join(',');

function isCanvasZoomTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(CANVAS_ZOOM_SELECTOR));
}

export function useCtrlScrollDensity(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (isCanvasZoomTarget(e.target)) return;
      // Don't steal browser zoom inside Settings range inputs while focused.
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;

      e.preventDefault();
      const next = densFromWheelDelta(getRegisteredDensity(), e.deltaY);
      previewAndScheduleCommit(next);
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, true);
  }, [enabled]);
}
