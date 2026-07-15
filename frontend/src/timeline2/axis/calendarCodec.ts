// Beta 4 M22 — Axis engine: renderer-side mirror of the M21 `when` codec
// (electron-main/src/timelines/codec.ts) plus the NaN-guarded "never blank
// the app" variants §8.2 demands for render paths.
//
// Unit contract (identical to M21): `when` = absolute hours since year 0 in
// the ACTIVE calendar, divided by 10. One tick = 0.1 `when` = 1 hour, so
// every persisted `when` must be a multiple of 0.1 (`roundWhen`).
//
// Unlike the main-process codec these helpers never throw on user/render
// input — out-of-range parts clamp into the calendar and non-finite values
// fall back to the axis start (§8.2: "a NaN once blanked the app; never
// again").
import type { TimelineCalendar } from '../../timelinesTypes';

export interface TimelineInstant {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export const DEFAULT_CALENDAR: TimelineCalendar = {
  preset: 'standard',
  monthsPerYear: 12,
  daysPerMonth: 30,
  hoursPerDay: 24,
};

/** Calendar with every unit coerced to a safe positive integer. */
export function safeCalendar(calendar: Partial<TimelineCalendar> | null | undefined): TimelineCalendar {
  const merged = { ...DEFAULT_CALENDAR, ...(calendar ?? {}) };
  return {
    preset: merged.preset ?? 'custom',
    monthsPerYear: positiveInt(merged.monthsPerYear, DEFAULT_CALENDAR.monthsPerYear),
    daysPerMonth: positiveInt(merged.daysPerMonth, DEFAULT_CALENDAR.daysPerMonth),
    hoursPerDay: positiveInt(merged.hoursPerDay, DEFAULT_CALENDAR.hoursPerDay),
  };
}

/** Hours in one calendar year. */
export function hoursPerYear(calendar: TimelineCalendar): number {
  const cal = safeCalendar(calendar);
  return cal.monthsPerYear * cal.daysPerMonth * cal.hoursPerDay;
}

/** `when`-units in one calendar year (1 when = 10 hours). */
export function whenPerYear(calendar: TimelineCalendar): number {
  return hoursPerYear(calendar) / 10;
}

/** Snap a `when` to the codec's 0.1 tick grid (whole hours). */
export function roundWhen(when: number): number {
  if (!Number.isFinite(when)) return 0;
  return Math.round(when * 10) / 10;
}

/** True when `when` is a finite number the codec can decode. */
export function isValidWhen(when: unknown): when is number {
  return typeof when === 'number' && Number.isFinite(when);
}

/**
 * Decode a `when` into calendar parts. Non-finite input falls back to
 * `fallback` (typically the axis start) — render paths must never throw.
 */
export function safeDecodeWhen(
  when: number | null | undefined,
  calendar: TimelineCalendar,
  fallback = 0,
): TimelineInstant {
  const cal = safeCalendar(calendar);
  const safe = isValidWhen(when) ? when : (isValidWhen(fallback) ? fallback : 0);
  const absoluteHours = Math.round(safe * 10);
  const hpy = hoursPerYear(cal);
  const hpm = cal.daysPerMonth * cal.hoursPerDay;

  const year = Math.floor(absoluteHours / hpy);
  let remainder = absoluteHours - year * hpy;
  const month = Math.floor(remainder / hpm) + 1;
  remainder -= (month - 1) * hpm;
  const day = Math.floor(remainder / cal.hoursPerDay) + 1;
  const hour = remainder - (day - 1) * cal.hoursPerDay;

  return { year, month, day, hour };
}

/**
 * Encode calendar parts into a `when`, clamping each part into the active
 * calendar's range (month 1..monthsPerYear, day 1..daysPerMonth,
 * hour 0..hoursPerDay−1). Result is always tick-aligned.
 */
export function safeEncodeWhen(
  instant: Partial<TimelineInstant>,
  calendar: TimelineCalendar,
): number {
  const cal = safeCalendar(calendar);
  const year = Math.trunc(finiteOr(instant.year, 0));
  const month = clampInt(finiteOr(instant.month, 1), 1, cal.monthsPerYear);
  const day = clampInt(finiteOr(instant.day, 1), 1, cal.daysPerMonth);
  const hour = clampInt(finiteOr(instant.hour, 0), 0, cal.hoursPerDay - 1);

  const absoluteHours =
    year * hoursPerYear(cal) +
    (month - 1) * cal.daysPerMonth * cal.hoursPerDay +
    (day - 1) * cal.hoursPerDay +
    hour;
  return roundWhen(absoluteHours / 10);
}

/** Prototype `fmtWhen`: `Y871 · M3 · D14 · 06:00`. */
export function formatWhen(when: number | null | undefined, calendar: TimelineCalendar, fallback = 0): string {
  const v = safeDecodeWhen(when, calendar, fallback);
  return `Y${v.year} · M${v.month} · D${v.day} · ${String(v.hour).padStart(2, '0')}:00`;
}

/** Prototype `tlCalNote`: `12 months × 30 days × 24h days`. */
export function calendarNote(calendar: TimelineCalendar): string {
  const cal = safeCalendar(calendar);
  return `${cal.monthsPerYear} months × ${cal.daysPerMonth} days × ${cal.hoursPerDay}h days`;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return fallback;
  return n;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
