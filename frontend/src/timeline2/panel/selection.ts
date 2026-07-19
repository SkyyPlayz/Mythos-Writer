// Beta 4 M25 (§8.6 / §14.5) — shared timeline selection model.
// The axis engine reports clicks as a `TimelineSelection`; TimelineRoot owns
// the value and the right panel resolves it into the matching Inspector
// editor. Pure module — no React.
import type {
  TimelinesStore,
  TimelineEra,
  TimelineSpan,
  TimelineEvent,
} from '../../timelinesTypes';
import { ARC_LANE, CHARACTER_LANE, THEME_LANE, WORLD_LANE } from '../axis/storyLanes';

export type TimelineSelectableType = 'era' | 'span' | 'event';

export interface TimelineSelection {
  type: TimelineSelectableType;
  id: string;
}

/** Which lane-editor field layout a lane item gets (§8.6 lane-item editor). */
export type LaneVariant = 'era' | 'span' | 'arc' | 'journey' | 'world' | 'theme' | 'custom';

export type InspectorTarget =
  /** Key event (no rowId) — the full event editor with POV/location/impact. */
  | { editor: 'event'; type: 'event'; item: TimelineEvent }
  /** Plotline scene card — the card editor (plotline/chapter/what-happens). */
  | { editor: 'card'; type: 'event'; item: TimelineEvent }
  /** Everything span-like plus world/theme chips — the lane-item editor. */
  | {
      editor: 'lane';
      type: TimelineSelectableType;
      item: TimelineEra | TimelineSpan | TimelineEvent;
      variant: LaneVariant;
      kindLabel: string;
    };

/**
 * Resolve a selection into the editor the Inspector should show.
 * Returns null when the selected item no longer exists (deleted elsewhere).
 */
export function resolveInspectorTarget(
  store: TimelinesStore,
  selection: TimelineSelection | null,
): InspectorTarget | null {
  if (!selection) return null;

  if (selection.type === 'era') {
    const era = store.eras.find((e) => e.id === selection.id);
    return era ? { editor: 'lane', type: 'era', item: era, variant: 'era', kindLabel: 'Era' } : null;
  }

  if (selection.type === 'span') {
    const span = store.spans.find((s) => s.id === selection.id);
    if (!span) return null;
    if (span.rowId === ARC_LANE) {
      return { editor: 'lane', type: 'span', item: span, variant: 'arc', kindLabel: 'Story arc' };
    }
    if (span.rowId === CHARACTER_LANE) {
      return { editor: 'lane', type: 'span', item: span, variant: 'journey', kindLabel: 'Character journey' };
    }
    if (span.rowId) {
      return { editor: 'lane', type: 'span', item: span, variant: 'custom', kindLabel: 'Custom row item' };
    }
    return { editor: 'lane', type: 'span', item: span, variant: 'span', kindLabel: 'Timeline span' };
  }

  const event = store.events.find((e) => e.id === selection.id);
  if (!event) return null;
  if (event.rowId === WORLD_LANE) {
    return { editor: 'lane', type: 'event', item: event, variant: 'world', kindLabel: 'World event' };
  }
  if (event.rowId === THEME_LANE) {
    return { editor: 'lane', type: 'event', item: event, variant: 'theme', kindLabel: 'Theme' };
  }
  if (event.rowId && store.rows.some((r) => r.id === event.rowId && r.kind === 'plotline')) {
    return { editor: 'card', type: 'event', item: event };
  }
  return { editor: 'event', type: 'event', item: event };
}
