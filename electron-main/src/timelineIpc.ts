// SKY-2463: Pure handler logic for timeline:list and timeline:upsert IPC channels.
// Extracted from main.ts so these functions are unit-testable without Electron mocks.
//
// SKY-6306 / PR #914 UNIFICATION DECISION — one source of truth:
// `timelines.json` (the M21 TimelinesStore, timelines/store.ts) is the single
// runtime store for timeline data. These legacy channels are COMPATIBILITY
// VIEWS over it:
//
// - `timeline:list` returns the per-scene ManifestTimelineEntry data carried
//   on migrated/upserted events (`event.legacy`). On first access to a vault
//   with pre-M21 `manifest.timeline` data, readTimelinesStore migrates it
//   (backup-first, lossless) — the previous dead-code state left that data
//   silently orphaned while the demo seed masked it.
// - `timeline:upsert` validates against manifest.scenes (the manifest remains
//   the source of truth for SCENES) but persists the day/time override into
//   the TimelinesStore event — `manifest.timeline` is no longer written. The
//   manifest keeps its historical `timeline` field untouched (lossless), but
//   nothing reads it after migration: no dual-read, no dual-write.
// - Demo-seeded events (source 'seed') carry no `legacy` entry and therefore
//   never leak into the legacy API's responses.
//
// Rationale: these channels have no frontend consumers (preload/global.d.ts
// exposure only — verified across frontend/src), while the TimelinesStore is
// what M21's picker and M22's axis engine render. Routing the legacy channels
// through the store was the minimal unification that leaves one writer.
//
// Reads of the legacy manifest go through vault.ts readManifest — the real
// on-disk shape. The sibling `vault/manifest/*` ManifestV1 module is a
// structure-only schema NOT shape-compatible with real vaults (object
// `provenance`, `boardReferences` instead of `boards`) despite also declaring
// schemaVersion 1 — validating real vaults against it throws (SKY-6632).
import type { ManifestTimelineEntry, StoryTimeOfDay } from './vault/manifest/types.js';
import { readManifest } from './vault.js';
import { resolveManifestPath } from './mythosFormat/mythosJson.js';
import {
  encodeLegacyDay,
  readTimelinesStore,
  writeTimelinesStore,
} from './timelines/store.js';
import { DEFAULT_TIMELINE_CALENDAR, type TimelineDefinition, type TimelinesStore } from './timelines/model.js';
import type { TimelineListResponse, TimelineUpsertPayload, TimelineUpsertResponse } from './ipc.js';

export const VALID_TIMELINE_TIMES: ReadonlyArray<StoryTimeOfDay> = [
  'midnight', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'unspecified',
];

/**
 * Read all per-scene timeline entries (the legacy view over the TimelinesStore)
 * and compute aggregate values. `maxDay` is the highest resolved day across
 * user overrides and inferred days.
 *
 * First access to a vault with legacy `manifest.timeline` data migrates it
 * into timelines.json (see readTimelinesStore).
 */
export function handleTimelineList(vaultRoot: string): TimelineListResponse {
  const store = readTimelinesStore(vaultRoot);
  const entries = legacyEntries(store);
  const sceneCount = entries.length;
  const maxDay = entries.reduce((m, e) => {
    const d = e.userOverride?.day ?? e.inferredDay;
    return d > m ? d : m;
  }, 0);
  return { entries, sceneCount, maxDay };
}

/**
 * Upsert a user day/time override for a scene.
 *
 * Validation (main-process enforced):
 * - sceneId must match an entry in manifest.scenes
 * - day must be an integer 1–9999
 * - time must be a valid StoryTimeOfDay value
 *
 * The override persists into the TimelinesStore (timelines.json) — the single
 * source of truth — as the scene event's `legacy` entry plus a recomputed
 * `when` position. `manifest.timeline` is NOT written.
 */
export function handleTimelineUpsert(
  vaultRoot: string,
  payload: TimelineUpsertPayload,
): TimelineUpsertResponse {
  const { sceneId, day, time } = payload;

  if (!Number.isInteger(day) || day < 1 || day > 9999) {
    return { ok: false, error: 'invalid day' };
  }
  if (!VALID_TIMELINE_TIMES.includes(time)) {
    return { ok: false, error: 'invalid time' };
  }

  const manifest = readManifest(resolveManifestPath(vaultRoot));
  const scene = manifest.scenes.find(s => s.id === sceneId);
  if (!scene) {
    return { ok: false, error: 'scene not found' };
  }

  const now = new Date().toISOString();
  const store = readTimelinesStore(vaultRoot);

  const existingEvent = store.events.find(e => e.sceneId === sceneId);
  const baseEntry: ManifestTimelineEntry = existingEvent?.legacy ?? {
    sceneId,
    inferredDay: 0,
    inferredTime: 'unspecified',
    confidence: 0,
    rawCue: '',
  };
  const updatedEntry: ManifestTimelineEntry = {
    ...baseEntry,
    userOverride: { day, time, setAt: now },
  };

  if (existingEvent) {
    const timeline = store.timelines.find(t => t.id === existingEvent.timelineId);
    existingEvent.when = encodeLegacyDay(day, time, timeline?.calendar ?? DEFAULT_TIMELINE_CALENDAR);
    existingEvent.legacy = updatedEntry;
  } else {
    const timeline = sceneEventTimeline(store);
    store.events.push({
      id: `scene:${sceneId}`,
      timelineId: timeline.id,
      name: scene.title || sceneId,
      when: encodeLegacyDay(day, time, timeline.calendar),
      sceneId,
      source: 'manual',
      legacy: updatedEntry,
    });
  }

  writeTimelinesStore(vaultRoot, store);
  return { ok: true, entry: updatedEntry };
}

/** The legacy per-scene entries carried on the store's scene events. */
function legacyEntries(store: TimelinesStore): ManifestTimelineEntry[] {
  const entries: ManifestTimelineEntry[] = [];
  for (const event of store.events) {
    if (event.legacy) entries.push(event.legacy);
  }
  return entries;
}

/** The timeline scene events belong on: story-kind first, then the active one. */
function sceneEventTimeline(store: TimelinesStore): TimelineDefinition {
  return (
    store.timelines.find(t => t.kind === 'story') ??
    store.timelines.find(t => t.id === store.activeTimelineId) ??
    store.timelines[0]
  );
}
