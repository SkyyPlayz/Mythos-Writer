/**
 * F5 — Resolve book / part / chapter / scene ancestry for Notes per-tier.
 *
 * v2 cache manifests keep chapters flat under `story.chapters` with paths like
 * `<Story>/Part N/Chapter NN` and leave `story.parts` empty. Part ancestry must
 * therefore be read from the chapter path (or legacy nested `story.parts`).
 */

import { isPartDirName } from './mythosFormat/sceneFiles.js';
import type { NotesTierContextResponse } from './ipc.js';

type TierScene = { id: string };
type TierChapter = {
  id: string;
  path?: string;
  scenes?: TierScene[];
};
type TierPart = {
  id: string;
  chapters?: TierChapter[];
};
type TierStory = {
  id: string;
  parts?: TierPart[];
  chapters?: TierChapter[];
};

export type TierManifest = {
  stories?: TierStory[];
};

/** Extract bare "Part N" from a v2 canonical chapter path. */
export function partIdFromChapterPath(chapterPath: string | undefined): string | null {
  if (!chapterPath || typeof chapterPath !== 'string') return null;
  const segments = chapterPath.split(/[\\/]/).filter(Boolean);
  for (const seg of segments) {
    if (isPartDirName(seg)) return seg;
  }
  return null;
}

/**
 * Critic H2 / Probe: scope v2 "Part N" ids per book so Part notes do not
 * collide across stories that share the same folder name.
 * Legacy `story.parts[].id` values are left as-is (already unique).
 */
export function scopedPartIdForBook(bookId: string, barePartId: string): string {
  const book = bookId.trim();
  const bare = barePartId.trim();
  if (!book || !bare) return bare;
  if (bare.startsWith(`${book}/`)) return bare;
  return `${book}/${bare}`;
}

/**
 * Pure resolver — unit/integration tested against scanned v2 manifests.
 * Does not touch the filesystem.
 */
export function resolveNotesTierFromManifest(
  manifest: TierManifest,
  sceneId: string,
): NotesTierContextResponse {
  const id = typeof sceneId === 'string' ? sceneId.trim() : '';
  if (!id || id.includes('\0') || id.includes('..')) {
    return { ok: false, error: 'Invalid scene id' };
  }

  for (const story of manifest.stories ?? []) {
    for (const chapter of story.chapters ?? []) {
      const hit = (chapter.scenes ?? []).some((s) => s.id === id);
      if (!hit) continue;

      let partId: string | null = null;
      for (const part of story.parts ?? []) {
        if ((part.chapters ?? []).some((c) => c.id === chapter.id)) {
          partId = part.id;
          break;
        }
      }
      if (!partId) {
        const bare = partIdFromChapterPath(chapter.path);
        partId = bare ? scopedPartIdForBook(story.id, bare) : null;
      }

      return {
        ok: true,
        bookId: story.id,
        partId,
        chapterId: chapter.id,
        sceneId: id,
      };
    }

    // Legacy nested parts → chapters → scenes (pre-v2 / parted manifests).
    for (const part of story.parts ?? []) {
      for (const chapter of part.chapters ?? []) {
        const hit = (chapter.scenes ?? []).some((s) => s.id === id);
        if (!hit) continue;
        return {
          ok: true,
          bookId: story.id,
          partId: part.id,
          chapterId: chapter.id,
          sceneId: id,
        };
      }
    }
  }

  return { ok: false, error: 'Scene not found' };
}

/**
 * IPC-facing entry: wrap manifest read so FS/parse failures become plain errors.
 * `sanitize` must be sanitizeIpcError (or equivalent) — never forward raw paths.
 */
export function runNotesTierContext(
  sceneId: string,
  readManifest: () => TierManifest,
  sanitize: (err: unknown) => { error: string },
): NotesTierContextResponse {
  try {
    return resolveNotesTierFromManifest(readManifest(), sceneId);
  } catch (e) {
    return { ok: false, error: sanitize(e).error };
  }
}
