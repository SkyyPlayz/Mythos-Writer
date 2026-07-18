// Beta 4 M23 — Lane rows (§8.4): story-lane partition of the M21 store.
//
// The §8.4 story rows persist inside the existing timelines.json shapes:
//   - ARCS        → spans   with rowId === ARC_LANE
//   - CHARACTERS  → spans   with rowId === CHARACTER_LANE (one lane each)
//   - WORLD       → events  with rowId === WORLD_LANE (point chips)
//   - THEMES      → events  with rowId === THEME_LANE (flex chips, undated)
//   - PLOTLINES   → rows    with kind 'plotline'; their cards are events with
//                   rowId === <plotline row id> (chapter-addressed chips)
// Sentinel rowIds never collide with real row ids (`row:<uuid>` / seeds), so
// the M22 rules — main spans have no rowId, custom-row items match a custom
// row's id — keep working unchanged. Everything here is pure and NaN-safe.
import type {
  TimelinesStore,
  TimelineEvent,
  TimelineRow,
  TimelineSpan,
} from '../../timelinesTypes';

export const ARC_LANE = 'lane:arcs';
export const CHARACTER_LANE = 'lane:characters';
export const WORLD_LANE = 'lane:world';
export const THEME_LANE = 'lane:themes';

const SENTINEL_LANES = new Set([ARC_LANE, CHARACTER_LANE, WORLD_LANE, THEME_LANE]);

/** True when a span belongs to the main BOOKS / SPANS & STORIES row. */
export function isMainSpan(span: TimelineSpan): boolean {
  return !span.rowId;
}

export function arcSpans(store: Pick<TimelinesStore, 'spans'>, timelineId: string): TimelineSpan[] {
  return store.spans.filter((s) => s.timelineId === timelineId && s.rowId === ARC_LANE);
}

export function characterSpans(store: Pick<TimelinesStore, 'spans'>, timelineId: string): TimelineSpan[] {
  return store.spans.filter((s) => s.timelineId === timelineId && s.rowId === CHARACTER_LANE);
}

export function worldEvents(store: Pick<TimelinesStore, 'events'>, timelineId: string): TimelineEvent[] {
  return store.events.filter((e) => e.timelineId === timelineId && e.rowId === WORLD_LANE);
}

export function themeEvents(store: Pick<TimelinesStore, 'events'>, timelineId: string): TimelineEvent[] {
  return store.events.filter((e) => e.timelineId === timelineId && e.rowId === THEME_LANE);
}

export function plotlineRows(store: Pick<TimelinesStore, 'rows'>, timelineId: string): TimelineRow[] {
  return store.rows.filter((r) => r.timelineId === timelineId && r.kind === 'plotline');
}

export function plotlineCards(store: Pick<TimelinesStore, 'events'>, plotlineId: string): TimelineEvent[] {
  return store.events.filter((e) => e.rowId === plotlineId);
}

/**
 * KEY EVENTS row contents: every event of the timeline EXCEPT the ones that
 * belong to a story lane (world chips, theme chips, plotline cards). Events
 * whose rowId points at a custom row keep rendering here — that is the M21
 * seed/migration behavior M22 shipped with.
 */
export function keyEvents(
  store: Pick<TimelinesStore, 'events' | 'rows'>,
  timelineId: string,
): TimelineEvent[] {
  const plotlineIds = new Set(plotlineRows(store, timelineId).map((r) => r.id));
  return store.events.filter(
    (e) =>
      e.timelineId === timelineId &&
      (!e.rowId || (!SENTINEL_LANES.has(e.rowId) && !plotlineIds.has(e.rowId))),
  );
}

/**
 * FLASHBACK (§8.4 row 6): "chronology ≠ narrative". An event with a narrative
 * chapter is a flashback when some event EARLIER in the narrative carries a
 * LATER in-world date — i.e. its date is out of chronological order relative
 * to narrative order (prototype: "The Crown of Ash", revealed Ch. 31, dated
 * Year 850 while Ch. 1–23 sit in 871–873).
 */
export function isFlashback(
  event: Pick<TimelineEvent, 'chapter' | 'when'>,
  events: readonly Pick<TimelineEvent, 'chapter' | 'when'>[],
): boolean {
  if (event.chapter == null || !Number.isFinite(event.when)) return false;
  return events.some(
    (other) =>
      other !== event &&
      other.chapter != null &&
      Number.isFinite(other.when) &&
      other.chapter < (event.chapter as number) &&
      other.when > event.when,
  );
}

