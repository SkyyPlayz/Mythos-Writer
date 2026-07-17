// Beta 4 M22 — Axis engine: adaptive tick generation + axis percent math.
// Exact port of the prototype ("Mythos Writer - Liquid Neon.dc.html"
// 6640/6655/6683–6688), converted to the M21 `when` unit (hours ÷ 10; the
// prototype stored year × 10, so its step thresholds 5 / .8 / .04 are
// 0.5 / 0.08 / 0.004 years here).
import type { TimelineCalendar } from '../../timelinesTypes';
import { safeDecodeWhen, whenPerYear } from './calendarCodec';

/** Prototype zoom segment (`tlZoomOpts`, 6035). */
export type AxisZoomSeg = 'Year' | 'Quarter' | 'Month' | 'Week' | 'Day';

export const AXIS_ZOOM_SEGS: readonly AxisZoomSeg[] = ['Year', 'Quarter', 'Month', 'Week', 'Day'];

/** Prototype `tlTickBaseN` (6683). */
export const TICK_BASE_BY_ZOOM: Readonly<Record<AxisZoomSeg, number>> = {
  Year: 5, Quarter: 7, Month: 9, Week: 13, Day: 19,
};

/** Prototype `tlTickN` (6684): base × zoomX, clamped 4–60. */
export function tickCount(zoomSeg: AxisZoomSeg, zoomX: number): number {
  const base = TICK_BASE_BY_ZOOM[zoomSeg] ?? 5;
  const x = Number.isFinite(zoomX) ? zoomX : 1;
  return Math.max(4, Math.min(60, Math.round(base * Math.max(1, x))));
}

/**
 * The `when` step that drives LABEL granularity: base × zoomX WITHOUT the
 * 60-tick render cap. Deliberate deviation from the prototype's
 * `tlStepW = (t1−t0)/tlTickN`: with the cap, ticks over a years-long axis
 * could never re-label to hours no matter how far Ctrl+scroll went, which
 * fails §14.4 step 5 ("ctrl+scroll to half-day — ticks re-label to hours").
 * Rendered tick COUNT still respects the prototype cap (tickCount above).
 */
export function labelStepWhen(t0: number, t1: number, zoomSeg: AxisZoomSeg, zoomX: number): number {
  const base = TICK_BASE_BY_ZOOM[zoomSeg] ?? 5;
  const x = Number.isFinite(zoomX) ? zoomX : 1;
  return (t1 - t0) / Math.max(4, base * Math.max(1, x));
}

/** Prototype `tlPct` (6640): item percent along the axis, clamped 1.5–98.5. */
export function axisPct(when: number | null | undefined, t0: number, t1: number): number {
  let w = when;
  if (w == null || !Number.isFinite(w)) w = t0;
  const span = t1 - t0;
  if (!Number.isFinite(span) || span <= 0) return 1.5;
  return Math.max(1.5, Math.min(98.5, ((w - t0) / span) * 100));
}

/** Prototype `tlPctL` (6055): lane variant clamped 1–99. */
export function axisPctL(when: number | null | undefined, t0: number, t1: number): number {
  const w = when == null || !Number.isFinite(when) ? t0 : when;
  const span = t1 - t0;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.min(99, ((w - t0) / span) * 100));
}

export interface AxisTick {
  when: number;
  /** Unclamped-then-clamped percent along the axis (prototype `tlPct`). */
  pct: number;
  label: string;
}

/**
 * Prototype adaptive tick label (`tlTickLabel`, 6687): granularity follows
 * the step between ticks — year → year·month → month·day → day·hour.
 */
export function tickLabel(when: number, stepWhen: number, calendar: TimelineCalendar): string {
  const v = safeDecodeWhen(when, calendar, 0);
  const stepYears = stepWhen / whenPerYear(calendar);
  if (stepYears >= 0.5) return `${v.year} EC`;
  if (stepYears >= 0.08) return `Y${v.year} · M${v.month}`;
  if (stepYears >= 0.004) return `M${v.month} · D${v.day}`;
  return `D${v.day} · ${String(v.hour).padStart(2, '0')}:00`;
}

/**
 * Interior axis ticks (prototype 6685: i = 1..N−1 — the edges carry no tick).
 * Degrades to [] on a degenerate axis instead of throwing.
 */
export function generateTicks(
  t0: number,
  t1: number,
  zoomSeg: AxisZoomSeg,
  zoomX: number,
  calendar: TimelineCalendar,
): AxisTick[] {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return [];
  const n = tickCount(zoomSeg, zoomX);
  const step = (t1 - t0) / n;
  const labelStep = labelStepWhen(t0, t1, zoomSeg, zoomX);
  const ticks: AxisTick[] = [];
  for (let i = 1; i < n; i++) {
    const when = t0 + step * i;
    ticks.push({ when, pct: axisPct(when, t0, t1), label: tickLabel(when, labelStep, calendar) });
  }
  return ticks;
}
