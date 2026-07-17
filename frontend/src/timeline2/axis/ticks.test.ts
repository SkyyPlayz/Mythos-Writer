import { describe, it, expect } from 'vitest';
import type { TimelineCalendar } from '../../timelinesTypes';
import { safeEncodeWhen, whenPerYear } from './calendarCodec';
import {
  AXIS_ZOOM_SEGS,
  TICK_BASE_BY_ZOOM,
  tickCount,
  labelStepWhen,
  axisPct,
  axisPctL,
  tickLabel,
  generateTicks,
} from './ticks';

const STANDARD: TimelineCalendar = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };
const WPY = whenPerYear(STANDARD); // 864

describe('tickCount (prototype tlTickN)', () => {
  it('uses the prototype base counts at zoomX 1', () => {
    expect(tickCount('Year', 1)).toBe(5);
    expect(tickCount('Quarter', 1)).toBe(7);
    expect(tickCount('Month', 1)).toBe(9);
    expect(tickCount('Week', 1)).toBe(13);
    expect(tickCount('Day', 1)).toBe(19);
  });

  it('scales with zoomX and clamps to 4–60', () => {
    expect(tickCount('Year', 2)).toBe(10);
    expect(tickCount('Day', 44)).toBe(60); // 19 × 44 clamps to 60
    expect(tickCount('Year', 0.55)).toBe(5); // zoomX below 1 doesn't shrink (max(1, x))
    expect(tickCount('Year', NaN)).toBe(5);
  });

  it('covers every zoom segment', () => {
    for (const seg of AXIS_ZOOM_SEGS) {
      expect(tickCount(seg, 1)).toBe(TICK_BASE_BY_ZOOM[seg]);
    }
  });
});

describe('axisPct / axisPctL (prototype tlPct / tlPctL)', () => {
  it('maps linearly and clamps 1.5–98.5', () => {
    expect(axisPct(50, 0, 100)).toBe(50);
    expect(axisPct(0, 0, 100)).toBe(1.5);
    expect(axisPct(100, 0, 100)).toBe(98.5);
    expect(axisPct(-1000, 0, 100)).toBe(1.5);
    expect(axisPct(1000, 0, 100)).toBe(98.5);
  });

  it('lane variant clamps 1–99', () => {
    expect(axisPctL(0, 0, 100)).toBe(1);
    expect(axisPctL(100, 0, 100)).toBe(99);
    expect(axisPctL(25, 0, 100)).toBe(25);
  });

  it('guards null / NaN / degenerate axes', () => {
    expect(axisPct(null, 0, 100)).toBe(1.5);
    expect(axisPct(NaN, 0, 100)).toBe(1.5);
    expect(axisPct(5, 100, 100)).toBe(1.5); // zero-width axis
    expect(axisPctL(undefined, 0, 100)).toBe(1);
    expect(axisPctL(5, 100, 0)).toBe(1); // inverted axis
  });
});

describe('tickLabel — adaptive granularity (§8.3 year→month→day→hour)', () => {
  const when = safeEncodeWhen({ year: 871, month: 3, day: 14, hour: 6 }, STANDARD);

  it('coarse step (≥ half a year) → "871 EC"', () => {
    expect(tickLabel(when, WPY, STANDARD)).toBe('871 EC');
    expect(tickLabel(when, WPY * 0.5, STANDARD)).toBe('871 EC');
  });

  it('month step → "Y871 · M3"', () => {
    expect(tickLabel(when, WPY * 0.1, STANDARD)).toBe('Y871 · M3');
    expect(tickLabel(when, WPY * 0.08, STANDARD)).toBe('Y871 · M3');
  });

  it('day step → "M3 · D14"', () => {
    expect(tickLabel(when, WPY * 0.01, STANDARD)).toBe('M3 · D14');
    expect(tickLabel(when, WPY * 0.004, STANDARD)).toBe('M3 · D14');
  });

  it('hour step (ctrl+scroll to half-day) → "D14 · 06:00"', () => {
    expect(tickLabel(when, WPY * 0.003, STANDARD)).toBe('D14 · 06:00');
    expect(tickLabel(when, 0.5, STANDARD)).toBe('D14 · 06:00');
  });

  it('never throws on NaN when', () => {
    expect(tickLabel(NaN, WPY, STANDARD)).toBe('0 EC');
  });
});

describe('generateTicks', () => {
  it('produces N−1 interior ticks', () => {
    const ticks = generateTicks(0, 1000, 'Year', 1, STANDARD);
    expect(ticks).toHaveLength(4); // tickCount 5 → interior 4
    expect(ticks[0].when).toBe(200);
    expect(ticks[3].when).toBe(800);
  });

  it('re-labels to hours at deep continuous zoom over a short axis', () => {
    // One-day axis at Day segment zoomed in: step ≪ 0.004y → hour labels.
    const dayStart = safeEncodeWhen({ year: 871, month: 3, day: 14, hour: 0 }, STANDARD);
    const ticks = generateTicks(dayStart, dayStart + 2.4, 'Day', 2, STANDARD);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0].label).toMatch(/^D14 · \d{2}:00$/);
  });

  it('tick density rises with zoomX', () => {
    const coarse = generateTicks(0, 1000, 'Year', 1, STANDARD).length;
    const fine = generateTicks(0, 1000, 'Year', 4, STANDARD).length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it('degrades to [] on a degenerate axis', () => {
    expect(generateTicks(100, 100, 'Year', 1, STANDARD)).toEqual([]);
    expect(generateTicks(NaN, 100, 'Year', 1, STANDARD)).toEqual([]);
    expect(generateTicks(100, 0, 'Year', 1, STANDARD)).toEqual([]);
  });

  it('labels shift from years to months as zoom deepens on the same axis', () => {
    // 5-year axis: Year seg step = 1y → year labels; Day seg ×4 → months.
    const yearTicks = generateTicks(0, WPY * 5, 'Year', 1, STANDARD);
    expect(yearTicks[0].label).toMatch(/ EC$/);
    const dayTicks = generateTicks(0, WPY * 5, 'Day', 3, STANDARD);
    expect(dayTicks[0].label).toMatch(/^Y\d+ · M\d+$/);
  });

  it('label granularity keeps deepening past the 60-tick render cap (§14.4 step 5)', () => {
    // A ~1.1-year story axis at Day seg, Ctrl+scrolled to ×44: rendered
    // ticks stay capped at 60, but the label step (19 × 44 divisions)
    // reaches hour granularity.
    const ticks = generateTicks(0, 950.4, 'Day', 44, STANDARD);
    expect(ticks.length).toBeLessThanOrEqual(59);
    expect(ticks[0].label).toMatch(/^D\d+ · \d{2}:00$/);
    expect(labelStepWhen(0, 950.4, 'Day', 44)).toBeCloseTo(950.4 / (19 * 44), 6);
  });

  it('labelStepWhen matches the rendered step below the cap', () => {
    expect(labelStepWhen(0, 1000, 'Year', 1)).toBeCloseTo(200, 10);
    expect(labelStepWhen(0, 1000, 'Quarter', 2)).toBeCloseTo(1000 / 14, 10);
  });
});
