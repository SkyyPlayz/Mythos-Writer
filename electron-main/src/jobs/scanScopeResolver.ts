// Scan-scope resolution (M12.3, SKY-10770).
//
// Maps a renderer-picked scope (level + anchor scene id) to the concrete set
// of manuscript scene units the extraction job may touch. Runs in the MAIN
// process on a manifest MAIN read itself — the renderer never supplies file
// paths, so the M12.1 security invariant (renderer never controls scan
// targets) holds for scoped scans too.
//
// Pure over the manifest object: no fs, no DB — trivially unit-testable.

import type { ChapterEntry, Manifest, PartEntry, SceneEntry, StoryEntry } from '../ipc.js';
import type { ScanScopeLevel, ScanUnit } from './types.js';

export interface ScanScopeRequest {
  level: ScanScopeLevel;
  /** The anchor: the scene the user is looking at when they trigger the scan. */
  sceneId: string;
}

interface SceneContext {
  story: StoryEntry;
  /** Null when the story has no real Part tier (pre-M2 vault, or the single
   *  untitled Part the M2 migration wraps chapters in). */
  part: PartEntry | null;
  chapter: ChapterEntry;
}

/** A story whose parts are absent, empty, or a single untitled wrapper has no
 *  user-visible Part tier (same rule as the renderer's isSimpleSinglePart). */
function realParts(story: StoryEntry): PartEntry[] | null {
  const parts = story.parts ?? [];
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].title === '') return null;
  return parts;
}

const byOrder = <T extends { order: number }>(items: T[]): T[] =>
  items.slice().sort((a, b) => a.order - b.order);

/** Part-tier contract (storyParts.ts): with a REAL Part tier, parts[] is
 *  authoritative and story.chapters is the derived mirror. With no real tier
 *  (absent, empty, or the single untitled M2-migration wrapper part),
 *  story.chapters is authoritative — the wrapper's chapters can be a stale
 *  migration-time snapshot that only heals on a structural write. */
function chaptersOf(story: StoryEntry): ChapterEntry[] {
  const parts = realParts(story);
  if (parts) {
    return byOrder(parts).flatMap((p) => byOrder(p.chapters));
  }
  const live = byOrder(story.chapters ?? []);
  if (live.length > 0) return live;
  // Defensive: a wrapper-part manifest with no mirrored chapters list.
  return byOrder(story.parts ?? []).flatMap((p) => byOrder(p.chapters));
}

/** Scenes of a chapter in manuscript order. `order` is per-chapter, so
 *  ordering must happen inside each container — never across a flattened
 *  cross-chapter list. */
function scenesInOrder(chapter: ChapterEntry): SceneEntry[] {
  return byOrder(chapter.scenes ?? []);
}

function findSceneContext(manifest: Manifest, sceneId: string): SceneContext | null {
  for (const story of manifest.stories ?? []) {
    const parts = realParts(story);
    for (const chapter of chaptersOf(story)) {
      if (!(chapter.scenes ?? []).some((s) => s.id === sceneId)) continue;
      const part = parts?.find((p) => p.chapters.some((c) => c.id === chapter.id)) ?? null;
      return { story, part, chapter };
    }
  }
  return null;
}

/** True when the path is safe to hand to the scan worker: vault-relative,
 *  POSIX separators, no traversal. Manifest entries normally satisfy this;
 *  a corrupted/hand-edited manifest must not widen the scan past the vault. */
function isSafeUnitPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\\')) return false;
  return !p.split('/').includes('..');
}

/** De-duplicate and path-screen an already-ordered scene list. */
function toUnits(scenes: SceneEntry[]): ScanUnit[] {
  const seen = new Set<string>();
  const units: ScanUnit[] = [];
  for (const scene of scenes) {
    if (seen.has(scene.id) || !isSafeUnitPath(scene.path)) continue;
    seen.add(scene.id);
    units.push({ sceneId: scene.id, path: scene.path });
  }
  return units;
}

/**
 * Resolve a scope request to the ordered, de-duplicated scene units it
 * covers. Returns [] when the anchor scene is not in the manifest.
 *
 * Levels: 'scene' = the anchor alone; 'chapter' = the containing chapter;
 * 'part' = every chapter in the containing Part (a story with no real Part
 * tier treats 'part' as 'book'); 'book' = the whole containing story.
 */
export function resolveScanScopeUnits(manifest: Manifest, scope: ScanScopeRequest): ScanUnit[] {
  const ctx = findSceneContext(manifest, scope.sceneId);
  if (!ctx) return [];

  switch (scope.level) {
    case 'scene': {
      const scene = ctx.chapter.scenes.find((s) => s.id === scope.sceneId);
      return scene ? toUnits([scene]) : [];
    }
    case 'chapter':
      return toUnits(scenesInOrder(ctx.chapter));
    case 'part': {
      const chapters = ctx.part
        ? byOrder(ctx.part.chapters)
        : chaptersOf(ctx.story); // no Part tier — 'part' degrades to 'book'
      return toUnits(chapters.flatMap(scenesInOrder));
    }
    case 'book':
      return toUnits(chaptersOf(ctx.story).flatMap(scenesInOrder));
  }
}
