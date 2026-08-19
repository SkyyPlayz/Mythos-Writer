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
// Hard safety properties:
//   - Collision is refused before anything is written.
//   - The whole cascade is one transaction: a failure partway restores every
//     written file AND renames the note back — never a half-updated vault.
//   - The completed transaction is held for a one-shot undo that restores the
//     rename and every touched file in a single step (files edited since are
//     left alone and reported as skipped).

import fs from 'fs';
import path from 'path';
import {
  listVaultFiles,
  moveVaultFile,
  readVaultFile,
  realSafePath,
  writeVaultFileAtomic,
} from './vault.js';
import { SafeIpcError } from './ipcErrors.js';
import { SESSIONS_DIRNAME } from './mythosFormat/agentSessions.js';
import { rewriteWikiLinksForRename } from '@mythos-writer/shared/wikiLinkRename';
import type {
  RenameCascadeLinkUpdate,
  RenameCascadeProgress,
  RenameCascadeUndoResponse,
  VaultMoveResponse,
} from './ipc.js';

/** Test seam — defaults to the vault-sandboxed atomic writer. */
export type VaultWriter = (vaultRoot: string, relPath: string, content: string) => void;

const defaultWriter: VaultWriter = (root, relPath, content) => {
  writeVaultFileAtomic(root, relPath, content);
};

interface PlanFile {
  side: 'notes' | 'story';
  relPath: string;
  oldContent: string;
  newContent: string;
  linkCount: number;
}

interface CascadeTransaction {
  notesRoot: string;
  storyRoot: string;
  fromPath: string;
  toPath: string;
  oldStem: string;
  newStem: string;
  files: PlanFile[];
}

// Single-level undo: each cascade replaces the previous transaction. Undo is
// validated against current disk state, so a stale transaction can never
// clobber newer work — it degrades to "skipped" files or a refusal.
let lastTransaction: CascadeTransaction | null = null;

/** Test hook — clears the held undo transaction. */
export function _resetRenameCascadeState(): void {
  lastTransaction = null;
}

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

function listMarkdownFiles(root: string, excludeSessions: boolean): string[] {
  const { items } = listVaultFiles(root);
  return items
    .filter((f) => !f.isDirectory && f.path.toLowerCase().endsWith('.md'))
    .filter((f) => !excludeSessions || !isSessionFile(f.path))
    .map((f) => f.path);
}

