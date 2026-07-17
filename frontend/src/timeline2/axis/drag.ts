// Beta 4 M22 — Axis engine: universal direct-manipulation time math.
// Pure ports of the prototype's `mkAxisDrag` (6057–6074: span-likes move +
// 7px/6px edge handles resize) and `tlEvDrag` (5241–5251: point items move
// only, clamped to the axis). All results snap to the codec's 0.1 tick grid
// so persisted `when`s always round-trip through the M21 codec.
import { roundWhen } from './calendarCodec';

/** Prototype drag thresholds: span-likes arm past 2px (6063 `> 2`), point
 *  events past 3px (5249 `> 3`) — both are "3px threshold" per §8.3. */
export const SPAN_DRAG_THRESHOLD_PX = 2;
export const EVENT_DRAG_THRESHOLD_PX = 3;

/** True once the pointer has travelled far enough to count as a drag. */
export function dragArmed(startClientX: number, clientX: number, thresholdPx: number): boolean {
  return Math.abs(clientX - startClientX) > thresholdPx;
}

/** Pixel delta → `when` delta across a row of `rectWidthPx` px spanning
 *  [t0, t1]. Degenerate rects yield 0 (never NaN). */
export function pixelsToWhen(dxPx: number, rectWidthPx: number, t0: number, t1: number): number {
  const span = t1 - t0;
  if (!Number.isFinite(dxPx) || !Number.isFinite(span) || !(rectWidthPx > 0)) return 0;
  return (dxPx / rectWidthPx) * span;
}

export type AxisDragMode = 'move' | 'resize-left' | 'resize-right';

export interface SpanDragResult {
  startWhen: number;
  endWhen: number;
}

/**
 * Prototype `mkAxisDrag` move/resize math (6064–6069):
 *  - move: both edges shift by the delta;
 *  - resize-left: the start edge moves but stays ≥ 1% of the axis span
 *    before the end (`nf = min(t0v − spanW·.01, f0 + dw)`);
 *  - resize-right: mirrored (`nt = max(f0 + spanW·.01, t0v + dw)`).
 * Results snap to the 0.1 tick grid (prototype `Math.round(nf*10)/10`).
 */
export function applySpanDrag(
  mode: AxisDragMode,
  startWhen0: number,
  endWhen0: number,
  dWhen: number,
  axisT0: number,
  axisT1: number,
): SpanDragResult {
  const minSep = (axisT1 - axisT0) * 0.01;
  let start = startWhen0;
  let end = endWhen0;
  if (mode === 'move') {
    start = startWhen0 + dWhen;
    end = endWhen0 + dWhen;
  } else if (mode === 'resize-left') {
    start = Math.min(endWhen0 - minSep, startWhen0 + dWhen);
  } else {
    end = Math.max(startWhen0 + minSep, endWhen0 + dWhen);
  }
  return { startWhen: roundWhen(start), endWhen: roundWhen(end) };
}

/**
 * Prototype `tlEvDrag` (5249): point items move only, clamped to the axis
 * — `max(axis[0], min(axis[1], w0 + dx/rect.width · span))` — then snapped
 * to the tick grid (the codec requires 0.1 precision).
 */
export function applyEventDrag(
  when0: number,
  dWhen: number,
  axisT0: number,
  axisT1: number,
): number {
  const base = Number.isFinite(when0) ? when0 : axisT0;
  return roundWhen(Math.max(axisT0, Math.min(axisT1, base + dWhen)));
}
