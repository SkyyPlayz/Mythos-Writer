// SKY-10712: renaming a note cascade-updates inbound [[wikilinks]] so nothing
// breaks (Obsidian's "Automatically update internal links", which is our
// behaviour authority for the Notes side).
//
// The two vaults get DIFFERENT rewrite modes — this is the owner ruling that
// shapes the whole feature:
//   - Notes vault:  [[Jasper]] → [[Jasper Thorne]]           (display may change)
//   - Story vault:  [[Jasper]] → [[Jasper Thorne|Jasper]]    (visible words preserved)
// Renaming a note is a metadata action; changing prose is an editorial one.
// The story-vault writer is authorised to touch [[...]] spans ONLY — this is
// a bounded exception to the no-agent-edits-manuscript rule, not a licence.
//
// What text changes is decided here. Snapshot-before-write, rollback, and
// one-shot undo (including SKY-10887 span undo) are owned by vaultTransaction.ts.
// Collision is still refused here, before anything is written.

import fs from 'fs';
import path from 'path';
import {
  listVaultFiles,
  moveVaultFile,
  readVaultFile,
  realSafePath,
} from './vault.js';
import { SafeIpcError } from './ipcErrors.js';
import { SESSIONS_DIRNAME } from './mythosFormat/agentSessions.js';
import { rewriteWikiLinksForRename } from '@mythos-writer/shared/wikiLinkRename';
import { BOARD_SIDECAR_FILE_NAME, rewriteBoardSidecarTextForRename } from './notesBoard.js';
import type {
  RenameCascadeLinkUpdate,
  RenameCascadeProgress,
  RenameCascadeUndoResponse,
  VaultMoveResponse,
} from './ipc.js';
import {
  applyVaultTransaction,
  undoVaultTransaction,
  type VaultPlannedChange,
  type VaultWriter,
} from './vaultTransaction.js';

export type { VaultWriter };
export { _resetVaultTransactionState as _resetRenameCascadeState } from './vaultTransaction.js';

export interface RenameNoteWithCascadeOptions {
  notesRoot: string;
  /** Story vault root; empty/missing skips the manuscript side. */
  storyRoot?: string;
  fromPath: string;
  toPath: string;
  onProgress?: (p: RenameCascadeProgress) => void;
  writeFile?: VaultWriter;
}

function noteStem(relPath: string): string {
  return path.basename(relPath).replace(/\.md$/i, '');
}

function isSessionFile(relPath: string): boolean {
  return relPath.split(/[\\/]/)[0] === SESSIONS_DIRNAME;
}

interface CascadeFileRef {
  relPath: string;
  kind: 'note' | 'board';
}

/**
 * SKY-11188: board sidecars only ever live in the notes vault (a board IS a
 * notes-vault folder, §1) — `includeBoards` is false for the story side.
 */
function listCascadeFiles(root: string, excludeSessions: boolean, includeBoards: boolean): CascadeFileRef[] {
  const { items } = listVaultFiles(root);
  return items
    .filter((f) => !f.isDirectory)
    .filter((f) => !excludeSessions || !isSessionFile(f.path))
    .filter((f) => f.path.toLowerCase().endsWith('.md') || (includeBoards && path.basename(f.path) === BOARD_SIDECAR_FILE_NAME))
    .map((f) => ({ relPath: f.path, kind: f.path.toLowerCase().endsWith('.md') ? 'note' : 'board' }));
}

function buildPlan(
  notesRoot: string,
  storyRoot: string,
  oldStem: string,
  newStem: string,
): VaultPlannedChange[] {
  const plan: VaultPlannedChange[] = [];
  const sides: Array<{ side: 'notes' | 'story'; root: string; mode: 'update-display' | 'preserve-display'; includeBoards: boolean }> = [
    // Session transcripts are excluded to match the graph/backlinks scanners:
    // they are system files with no user-facing wikilink semantics (SKY-6228).
    { side: 'notes', root: notesRoot, mode: 'update-display', includeBoards: true },
  ];
  if (storyRoot && fs.existsSync(storyRoot)) {
    // The ENTIRE story vault (scenes, outline, synopsis) is author prose —
    // everything on that side gets the display-preserving rewrite.
    sides.push({ side: 'story', root: storyRoot, mode: 'preserve-display', includeBoards: false });
  }

  for (const { side, root, mode, includeBoards } of sides) {
    for (const file of listCascadeFiles(root, side === 'notes', includeBoards)) {
      let current: string;
      try {
        current = readVaultFile(root, file.relPath).content;
      } catch {
        continue; // unreadable file — leave it alone rather than abort the rename
      }
      const { content: newContent, count } =
        file.kind === 'board'
          ? rewriteBoardSidecarTextForRename(current, oldStem, newStem)
          : rewriteWikiLinksForRename(current, oldStem, newStem, mode);
      if (count > 0) {
        plan.push({ side, kind: file.kind, relPath: file.relPath, newContent, linkCount: count, mode });
      }
    }
  }
  return plan;
}

