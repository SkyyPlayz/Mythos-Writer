// SKY-3181: Pure layout engine for the AEON-style track/lane chronology view.
// No DOM. Mirrors timelineFilters.ts — side-effect free, fully unit-testable.

import type { SpreadsheetScene } from './timelineFilters';
import type { TimelinePrimaryGrouping, TimelineSpacingMode } from './types';

// ─── Context types ───────────────────────────────────────────────────────────

export interface ArcMeta {
  id: string;
  title: string;
  color: string;
}

export interface CharMeta {
  id: string;
  name: string;
}

export interface ChapterMeta {
  id: string;
  title: string;
}

export interface LocationMeta {
  id: string;
  name: string;
}

/** Entity metadata needed to resolve lane labels and colors. */
export interface TrackLayoutContext {
  arcs: ArcMeta[];
  chars: CharMeta[];
  chapters: ChapterMeta[];
  locations: LocationMeta[];
}

// ─── Output types ────────────────────────────────────────────────────────────

/** A horizontal lane (track) in the chronology view. */
export interface LaneDef {
  /** Entity id, or 'unassigned' for scenes with no grouping entity. */
  id: string;
  label: string;
  /** Arc color from metadata (arc grouping only). */
  color?: string;
  /** Zero-based position in the rendered lane list. */
  index: number;
}

/** Layout coordinates for one scene on the track canvas. */
export interface SceneLayout {
  sceneId: string;
  /** Index into LayoutResult.lanes. */
  laneIndex: number;
  /**
   * Stacking position within the lane+date slot.
   * 0 = first card, 1 = second stacked beneath, etc.
   * Renderer uses this for the y-offset within the lane.
   */
  stackIndex: number;
  /** Pixels from the left edge of the track canvas. */
  xOffset: number;
  /** Card width in pixels. */
  width: number;
}

/**
 * A detected gap in the time axis — a jump of more than gapThresholdDays between
 * two adjacent date columns. Rendered as a visual discontinuity in the axis.
 */
export interface TimeGap {
  /** Last date before the gap. */
  afterDate: string;
  /** First date after the gap. */
  beforeDate: string;
  /** Right edge of the last column before the gap (px). */
  afterX: number;
  /** Left edge of the first column after the gap (px). */
  beforeX: number;
  /** Calendar days spanning the gap. */
  dayDelta: number;
}

/** One column on the time axis — one unique date. */
export interface TimeAxisColumn {
  date: string;
  /** Left edge of this column in px. */
  x: number;
  /** Column width in px (= cardWidth). */
  width: number;
}

export interface LayoutResult {
  lanes: LaneDef[];
  sceneLayouts: SceneLayout[];
  /** Ordered list of date columns for the time axis header. */
  timeAxis: TimeAxisColumn[];
  gaps: TimeGap[];
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface TrackLayoutOptions {
  primaryGrouping: TimelinePrimaryGrouping;
  spacingMode: TimelineSpacingMode;
  /** Scene card width in px. Default: 180. */
  cardWidth?: number;
  /**
   * Uniform mode: px between the left edges of adjacent date columns.
   * Default: 240.
   */
  columnSpacing?: number;
  /**
   * Proportional mode: total canvas width in px.
   * The first date maps to x=0; the last maps to x=(totalWidth - cardWidth).
   * Default: 4000.
   */
  totalWidth?: number;
  /**
   * Minimum calendar-day gap between adjacent dates that triggers a gap indicator.
   * E.g., 1 = any jump of more than 1 day creates a gap marker (consecutive dates don't).
   * Default: 1.
   */
  gapThresholdDays?: number;
}

const DEFAULT_CARD_WIDTH = 180;
const DEFAULT_COLUMN_SPACING = 240;
const DEFAULT_TOTAL_WIDTH = 4000;
const DEFAULT_GAP_THRESHOLD_DAYS = 1;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse an ISO date string (YYYY-MM-DD) as UTC milliseconds.
 * Using Date.UTC avoids DST/timezone ambiguity on date-only strings.
 */
function parseDateUTC(iso: string): number {
  const parts = iso.split('-');
  if (parts.length >= 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return Date.UTC(y, m - 1, d);
    }
  }
  const ms = new Date(iso).getTime();
  return isNaN(ms) ? 0 : ms;
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((parseDateUTC(isoB) - parseDateUTC(isoA)) / 86_400_000);
}

