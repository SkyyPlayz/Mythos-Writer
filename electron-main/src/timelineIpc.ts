// SKY-2463: Pure handler logic for timeline:list and timeline:upsert IPC channels.
// Extracted from main.ts so these functions are unit-testable without Electron mocks.
//
// SKY-6632: reads/writes go through the live legacy Manifest (vault.ts), same as
// every other IPC handler in main.ts. The sibling `vault/manifest/*` ManifestV1
// module is a structure-only schema that is NOT shape-compatible with the real
// on-disk manifest.json (object `provenance`, `boardReferences` instead of
// `boards`) despite both declaring schemaVersion 1 — routing the timeline path
// through it made `validateManifestV1` throw on every real vault.
import type { ManifestTimelineEntry, StoryTimeOfDay } from './vault/manifest/types.js';
import { readManifest, writeManifest } from './vault.js';
import type { TimelineListResponse, TimelineUpsertPayload, TimelineUpsertResponse } from './ipc.js';

export const VALID_TIMELINE_TIMES: ReadonlyArray<StoryTimeOfDay> = [
  'midnight', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'unspecified',
];

/**
 * Read all timeline entries from the manifest and compute aggregate values.
 * `maxDay` is the highest resolved day across user overrides and inferred days.
 */
export function handleTimelineList(manifestPath: string): TimelineListResponse {
  const manifest = readManifest(manifestPath);
  const entries = manifest.timeline ?? [];
  const sceneCount = entries.length;
  const maxDay = entries.reduce((m, e) => {
    const d = e.userOverride?.day ?? e.inferredDay;
    return d > m ? d : m;
  }, 0);
  return { entries, sceneCount, maxDay };
}

/**
 * Upsert a user day/time override for a scene into the manifest timeline.
 *
 * Validation (main-process enforced):
 * - sceneId must match an entry in manifest.scenes
 * - day must be an integer 1–9999
 * - time must be a valid StoryTimeOfDay value
 */
export function handleTimelineUpsert(
  manifestPath: string,
  payload: TimelineUpsertPayload,
): TimelineUpsertResponse {
  const { sceneId, day, time } = payload;

  if (!Number.isInteger(day) || day < 1 || day > 9999) {
    return { ok: false, error: 'invalid day' };
  }
  if (!VALID_TIMELINE_TIMES.includes(time)) {
    return { ok: false, error: 'invalid time' };
  }

  const manifest = readManifest(manifestPath);

  if (!manifest.scenes.some(s => s.id === sceneId)) {
    return { ok: false, error: 'scene not found' };
  }

  const now = new Date().toISOString();
  const existing = manifest.timeline?.find(e => e.sceneId === sceneId);
  const updatedEntry: ManifestTimelineEntry = existing
    ? { ...existing, userOverride: { day, time, setAt: now } }
    : {
        sceneId,
        inferredDay: 0,
        inferredTime: 'unspecified',
        confidence: 0,
        rawCue: '',
        userOverride: { day, time, setAt: now },
      };

  const timeline: ManifestTimelineEntry[] = [
    ...(manifest.timeline?.filter(e => e.sceneId !== sceneId) ?? []),
    updatedEntry,
  ];

  writeManifest(manifestPath, { ...manifest, timeline });
  return { ok: true, entry: updatedEntry };
}