/**
 * Rename a notes-vault entry, cascading inbound-link updates when the rename
 * changes a note's stem. Non-cascade moves (folder moves, directory renames,
 * same-stem moves) behave exactly like the plain move they always were —
 * except that renaming onto an existing entry is now refused server-side.
 */
export function renameNoteWithCascade(
  opts: RenameNoteWithCascadeOptions,
): VaultMoveResponse {
  const { notesRoot, fromPath, toPath, onProgress } = opts;
  const storyRoot = opts.storyRoot ?? '';

  const fromFull = realSafePath(notesRoot, fromPath, true);
  const toFull = realSafePath(notesRoot, toPath, true);

  // Collision guard — refused BEFORE anything is written. A case-only rename
  // of the same entry (Jasper → jasper) trips existsSync on case-insensitive
  // filesystems, so same-file identity is checked via realpath.
  if (fromFull !== toFull && fs.existsSync(toFull)) {
    let sameFile = false;
    try {
      sameFile = fs.realpathSync.native(fromFull) === fs.realpathSync.native(toFull);
    } catch {
      /* source vanished or unreadable — let moveVaultFile report it */
    }
    if (!sameFile) {
      throw new SafeIpcError(
        `"${path.basename(toPath)}" already exists there. Nothing was renamed — choose a different name.`,
      );
    }
  }

  const isFileRename =
    fs.existsSync(fromFull) &&
    fs.statSync(fromFull).isFile() &&
    /\.md$/i.test(fromPath) &&
    /\.md$/i.test(toPath);
  const oldStem = noteStem(fromPath);
  const newStem = noteStem(toPath);
  // Link resolution is stem-based and case-insensitive (vaultGraph.ts), so
  // folder moves and case-only renames don't break links — no cascade.
  const cascade = isFileRename && oldStem.toLowerCase() !== newStem.toLowerCase();

  const result = moveVaultFile(notesRoot, fromPath, toPath);
  if (!result.moved || !cascade) return result;

  const plan = buildPlan(notesRoot, storyRoot, oldStem, newStem);
  applyVaultTransaction({
    notesRoot,
    storyRoot,
    fromPath,
    toPath,
    oldStem,
    newStem,
    changes: plan,
    onProgress,
    writeFile: opts.writeFile,
  });

  const linkUpdate: RenameCascadeLinkUpdate = {
    linksUpdated: plan.reduce((sum, f) => sum + f.linkCount, 0),
    filesChanged: plan.length,
    notesFilesChanged: plan.filter((f) => f.side === 'notes').length,
    storyFilesChanged: plan.filter((f) => f.side === 'story').length,
    changedNotesPaths: plan.filter((f) => f.side === 'notes').map((f) => f.relPath),
    changedStoryPaths: plan.filter((f) => f.side === 'story').map((f) => f.relPath),
    oldStem,
    newStem,
    undoAvailable: true,
  };
  return { ...result, linkUpdate };
}

export interface UndoRenameCascadeOptions {
  notesRoot: string;
  storyRoot?: string;
  writeFile?: VaultWriter;
}

/**
 * One-shot undo of the most recent rename cascade. The restore rules
 * (byte-for-byte, SKY-10887 span undo, conflicts) live in vaultTransaction.
 */
export function undoLastRenameCascade(opts: UndoRenameCascadeOptions): RenameCascadeUndoResponse {
  return undoVaultTransaction({
    notesRoot: opts.notesRoot,
    storyRoot: opts.storyRoot,
    writeFile: opts.writeFile,
  }).response;
}
