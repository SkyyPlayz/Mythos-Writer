// owns snapshot-before-write, rollback and one-shot undo (incl. SKY-10887 span undo); never decides what text changes.

import fs from 'fs';
import {
  moveVaultFile,
  readVaultFile,
  realSafePath,
  writeVaultFileAtomic,
} from './vault.js';
import { SafeIpcError } from './ipcErrors.js';
import { isSymlinkWriteRefusal, symlinkSkipLine } from './vault/writeErrors.js';
import {
  rewriteWikiLinksForRename,
  type WikiLinkRewriteMode,
} from '@mythos-writer/shared/wikiLinkRename';
import { rewriteBoardSidecarTextForRename } from './notesBoard.js';
import type { RenameCascadeProgress, RenameCascadeUndoResponse } from './ipc.js';

/** Test seam — defaults to the vault-sandboxed atomic writer. */
export type VaultWriter = (vaultRoot: string, relPath: string, content: string) => void;

const defaultWriter: VaultWriter = (root, relPath, content) => {
  writeVaultFileAtomic(root, relPath, content);
};

/**
 * One planned write. The caller has already decided `newContent`; this module
 * snapshots the bytes on disk itself and never invents them.
 */
export interface VaultPlannedChange {
  side: 'notes' | 'story';
  /** SKY-11188: a board sidecar undoes through its `ref` rewriter; a note
   *  undoes through [[wikilinks]]. */
  kind: 'note' | 'board';
  relPath: string;
  newContent: string;
  linkCount: number;
  mode: WikiLinkRewriteMode;
}

export interface VaultTransactionSnapshot extends VaultPlannedChange {
  /** Bytes read before any write in this transaction. */
  oldContent: string;
}

interface CascadeTransaction {
  notesRoot: string;
  storyRoot: string;
  fromPath: string;
  toPath: string;
  oldStem: string;
  newStem: string;
  files: VaultTransactionSnapshot[];
}

// Single-level undo: each successful transaction replaces the previous one.
// Undo is validated against current disk state, so a stale transaction can
// never clobber newer work — it degrades to conflicts or a refusal.
let lastTransaction: CascadeTransaction | null = null;

/** Test hook — clears the held undo transaction. */
export function _resetVaultTransactionState(): void {
  lastTransaction = null;
}

export interface ApplyVaultTransactionOptions {
  notesRoot: string;
  storyRoot: string;
  fromPath: string;
  toPath: string;
  oldStem: string;
  newStem: string;
  changes: readonly VaultPlannedChange[];
  onProgress?: (p: RenameCascadeProgress) => void;
  writeFile?: VaultWriter;
}

export interface ApplyVaultTransactionResult {
  files: VaultTransactionSnapshot[];
}

/**
 * Snapshot every planned file, then write. A failure partway restores every
 * file already written and renames `toPath` back to `fromPath`. The caller
 * has already performed that rename; this function does not decide it.
 */
