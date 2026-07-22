// Beta 4 M25 (SKY-6981) — Archive Agent auto-build → timelines.json writes.
//
// Replaces the old ephemeral consumer: M23 merged plan notes into the derived
// Aeon view only, so planned events vanished on every reload and never plotted
// on the M21 axis. This module diffs the auto-build pass's planned scenes
// (`mergePlannedIntoTimeline`) against the store and returns the minimal
// upsert/delete set — TimelineRoot applies it through the timelines IPC, so
// the axis, spreadsheet and every other mode read planned events from
// `timelines.json` like any other item.
//
// Ownership discipline: the auto-build only ever touches events it created
// (id prefix `event:auto:`, source `'agent'`). On re-runs it updates ONLY the
// plotting fields (`when`/`chapter`/`written`) — a user's rename or summary
// edit on an auto event survives every rebuild. Pure functions; no IPC here.

import type { TimelineEvent, TimelinesStore } from '../timelinesTypes';
import { roundWhen } from './axis/calendarCodec';

export const AUTO_EVENT_PREFIX = 'event:auto:';

/** The slice of a merged planned scene the auto-build needs. */
export interface PlannedSceneInput {
  /** Synthetic plan scene id (`plan:…`) — kept stable across rebuilds. */
  id: string;
  title: string;
  chapterId: string;
}

export interface AutoBuildPlan {
  upserts: TimelineEvent[];
  deleteIds: string[];
}

/**
 * Diff the current auto-build pass against the store's agent-owned events.
 * `chapterIndexById` maps merged chapter ids to their 0-based narrative
 * position; `whenForChapter` plots that position on the active axis.
 */
export function planAutoBuild(
  store: TimelinesStore,
  timelineId: string,
  plannedScenes: readonly PlannedSceneInput[],
  chapterIndexById: ReadonlyMap<string, number>,
  whenForChapter: (chapterIndex: number) => number,
): AutoBuildPlan {
  const upserts: TimelineEvent[] = [];
  const desiredIds = new Set<string>();

  for (const scene of plannedScenes) {
    const id = AUTO_EVENT_PREFIX + scene.id;
    desiredIds.add(id);
    const chapterIndex = chapterIndexById.get(scene.chapterId) ?? chapterIndexById.size;
    const when = roundWhen(whenForChapter(chapterIndex));
    const chapter = chapterIndex + 1;
    const existing = store.events.find((e) => e.id === id);

    if (!existing) {
      upserts.push({
        id,
        timelineId,
        name: scene.title,
        when,
        chapter,
        written: false,
        summary: 'Planned from your notes',
        source: 'agent',
      });
      continue;
    }
    // The user may have taken the event over — never fight their edits.
    if (existing.source !== 'agent') continue;
    if (existing.when !== when || existing.chapter !== chapter || existing.written !== false) {
      upserts.push({ ...existing, when, chapter, written: false });
    }
  }

  const deleteIds = store.events
    .filter(
      (e) =>
        e.timelineId === timelineId &&
        e.source === 'agent' &&
        e.id.startsWith(AUTO_EVENT_PREFIX) &&
        !desiredIds.has(e.id),
    )
    .map((e) => e.id);

  return { upserts, deleteIds };
}

/**
 * A stable signature for one auto-build pass — TimelineRoot re-applies the
 * build only when this changes, so the store round-trip can't loop.
 */
export function autoBuildSignature(
  timelineId: string,
  plannedScenes: readonly PlannedSceneInput[],
  chapterIndexById: ReadonlyMap<string, number>,
): string {
  const parts = plannedScenes.map(
    (s) => `${s.id}@${chapterIndexById.get(s.chapterId) ?? -1}:${s.title}`,
  );
  return `${timelineId}|${parts.join('|')}`;
}