// ── Show filter (prototype tlFilterSel 6839 + evVis 6082) ──

export type TimelineShowFilter = 'All Events' | 'Key Events' | 'Written Only' | 'Planned Only';

export const TIMELINE_SHOW_FILTERS: readonly TimelineShowFilter[] = [
  'All Events', 'Key Events', 'Written Only', 'Planned Only',
];

export interface EventVisibilityContext {
  show: TimelineShowFilter;
  /** All key events (for the flashback check under 'Key Events'). */
  events: readonly TimelineEvent[];
  /** The story's current position; null = nothing written yet. */
  hereWhen: number | null;
}

/** Written/planned resolution: the explicit flag wins; otherwise anything at
 *  or before the current position counts as written (prototype greyed items
 *  past "you are here"; with nothing written everything is planned). */
export function isEventWritten(event: TimelineEvent, hereWhen: number | null): boolean {
  if (event.written != null) return event.written;
  if (hereWhen == null) return false;
  return Number.isFinite(event.when) && event.when <= hereWhen;
}

/** Prototype `evVis` (6082), on real data: Key Events keeps flashbacks and
 *  summarized/impactful events; Written/Planned split on isEventWritten. */
export function eventVisible(event: TimelineEvent, ctx: EventVisibilityContext): boolean {
  switch (ctx.show) {
    case 'Key Events':
      return isFlashback(event, ctx.events) || Boolean(event.summary) || !event.rowId;
    case 'Written Only':
      return isEventWritten(event, ctx.hereWhen);
    case 'Planned Only':
      return !isEventWritten(event, ctx.hereWhen);
    default:
      return true;
  }
}

// ── Plot-structure templates (prototype tlTpls, 4179–4183 — exact port) ──

export interface PlotTemplate {
  name: string;
  /** [grid chapter (1–12), beat title] */
  beats: readonly (readonly [number, string])[];
}

export const PLOT_TEMPLATES: readonly PlotTemplate[] = [
  {
    name: 'Three-Act Structure',
    beats: [
      [1, 'Setup'], [3, 'Inciting Incident'], [4, 'Plot Point One'], [6, 'Midpoint'],
      [9, 'Plot Point Two'], [11, 'Climax'], [12, 'Resolution'],
    ],
  },
  {
    name: 'Save the Cat',
    beats: [
      [1, 'Opening Image'], [2, 'Theme Stated'], [3, 'Catalyst'], [4, 'Break into Two'],
      [6, 'Midpoint'], [8, 'All Is Lost'], [10, 'Break into Three'], [12, 'Final Image'],
    ],
  },
  {
    name: 'Hero’s Journey',
    beats: [
      [1, 'Ordinary World'], [2, 'Call to Adventure'], [3, 'Refusal of the Call'],
      [4, 'Crossing the Threshold'], [6, 'Tests & Allies'], [8, 'The Ordeal'],
      [10, 'The Road Back'], [12, 'Return with the Elixir'],
    ],
  },
];

/** Prototype plotline palette (`tlPal`, 6572): c1 c2 c3 teal c6. */
export const PLOTLINE_PALETTE: readonly string[] = [
  '#00f0ff', '#9b5fff', '#ff4dff', '#2fe6c8', '#3d9bff',
];

export interface TemplateApplication {
  row: TimelineRow;
  cards: TimelineEvent[];
}

/**
 * Build the plotline row + dashed beat cards a template lays onto the
 * timeline (prototype tlTplItems.pick, 6600). `cardWhen` maps a grid chapter
 * to a date so every card persists with a valid `when` (0.1-tick aligned by
 * the caller's rounding function).
 */
export function buildTemplateApplication(
  template: PlotTemplate,
  timelineId: string,
  existingPlotlineCount: number,
  cardWhen: (gridChapter: number) => number,
  newId: (prefix: string) => string,
): TemplateApplication {
  const row: TimelineRow = {
    id: newId('row'),
    timelineId,
    name: template.name,
    kind: 'plotline',
    color: PLOTLINE_PALETTE[existingPlotlineCount % PLOTLINE_PALETTE.length],
  };
  const cards: TimelineEvent[] = template.beats.map(([ch, title]) => ({
    id: newId('event'),
    timelineId,
    name: title,
    when: cardWhen(ch),
    rowId: row.id,
    chapter: ch,
    beat: true,
    summary: `${template.name} beat — replace with your scene.`,
    source: 'manual',
  }));
  return { row, cards };
}
