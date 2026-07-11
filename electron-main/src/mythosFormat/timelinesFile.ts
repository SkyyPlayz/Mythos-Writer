// Beta 4 M5 — MythosVault v2 `timelines.json`: all timelines in one vault file.
//
// v0.4 scattered timeline state across three stores: `timeline-settings.json`
// and `arcs.json` at the Story Vault root plus `ManifestV1.timeline` entries
// inside manifest.json. v2 gathers them into `<MythosVault>/timelines.json`
// so timeline work survives vault copy like everything else. M21 (timeline
// model + custom calendars) builds its full §8 schema on this envelope —
// unknown keys are preserved so its richer payloads round-trip through M5
// builds.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../vault.js';
import type { ArcEntry, TimelineSettings } from '../ipc.js';

export const TIMELINES_FILENAME = 'timelines.json';
export const TIMELINES_FILE_VERSION = 1 as const;

/** Per-scene inferred/overridden position — shape of ManifestV1.timeline entries. */
export interface TimelineSceneEntry {
  sceneId: string;
  [key: string]: unknown;
}

/** A named timeline event (seeded by the Veynn demo; M21's model grows this). */
export interface TimelineEventEntry {
  id: string;
  title: string;
  /** Timeline date — year×10 float (§8.2). */
  when: number;
  chapter?: string;
  description?: string;
  flashback?: boolean;
}

export interface TimelinesFile {
  version: number;
  settings?: TimelineSettings;
  arcs: ArcEntry[];
  /** Per-scene timeline entries carried over from ManifestV1.timeline. */
  sceneEntries: TimelineSceneEntry[];
  events: TimelineEventEntry[];
  /** Forward-compat: keys written by newer builds are preserved on rewrite. */
  [key: string]: unknown;
}

export function timelinesFilePath(mythosRoot: string): string {
  return path.join(mythosRoot, TIMELINES_FILENAME);
}

export function defaultTimelinesFile(): TimelinesFile {
  return {
    version: TIMELINES_FILE_VERSION,
    arcs: [],
    sceneEntries: [],
    events: [],
  };
}

/** Tolerant read — missing/corrupt file degrades to an empty envelope. */
export function readTimelinesFile(mythosRoot: string): TimelinesFile {
  try {
    const raw = fs.readFileSync(timelinesFilePath(mythosRoot), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaultTimelinesFile();
    }
    const r = parsed as Record<string, unknown>;
    return {
      ...r,
      version: typeof r.version === 'number' ? r.version : TIMELINES_FILE_VERSION,
      arcs: Array.isArray(r.arcs) ? (r.arcs as ArcEntry[]) : [],
      sceneEntries: Array.isArray(r.sceneEntries) ? (r.sceneEntries as TimelineSceneEntry[]) : [],
      events: Array.isArray(r.events) ? (r.events as TimelineEventEntry[]) : [],
      ...(typeof r.settings === 'object' && r.settings !== null
        ? { settings: r.settings as TimelineSettings }
        : {}),
    } as TimelinesFile;
  } catch {
    return defaultTimelinesFile();
  }
}

export function writeTimelinesFile(mythosRoot: string, file: TimelinesFile): void {
  writeFileAtomic(timelinesFilePath(mythosRoot), `${JSON.stringify(file, null, 2)}\n`);
}
