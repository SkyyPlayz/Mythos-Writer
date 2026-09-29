// Slice D / 02 §4 — story/vault editable-state stash.
// Leaving a story/vault stashes editable state; returning restores it.
// A stash must never inject another story's lanes (content-validated).

import fs from 'node:fs';
import path from 'node:path';
import { MYTHOS_MACHINE_DIRNAME } from './mythosJson.js';
import { writeFileAtomic } from '../vault.js';

export const STASH_FILENAME = 'story-state-stash.json';

export interface StoryLaneBundle {
  arcs?: unknown[];
  journeys?: unknown[];
  world?: unknown[];
  themes?: unknown[];
  plotlineIds?: string[];
}

export interface StoryStashEntry {
  vaultId: string;
  storyId: string;
  updatedAt: string;
  manuscriptTabs?: unknown;
  navigatorOpen?: unknown;
  selectedEventId?: string | null;
  lanes?: StoryLaneBundle;
  crafter?: unknown;
  boards?: unknown;
}

interface StashFile {
  version: 1;
  entries: Record<string, StoryStashEntry>;
}

function stashPath(mythosRoot: string): string {
  return path.join(mythosRoot, MYTHOS_MACHINE_DIRNAME, STASH_FILENAME);
}

function stashKey(vaultId: string, storyId: string): string {
  return `${vaultId}/${storyId}`;
}

function readFile(mythosRoot: string): StashFile {
  try {
    const raw = JSON.parse(fs.readFileSync(stashPath(mythosRoot), 'utf-8')) as StashFile;
    if (!raw || raw.version !== 1 || typeof raw.entries !== 'object' || !raw.entries) {
      return { version: 1, entries: {} };
    }
    return raw;
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeFile(mythosRoot: string, file: StashFile): void {
  const dir = path.join(mythosRoot, MYTHOS_MACHINE_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(stashPath(mythosRoot), `${JSON.stringify(file, null, 2)}\n`);
}

export function stashStoryState(
  mythosRoot: string,
  entry: Omit<StoryStashEntry, 'updatedAt'> & { updatedAt?: string },
): void {
  const file = readFile(mythosRoot);
  const key = stashKey(entry.vaultId, entry.storyId);
  file.entries[key] = {
    ...entry,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };
  writeFile(mythosRoot, file);
}

/**
 * Restore stash only when plotline ids intersect seed ids (or stash plotlines
 * are all user-created / empty). Guards against corrupted cross-story inject.
 */
export function restoreStoryState(
  mythosRoot: string,
  vaultId: string,
  storyId: string,
  seedPlotlineIds: string[],
): StoryStashEntry | null {
  const file = readFile(mythosRoot);
  const entry = file.entries[stashKey(vaultId, storyId)];
  if (!entry) return null;
  if (entry.vaultId !== vaultId || entry.storyId !== storyId) return null;

  const stashIds = entry.lanes?.plotlineIds ?? [];
  if (stashIds.length > 0 && seedPlotlineIds.length > 0) {
    const seed = new Set(seedPlotlineIds);
    const overlap = stashIds.some((id) => seed.has(id));
    const allUser = stashIds.every((id) => typeof id === 'string' && id.startsWith('user:'));
    if (!overlap && !allUser) {
      // Discard timeline/lane keys — corrupted / wrong-story stash.
      return {
        ...entry,
        lanes: undefined,
        selectedEventId: null,
      };
    }
  }
  return entry;
}

export function clearStoryStash(mythosRoot: string, vaultId: string, storyId: string): void {
  const file = readFile(mythosRoot);
  delete file.entries[stashKey(vaultId, storyId)];
  writeFile(mythosRoot, file);
}
