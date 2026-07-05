// Beta 3 / M17 — Canvas board engine: pure layout/interaction math.
// No DOM. Every constant and formula is ported 1:1 from the Liquid Neon
// prototype (design-handoff/prototype, Component class + renderVals):
//   wheel/button zoom + clamp . . . lines 4775–4779
//   card drag (zoom-scaled) . . . . lines 3425–3435
//   corner resize (min 130×60)  . . lines 3436–3446
//   link bezier path  . . . . . . . lines 4795–4799
//   add-card spawn point  . . . . . line 4781

import type { CanvasCard } from './canvasTypes';

// ─── Constants (prototype values) ────────────────────────────────────────────

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.4;
/** Wheel step factors: `cvZoom * (deltaY < 0 ? 1.1 : .92)` (line 4775). */
export const WHEEL_ZOOM_IN = 1.1;
export const WHEEL_ZOOM_OUT = 0.92;
/** Dock button step factors: `* 1.15` in, `* .87` out (lines 4777–4778). */
export const BUTTON_ZOOM_IN = 1.15;
export const BUTTON_ZOOM_OUT = 0.87;
/** Minimum card size enforced by the corner resize (line 3442). */
export const CARD_MIN_W = 130;
export const CARD_MIN_H = 60;
/** Defaults for a freshly added card (line 4781). */
export const NEW_CARD_W = 190;
export const NEW_CARD_H = 80;
/** Virtual stage size the prototype pans/zooms within (line 4770). */
export const STAGE_W = 2200;
export const STAGE_H = 1500;

/** Pan offset + zoom scale of the board stage (transform-origin 0 0). */
export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

// ─── Zoom ────────────────────────────────────────────────────────────────────

/** Clamp a zoom factor into the prototype's `.4 – 2.4` range. */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/** Wheel zoom: scroll up zooms in ×1.1, scroll down zooms out ×0.92, clamped. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * (deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT));
}

/** Dock `+` button: ×1.15, clamped. */
export function zoomIn(zoom: number): number {
  return clampZoom(zoom * BUTTON_ZOOM_IN);
}

/** Dock `−` button: ×0.87, clamped. */
export function zoomOut(zoom: number): number {
  return clampZoom(zoom * BUTTON_ZOOM_OUT);
}

/**
 * Re-anchor a zoom change so the board point under the viewport point
 * `(pointX, pointY)` stays stationary (screen = pan + board × zoom).
 * The prototype itself zooms about the stage origin (pan untouched); this
 * helper is for callers that want pointer-anchored zoom on top of the same
 * clamped scale.
 */
export function zoomAtPoint(
  view: ViewTransform,
  nextZoom: number,
  pointX: number,
  pointY: number,
): ViewTransform {
  const zoom = clampZoom(nextZoom);
  const boardX = (pointX - view.panX) / view.zoom;
  const boardY = (pointY - view.panY) / view.zoom;
  return { zoom, panX: pointX - boardX * zoom, panY: pointY - boardY * zoom };
}

// ─── Card drag / resize ──────────────────────────────────────────────────────

/**
 * Card drag: screen-space mouse deltas are divided by the zoom factor and the
 * result is clamped to the positive quadrant (`Math.max(0, …)`, line 3431).
 */
export function dragCardPosition(
  originX: number,
  originY: number,
  deltaScreenX: number,
  deltaScreenY: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, originX + deltaScreenX / zoom),
    y: Math.max(0, originY + deltaScreenY / zoom),
  };
}

/** Clamp a card size to the 130×60 minimum (line 3442). */
export function clampCardSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(CARD_MIN_W, w), h: Math.max(CARD_MIN_H, h) };
}

/** Corner resize: zoom-scaled deltas, clamped to the 130×60 minimum. */
export function resizeCardSize(
  originW: number,
  originH: number,
  deltaScreenX: number,
  deltaScreenY: number,
  zoom: number,
): { w: number; h: number } {
  return clampCardSize(originW + deltaScreenX / zoom, originH + deltaScreenY / zoom);
}

/**
 * Spawn point for a new card: the fixed viewport point (240, 180) mapped back
 * into board coordinates (`240 - panX / zoom, 180 - panY / zoom`, line 4781).
 */
export function newCardPosition(view: ViewTransform): { x: number; y: number } {
  return { x: 240 - view.panX / view.zoom, y: 180 - view.panY / view.zoom };
}

// ─── Link beziers ────────────────────────────────────────────────────────────

/**
 * Cubic bezier between two card centers, exactly as the prototype emits it
 * (lines 4797–4799): horizontal S-curve through the midpoint x.
 */
export function linkPath(
  from: Pick<CanvasCard, 'x' | 'y' | 'w' | 'h'>,
  to: Pick<CanvasCard, 'x' | 'y' | 'w' | 'h'>,
): string {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h / 2;
  const x2 = to.x + to.w / 2;
  const y2 = to.y + to.h / 2;
  const mx = (x1 + x2) / 2;
  return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
}

// ─── Fit to content ──────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding rect of all cards, or null for an empty board. */
export function contentBounds(cards: readonly Pick<CanvasCard, 'x' | 'y' | 'w' | 'h'>[]): Rect | null {
  if (cards.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const card of cards) {
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + card.w);
    maxY = Math.max(maxY, card.y + card.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Fit the card bounding rect into the viewport with `padding` px on each side,
 * centered, with the zoom clamped to the `.4 – 2.4` range. Empty boards (or a
 * degenerate viewport, e.g. before first layout) reset to the prototype's Fit
 * state: zoom 1 at pan (0, 0) (line 4779).
 */
export function fitToContent(
  cards: readonly Pick<CanvasCard, 'x' | 'y' | 'w' | 'h'>[],
  viewportW: number,
  viewportH: number,
  padding = 60,
): ViewTransform {
  const bounds = contentBounds(cards);
  if (!bounds || viewportW <= 0 || viewportH <= 0) return { zoom: 1, panX: 0, panY: 0 };
  const zoom = clampZoom(
    Math.min((viewportW - 2 * padding) / bounds.w, (viewportH - 2 * padding) / bounds.h),
  );
  return {
    zoom,
    panX: (viewportW - bounds.w * zoom) / 2 - bounds.x * zoom,
    panY: (viewportH - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}
