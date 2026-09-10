// SKY-11192/SKY-11674 §3 — Idea Collections `File` action.
//
// Files an agent-suggested/starter idea as a REAL vault note in one of three
// fixed, non-user-editable folders (BOARDS-SPEC §11). Every call here is the
// direct result of a user's own click on `File` — this module has exactly
// one entry point (fileIdea) and no timer/batch/agent-turn caller anywhere
// in the codebase is permitted to call it (review-blocking constraint, see
// the ticket).
//
// Pure Node (fs/path only) — mirrors notesBoard.ts's degrade-to-safe-default
// style and reuses its I/O primitives (vault.ts) rather than a second writer.

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';
import { writeFileAtomic, listVaultFiles, markSelfWrite } from './vault.js';

export type IdeaCollectionCategory = 'beats' | 'theme' | 'trope' | 'loose' | 'rel' | 'world';

/**
 * Fixed mapping (BOARDS-SPEC §11 / SKY-11192 §3) — NOT user-editable.
 * beats/theme/trope/loose -> Plot & Story, rel -> Characters, world -> Worldbuilding.
 */
export const IDEA_COLLECTION_FOLDER: Record<IdeaCollectionCategory, string> = {
  beats: 'Plot & Story',
  theme: 'Plot & Story',
  trope: 'Plot & Story',
  loose: 'Plot & Story',
  rel: 'Characters',
  world: 'Worldbuilding',
};

export interface FileIdeaArgs {
  notesVaultRoot: string;
  category: IdeaCollectionCategory;
  title: string;
  desc: string;
}

export type FileIdeaResult =
  | { status: 'filed'; folderPath: string; itemPath: string }
  | { status: 'already-filed'; folderPath: string; itemPath: string };

/**
 * Case-insensitive stem match against the target folder's IMMEDIATE .md
 * children only — "matching idea text against existing note names in the
 * target folder" (§3), not a vault-wide search. Re-run on every call (never
 * cached) so a note renamed away from the matching name un-blocks the idea,
 * and a hand-created note with a matching name is detected too (§3).
 */
export function findFiledNote(
  vaultRoot: string,
  folderRelPath: string,
  title: string,
): string | null {
  const stemLower = sanitizeVaultName(title, 'Untitled idea').toLowerCase();
  let items: ReturnType<typeof listVaultFiles>['items'];
  try {
    items = listVaultFiles(vaultRoot, folderRelPath || undefined).items;
  } catch {
    return null; // folder doesn't exist yet — nothing can be filed there
  }
  for (const item of items) {
    if (item.path.includes('/')) continue; // immediate children only
    if (!/\.md$/i.test(item.name)) continue;
    if (item.name.slice(0, -3).toLowerCase() === stemLower) return item.path;
  }
  return null;
}

/**
 * File an idea as a real note. Idempotent: an existing note whose name
 * matches (case-insensitively) is returned as `already-filed` rather than
 * overwritten or duplicated. Creates the target folder silently if it is
 * missing (§3 — this is a direct effect of the user's own click, not agent
 * autonomy) before writing the note. The card's board position is left
 * unset — the shared board engine auto-layouts any item without a saved
 * position (BOARDS-SPEC §6), so no explicit patchLayout call is needed here.
 */
export function fileIdea(args: FileIdeaArgs): FileIdeaResult {
  const folderPath = IDEA_COLLECTION_FOLDER[args.category];

  const existing = findFiledNote(args.notesVaultRoot, folderPath, args.title);
  if (existing) return { status: 'already-filed', folderPath, itemPath: existing };

  const folderAbs = path.join(args.notesVaultRoot, folderPath);
  fs.mkdirSync(folderAbs, { recursive: true });

  const stem = sanitizeVaultName(args.title, 'Untitled idea');
  const itemPath = `${stem}.md`;
  const abs = path.join(folderAbs, itemPath);
  const body = args.desc
    ? `# ${args.title}\n\n${args.desc}\n`
    : `# ${args.title}\n`;
  writeFileAtomic(abs, body);
  // The app's own write — without the mark, chokidar's `add` would bounce
  // straight back as an external vault change (same reasoning as
  // notesBoard.ts's createBoardItem).
  markSelfWrite(abs);

  return { status: 'filed', folderPath, itemPath };
}

/**
 * Undo a just-filed idea (the toast's `Undo` action, §3): deletes the note
 * fileIdea just created. Same forgiveness idiom as the canvas's card-delete
 * undo — a plain delete, since the toast (and therefore the Undo window) is
 * only live for a few seconds right after the create.
 */
export function unfileIdea(
  notesVaultRoot: string,
  category: IdeaCollectionCategory,
  itemPath: string,
): { deleted: boolean } {
  const folderPath = IDEA_COLLECTION_FOLDER[category];
  const abs = path.join(notesVaultRoot, folderPath, itemPath);
  try {
    fs.unlinkSync(abs);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}