/**
 * Returns the lane key(s) for a scene under the given grouping.
 *
 * For arc grouping: all of scene.arcIds (a scene can belong to multiple arcs).
 * The FIRST key is the primary lane used in SceneLayout; F3 uses the full list
 * to render secondary ghost appearances in other arc lanes.
 *
 * For other groupings: at most one key (the first / only entity).
 */
export function primaryGroupKeysFor(
  scene: SpreadsheetScene,
  grouping: TimelinePrimaryGrouping,
): string[] {
  switch (grouping) {
    case 'arc':
      return scene.arcIds.length > 0 ? [...scene.arcIds] : ['unassigned'];
    case 'character':
      return scene.characterIds.length > 0 ? [scene.characterIds[0]] : ['unassigned'];
    case 'chapter':
      return scene.chapterId ? [scene.chapterId] : ['unassigned'];
    case 'location':
      return scene.locationId ? [scene.locationId] : ['unassigned'];
  }
}

function resolveLaneLabel(
  key: string,
  grouping: TimelinePrimaryGrouping,
  context: TrackLayoutContext,
): { label: string; color?: string } {
  if (key === 'unassigned') return { label: 'Unassigned' };
  switch (grouping) {
    case 'arc': {
      const arc = context.arcs.find(a => a.id === key);
      return { label: arc?.title ?? key, color: arc?.color };
    }
    case 'character': {
      const char = context.chars.find(c => c.id === key);
      return { label: char?.name ?? key };
    }
    case 'chapter': {
      const chap = context.chapters.find(c => c.id === key);
      return { label: chap?.title ?? key };
    }
    case 'location': {
      const loc = context.locations.find(l => l.id === key);
      return { label: loc?.name ?? key };
    }
  }
}

/**
 * Builds an ordered lane list from the scene set, preserving first-seen order
 * so the lane list is stable as long as the scene order is stable.
 */
function buildLanes(
  scenes: SpreadsheetScene[],
  grouping: TimelinePrimaryGrouping,
  context: TrackLayoutContext,
): LaneDef[] {
  const seen = new Set<string>();
  const orderedKeys: string[] = [];

  for (const scene of scenes) {
    for (const key of primaryGroupKeysFor(scene, grouping)) {
      if (!seen.has(key)) {
        seen.add(key);
        orderedKeys.push(key);
      }
    }
  }

  return orderedKeys.map((key, index) => ({
    id: key,
    index,
    ...resolveLaneLabel(key, grouping, context),
  }));
}

/**
 * Builds the x-coordinate map (date → TimeAxisColumn) for all unique dates.
 *
 * Uniform: each date column starts at idx × columnSpacing.
 * Proportional: each date is mapped linearly between [0, totalWidth - cardWidth].
 */