function buildPlan(
  notesRoot: string,
  storyRoot: string,
  oldStem: string,
  newStem: string,
): PlanFile[] {
  const plan: PlanFile[] = [];
  const sides: Array<{ side: 'notes' | 'story'; root: string; mode: 'update-display' | 'preserve-display' }> = [
    // Session transcripts are excluded to match the graph/backlinks scanners:
    // they are system files with no user-facing wikilink semantics (SKY-6228).
    { side: 'notes', root: notesRoot, mode: 'update-display' },
  ];
  if (storyRoot && fs.existsSync(storyRoot)) {
    // The ENTIRE story vault (scenes, outline, synopsis) is author prose —
    // everything on that side gets the display-preserving rewrite.
    sides.push({ side: 'story', root: storyRoot, mode: 'preserve-display' });
  }

  for (const { side, root, mode } of sides) {
    for (const relPath of listMarkdownFiles(root, side === 'notes')) {
      let oldContent: string;
      try {
        oldContent = readVaultFile(root, relPath).content;
      } catch {
        continue; // unreadable file — leave it alone rather than abort the rename
      }
      const { content: newContent, count } = rewriteWikiLinksForRename(
        oldContent,
        oldStem,
        newStem,
        mode,
      );
      if (count > 0) {
        plan.push({ side, relPath, oldContent, newContent, linkCount: count });
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
  const write = opts.writeFile ?? defaultWriter;

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
  const applied: PlanFile[] = [];
  try {
    for (const file of plan) {
      write(file.side === 'notes' ? notesRoot : storyRoot, file.relPath, file.newContent);
      applied.push(file);
      onProgress?.({
        current: applied.length,
        total: plan.length,
        lastAction: file.relPath,
      });
    }
  } catch (err) {
    // Roll back: restore every file already written, then undo the rename.
    // The vault must never be left half-updated.
    const rollbackFailures: string[] = [];
    for (const file of applied) {
      try {
        write(file.side === 'notes' ? notesRoot : storyRoot, file.relPath, file.oldContent);
      } catch {
        rollbackFailures.push(file.relPath);
      }
    }
    try {
      moveVaultFile(notesRoot, toPath, fromPath);
    } catch {
      rollbackFailures.push(fromPath);
    }
    const reason = err instanceof Error ? err.message : String(err);
    if (rollbackFailures.length > 0) {
      throw new SafeIpcError(
        `Updating links failed and ${rollbackFailures.length} file(s) could not be restored — check the vault before retrying. (${reason})`,
      );
    }
    throw new SafeIpcError(
      `Updating links failed — the rename was rolled back and no changes were kept. (${reason})`,
    );
  }

  lastTransaction = { notesRoot, storyRoot, fromPath, toPath, oldStem, newStem, files: plan };

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
 * One-shot undo of the most recent rename cascade: renames the note back and
 * restores every rewritten file whose on-disk content is still exactly what
 * the cascade wrote. Files edited since are left untouched and counted as
 * skipped — undo never overwrites newer work.
 */
export function undoLastRenameCascade(
  opts: UndoRenameCascadeOptions,
): RenameCascadeUndoResponse {
  const write = opts.writeFile ?? defaultWriter;
  const tx = lastTransaction;
  const refused = (reason: string): RenameCascadeUndoResponse => ({
    undone: false,
    reason,
    filesRestored: 0,
    filesSkipped: 0,
    restoredNotesPaths: [],
    restoredStoryPaths: [],
  });

  if (!tx) return refused('Nothing to undo.');
  if (tx.notesRoot !== opts.notesRoot || tx.storyRoot !== (opts.storyRoot ?? '')) {
    lastTransaction = null;
    return refused('The project has changed since the rename.');
  }

  const toFull = realSafePath(tx.notesRoot, tx.toPath, true);
  const fromFull = realSafePath(tx.notesRoot, tx.fromPath, true);
  if (!fs.existsSync(toFull)) {
    lastTransaction = null;
    return refused('The renamed note has been moved or deleted.');
  }
  if (fs.existsSync(fromFull)) {
    lastTransaction = null;
    return refused('A note now exists under the original name.');
  }

  // Rename back first — if the note itself can't move, nothing else should.
  moveVaultFile(tx.notesRoot, tx.toPath, tx.fromPath);
  lastTransaction = null;

  let filesRestored = 0;
  let filesSkipped = 0;
  const restoredNotesPaths: string[] = [];
  const restoredStoryPaths: string[] = [];
  for (const file of tx.files) {
    const root = file.side === 'notes' ? tx.notesRoot : tx.storyRoot;
    // The renamed note's own entry (self-links) now lives back at fromPath.
    const relPath = file.side === 'notes' && file.relPath === tx.toPath ? tx.fromPath : file.relPath;
    let current: string | null = null;
    try {
      current = readVaultFile(root, relPath).content;
    } catch {
      /* deleted since — skip */
    }
    if (current !== file.newContent) {
      filesSkipped++;
      continue;
    }
    try {
      write(root, relPath, file.oldContent);
      filesRestored++;
      (file.side === 'notes' ? restoredNotesPaths : restoredStoryPaths).push(relPath);
    } catch {
      filesSkipped++;
    }
  }

  return {
    undone: true,
    filesRestored,
    filesSkipped,
    fromPath: tx.fromPath,
    toPath: tx.toPath,
    oldStem: tx.oldStem,
    newStem: tx.newStem,
    restoredNotesPaths,
    restoredStoryPaths,
  };
}
