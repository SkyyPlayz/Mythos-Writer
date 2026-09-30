// M9b (SKY-9823): scene-note list model + drag-promote payload.
//
// Scene notes persist through the existing SKY-55 store (`notes:get`/`notes:set`,
// one content string per scene). The brainstorm bridge (SKY-1391,
// sceneAppendBrainstormNote.ts) already appends discrete notes to that string
// with a `\n---\n` separator, so that separator IS the list format: this module
// parses the stored string into note cards and serializes cards back. Legacy
// free-text content round-trips as a single card.
//
// F5 (beta 0.5.6): book / part / chapter / scene each get their own store key.
// Scene keeps the bare UUID key so the brainstorm append bridge stays in sync;
// higher tiers use a `tier:<id>` prefix in the same SQLite column.

import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';

export const SCENE_NOTE_SEPARATOR = '\n---\n';

/** dataTransfer MIME for dragging a scene note onto the story navigator. */
export const SCENE_NOTE_DRAG_MIME = 'application/x-mythos-scene-note';

/** Structural tiers that own a private notes pane (apart from manuscript body). */
export type NoteTier = 'book' | 'part' | 'chapter' | 'scene';

export const NOTE_TIERS: readonly NoteTier[] = ['book', 'part', 'chapter', 'scene'] as const;

export const NOTE_TIER_LABELS: Record<NoteTier, string> = {
  book: 'Book',
  part: 'Part',
  chapter: 'Chapter',
  scene: 'Scene',
};

export interface SceneNoteDragPayload {
  sceneId: string;
  /** Index of the note within the scene's parsed note list at drag time. */
  index: number;
  text: string;
}

export interface NoteTierIds {
  bookId: string | null;
  partId: string | null;
  chapterId: string | null;
  sceneId: string | null;
}

/**
 * Store key for `notes:get` / `notes:set`. Scene stays a bare UUID (legacy +
 * brainstorm bridge); book/part/chapter use a stable prefix.
 */
export function buildNoteStoreKey(tier: NoteTier, id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error('note store key requires a non-empty id');
  if (tier === 'scene') return trimmed;
  return `${tier}:${trimmed}`;
}

/** Resolve the store key for a tier given the current structural ids. */
export function noteStoreKeyForTier(tier: NoteTier, ids: NoteTierIds): string | null {
  switch (tier) {
    case 'book':
      return ids.bookId ? buildNoteStoreKey('book', ids.bookId) : null;
    case 'part':
      return ids.partId ? buildNoteStoreKey('part', ids.partId) : null;
    case 'chapter':
      return ids.chapterId ? buildNoteStoreKey('chapter', ids.chapterId) : null;
    case 'scene':
      return ids.sceneId ? buildNoteStoreKey('scene', ids.sceneId) : null;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

export function parseSceneNotes(content: string): string[] {
  if (!content.trim()) return [];
  return content
    .split(SCENE_NOTE_SEPARATOR)
    .map((note) => note.trim())
    .filter(Boolean);
}

export function serializeSceneNotes(notes: string[]): string {
  return notes.join(SCENE_NOTE_SEPARATOR);
}

/**
 * Vault filename (no extension, no directory) for a promoted scene note,
 * derived from the note's first line. Display name, not a slug — the
 * sanitizer keeps Unicode/emoji (R3).
 */
export function promotedSceneNoteName(text: string): string {
  const firstLine = text.split('\n', 1)[0].trim();
  const capped = firstLine.length > 60 ? `${firstLine.slice(0, 60).trimEnd()}…` : firstLine;
  return sanitizeVaultName(capped, 'Scene note');
}

function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Markdown body for a promoted note; same frontmatter shape as promoted entries. */
export function buildPromotedSceneNoteContent(
  text: string,
  sceneTitle: string,
  storyTitle: string,
): string {
  return [
    '---',
    'type: note',
    'source: promoted-scene-note',
    `scene: ${yamlScalar(sceneTitle || 'unknown')}`,
    `story: ${yamlScalar(storyTitle || 'unknown')}`,
    '---',
    '',
    text,
  ].join('\n');
}
