// SKY-1391: brainstorm → writing-panel bridge — append logic
//
// savedPath → sceneId mapping (documented per spec):
//   The renderer stores the scene's UUID (SceneEntry.id) as `savedPath` when
//   it links an idea card to a scene via "Open in writing panel". That UUID
//   is passed directly as `sceneId` to this handler — no normalization needed.
//   Scene ids are the primary key used by the notes table and the manifest.

import { getNoteBySceneId, upsertNote } from './db.js';
import type { Manifest, SceneAppendBrainstormNoteResponse } from './ipc.js';

/**
 * Append `content` to the scene's note field (SQLite notes table).
 *
 * - Empty content: no-op, returns { appended: false }.
 * - First append: stores content directly.
 * - Subsequent appends: inserts "\n---\n" separator before the new content.
 * - Unknown sceneId: throws Error("Scene not found: <id>") — sanitized by
 *   setupIpcMain's catch before reaching the renderer.
 */
export function appendBrainstormNote(
  manifest: Manifest,
  sceneId: string,
  content: string,
): SceneAppendBrainstormNoteResponse {
  if (!content) return { appended: false };

  let found = false;
  outer: for (const story of manifest.stories) {
    for (const chapter of story.chapters) {
      if (chapter.scenes.some((s) => s.id === sceneId)) {
        found = true;
        break outer;
      }
    }
  }
  if (!found) found = manifest.scenes.some((s) => s.id === sceneId);
  if (!found) throw new Error(`Scene not found: ${sceneId}`);

  const existing = getNoteBySceneId(sceneId);
  const updated = existing ? `${existing}\n---\n${content}` : content;
  upsertNote(sceneId, updated);
  return { appended: true };
}
