import { describe, expect, it } from 'vitest';
import {
  GHOST_TAIL_RATIO,
  clampVZoom,
  dualStampsFor,
  formatLocalStamp,
  formatStandardStamp,
  ghostLabelForWidth,
} from './stamps';
import type { TimelineCalendar, TimelineDefinition } from '../../timelinesTypes';

const STD: TimelineCalendar = {
  preset: 'standard',
  monthsPerYear: 12,
  daysPerMonth: 30,
  hoursPerDay: 24,
};

const KEPLER: TimelineCalendar = {
  preset: 'custom',
  monthsPerYear: 12,
  daysPerMonth: 60,
  hoursPerDay: 24,
};

function makeTl(partial: Partial<TimelineDefinition>): TimelineDefinition {
  return {
    id: 'tl',
    name: 'World',
    kind: 'world',
    axis: 'calendar',
    calendar: STD,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('GHOST_TAIL_RATIO (v2.4.1)', () => {
  it('is exactly 1/8 — Soft-FAIL 34% / ~1/3', () => {
    expect(GHOST_TAIL_RATIO).toBe(1 / 8);
    expect(GHOST_TAIL_RATIO).not.toBeCloseTo(0.34, 2);
    expect(GHOST_TAIL_RATIO).not.toBeCloseTo(1 / 3, 2);
  });
});

describe('formatLocalStamp / formatStandardStamp', () => {
  it('formats local with time and era', () => {
    // year 873, month 12, day 3, hour 0 → when = (873*8640 + 11*720 + 2*24)/10
    const when = (873 * 8640 + 11 * 720 + 2 * 24) / 10;
    expect(formatLocalStamp(when, STD, 'EC', true)).toBe('M12 D3 00:00 · 873 EC');
  });

  it('formats coarser standard stamp', () => {
    const when = (873 * 8640 + 11 * 720) / 10;
    expect(formatStandardStamp(when, STD, 'UST')).toBe('873 UST · mo 12');
  });
});

describe('dualStampsFor', () => {
  it('collapses to one standard row on root std timeline', () => {
    const root = makeTl({ id: 'root', std: true, era: 'UST', calendar: STD });
    const d = dualStampsFor(8730, root, [root], true);
    expect(d.isStandardTimeline).toBe(true);
    expect(d.standard).toContain('IS the standard');
  });

  it('converts nested local when through epoch to standard', () => {
    const root = makeTl({ id: 'root', std: true, era: 'UST', calendar: STD });
    const nested = makeTl({
      id: 'kep',
      calendar: KEPLER,
      era: 'AL',
      ep: 3470,
    });
    const d = dualStampsFor(100, nested, [root, nested], true);
    expect(d.isStandardTimeline).toBe(false);
    expect(d.local).toMatch(/AL/);
    expect(d.standard).toMatch(/UST/);
  });
});

describe('ghostLabelForWidth', () => {
  it('thresholds match v2.4.1', () => {
    expect(ghostLabelForWidth(20)).toBe('');
    expect(ghostLabelForWidth(40)).toBe('open');
    expect(ghostLabelForWidth(90)).toBe('OPEN RANGE — NEST CAN GROW');
  });
});

describe('clampVZoom', () => {
  it('clamps 40–160 in 10% steps', () => {
    expect(clampVZoom(35)).toBe(40);
    expect(clampVZoom(100)).toBe(100);
    expect(clampVZoom(165)).toBe(160);
    expect(clampVZoom(97)).toBe(100);
  });
});
