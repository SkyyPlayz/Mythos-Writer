import { describe, it, expect } from 'vitest';
import {
  LANE_EPSILON_PCT,
  createLaneFit,
  stackSpans,
  stackPoints,
  characterLanePolicy,
} from './lanes';

describe('createLaneFit — prototype mkLaneFit', () => {
  it('keeps non-overlapping items in lane 0', () => {
    const fit = createLaneFit(0);
    expect(fit(0, 10)).toEqual({ lane: 0, laneCount: 1 });
    expect(fit(20, 30)).toEqual({ lane: 0, laneCount: 1 });
  });

  it('stacks overlapping items into new lanes', () => {
    const fit = createLaneFit(0);
    fit(0, 50);
    expect(fit(10, 60)).toEqual({ lane: 1, laneCount: 2 });
    expect(fit(20, 70)).toEqual({ lane: 2, laneCount: 3 });
  });

  it('touching edges (end == next start) do NOT stack (§14.4 step 4)', () => {
    const fit = createLaneFit(0);
    fit(0, 33);
    expect(fit(33, 66).lane).toBe(0);
    expect(fit(66, 99).lane).toBe(0);
  });

  it('overlap within ε (0.15%) does not stack; past ε it does', () => {
    expect(LANE_EPSILON_PCT).toBe(0.15);
    const fitA = createLaneFit(0);
    fitA(0, 33);
    expect(fitA(32.85, 66).lane).toBe(0); // 32.85 + 0.15 = 33 → not < 33
    const fitB = createLaneFit(0);
    fitB(0, 33);
    expect(fitB(32.8, 66).lane).toBe(1); // 32.95 < 33 → stack
  });

  it('reuses a lane once it frees up', () => {
    const fit = createLaneFit(0);
    fit(0, 40); // lane 0
    fit(10, 20); // lane 1
    expect(fit(50, 60).lane).toBe(0);
  });
});

describe('stackSpans', () => {
  it('sequential book spans share lane 0, overlapping ones grow the row', () => {
    const spans = [
      { item: 'book1', leftPct: 2, rightPct: 30 },
      { item: 'book2', leftPct: 30, rightPct: 60 }, // touches book1 → same lane
      { item: 'book3', leftPct: 60, rightPct: 95 }, // touches book2 → same lane
    ];
    const { items, laneCount } = stackSpans(spans);
    expect(items.map((s) => s.lane)).toEqual([0, 0, 0]);
    expect(laneCount).toBe(1);
  });

  it('sorts by left edge before fitting (input order independent)', () => {
    const spans = [
      { item: 'late', leftPct: 60, rightPct: 90 },
      { item: 'early', leftPct: 5, rightPct: 65 },
    ];
    const { items } = stackSpans(spans);
    expect(items[0].item).toBe('early');
    expect(items[0].lane).toBe(0);
    expect(items[1].item).toBe('late');
    expect(items[1].lane).toBe(1); // overlaps 60–65
  });

  it('enforces the 0.2% minimum visual width (prototype spanFit call)', () => {
    const { items } = stackSpans([{ item: 'dot', leftPct: 10, rightPct: 10 }]);
    expect(items[0].rightPct).toBeCloseTo(10.2, 10);
  });

  it('respects minLanes for rows that always reserve space', () => {
    const { laneCount } = stackSpans([{ item: 'a', leftPct: 0, rightPct: 10 }], 2);
    expect(laneCount).toBe(2);
  });
});

describe('stackPoints — events on the same date (§14.4 step 3)', () => {
  it('three events on the SAME date auto-stack into three lanes', () => {
    const { items, laneCount } = stackPoints(
      [
        { item: 'e1', pct: 50 },
        { item: 'e2', pct: 50 },
        { item: 'e3', pct: 50 },
      ],
      17,
    );
    expect(items.map((p) => p.lane).sort()).toEqual([0, 1, 2]);
    expect(laneCount).toBe(3); // row grows to fit
  });

  it('spread-out events stay in one lane', () => {
    const { items, laneCount } = stackPoints(
      [
        { item: 'e1', pct: 5 },
        { item: 'e2', pct: 40 },
        { item: 'e3', pct: 80 },
      ],
      17,
    );
    expect(items.every((p) => p.lane === 0)).toBe(true);
    expect(laneCount).toBe(1);
  });

  it('never crashes on many identical dates and keeps growing lanes', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ item: i, pct: 25 }));
    const { laneCount } = stackPoints(points, 17);
    expect(laneCount).toBe(40);
  });
});

describe('characterLanePolicy — one thin lane each', () => {
  it('gives every character its own lane regardless of overlap', () => {
    const { items, laneCount } = characterLanePolicy(['kael', 'mira', 'watcher']);
    expect(items.map((c) => c.lane)).toEqual([0, 1, 2]);
    expect(laneCount).toBe(3);
  });

  it('empty character list still reserves one lane', () => {
    expect(characterLanePolicy([]).laneCount).toBe(1);
  });
});
