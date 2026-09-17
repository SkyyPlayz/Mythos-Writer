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
  whenSpanToDays,
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

describe('whenSpanToDays — TIMELINE NAVIGATOR "Est. N days" (prototype tlBooks0)', () => {
  it('converts a when-span to whole calendar days', () => {
    // 28.8 when = 288 hours = 12 days at 24h/day, matching the prototype's
    // "Book One … Est. 12 days" seed.
    expect(whenSpanToDays(28.8, STANDARD)).toBe(12);
  });

  it('respects a non-24h calendar', () => {
    expect(whenSpanToDays(28.8, AEON13)).toBe(16); // 288h / 18h-days = 16
  });

  it('is NaN/negative-guarded (§8.2)', () => {
    expect(whenSpanToDays(NaN, STANDARD)).toBe(0);
    expect(whenSpanToDays(-5, STANDARD)).toBe(0);
    expect(whenSpanToDays(0, STANDARD)).toBe(0);
  });
});

// ─── 0.5.3 Multi-calendar conversion (spec §1.3, §10) ──────────────────────

import {
  calendarRatio,
  timelineEpoch,
  toStandard,
  toLocal,
  eraOf,
  formatLocalYear,
  calendarSignature,
  resolveStdCalendar,
  buildConversionTable,
  whenRoundTripError,
} from './calendarCodec';
import type { TimelineDefinition } from '../../timelinesTypes';

const KEPLER: TimelineCalendar = { preset: 'custom', monthsPerYear: 10, daysPerMonth: 72, hoursPerDay: 24 };
const AETHIS: TimelineCalendar = { preset: 'custom', monthsPerYear: 8, daysPerMonth: 44, hoursPerDay: 19 };