function buildColumnMap(
  uniqueDates: string[],
  spacingMode: TimelineSpacingMode,
  cardWidth: number,
  columnSpacing: number,
  totalWidth: number,
): Map<string, TimeAxisColumn> {
  const columnMap = new Map<string, TimeAxisColumn>();
  if (uniqueDates.length === 0) return columnMap;

  if (spacingMode === 'uniform') {
    uniqueDates.forEach((date, idx) => {
      columnMap.set(date, { date, x: idx * columnSpacing, width: cardWidth });
    });
  } else {
    // proportional
    if (uniqueDates.length === 1) {
      columnMap.set(uniqueDates[0], { date: uniqueDates[0], x: 0, width: cardWidth });
    } else {
      const minMs = parseDateUTC(uniqueDates[0]);
      const maxMs = parseDateUTC(uniqueDates[uniqueDates.length - 1]);
      const msRange = maxMs - minMs;
      uniqueDates.forEach(date => {
        const ratio = (parseDateUTC(date) - minMs) / msRange;
        const x = Math.round(ratio * (totalWidth - cardWidth));
        columnMap.set(date, { date, x, width: cardWidth });
      });
    }
  }

  return columnMap;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute the full track layout for a set of scenes.
 *
 * Pure function — no DOM access, no side effects.
 *
 * Callers should pre-filter scenes by showUndatedScenes / visibleTrackFilters
 * before calling (filtering is the caller's concern, not the layout engine's).
 *
 * Multi-arc rendering: for arc grouping, this engine assigns each scene to its
 * FIRST arc's lane (the primary lane). The rendering layer (F3) is responsible
 * for drawing secondary-arc ghost cards by iterating over scene.arcIds directly,
 * using the full lane list and the shared xOffset/width from this layout.
 */
export function computeTrackLayout(
  scenes: SpreadsheetScene[],
  context: TrackLayoutContext,
  options: TrackLayoutOptions,
): LayoutResult {
  const {
    primaryGrouping,
    spacingMode,
    cardWidth = DEFAULT_CARD_WIDTH,
    columnSpacing = DEFAULT_COLUMN_SPACING,
    totalWidth = DEFAULT_TOTAL_WIDTH,
    gapThresholdDays = DEFAULT_GAP_THRESHOLD_DAYS,
  } = options;

  // 1. Build lanes (preserving first-seen order across all scenes)
  const lanes = buildLanes(scenes, primaryGrouping, context);
  const laneIndexMap = new Map(lanes.map(l => [l.id, l.index]));

  // 2. Partition into dated / undated
  const datedScenes = scenes.filter(s => s.date);
  const undatedScenes = scenes.filter(s => !s.date);

  // 3. Collect unique dates, sorted ascending (ISO string sort = chronological)
  const uniqueDates = [...new Set(datedScenes.map(s => s.date))].sort();

  // 4. Build x-coordinate map
  const columnMap = buildColumnMap(uniqueDates, spacingMode, cardWidth, columnSpacing, totalWidth);

  // 5. Detect gaps between adjacent date columns
  const gaps: TimeGap[] = [];
  for (let i = 0; i < uniqueDates.length - 1; i++) {
    const a = uniqueDates[i];
    const b = uniqueDates[i + 1];
    const delta = daysBetween(a, b);
    if (delta > gapThresholdDays) {
      const colA = columnMap.get(a)!;
      const colB = columnMap.get(b)!;
      gaps.push({
        afterDate: a,
        beforeDate: b,
        afterX: colA.x + colA.width,
        beforeX: colB.x,
        dayDelta: delta,
      });
    }
  }

  // 6. Assign scene layouts
  // Within a lane+date slot, scenes are sorted alphabetically by title for stable stacking.
  const stackCounter = new Map<string, number>();

  const sortedDated = [...datedScenes].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    return dateCmp !== 0 ? dateCmp : a.title.localeCompare(b.title);
  });

  const sceneLayouts: SceneLayout[] = [];

  for (const scene of sortedDated) {
    const primaryKey = primaryGroupKeysFor(scene, primaryGrouping)[0];
    const laneIndex = laneIndexMap.get(primaryKey) ?? 0;

    // Use NUL as separator so "1" + "2024" can't collide with "12" + "024"
    const stackKey = `${laneIndex}\x00${scene.date}`;
    const stackIndex = stackCounter.get(stackKey) ?? 0;
    stackCounter.set(stackKey, stackIndex + 1);

    const col = columnMap.get(scene.date);
    sceneLayouts.push({
      sceneId: scene.id,
      laneIndex,
      stackIndex,
      xOffset: col?.x ?? 0,
      width: cardWidth,
    });
  }

  // Undated scenes: placed one columnSpacing after the last dated column.
  // If there are no dated scenes they start at x=0.
  const undatedX =
    uniqueDates.length > 0
      ? columnMap.get(uniqueDates[uniqueDates.length - 1])!.x + columnSpacing
      : 0;

  const sortedUndated = [...undatedScenes].sort((a, b) => a.title.localeCompare(b.title));

  for (const scene of sortedUndated) {
    const primaryKey = primaryGroupKeysFor(scene, primaryGrouping)[0];
    const laneIndex = laneIndexMap.get(primaryKey) ?? 0;

    const stackKey = `${laneIndex}\x00__undated__`;
    const stackIndex = stackCounter.get(stackKey) ?? 0;
    stackCounter.set(stackKey, stackIndex + 1);

    sceneLayouts.push({
      sceneId: scene.id,
      laneIndex,
      stackIndex,
      xOffset: undatedX,
      width: cardWidth,
    });
  }

  return {
    lanes,
    sceneLayouts,
    timeAxis: [...columnMap.values()],
    gaps,
  };
}
