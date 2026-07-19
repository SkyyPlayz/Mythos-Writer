// Beta 4 M25 — Archive auto-build diff against timelines.json (AC7).
import { describe, it, expect } from 'vitest';
import type { TimelinesStore, TimelineEvent } from '../timelinesTypes';
import { AUTO_EVENT_PREFIX, autoBuildSignature, planAutoBuild } from './archiveAutoBuild';

function makeStore(events: TimelineEvent[] = []): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-1',
    timelines: [
      {
        id: 'tl-1', name: 'Story', kind: 'story', axis: 'calendar',
        calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
        createdAt: '', updatedAt: '',
      },
    ],
    eras: [], spans: [], rows: [],
    events,
  };
}

const chapters = new Map([
  ['ch-1', 0],
  ['plan:unsorted', 1],
]);
const whenForChapter = (i: number) => (i + 1) * 100;

const planned = [
  { id: 'plan:gate:sc:1', title: 'Signal fires', chapterId: 'plan:unsorted' },
  { id: 'plan:gate:sc:2', title: 'Finale', chapterId: 'plan:unsorted' },
];

describe('planAutoBuild', () => {
  it('creates agent-owned planned events for new plan units', () => {
    const { upserts, deleteIds } = planAutoBuild(makeStore(), 'tl-1', planned, chapters, whenForChapter);
    expect(deleteIds).toEqual([]);
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toMatchObject({
      id: `${AUTO_EVENT_PREFIX}plan:gate:sc:1`,
      timelineId: 'tl-1',
      name: 'Signal fires',
      when: 200,
      chapter: 2,
      written: false,
      source: 'agent',
    });
  });

  it('is idempotent: an in-sync store produces no writes', () => {
    const first = planAutoBuild(makeStore(), 'tl-1', planned, chapters, whenForChapter);
    const synced = makeStore(first.upserts);
    const second = planAutoBuild(synced, 'tl-1', planned, chapters, whenForChapter);
    expect(second.upserts).toEqual([]);
    expect(second.deleteIds).toEqual([]);
  });

  it('updates only plotting fields on re-plot — user renames survive', () => {
    const first = planAutoBuild(makeStore(), 'tl-1', planned, chapters, whenForChapter);
    const renamed = first.upserts.map((e) =>
      e.id.endsWith('sc:1') ? { ...e, name: 'My better title', summary: 'my words' } : e,
    );
    // The plan pass moves the unit to chapter 1.
    const moved = [{ ...planned[0], chapterId: 'ch-1' }, planned[1]];
    const { upserts } = planAutoBuild(makeStore(renamed), 'tl-1', moved, chapters, whenForChapter);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      name: 'My better title',
      summary: 'my words',
      when: 100,
      chapter: 1,
    });
  });

  it('never touches events the user has taken over (source no longer agent)', () => {
    const first = planAutoBuild(makeStore(), 'tl-1', planned, chapters, whenForChapter);
    const owned = first.upserts.map((e) => ({ ...e, source: 'manual' as const }));
    const moved = [{ ...planned[0], chapterId: 'ch-1' }, planned[1]];
    const { upserts, deleteIds } = planAutoBuild(makeStore(owned), 'tl-1', moved, chapters, whenForChapter);
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual([]);
  });

  it('deletes agent-owned auto events whose plan unit disappeared', () => {
    const first = planAutoBuild(makeStore(), 'tl-1', planned, chapters, whenForChapter);
    const synced = makeStore(first.upserts);
    const { deleteIds } = planAutoBuild(synced, 'tl-1', [planned[0]], chapters, whenForChapter);
    expect(deleteIds).toEqual([`${AUTO_EVENT_PREFIX}plan:gate:sc:2`]);
  });

  it('leaves quick-add agent events (no auto prefix) alone on rebuild', () => {
    const quickAdd: TimelineEvent = {
      id: 'event:abc', timelineId: 'tl-1', name: 'The festival', when: 150, source: 'agent',
    };
    const { deleteIds } = planAutoBuild(makeStore([quickAdd]), 'tl-1', [], chapters, whenForChapter);
    expect(deleteIds).toEqual([]);
  });
});

describe('autoBuildSignature', () => {
  it('changes when a unit moves chapters and when units appear', () => {
    const a = autoBuildSignature('tl-1', planned, chapters);
    const b = autoBuildSignature('tl-1', [{ ...planned[0], chapterId: 'ch-1' }, planned[1]], chapters);
    const c = autoBuildSignature('tl-1', [planned[0]], chapters);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(autoBuildSignature('tl-1', planned, chapters)).toBe(a);
  });
});