export function applyVaultTransaction(opts: ApplyVaultTransactionOptions): ApplyVaultTransactionResult {
  const { notesRoot, storyRoot, fromPath, toPath, oldStem, newStem, changes, onProgress } = opts;
  const write = opts.writeFile ?? defaultWriter;

  const snapshotted: VaultTransactionSnapshot[] = [];
  const applied: VaultTransactionSnapshot[] = [];
  try {
    for (const change of changes) {
      const root = change.side === 'notes' ? notesRoot : storyRoot;
      const oldContent = readVaultFile(root, change.relPath).content;
      snapshotted.push({ ...change, oldContent });
    }
    for (const file of snapshotted) {
      write(file.side === 'notes' ? notesRoot : storyRoot, file.relPath, file.newContent);
      applied.push(file);
      onProgress?.({
        current: applied.length,
        total: snapshotted.length,
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

  lastTransaction = { notesRoot, storyRoot, fromPath, toPath, oldStem, newStem, files: snapshotted };
  return { files: snapshotted };
}

/** A file undo left untouched. `filesSkipped` on the response is this list's length. */
export interface VaultUndoConflict {
  side: 'notes' | 'story';
  relPath: string;
}

export interface VaultTransactionUndoResult {
  response: RenameCascadeUndoResponse;
  conflicts: VaultUndoConflict[];
}

export interface UndoVaultTransactionOptions {
  notesRoot: string;
  storyRoot?: string;
  writeFile?: VaultWriter;
}

/**
 * One-shot undo of the most recent transaction: renames the note back and
 * restores every rewritten file. A file untouched since the transaction is
 * restored byte-for-byte; a file edited elsewhere since has only the
 * wikilink span(s) the transaction touched reverted, leaving the rest of the
 * user's edit in place — undo never overwrites newer prose. A file whose
 * touched link(s) are gone too (edit removed them) is left untouched and
 * listed as a conflict.
 */
export function undoVaultTransaction(opts: UndoVaultTransactionOptions): VaultTransactionUndoResult {
  const write = opts.writeFile ?? defaultWriter;
  const tx = lastTransaction;
  const refused = (reason: string): VaultTransactionUndoResult => ({
    response: {
      undone: false,
      reason,
      filesRestored: 0,
      filesSkipped: 0,
      restoredNotesPaths: [],
      restoredStoryPaths: [],
    },
    conflicts: [],
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
  const skippedSymlinks: string[] = [];
  const restoredNotesPaths: string[] = [];
  const restoredStoryPaths: string[] = [];
  const conflicts: VaultUndoConflict[] = [];
  for (const file of tx.files) {
    const root = file.side === 'notes' ? tx.notesRoot : tx.storyRoot;
    // The renamed note's own entry (self-links) now lives back at fromPath.
    const relPath = file.side === 'notes' && file.relPath === tx.toPath ? tx.fromPath : file.relPath;
    let current: string | null = null;
    try {
      current = readVaultFile(root, relPath).content;
    } catch (err) {
      if (err instanceof Error && /Path traversal denied|\(symlink/.test(err.message)) {
        skippedSymlinks.push(symlinkSkipLine(relPath));
      }
    }
    if (current === null) {
      filesSkipped++;
      conflicts.push({ side: file.side, relPath });
      continue;
    }

    let restoredContent: string;
    if (current === file.newContent) {
      // Untouched since the transaction — restore byte-for-byte.
      restoredContent = file.oldContent;
    } else {
      // Edited elsewhere since the transaction — revert only the wikilink
      // span(s) it touched (rewriteWikiLinksForRename is its own inverse
      // for this rename/mode pair — see SKY-10887), leaving the rest of
      // the user's edit untouched instead of skipping the file outright
      // and leaving a dangling link once the note moves back.
      // SKY-11188: a board sidecar reverses through the same oldStem/newStem
      // swap — rewriteRefForRename is symmetric by construction (it only
      // ever compares/replaces the stem, so applying it forward then
      // backward is a no-op on an untouched ref).
      const { content, count } =
        file.kind === 'board'
          ? rewriteBoardSidecarTextForRename(current, tx.newStem, tx.oldStem)
          : rewriteWikiLinksForRename(current, tx.newStem, tx.oldStem, file.mode);
      if (count === 0) {
        // The touched link(s) aren't present anymore either — nothing to revert.
        filesSkipped++;
        conflicts.push({ side: file.side, relPath });
        continue;
      }
      restoredContent = content;
    }

    try {
      write(root, relPath, restoredContent);
      filesRestored++;
      (file.side === 'notes' ? restoredNotesPaths : restoredStoryPaths).push(relPath);
    } catch (err) {
      if (isSymlinkWriteRefusal(err)) skippedSymlinks.push(symlinkSkipLine(relPath));
      filesSkipped++;
      conflicts.push({ side: file.side, relPath });
    }
  }

  return {
    response: {
      undone: true,
      filesRestored,
      filesSkipped,
      fromPath: tx.fromPath,
      toPath: tx.toPath,
      oldStem: tx.oldStem,
      newStem: tx.newStem,
      restoredNotesPaths,
      restoredStoryPaths,
      ...(skippedSymlinks.length > 0 ? { skippedSymlinks } : {}),
    },
    conflicts,
  };
}
