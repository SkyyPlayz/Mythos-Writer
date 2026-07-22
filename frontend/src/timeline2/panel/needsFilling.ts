// Beta 4 M25 — Brainstorm tab NEEDS FILLING OUT list (§8.6): timeline spots
// the agent flags as thin — blank-summary key events, unreplaced template
// beats, and thin world events. Pure module; clicking an item jumps to it on
// the axis (TimelineRoot's jump signal).
import type { TimelinesStore } from '../../timelinesTypes';
import { THEME_LANE, keyEvents, worldEvents } from '../axis/storyLanes';

export interface NeedsFillingItem {
  /** Canvas item id — the jump target. */
  id: string;
  title: string;
  detail: string;
}

/** A world event with less summary than this reads as a bare stub. */
const THIN_WORLD_SUMMARY_CHARS = 24;
/** Keep the list scannable — the worst offenders, not an audit. */
const MAX_ITEMS = 8;

export function needsFillingOut(store: TimelinesStore, timelineId: string): NeedsFillingItem[] {
  const items: NeedsFillingItem[] = [];

  for (const event of store.events) {
    if (event.timelineId !== timelineId) continue;
    if (event.rowId === THEME_LANE) continue;
    if (event.beat) {
      items.push({
        id: event.id,
        title: event.name,
        detail: 'Template beat — replace it with a real scene',
      });
    }
  }

  for (const event of keyEvents(store, timelineId)) {
    if (event.beat) continue;
    if (!event.summary?.trim()) {
      items.push({ id: event.id, title: event.name, detail: 'No summary yet — what happens here?' });
    }
  }

  for (const event of worldEvents(store, timelineId)) {
    const summary = event.summary?.trim() ?? '';
    if (summary.length < THIN_WORLD_SUMMARY_CHARS) {
      items.push({
        id: event.id,
        title: event.name,
        detail: summary ? 'Thin world event — flesh it out' : 'No detail yet — what changes in the world?',
      });
    }
  }

  return items.slice(0, MAX_ITEMS);
}
