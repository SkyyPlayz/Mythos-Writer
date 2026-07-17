// Beta 4 M22 — Axis engine: zoom math.
// Exact port of the prototype's Ctrl+scroll zoom (`tlAxisWheel`, 7172) and
// zoom-driven canvas min-width growth (6862–6864).
import type { AxisZoomSeg } from './ticks';

/** Continuous zoom bounds (prototype 7172): ×0.55 – ×44. */
export const ZOOM_X_MIN = 0.55;
export const ZOOM_X_MAX = 44;

/** Wheel step factors (prototype 7172): in ×1.13, out ×0.88. */
export const ZOOM_WHEEL_IN = 1.13;
export const ZOOM_WHEEL_OUT = 0.88;

/** Apply one Ctrl+scroll step. `deltaY < 0` zooms in. */
export function applyWheelZoom(zoomX: number, deltaY: number): number {
  const x = Number.isFinite(zoomX) ? zoomX : 1;
  const factor = deltaY < 0 ? ZOOM_WHEEL_IN : ZOOM_WHEEL_OUT;
  return Math.max(ZOOM_X_MIN, Math.min(ZOOM_X_MAX, x * factor));
}

/** Prototype `tlZoomWL` (6862): per-segment canvas width floor, px. */
export const ZOOM_SEG_MIN_WIDTH: Readonly<Record<AxisZoomSeg, number>> = {
  Year: 0, Quarter: 1600, Month: 2400, Week: 3600, Day: 5400,
};

/** Prototype 6863: effective canvas width = round(max(floor, 1100) × zoomX). */
export function effectiveCanvasWidth(zoomSeg: AxisZoomSeg, zoomX: number): number {
  const floor = ZOOM_SEG_MIN_WIDTH[zoomSeg] ?? 0;
  const x = Number.isFinite(zoomX) ? zoomX : 1;
  return Math.round(Math.max(floor, 1100) * x);
}

/**
 * Prototype 6864: the lanes wrap only gets a `min-width` once zoom applies
 * (segment floor set, or continuous zoom ≠ 1) AND the effective width
 * exceeds 1150px — otherwise the canvas just fills the container.
 * Returns the min-width in px, or null for "no min-width".
 */
export function canvasMinWidth(zoomSeg: AxisZoomSeg, zoomX: number): number | null {
  const floor = ZOOM_SEG_MIN_WIDTH[zoomSeg] ?? 0;
  const x = Number.isFinite(zoomX) ? zoomX : 1;
  const eff = effectiveCanvasWidth(zoomSeg, zoomX);
  if ((floor !== 0 || x !== 1) && eff > 1150) return eff;
  return null;
}
