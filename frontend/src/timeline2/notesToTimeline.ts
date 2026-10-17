// PLAN-058 L4 (FD-2) — Notes → timeline chip: plot (or focus) a vault note as a
// planned key event on the story timeline with linkedNotePath (FD-5).

import type { TimelinesStore, TimelineEvent } from '../timelinesTypes';
import { deriveAxisDomain } from './axis/domain';
import { roundWhen, safeCalendar } from './axis/calendarCodec';

export const TIMELINE_FROM_NOTE_EVENT = 'mythos:timeline-from-note';

export type TimelineFromNoteDetail = {
  eventId: string;
  store: TimelinesStore;
};

/** FD-2 cold path: survives until TimelineRoot mounts (CustomEvent is not queued). */
let pendingTimelineFromNote: TimelineFromNoteDetail | null = null;

export function stashTimelineFromNote(detail: TimelineFromNoteDetail): void {
  pendingTimelineFromNote = detail;
}

export function takePendingTimelineFromNote(): TimelineFromNoteDetail | null {
  const pending = pendingTimelineFromNote;
  pendingTimelineFromNote = null;
  return pending;
}

function newEventId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `event:${uuid}`;
}

export function storyTimelineId(store: TimelinesStore): string | null {
  const story = store.timelines.find((t) => t.kind === 'story');
  return story?.id ?? store.activeTimelineId ?? null;
}

export function findTimelineEventForNote(store: TimelinesStore, notePath: string): TimelineEvent | null {
  const tlId = storyTimelineId(store);
  if (!tlId) return null;
  return store.events.find((e) => e.timelineId === tlId && e.linkedNotePath === notePath) ?? null;
}

export function titleFromNotePath(notePath: string, noteTitle?: string): string {
  const trimmed = noteTitle?.trim();
  if (trimmed) return trimmed;
  const base = notePath.split('/').pop() ?? notePath;
  return base.replace(/\.md$/i, '') || 'Note';
}

export async function plotNoteOnTimeline(
  notePath: string,
  noteTitle: string,
): Promise<
  | { ok: true; eventId: string; store: TimelinesStore; created: boolean }
  | { ok: false; message: string }
> {
  const api = window.api;
  if (typeof api?.timelinesGetStore !== 'function' || typeof api?.timelinesUpsertItem !== 'function') {
    return { ok: false, message: 'Timeline is unavailable in this build.' };
  }

  let store: TimelinesStore;
  try {
    const res = await api.timelinesGetStore();
    store = res.store;
  } catch {
    return { ok: false, message: 'Could not load the timeline store.' };
  }

  const timelineId = storyTimelineId(store);
  if (!timelineId) {
    return { ok: false, message: 'No timeline is available yet — create one from the Timeline view.' };
  }

  const existing = findTimelineEventForNote(store, notePath);
  if (existing) {
    return { ok: true, eventId: existing.id, store, created: false };
  }

  const timeline = store.timelines.find((t) => t.id === timelineId);
  if (!timeline) {
    return { ok: false, message: 'No timeline is available yet.' };
  }

  const calendar = safeCalendar(timeline.calendar);
  const [t0, t1] = deriveAxisDomain(store, timelineId, calendar);
  const when = roundWhen(t0 + (t1 - t0) / 2);
  const name = titleFromNotePath(notePath, noteTitle);

  const event: TimelineEvent = {
    id: newEventId(),
    timelineId,
    name,
    when,
    written: false,
    linkedNotePath: notePath,
    summary: 'Plotted from this vault note — drag or use the Inspector to set the exact date.',
  };

  try {
    const upsert = await api.timelinesUpsertItem({ type: 'event', item: event });
    if (!upsert.ok) {
      return { ok: false, message: 'Could not plot this note on the timeline.' };
    }
    return { ok: true, eventId: event.id, store: upsert.store, created: true };
  } catch {
    return { ok: false, message: 'Could not plot this note on the timeline.' };
  }
}

export function dispatchTimelineFromNote(detail: TimelineFromNoteDetail): void {
  stashTimelineFromNote(detail);
  window.dispatchEvent(new CustomEvent<TimelineFromNoteDetail>(TIMELINE_FROM_NOTE_EVENT, { detail }));
}
