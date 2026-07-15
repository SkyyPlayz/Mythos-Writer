import { describe, it, expect } from 'vitest';
import type { TimelineCalendar, TimelineEra, TimelineEvent, TimelineSpan } from '../../timelinesTypes';
import { deriveAxisDomain, emptyDomain } from './domain';
import { whenPerYear } from './calendarCodec';

const STANDARD: TimelineCalendar = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };
const WPY = whenPerYear(STANDARD);

const era = (timelineId: string, startWhen: number, endWhen: number): TimelineEra =>
  ({ id: `era-${startWhen}`, timelineId, name: 'Era', startWhen, endWhen });
const span = (timelineId: string, startWhen: number, endWhen: number): TimelineSpan =>
  ({ id: `span-${startWhen}`, timelineId, name: 'Span', startWhen, endWhen });
const event = (timelineId: string, when: number): TimelineEvent =>
  ({ id: `ev-${when}`, timelineId, name: 'Event', when });

describe('deriveAxisDomain', () => {
  it('spans the timeline content with 5% padding', () => {
    const store = {
      eras: [era('tl', 0, WPY * 2)],
      spans: [span('tl', WPY, WPY * 8)],
      events: [event('tl', WPY * 10)],
    };
    const [t0, t1] = deriveAxisDomain(store, 'tl', STANDARD);
    expect(t0).toBeLessThan(0);
    expect(t1).toBeGreaterThan(WPY * 10);
    expect(t1 - t0).toBeCloseTo(WPY * 10 * 1.1, 0);
  });

  it('ignores other timelines', () => {
    const store = {
      eras: [],
      spans: [span('other', 0, 100000)],
      events: [event('tl', WPY * 2), event('tl', WPY * 4)],
    };
    const [, t1] = deriveAxisDomain(store, 'tl', STANDARD);
    expect(t1).toBeLessThan(WPY * 5);
  });

  it('never narrower than one calendar year', () => {
    const store = { eras: [], spans: [], events: [event('tl', 500)] };
    const [t0, t1] = deriveAxisDomain(store, 'tl', STANDARD);
    expect(t1 - t0).toBeGreaterThanOrEqual(WPY);
    expect(t0).toBeLessThan(500);
    expect(t1).toBeGreaterThan(500);
  });

  it('empty timeline falls back to years 0–5', () => {
    const store = { eras: [], spans: [], events: [] };
    expect(deriveAxisDomain(store, 'tl', STANDARD)).toEqual(emptyDomain(STANDARD));
    expect(emptyDomain(STANDARD)).toEqual([0, WPY * 5]);
  });

  it('skips NaN whens instead of blanking the axis (§8.2)', () => {
    const store = {
      eras: [era('tl', NaN, NaN)],
      spans: [],
      events: [event('tl', WPY), event('tl', NaN)],
    };
    const [t0, t1] = deriveAxisDomain(store, 'tl', STANDARD);
    expect(Number.isFinite(t0)).toBe(true);
    expect(Number.isFinite(t1)).toBe(true);
  });

  it('all-NaN content behaves like an empty timeline', () => {
    const store = { eras: [], spans: [], events: [event('tl', NaN)] };
    expect(deriveAxisDomain(store, 'tl', STANDARD)).toEqual(emptyDomain(STANDARD));
  });
});