function makeTl(overrides: Partial<TimelineDefinition>): TimelineDefinition {
  return {
    id: 'test',
    name: 'Test',
    kind: 'world',
    axis: 'calendar',
    calendar: STANDARD,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('calendarRatio', () => {
  it('Kepler (10×72×24h vs 12×30×24h) = 2.0', () => {
    expect(calendarRatio(makeTl({ calendar: KEPLER }), STANDARD)).toBe(2);
  });

  it('Aethis (8×44×19h vs 12×30×24h) ≈ 0.774', () => {
    expect(calendarRatio(makeTl({ calendar: AETHIS }), STANDARD)).toBeCloseTo(0.774, 3);
  });

  it('standard vs standard = 1.0', () => {
    expect(calendarRatio(makeTl({ calendar: STANDARD }), STANDARD)).toBe(1);
  });
});

describe('timelineEpoch', () => {
  it('reads ep when present', () => {
    const wpy_std = hoursPerYear(STANDARD) / 10;
    const ep347 = 347 * wpy_std;
    expect(timelineEpoch(makeTl({ ep: ep347 }), STANDARD)).toBe(ep347);
  });

  it('derives back-compat default when ep absent', () => {
    const tl = makeTl({ calendar: KEPLER });
    expect(timelineEpoch(tl, STANDARD, 0)).toBe(0);
  });
});

describe('toStandard / toLocal — spec §10 AC1 (Kepler bar placement)', () => {
  const stdCal = STANDARD;
  const hpyStd = hoursPerYear(stdCal);
  const hpyKepler = hoursPerYear(KEPLER);
  const wpy_std = hpyStd / 10;
  const ep347 = 347 * wpy_std;
  const kepler = makeTl({ calendar: KEPLER, ep: ep347, era: 'AL', epName: 'Landfall' });

  it('local year 0 maps to standard year 347', () => {
    const localWhen0 = 0;
    const stdWhen = toStandard(kepler, stdCal, localWhen0);
    const stdYear = (stdWhen * 10) / hpyStd;
    expect(stdYear).toBeCloseTo(347, 6);
  });

  it('local year 100 maps to standard year 547', () => {
    const localWhen100 = (100 * hpyKepler) / 10;
    const stdWhen = toStandard(kepler, stdCal, localWhen100);
    const stdYear = (stdWhen * 10) / hpyStd;
    expect(stdYear).toBeCloseTo(547, 6);
  });

  it('range 0–125 AL spans 250 standard years', () => {
    const localWhen0 = 0;
    const localWhen125 = (125 * hpyKepler) / 10;
    const stdStart = toStandard(kepler, stdCal, localWhen0);
    const stdEnd = toStandard(kepler, stdCal, localWhen125);
    const stdSpanYears = ((stdEnd - stdStart) * 10) / hpyStd;
    expect(stdSpanYears).toBeCloseTo(250, 6);
  });

  it('toLocal inverts toStandard', () => {
    const localWhen = (76 * hpyKepler) / 10;
    const stdWhen = toStandard(kepler, stdCal, localWhen);
    const back = toLocal(kepler, stdCal, stdWhen);
    expect(back).toBeCloseTo(localWhen, 6);
  });
});

describe('eraOf / formatLocalYear', () => {
  it('returns era or falls back to EC', () => {
    expect(eraOf(makeTl({ era: 'AL' }))).toBe('AL');
    expect(eraOf(makeTl({}))).toBe('EC');
    expect(eraOf(makeTl({ era: '' }))).toBe('EC');
  });

  it('spec §3: local dates never stamped with another era', () => {
    expect(formatLocalYear(76, makeTl({ era: 'AL' }))).toBe('76 AL');
    expect(formatLocalYear(76, makeTl({ era: 'EC' }))).toBe('76 EC');
  });
});

describe('calendarSignature', () => {
  it('compact format', () => {
    expect(calendarSignature(KEPLER)).toBe('10 × 72 · 24h');
    expect(calendarSignature(STANDARD)).toBe('12 × 30 · 24h');
  });
});

describe('resolveStdCalendar', () => {
  it('picks the std=true timeline', () => {
    const tls = [
      makeTl({ id: 'uni', calendar: STANDARD, std: true }),
      makeTl({ id: 'kep', calendar: KEPLER }),
    ];
    expect(resolveStdCalendar(tls)).toEqual(STANDARD);
  });

  it('falls back to DEFAULT_CALENDAR when none marked', () => {
    expect(resolveStdCalendar([makeTl({})])).toEqual(DEFAULT_CALENDAR);
  });
});

describe('buildConversionTable — spec §6 (Kepler conversion)', () => {
  const stdCal = STANDARD;
  const wpy_std = hoursPerYear(stdCal) / 10;
  const ep347 = 347 * wpy_std;
  const kepler = makeTl({ calendar: KEPLER, ep: ep347, era: 'AL' });

  it('0 AL → 347 EC, 124 AL → 595 EC (approx)', () => {
    const table = buildConversionTable(kepler, stdCal, 0, 124, 5);
    expect(table[0].localYear).toBe(0);
    expect(table[0].stdYear).toBe(347);
    const last = table[table.length - 1];
    expect(last.localYear).toBe(124);
    expect(last.stdYear).toBe(595);
  });
});

describe('whenRoundTripError — spec §1.2 (precision ≤1e-6)', () => {
  it('standard calendar round-trips exactly', () => {
    expect(whenRoundTripError({ year: 871, month: 3, day: 14, hour: 6 }, STANDARD)).toBe(0);
  });

  it('13×28×18 calendar round-trips exactly', () => {
    expect(whenRoundTripError({ year: 42, month: 7, day: 1, hour: 9 }, AEON13)).toBe(0);
  });

  it('Kepler calendar round-trips exactly', () => {
    expect(whenRoundTripError({ year: 100, month: 5, day: 36, hour: 12 }, KEPLER)).toBe(0);
  });
});

describe('spec §10 AC2 — changing standard calendar re-derives ratios', () => {
  it('ratio updates when standard calendar changes', () => {
    const r1 = calendarRatio(makeTl({ calendar: KEPLER }), STANDARD);
    const newStd: TimelineCalendar = { preset: 'custom', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 12 };
    const r2 = calendarRatio(makeTl({ calendar: KEPLER }), newStd);
    expect(r2).toBe(r1 * 2);
  });
});

describe('spec §10 AC4 — local dates never stamped with another era', () => {
  it('Kepler year never says EC', () => {
    const kepler = makeTl({ era: 'AL' });
    const veynn = makeTl({ era: 'EC' });
    expect(formatLocalYear(76, kepler)).toContain('AL');
    expect(formatLocalYear(76, kepler)).not.toContain('EC');
    expect(formatLocalYear(76, veynn)).toContain('EC');
  });
});
