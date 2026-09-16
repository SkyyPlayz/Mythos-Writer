// SKY-10876 (M12.B4b) — "Rebuild my timeline" command engine.
//
// The command half of the "two buttons, one engine" ruling (owner vision
// SKY-10528, wave-sequenced by SKY-10739 / SKY-10874): a SEPARATELY invokable
// command that rebuilds the active timeline's scene events from the manuscript.
// It consumes the SAME shared manuscript-pass primitive the continuity checks
// use (`buildManuscriptSnapshot`, M12.B4a / SKY-10875) — the book is read once,
// by one engine, whichever button the author presses.
//
// This module is the WRITE layer the read-only primitive deliberately keeps at
// arm's length (see manuscriptPass.ts §"READ-ONLY by construction"). It imports
// the snapshot BUILDER but NEVER `runContinuityChecksFromSnapshot`: a timeline
// rebuild can never fire a continuity check, and — the converse the primitive's
// own byte-identity test already guards — a continuity check can never rebuild
// the timeline. The two commands share the reader, nothing else.
//
// Ownership discipline (mirrors the M25 frontend auto-build, archiveAutoBuild.ts):
// the rebuild only ever owns events IT created — id prefix `event:manuscript:`,
// `source: 'agent'`. On a re-run it refreshes only the plotting fields
// (`when`/`chapter`) of those events, so an author's rename or summary edit
// survives every rebuild; an event the author has taken over (`source !==
// 'agent'`) is never touched. The distinct `event:manuscript:` namespace also
// keeps this main-process, manuscript-driven build from colliding with the M25
// frontend, plan-note-driven build (`event:auto:`) — neither deletes the
// other's events.

import type { Manifest, TimelineRebuildReport } from './ipc.js';
import {
  buildManuscriptSnapshot,
  type ManuscriptSnapshot,
  type SceneFileReader,
} from './manuscriptPass.js';
import { encodeLegacyDay, readTimelinesStore, writeTimelinesStore } from './timelines/store.js';
import { DEFAULT_TIMELINE_CALENDAR, type TimelineEvent, type TimelinesStore } from './timelines/model.js';

/** Id prefix for every manuscript-derived agent event. Kept distinct from the
 *  migration's `scene:` ids and the M25 auto-build's `event:auto:` ids so the
 *  three builders never clobber one another. */
export const MANUSCRIPT_EVENT_PREFIX = 'event:manuscript:';

export interface ManuscriptRebuildResult {
  store: TimelinesStore;
  timelineId: string;
  eventsAdded: number;
  eventsUpdated: number;
  eventsRemoved: number;
}

/**
 * Pure store transform: rebuild the ACTIVE timeline's manuscript-derived events
 * from a snapshot. Returns a NEW store (the input is never mutated) plus the
 * add/update/remove tallies. Everything that is not a manuscript-agent event on
 * the active timeline — author-authored events, migrated events, other
 * timelines, eras, spans, rows, tension points — is preserved verbatim.
 */
