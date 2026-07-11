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

function parseWhenTicks(when: number): number {
  if (!Number.isFinite(when) || Number.isNaN(when)) {
    throw new RangeError('when must be a finite number');
  }

  const absoluteHours = Math.round(when * 10);
  if (!Number.isSafeInteger(absoluteHours) || Math.abs(absoluteHours) > MAX_ABSOLUTE_TICKS) {
    throw new RangeError('when is outside the supported range');
  }

  if (Math.abs(absoluteHours / 10 - when) > Number.EPSILON * Math.max(1, Math.abs(when))) {
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
