// SKY-10876 (M12.B4b) — "Rebuild my timeline" command engine tests.
//
// Covers the ownership discipline the engine's header promises:
//  §1 fresh build — one manuscript-agent event per scene, in reading order,
//     namespaced `event:manuscript:` so it can never clobber the migration's
//     `scene:` ids or the M25 auto-build's `event:auto:` ids;
//  §2 idempotent — a second rebuild of an unchanged manuscript changes nothing;
//  §3 author sovereignty — an event the author took over (source !== 'agent')
//     is never refreshed, removed, or duplicated, and an author's rename/summary
//     on an agent event survives every rebuild (only when/chapter refresh);
//  §4 stale pruning is SCOPED — only stale manuscript-agent events on the ACTIVE
//     timeline are dropped; other timelines and other namespaces are untouched;
//  §5 driver — the shared primitive is read ONCE (spy reader), the store is
//     persisted through the injected writer, and missing scenes surface, never
//     silent (gh-944).
import { describe, expect, it, vi } from 'vitest';
import type { Manifest, ChapterEntry, SceneEntry, StoryEntry } from './ipc.js';
import type { SceneFileData } from './vault.js';
import { defaultManifest } from './vault.js';
import {
  DEFAULT_TIMELINE_CALENDAR,
  type TimelineEvent,
  type TimelinesStore,
} from './timelines/model.js';
import { encodeLegacyDay } from './timelines/store.js';
import type { ManuscriptPassScene, ManuscriptSnapshot } from './manuscriptPass.js';
import {
  MANUSCRIPT_EVENT_PREFIX,
  applyManuscriptRebuild,
  rebuildTimelineFromManuscript,
} from './timelineRebuild.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const ACTIVE = 'story';

function snapScene(sceneId: string, chapterNumber: number, over: Partial<ManuscriptPassScene> = {}): ManuscriptPassScene {
  return {
    sceneId,
    scenePath: `scenes/${sceneId}.md`,
    title: `Scene ${sceneId}`,
    storyId: 'st-1',
    chapterId: `ch-${chapterNumber}`,
    chapterTitle: `Chapter ${chapterNumber}`,
    chapterNumber,
    prose: `Prose for ${sceneId}.`,
    ...over,
  };
}

function snapshot(scenes: ManuscriptPassScene[], missingSceneIds: string[] = []): ManuscriptSnapshot {
  return { scenes, missingSceneIds, builtAt: CREATED_AT };
}

function store(events: TimelineEvent[], activeTimelineId = ACTIVE): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId,
    timelines: [],
    eras: [],
    spans: [],
    rows: [],
    events,
  };
}

const mid = (sceneId: string): string => MANUSCRIPT_EVENT_PREFIX + sceneId;
const whenFor = (index: number): number => encodeLegacyDay(index + 1, 'unspecified', DEFAULT_TIMELINE_CALENDAR);

// ─── §1: fresh build ─────────────────────────────────────────────────────────

describe('applyManuscriptRebuild — fresh build', () => {
  it('adds one namespaced agent event per scene, in reading order with 1-based chapter and POV', () => {
    const snap = snapshot([
      snapScene('sc-a', 1, { title: 'Arrival', metaPov: 'Elara' }),
      snapScene('sc-b', 1, { pov: 'Kade' }),
      snapScene('sc-c', 2),
    ]);
    const before = store([]);

    const result = applyManuscriptRebuild(before, snap);

    expect(result).toMatchObject({ eventsAdded: 3, eventsUpdated: 0, eventsRemoved: 0 });
    expect(result.store.events.map((e) => e.id)).toEqual([mid('sc-a'), mid('sc-b'), mid('sc-c')]);
    expect(result.store.events.map((e) => e.when)).toEqual([whenFor(0), whenFor(1), whenFor(2)]);
    expect(result.store.events.map((e) => e.chapter)).toEqual([1, 1, 2]);
    // metaPov wins over pov; pov falls back; absent when neither is set.
    expect(result.store.events.map((e) => e.pov)).toEqual(['Elara', 'Kade', undefined]);
    for (const e of result.store.events) {
      expect(e.source).toBe('agent');
      expect(e.timelineId).toBe(ACTIVE);
    }
    // Reading order is strictly increasing so events plot in manuscript order.
    const whens = result.store.events.map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });

  it('does not mutate the input store', () => {
    const before = store([]);
    const frozen = JSON.parse(JSON.stringify(before));
    applyManuscriptRebuild(before, snapshot([snapScene('sc-a', 1)]));
    expect(before).toEqual(frozen);
  });
});

// ─── §2: idempotency ─────────────────────────────────────────────────────────

describe('applyManuscriptRebuild — idempotency', () => {
  it('a second rebuild of an unchanged manuscript changes nothing', () => {
    const snap = snapshot([snapScene('sc-a', 1), snapScene('sc-b', 2)]);
    const first = applyManuscriptRebuild(store([]), snap);
    const second = applyManuscriptRebuild(first.store, snap);
    expect(second).toMatchObject({ eventsAdded: 0, eventsUpdated: 0, eventsRemoved: 0 });
    expect(second.store.events).toEqual(first.store.events);
  });
});

// ─── §3: author sovereignty ──────────────────────────────────────────────────

