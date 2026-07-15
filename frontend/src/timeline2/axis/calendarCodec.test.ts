import { describe, it, expect } from 'vitest';
import type { TimelineCalendar } from '../../timelinesTypes';
import {
  safeCalendar,
  hoursPerYear,
  whenPerYear,
  roundWhen,
  isValidWhen,
  safeDecodeWhen,
  safeEncodeWhen,
  formatWhen,
  calendarNote,
  DEFAULT_CALENDAR,
} from './calendarCodec';

const STANDARD: TimelineCalendar = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };
const AEON13: TimelineCalendar = { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 };

describe('safeCalendar', () => {
  it('passes valid calendars through', () => {
    expect(safeCalendar(AEON13)).toEqual(AEON13);
  });

  it('falls back to defaults on garbage units', () => {
    const cal = safeCalendar({ preset: 'custom', monthsPerYear: NaN, daysPerMonth: -3, hoursPerDay: 0 } as TimelineCalendar);
    expect(cal.monthsPerYear).toBe(12);
    expect(cal.daysPerMonth).toBe(30);
    expect(cal.hoursPerDay).toBe(24);
  });

  it('handles null/undefined input', () => {
    expect(safeCalendar(null)).toEqual(DEFAULT_CALENDAR);
    expect(safeCalendar(undefined)).toEqual(DEFAULT_CALENDAR);
  });
});

describe('encode/decode round-trips (mirrors the M21 codec)', () => {
  it('matches the M21 unit: year 0 · month 1 · day 2 · hour 0 = when 2.4', () => {
    // M21 seed "Inciting incident" sits at when 2.4 (24 absolute hours / 10).
    expect(safeEncodeWhen({ year: 0, month: 1, day: 2, hour: 0 }, STANDARD)).toBe(2.4);
    expect(safeDecodeWhen(2.4, STANDARD)).toEqual({ year: 0, month: 1, day: 2, hour: 0 });
  });

  it('round-trips exact times in the 13×28×18 calendar (§14.4 step 7)', () => {
    const cases = [
      { year: 871, month: 13, day: 28, hour: 17 },
      { year: 871, month: 3, day: 14, hour: 6 },
      { year: 0, month: 1, day: 1, hour: 0 },
      { year: 42, month: 7, day: 1, hour: 9 },
    ];
    for (const instant of cases) {
      const when = safeEncodeWhen(instant, AEON13);
      expect(safeDecodeWhen(when, AEON13)).toEqual(instant);
      // tick-aligned: multiple of 0.1
      expect(Math.round(when * 10)).toBeCloseTo(when * 10, 9);
    }
  });

  it('round-trips through the standard calendar', () => {
    const instant = { year: 871, month: 3, day: 14, hour: 6 };
    const when = safeEncodeWhen(instant, STANDARD);
    expect(safeDecodeWhen(when, STANDARD)).toEqual(instant);
  });

  it('clamps out-of-calendar parts instead of throwing', () => {
    // month 99 clamps to 13, day 99 to 28, hour 99 to 17 in the 13×28×18 calendar
    const when = safeEncodeWhen({ year: 1, month: 99, day: 99, hour: 99 }, AEON13);
    expect(safeDecodeWhen(when, AEON13)).toEqual({ year: 1, month: 13, day: 28, hour: 17 });
  });

  it('treats missing parts as calendar start', () => {
    expect(safeEncodeWhen({ year: 5 }, STANDARD)).toBe(safeEncodeWhen({ year: 5, month: 1, day: 1, hour: 0 }, STANDARD));
  });
});

describe('NaN guards (§8.2 — never blank the app)', () => {
  it('decodes NaN/undefined/Infinity to the fallback', () => {
    const atStart = safeDecodeWhen(120, STANDARD);
    expect(safeDecodeWhen(NaN, STANDARD, 120)).toEqual(atStart);
    expect(safeDecodeWhen(undefined, STANDARD, 120)).toEqual(atStart);
    expect(safeDecodeWhen(Infinity, STANDARD, 120)).toEqual(atStart);
    expect(safeDecodeWhen(null, STANDARD, 120)).toEqual(atStart);
  });

  it('falls back to 0 when the fallback itself is invalid', () => {
    expect(safeDecodeWhen(NaN, STANDARD, NaN)).toEqual({ year: 0, month: 1, day: 1, hour: 0 });
  });

  it('encodes NaN parts as calendar start, never NaN', () => {
    const when = safeEncodeWhen({ year: NaN, month: NaN, day: NaN, hour: NaN }, STANDARD);
    expect(Number.isFinite(when)).toBe(true);
    expect(when).toBe(0);
  });

  it('roundWhen guards non-finite input', () => {
    expect(roundWhen(NaN)).toBe(0);
    expect(roundWhen(Infinity)).toBe(0);
    expect(roundWhen(2.44)).toBe(2.4);
    expect(roundWhen(2.45)).toBe(2.5);
  });

  it('isValidWhen', () => {
    expect(isValidWhen(2.4)).toBe(true);
    expect(isValidWhen(0)).toBe(true);
    expect(isValidWhen(NaN)).toBe(false);
    expect(isValidWhen(Infinity)).toBe(false);
    expect(isValidWhen(null)).toBe(false);
    expect(isValidWhen('2.4')).toBe(false);
  });
});

describe('units', () => {
  it('hoursPerYear / whenPerYear', () => {
    expect(hoursPerYear(STANDARD)).toBe(8640);
    expect(whenPerYear(STANDARD)).toBe(864);
    expect(hoursPerYear(AEON13)).toBe(13 * 28 * 18);
    expect(whenPerYear(AEON13)).toBe((13 * 28 * 18) / 10);
  });
});

describe('formatting', () => {
  it('formatWhen matches the prototype fmtWhen shape', () => {
    const when = safeEncodeWhen({ year: 871, month: 3, day: 14, hour: 6 }, STANDARD);
    expect(formatWhen(when, STANDARD)).toBe('Y871 · M3 · D14 · 06:00');
  });

  it('formatWhen never throws on NaN', () => {
    expect(formatWhen(NaN, STANDARD, 0)).toBe('Y0 · M1 · D1 · 00:00');
  });

  it('calendarNote matches the prototype tlCalNote shape', () => {
    expect(calendarNote(STANDARD)).toBe('12 months × 30 days × 24h days');
    expect(calendarNote(AEON13)).toBe('13 months × 28 days × 18h days');
  });
});
