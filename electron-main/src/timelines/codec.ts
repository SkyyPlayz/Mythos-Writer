import type { TimelineCalendar, TimelineInstant } from './model.js';
import { DEFAULT_TIMELINE_CALENDAR } from './model.js';

const MAX_ABSOLUTE_TICKS = 9_000_000_000_000_000;

export function normalizeCalendar(calendar: Partial<TimelineCalendar> | undefined): TimelineCalendar {
  const merged = { ...DEFAULT_TIMELINE_CALENDAR, ...(calendar ?? {}) };
  const monthsPerYear = positiveInteger(merged.monthsPerYear, 'monthsPerYear');
  const daysPerMonth = positiveInteger(merged.daysPerMonth, 'daysPerMonth');
  const hoursPerDay = positiveInteger(merged.hoursPerDay, 'hoursPerDay');
  return {
    preset: merged.preset ?? 'custom',
    monthsPerYear,
    daysPerMonth,
    hoursPerDay,
  };
}

export function encodeWhen(instant: TimelineInstant, calendarInput?: Partial<TimelineCalendar>): number {
  const calendar = normalizeCalendar(calendarInput);
  assertInstantInCalendar(instant, calendar);

  const absoluteHours =
    instant.year * calendar.monthsPerYear * calendar.daysPerMonth * calendar.hoursPerDay +
    (instant.month - 1) * calendar.daysPerMonth * calendar.hoursPerDay +
    (instant.day - 1) * calendar.hoursPerDay +
    instant.hour;

  if (!Number.isSafeInteger(absoluteHours)) {
    throw new RangeError('when is outside the safe integer range');
  }

  return absoluteHours / 10;
}

export function decodeWhen(when: number, calendarInput?: Partial<TimelineCalendar>): TimelineInstant {
  const calendar = normalizeCalendar(calendarInput);
  const absoluteHours = parseWhenTicks(when);
  const hoursPerYear = calendar.monthsPerYear * calendar.daysPerMonth * calendar.hoursPerDay;
  const hoursPerMonth = calendar.daysPerMonth * calendar.hoursPerDay;

  const year = Math.floor(absoluteHours / hoursPerYear);
  let remainder = absoluteHours - year * hoursPerYear;
  const month = Math.floor(remainder / hoursPerMonth) + 1;
  remainder -= (month - 1) * hoursPerMonth;
  const day = Math.floor(remainder / calendar.hoursPerDay) + 1;
  const hour = remainder - (day - 1) * calendar.hoursPerDay;

  return { year, month, day, hour };
}

export function assertValidWhen(when: number): void {
  parseWhenTicks(when);
}

/**
 * Relative tolerance for the tenth-precision gate below. A `when` produced by
 * `encodeWhen` (integer ticks / 10) can drift from an exact multiple of 0.1 by
 * a few ULPs once it has been through arithmetic or a JSON round-trip, so a
 * raw `Number.EPSILON` comparison is too fragile: it rejects legitimately
 * codec-aligned values after harmless float noise. 1e-9 (relative) is many
 * orders of magnitude wider than accumulated ULP error at every supported
 * magnitude, while still rejecting anything meaningfully off-grid (the nearest
 * off-grid value is 0.05 away in tick space — 5e7 times the tolerance at 1.0).
 */
const TICK_ALIGNMENT_TOLERANCE = 1e-9;

function parseWhenTicks(when: number): number {
  if (!Number.isFinite(when)) {
    throw new RangeError('when must be a finite number');
  }

  const scaledTicks = when * 10;
  const absoluteHours = Math.round(scaledTicks);
  if (!Number.isSafeInteger(absoluteHours) || Math.abs(absoluteHours) > MAX_ABSOLUTE_TICKS) {
    throw new RangeError('when is outside the supported range');
  }

  const tolerance = TICK_ALIGNMENT_TOLERANCE * Math.max(1, Math.abs(scaledTicks));
  if (Math.abs(scaledTicks - absoluteHours) > tolerance) {
    throw new RangeError('when must use the year-times-ten codec precision');
  }

  return absoluteHours;
}

function assertInstantInCalendar(instant: TimelineInstant, calendar: TimelineCalendar): void {
  if (!Number.isInteger(instant.year)) throw new RangeError('year must be an integer');
  if (!Number.isInteger(instant.month) || instant.month < 1 || instant.month > calendar.monthsPerYear) {
    throw new RangeError('month is outside the active calendar');
  }
  if (!Number.isInteger(instant.day) || instant.day < 1 || instant.day > calendar.daysPerMonth) {
    throw new RangeError('day is outside the active calendar');
  }
  if (!Number.isInteger(instant.hour) || instant.hour < 0 || instant.hour >= calendar.hoursPerDay) {
    throw new RangeError('hour is outside the active calendar');
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000) {
    throw new RangeError(`${field} must be a positive integer`);
  }
  return Number(value);
}
