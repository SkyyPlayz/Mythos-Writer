import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dispatchTimelineFromNote,
  findTimelineEventForNote,
  plotNoteOnTimeline,
  storyTimelineId,
  takePendingTimelineFromNote,
  TIMELINE_FROM_NOTE_EVENT,
  titleFromNotePath,
} from './notesToTimeline';
import type { TimelinesStore } from '../timelinesTypes';
import type { TimelineFromNoteDetail } from './notesToTimeline';

const STANDARD = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 } as const;

function makeStore(): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [
      {
        id: 'tl-story',
        name: 'Story',
        kind: 'story',
        axis: 'calendar',
        calendar: { ...STANDARD },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    eras: [],
    spans: [],
    rows: [],
    events: [],
  };
}

describe('notesToTimeline (FD-2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('storyTimelineId prefers the story-kind timeline', () => {
    const store = makeStore();
    expect(storyTimelineId(store)).toBe('tl-story');
  });

  it('titleFromNotePath uses the note title or file stem', () => {
    expect(titleFromNotePath('Chars/Elara.md', 'Elara Vale')).toBe('Elara Vale');
    expect(titleFromNotePath('Chars/Elara.md', '')).toBe('Elara');
  });

  it('findTimelineEventForNote matches linkedNotePath on the story timeline', () => {
    const store = makeStore();
    store.events.push({
      id: 'ev-1',
      timelineId: 'tl-story',
      name: 'Beat',
      when: 10,
      linkedNotePath: 'Plot/beat.md',
    });
    expect(findTimelineEventForNote(store, 'Plot/beat.md')?.id).toBe('ev-1');
    expect(findTimelineEventForNote(store, 'Other.md')).toBeNull();
  });

  it('plotNoteOnTimeline creates a planned event with linkedNotePath', async () => {
    const store = makeStore();
    const upsert = vi.fn().mockResolvedValue({ ok: true, store });
    Object.defineProperty(window, 'api', {
      value: {
        timelinesGetStore: vi.fn().mockResolvedValue({ store }),
        timelinesUpsertItem: upsert,
      },
      configurable: true,
    });

    const out = await plotNoteOnTimeline('World/Gate.md', 'The Sunken Gate');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.created).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const item = upsert.mock.calls[0][0].item;
    expect(item.linkedNotePath).toBe('World/Gate.md');
    expect(item.name).toBe('The Sunken Gate');
    expect(item.written).toBe(false);
  });

  it('dispatch before listener leaves pending for cold TimelineRoot mount', () => {
    const store = makeStore();
    store.events.push({
      id: 'ev-cold',
      timelineId: 'tl-story',
      name: 'Beat',
      when: 10,
      linkedNotePath: 'Plot/beat.md',
    });
    dispatchTimelineFromNote({ eventId: 'ev-cold', store });
    expect(takePendingTimelineFromNote()).toMatchObject({ eventId: 'ev-cold' });
  });

  it('warm listener consumes pending on dispatch', () => {
    const store = makeStore();
    const heard: TimelineFromNoteDetail[] = [];
    const handler = (e: Event) => {
      takePendingTimelineFromNote();
      heard.push((e as CustomEvent<TimelineFromNoteDetail>).detail);
    };
    window.addEventListener(TIMELINE_FROM_NOTE_EVENT, handler);
    dispatchTimelineFromNote({ eventId: 'ev-warm', store });
    window.removeEventListener(TIMELINE_FROM_NOTE_EVENT, handler);
    expect(heard[0]?.eventId).toBe('ev-warm');
    expect(takePendingTimelineFromNote()).toBeNull();
  });

  it('plotNoteOnTimeline reuses an existing linked event', async () => {
    const store = makeStore();
    store.events.push({
      id: 'ev-existing',
      timelineId: 'tl-story',
      name: 'Old',
      when: 5,
      linkedNotePath: 'World/Gate.md',
    });
    Object.defineProperty(window, 'api', {
      value: {
        timelinesGetStore: vi.fn().mockResolvedValue({ store }),
        timelinesUpsertItem: vi.fn(),
      },
      configurable: true,
    });

    const out = await plotNoteOnTimeline('World/Gate.md', 'Title');
    expect(out).toMatchObject({ ok: true, eventId: 'ev-existing', created: false });
  });
});
