import { describe, expect, it } from 'vitest';
import { decodeWhen, encodeWhen, normalizeCalendar } from './codec.js';
import type { TimelineCalendar } from './model.js';

const AEON: TimelineCalendar = {
  preset: 'aeon-13',
  monthsPerYear: 13,
  daysPerMonth: 28,
  hoursPerDay: 18,
};

const STANDARD: TimelineCalendar = {
  preset: 'standard',
  monthsPerYear: 12,
  daysPerMonth: 30,
  hoursPerDay: 24,
};

describe('normalizeCalendar', () => {
  it('uses defaults for missing fields', () => {
    const cal = normalizeCalendar(undefined);
    expect(cal.monthsPerYear).toBe(12);
    expect(cal.daysPerMonth).toBe(30);
    expect(cal.hoursPerDay).toBe(24);
  });

  it('rejects zero monthsPerYear', () => {
    expect(() => normalizeCalendar({ monthsPerYear: 0, daysPerMonth: 30, hoursPerDay: 24 })).toThrow();
  });

  it('rejects negative daysPerMonth', () => {
    expect(() => normalizeCalendar({ monthsPerYear: 12, daysPerMonth: -1, hoursPerDay: 24 })).toThrow();
  });
});

describe('encodeWhen / decodeWhen — 13×28×18h calendar round-trip', () => {
  it('round-trips year 0 month 1 day 1 hour 0', () => {
    const instant = { year: 0, month: 1, day: 1, hour: 0 };
    const when = encodeWhen(instant, AEON);
    expect(decodeWhen(when, AEON)).toEqual(instant);
  });

  it('round-trips a mid-calendar instant with no precision loss', () => {
    const instant = { year: 42, month: 7, day: 14, hour: 9 };
    const when = encodeWhen(instant, AEON);
    expect(decodeWhen(when, AEON)).toEqual(instant);
  });

  it('round-trips last moment of day (hour = hoursPerDay - 1)', () => {
    const instant = { year: 1, month: 13, day: 28, hour: 17 };
    const when = encodeWhen(instant, AEON);
    expect(decodeWhen(when, AEON)).toEqual(instant);
  });

  it('round-trips large year without precision loss', () => {
    const instant = { year: 10_000, month: 13, day: 28, hour: 17 };
    const when = encodeWhen(instant, AEON);
    expect(decodeWhen(when, AEON)).toEqual(instant);
  });

  it('encodes as year × 10 tick (standard calendar, year=1, m=1, d=1, h=0)', () => {
    const hoursInYear = STANDARD.monthsPerYear * STANDARD.daysPerMonth * STANDARD.hoursPerDay;
    const when = encodeWhen({ year: 1, month: 1, day: 1, hour: 0 }, STANDARD);
    expect(when).toBe(hoursInYear / 10);
  });

  it('standard calendar round-trip at year 5 month 6 day 15 hour 12', () => {
    const instant = { year: 5, month: 6, day: 15, hour: 12 };
    const when = encodeWhen(instant, STANDARD);
    expect(decodeWhen(when, STANDARD)).toEqual(instant);
  });
});

describe('NaN-guard — malformed / out-of-range when values', () => {
  it('rejects NaN', () => {
    expect(() => decodeWhen(NaN, STANDARD)).toThrow(/finite/i);
  });

  it('rejects positive Infinity', () => {
    expect(() => decodeWhen(Infinity, STANDARD)).toThrow(/finite/i);
  });

  it('rejects negative Infinity', () => {
    expect(() => decodeWhen(-Infinity, STANDARD)).toThrow(/finite/i);
  });

  it('rejects an astronomically large value outside safe range', () => {
    expect(() => decodeWhen(Number.MAX_VALUE / 10, STANDARD)).toThrow(/range/i);
  });

  it('rejects non-codec-precision float (e.g. 1.234567)', () => {
    expect(() => decodeWhen(1.234567, STANDARD)).toThrow(/precision/i);
  });

  it('accepts 0 (epoch)', () => {
    expect(() => decodeWhen(0, STANDARD)).not.toThrow();
  });

  it('accepts a valid negative when (pre-epoch)', () => {
    const when = encodeWhen({ year: -1, month: 1, day: 1, hour: 0 }, STANDARD);
    expect(() => decodeWhen(when, STANDARD)).not.toThrow();
  });
});

describe('encodeWhen — calendar boundary validation', () => {
  it('rejects month 0', () => {
    expect(() => encodeWhen({ year: 0, month: 0, day: 1, hour: 0 }, AEON)).toThrow(/month/i);
  });

  it('rejects month > monthsPerYear', () => {
    expect(() => encodeWhen({ year: 0, month: 14, day: 1, hour: 0 }, AEON)).toThrow(/month/i);
  });

  it('rejects day 0', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 0, hour: 0 }, AEON)).toThrow(/day/i);
  });

  it('rejects day > daysPerMonth', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 29, hour: 0 }, AEON)).toThrow(/day/i);
  });

  it('rejects hour < 0', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 1, hour: -1 }, AEON)).toThrow(/hour/i);
  });

  it('rejects hour >= hoursPerDay', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 1, hour: 18 }, AEON)).toThrow(/hour/i);
  });
});