describe('applyManuscriptRebuild — author sovereignty', () => {
  it('never touches or duplicates an event the author took over (source !== agent)', () => {
    const authored: TimelineEvent = {
      id: mid('sc-a'),
      timelineId: ACTIVE,
      name: 'The Author’s Own Title',
      when: 999,
      chapter: 7,
      source: 'manual',
    };
    const result = applyManuscriptRebuild(store([authored]), snapshot([snapScene('sc-a', 1)]));
    expect(result).toMatchObject({ eventsAdded: 0, eventsUpdated: 0, eventsRemoved: 0 });
    // Exactly one event with that id, and it is the author's verbatim.
    const matches = result.store.events.filter((e) => e.id === mid('sc-a'));
    expect(matches).toEqual([authored]);
  });

  it('refreshes only when/chapter on an agent event, preserving the author’s rename and summary', () => {
    const edited: TimelineEvent = {
      id: mid('sc-a'),
      timelineId: ACTIVE,
      name: 'Renamed by author',
      summary: 'Author-written two-line summary.',
      when: 111,
      chapter: 9,
      source: 'agent',
    };
    const result = applyManuscriptRebuild(store([edited]), snapshot([snapScene('sc-a', 3)]));
    expect(result).toMatchObject({ eventsAdded: 0, eventsUpdated: 1, eventsRemoved: 0 });
    const [ev] = result.store.events;
    expect(ev.name).toBe('Renamed by author');
    expect(ev.summary).toBe('Author-written two-line summary.');
    expect(ev.chapter).toBe(3);
    expect(ev.when).toBe(whenFor(0));
  });
});

// ─── §4: scoped pruning ──────────────────────────────────────────────────────

describe('applyManuscriptRebuild — scoped pruning', () => {
  it('drops only stale manuscript-agent events on the active timeline; spares other namespaces and timelines', () => {
    const stale: TimelineEvent = { id: mid('gone'), timelineId: ACTIVE, name: 'Gone', when: 5, source: 'agent' };
    const authored: TimelineEvent = { id: 'user-1', timelineId: ACTIVE, name: 'Hand-made', when: 6, source: 'manual' };
    const m25Auto: TimelineEvent = { id: 'event:auto:x', timelineId: ACTIVE, name: 'M25 build', when: 7, source: 'agent' };
    const otherTimeline: TimelineEvent = { id: mid('sc-a'), timelineId: 'alt', name: 'Alt copy', when: 8, source: 'agent' };

    const result = applyManuscriptRebuild(
      store([stale, authored, m25Auto, otherTimeline]),
      snapshot([snapScene('sc-a', 1)]),
    );

    expect(result.eventsRemoved).toBe(1);
    const ids = result.store.events.map((e) => e.id);
    expect(ids).not.toContain(mid('gone')); // stale manuscript-agent event pruned
    expect(ids).toContain('user-1'); // author event spared
    expect(ids).toContain('event:auto:x'); // M25 auto-build namespace spared
    // The alt-timeline event keeps its own copy of the same scene id, untouched.
    expect(result.store.events.find((e) => e.timelineId === 'alt')).toEqual(otherTimeline);
    // ...and the active timeline got its own fresh event for sc-a.
    expect(result.store.events.some((e) => e.id === mid('sc-a') && e.timelineId === ACTIVE)).toBe(true);
  });
});

// ─── §5: driver (single read + persistence + honest report) ──────────────────

function manifestWith(scenes: Array<{ id: string; order: number }>): Manifest {
  const sceneEntries: SceneEntry[] = scenes.map((s) => ({
    id: s.id,
    title: `Scene ${s.id}`,
    path: `scenes/${s.id}.md`,
    order: s.order,
    blocks: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }));
  const chapter: ChapterEntry = {
    id: 'ch-1',
    title: 'Chapter 1',
    path: 'chapters/ch-1',
    order: 1,
    scenes: sceneEntries,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const story: StoryEntry = {
    id: 'st-1',
    title: 'Story',
    path: 'stories/st-1',
    chapters: [chapter],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  return { ...defaultManifest('/virtual'), stories: [story] };
}

describe('rebuildTimelineFromManuscript — driver', () => {
  it('reads each scene exactly once, persists via the injected writer, and reports honestly', () => {
    const manifest = manifestWith([
      { id: 'sc-a', order: 1 },
      { id: 'sc-b', order: 2 },
    ]);
    const readScene = vi.fn((_root: string, rel: string): SceneFileData => ({
      id: rel,
      title: rel,
      prose: `prose ${rel}`,
    }));
    let persisted: TimelinesStore | null = null;
    const writeStore = vi.fn((_root: string, s: TimelinesStore) => {
      persisted = s;
    });

    const { report, store: returned } = rebuildTimelineFromManuscript('/virtual', manifest, {
      readScene,
      readStore: () => store([]),
      writeStore,
    });

    // Single-read guarantee: one read per scene, never a second pass.
    expect(readScene).toHaveBeenCalledTimes(2);
    expect(writeStore).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      ok: true,
      timelineId: ACTIVE,
      scenesRead: 2,
      missingSceneIds: [],
      eventsAdded: 2,
      eventsUpdated: 0,
      eventsRemoved: 0,
      eventsTotal: 2,
    });
    // The returned store IS the persisted one (no second round-trip needed).
    expect(returned).toBe(persisted);
    expect(returned.events.map((e) => e.id)).toEqual([mid('sc-a'), mid('sc-b')]);
  });

  it('surfaces an unreadable scene in missingSceneIds instead of silently emptying it', () => {
    const manifest = manifestWith([
      { id: 'sc-a', order: 1 },
      { id: 'sc-missing', order: 2 },
    ]);
    const readScene = vi.fn((_root: string, rel: string): SceneFileData => {
      if (rel.includes('sc-missing')) throw new Error('ENOENT');
      return { id: rel, title: rel, prose: `prose ${rel}` };
    });

    const { report } = rebuildTimelineFromManuscript('/virtual', manifest, {
      readScene,
      readStore: () => store([]),
      writeStore: () => {},
    });

    expect(report.scenesRead).toBe(1);
    expect(report.missingSceneIds).toEqual(['sc-missing']);
    expect(report.eventsAdded).toBe(1);
  });
});
