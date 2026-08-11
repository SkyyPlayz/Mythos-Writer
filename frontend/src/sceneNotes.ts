// M9b (SKY-9823): scene-note list model + drag-promote payload.
//
// Scene notes persist through the existing SKY-55 store (`notes:get`/`notes:set`,
// one content string per scene). The brainstorm bridge (SKY-1391,
// sceneAppendBrainstormNote.ts) already appends discrete notes to that string
// with a `\n---\n` separator, so that separator IS the list format: this module
// parses the stored string into note cards and serializes cards back. Legacy
// free-text content round-trips as a single card.

import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';

export const SCENE_NOTE_SEPARATOR = '\n---\n';

/** dataTransfer MIME for dragging a scene note onto the story navigator. */
export const SCENE_NOTE_DRAG_MIME = 'application/x-mythos-scene-note';

export interface SceneNoteDragPayload {
  sceneId: string;
  /** Index of the note within the scene's parsed note list at drag time. */
  index: number;
  text: string;
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
