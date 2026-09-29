// Slice E — Dual date stamps (03 §2) + ghost nest math (v2.4.1 = 1/8).
import type { TimelineCalendar, TimelineDefinition } from '../../timelinesTypes';
import {
  eraOf,
  resolveStdCalendar,
  safeCalendar,
  safeDecodeWhen,
  toStandard,
} from './calendarCodec';

/** v2.4.1 conflict lock: ghost tail = 1/8 of plotted span (not 34% / ~1/3). */
export const GHOST_TAIL_RATIO = 1 / 8;

export function formatLocalStamp(
  when: number,
  calendar: TimelineCalendar,
  era: string,
  withTime = true,
  fallback = 0,
): string {
  const v = safeDecodeWhen(when, calendar, fallback);
  const hh = String(v.hour).padStart(2, '0');
  const head = `M${v.month} D${v.day}${withTime ? ` ${hh}:00` : ''}`;
  const eraPart = era.trim() ? ` ${era.trim()}` : '';
  return `${head} · ${v.year}${eraPart}`;
}

/** Coarser standard stamp: `{year} {rootEra} · mo {m}`. */
export function formatStandardStamp(
  when: number,
  stdCalendar: TimelineCalendar,
  rootEra: string,
  fallback = 0,
): string {
  const v = safeDecodeWhen(when, stdCalendar, fallback);
  const era = rootEra.trim() || 'UST';
  return `${v.year} ${era} · mo ${v.month}`;
}

export interface DualStampResult {
  local: string;
  standard: string;
  /** True when the active timeline IS the universal standard. */
  isStandardTimeline: boolean;
}

/**
 * Dual stamps for a local `when` on `timeline`, walking to the root standard
 * via epoch offset (`toStandard`).
 */
export function dualStampsFor(
  when: number,
  timeline: Pick<TimelineDefinition, 'ep' | 'calendar' | 'era' | 'std'>,
  timelines: ReadonlyArray<Pick<TimelineDefinition, 'std' | 'calendar' | 'era'>>,
  withTime = true,
  fallback = 0,
): DualStampResult {
  const localCal = safeCalendar(timeline.calendar);
  const stdCal = resolveStdCalendar(timelines);
  const stdTl = timelines.find((t) => t.std);
  const rootEra = stdTl ? eraOf(stdTl) : timeline.std ? eraOf(timeline) : 'UST';
  const localEra = timeline.std
    ? (timeline.era?.trim() ? eraOf(timeline) : 'UST')
    : eraOf(timeline);

  const isStandardTimeline = timeline.std === true;
  const local = formatLocalStamp(when, localCal, localEra, withTime, fallback);
  if (isStandardTimeline) {
    return {
      local,
      standard: `${formatStandardStamp(when, localCal, rootEra, fallback)} — this timeline IS the standard`,
      isStandardTimeline: true,
    };
  }
  const stdWhen = toStandard(timeline, stdCal, when);
  return {
    local,
    standard: formatStandardStamp(stdWhen, stdCal, rootEra),
    isStandardTimeline: false,
  };
}

/** Ghost label thresholds from prototype v2.4.1 (px of ghost width). */
export function ghostLabelForWidth(tailPx: number): string {
  if (tailPx > 86) return 'OPEN RANGE — NEST CAN GROW';
  if (tailPx > 34) return 'open';
  return '';
}

/** Vertical board zoom clamp: 40–160% in 10% steps. */
export function clampVZoom(pct: number): number {
  const stepped = Math.round(pct / 10) * 10;
  return Math.max(40, Math.min(160, stepped));
}