export function applyManuscriptRebuild(
  store: TimelinesStore,
  snapshot: ManuscriptSnapshot,
): ManuscriptRebuildResult {
  const timelineId = store.activeTimelineId;
  const calendar =
    store.timelines.find((t) => t.id === timelineId)?.calendar ?? DEFAULT_TIMELINE_CALENDAR;
  const scenes = snapshot.scenes;

  const desiredIds = new Set(scenes.map((s) => MANUSCRIPT_EVENT_PREFIX + s.sceneId));
  // Only the ACTIVE timeline's events participate in reconciliation. The same
  // manuscript scene can carry an `event:manuscript:<sceneId>` on more than one
  // timeline (rebuild timeline A, switch active to B, rebuild again → both hold
  // the id), so a store-wide id map would let this rebuild refresh or drop
  // another timeline's identical-id event. Scoping the lookup keeps a rebuild's
  // ownership to the active timeline, matching the "preserved verbatim" contract
  // above.
  const existingById = new Map(
    store.events.filter((e) => e.timelineId === timelineId).map((e) => [e.id, e] as const),
  );

  let eventsRemoved = 0;
  // Drop stale manuscript-agent events on the active timeline (their scene is
  // gone from the manuscript). Nothing else is a rebuild's to remove.
  const preserved = store.events.filter((e) => {
    const isStale =
      e.timelineId === timelineId &&
      e.source === 'agent' &&
      e.id.startsWith(MANUSCRIPT_EVENT_PREFIX) &&
      !desiredIds.has(e.id);
    if (isStale) eventsRemoved += 1;
    return !isStale;
  });

  let eventsAdded = 0;
  let eventsUpdated = 0;
  const rebuiltIds = new Set<string>();
  const rebuilt: TimelineEvent[] = [];

  scenes.forEach((scene, index) => {
    const id = MANUSCRIPT_EVENT_PREFIX + scene.sceneId;
    // Reading-order placement: one narrative "day" per scene, so events plot in
    // manuscript order on a fresh timeline. Chronological-date placement (from
    // scene frontmatter) is a separate concern already served by TIMELINE_INFER
    // and the timeline proposals engine — see SKY-796 / MYT-319.
    const when = encodeLegacyDay(index + 1, 'unspecified', calendar);
    const chapter = scene.chapterNumber;
    const existing = existingById.get(id);

    // The author took this event over — never fight their edit. It stays in
    // `preserved`; do not add a competing copy.
    if (existing && existing.source !== 'agent') return;

    rebuiltIds.add(id);
    if (existing) {
      if (existing.when !== when || existing.chapter !== chapter) eventsUpdated += 1;
      // Refresh only the plotting fields; keep the author's rename/summary/etc.
      rebuilt.push({ ...existing, when, chapter });
    } else {
      eventsAdded += 1;
      const pov = scene.metaPov ?? scene.pov;
      rebuilt.push({
        id,
        timelineId,
        name: scene.title,
        when,
        chapter,
        sceneId: scene.sceneId,
        ...(pov ? { pov } : {}),
        source: 'agent',
      });
    }
  });

  // Reassemble: everything preserved that we did not just rebuild, then the
  // rebuilt events in manuscript reading order. Deterministic → idempotent.
  // The rebuilt-id drop is scoped to the active timeline for the same reason
  // the lookup is: an identical id on another timeline is not ours to remove.
  const events = preserved
    .filter((e) => !(e.timelineId === timelineId && rebuiltIds.has(e.id)))
    .concat(rebuilt);

  return {
    store: { ...store, events },
    timelineId,
    eventsAdded,
    eventsUpdated,
    eventsRemoved,
  };
}

export interface RebuildDeps {
  /** Injectable manuscript reader — threaded straight into the shared
   *  primitive so tests can prove the single-read guarantee. */
  readScene?: SceneFileReader;
  readStore?: (vaultRoot: string) => TimelinesStore;
  writeStore?: (vaultRoot: string, store: TimelinesStore) => void;
}

/**
 * Drive the whole command: read the manuscript ONCE via the shared primitive,
 * rebuild the active timeline's scene events, persist the store (atomic +
 * rolling backup, via writeTimelinesStore), and return the report plus the
 * fresh store so the renderer can refresh without a second round-trip.
 */
export function rebuildTimelineFromManuscript(
  vaultRoot: string,
  manifest: Manifest,
  deps: RebuildDeps = {},
): { report: TimelineRebuildReport; store: TimelinesStore } {
  const snapshot = buildManuscriptSnapshot(vaultRoot, manifest, deps.readScene);
  const store = (deps.readStore ?? readTimelinesStore)(vaultRoot);

  const { store: nextStore, timelineId, eventsAdded, eventsUpdated, eventsRemoved } =
    applyManuscriptRebuild(store, snapshot);

  (deps.writeStore ?? writeTimelinesStore)(vaultRoot, nextStore);

  const eventsTotal = nextStore.events.filter(
    (e) =>
      e.timelineId === timelineId &&
      e.source === 'agent' &&
      e.id.startsWith(MANUSCRIPT_EVENT_PREFIX),
  ).length;

  const report: TimelineRebuildReport = {
    ok: true,
    timelineId,
    scenesRead: snapshot.scenes.length,
    missingSceneIds: snapshot.missingSceneIds,
    eventsAdded,
    eventsUpdated,
    eventsRemoved,
    eventsTotal,
  };
  return { report, store: nextStore };
}
