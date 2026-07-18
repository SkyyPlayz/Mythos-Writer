// Beta 4 M22 — Axis engine: auto-stacking (first-fit lanes).
// Exact port of the prototype `mkLaneFit` (6641): sort by start, place each
// item in the first lane whose last end is clear of the item's start within
// ε = 0.15 (percent of the axis). Touching edges (end == next start) do NOT
// stack; characters always get one lane each (see `characterLanePolicy`).

/** Prototype ε (6641): overlap tolerance, in axis-percent. */
export const LANE_EPSILON_PCT = 0.15;

export interface LaneFit {
  /** Zero-based lane index for this item. */
  lane: number;
  /** Total lanes allocated so far (row height grows to fit). */
  laneCount: number;
}

/**
 * Prototype `mkLaneFit(gapPct)` (6641). Returns a stateful fitter: call it
 * with each item's [left, right] percent IN ASCENDING left ORDER.
 *
 *   while (ends[lane] != null && left + 0.15 < ends[lane] + gapPct) lane++
 *
 * so an item only stacks when it overlaps the lane's last item by MORE than
 * ε — items that merely touch (left == previous right) share the lane.
 */
export function createLaneFit(gapPct = 0): (leftPct: number, rightPct: number) => LaneFit {
  const ends: number[] = [];
  return (leftPct: number, rightPct: number) => {
    let lane = 0;
    while (ends[lane] != null && leftPct + LANE_EPSILON_PCT < ends[lane] + gapPct) lane++;
    ends[lane] = rightPct;
    return { lane, laneCount: ends.length };
  };
}

export interface SpanLike<T> {
  item: T;
  leftPct: number;
  rightPct: number;
}

export interface StackedItem<T> {
  item: T;
  leftPct: number;
  rightPct: number;
  lane: number;
}

export interface StackResult<T> {
  items: StackedItem<T>[];
  laneCount: number;
}

/**
 * Stack span-like items (books/story spans, arcs, custom-row items, …):
 * sorted by left edge, first-fit, minimum visual width 0.2% (prototype 6645:
 * `spanFit(l, Math.max(l + .2, r))`).
 */
export function stackSpans<T>(spans: SpanLike<T>[], minLanes = 1): StackResult<T> {
  const fit = createLaneFit(0);
  let laneCount = Math.max(1, minLanes);
  const items = [...spans]
    .sort((a, b) => a.leftPct - b.leftPct)
    .map(({ item, leftPct, rightPct }) => {
      const right = Math.max(leftPct + 0.2, rightPct);
      const placed = fit(leftPct, right);
      laneCount = Math.max(laneCount, placed.laneCount);
      return { item, leftPct, rightPct: right, lane: placed.lane };
    });
  return { items, laneCount };
}

/**
 * Stack point items (key events, world events): each occupies `widthPct`
 * to its right (prototype 6691: `evFit(p, p + 17)`; world chips use 13).
 */
export function stackPoints<T>(
  points: { item: T; pct: number }[],
  widthPct: number,
  minLanes = 1,
): StackResult<T> {
  const fit = createLaneFit(0);
  let laneCount = Math.max(1, minLanes);
  const items = [...points]
    .sort((a, b) => a.pct - b.pct)
    .map(({ item, pct }) => {
      const placed = fit(pct, pct + widthPct);
      laneCount = Math.max(laneCount, placed.laneCount);
      return { item, leftPct: pct, rightPct: pct + widthPct, lane: placed.lane };
    });
  return { items, laneCount };
}

/**
 * Characters never auto-stack — every character line gets its own thin lane
 * (§8.3 "characters always one thin lane each"; prototype renders each
 * journey in its own 28px row). M23's character row must use this policy.
 */
export function characterLanePolicy<T>(characters: T[]): StackResult<T> {
  return {
    items: characters.map((item, i) => ({ item, leftPct: 0, rightPct: 100, lane: i })),
    laneCount: Math.max(1, characters.length),
  };
}
