// SKY-11189 (Notes Board 6/9): unit coverage for the deferred-delete pending
// registry — trash/restore/flush/invalidate. Real filesystem via
// fs.mkdtempSync (matching notesBoard.test.ts's pattern); `electron`'s
// `shell` is mocked (matching vaultSurface.test.ts's pattern) so flush can be
// asserted without touching a real OS trash.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted — factory must not reference outer variables.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(),
  },
}));

// Imports come AFTER vi.mock so the hoisted mock applies.
import { shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UNDO_WINDOW_MS,
  trashTargets,
  restoreEntry,
  listPendingForVault,
  emptyTrash,
  flushAllPendingNotesTrash,
  invalidatePendingUnderPath,
  isVaultRelPathPending,
  isFurniturePending,
  resetNotesTrashForTests,
} from './notesTrash.js';
import { getBoard, patchLayout, flushPendingNotesBoardWrites, furnitureCreate } from './notesBoard.js';

const mockTrashItem = vi.mocked(shell.trashItem);

function writeNote(root: string, relPath: string, content = ''): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('notesTrash', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notestrash-'));
    vi.useFakeTimers();
    mockTrashItem.mockReset();
    // Real shell.trashItem actually removes the path (that's the whole
    // point) — the mock does the same so flush-time "is this descendant
    // already gone" logic has something real to observe, instead of always
    // finding the file still there because the mock is a no-op.
    mockTrashItem.mockImplementation(async (target: string) => {
      fs.rmSync(target, { recursive: true, force: true });
    });
    resetNotesTrashForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetNotesTrashForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('hides a trashed note immediately, and leaves the file untouched on disk (crash-safety by construction)', () => {
    writeNote(root, 'Idea.md', 'hello\n');
    trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(true);
    // Nothing physically happens until flush — this IS the crash-safety
    // guarantee (§8): a process death right here leaves the file exactly as
    // it was, with nothing to roll back.
    expect(fs.existsSync(path.join(root, 'Idea.md'))).toBe(true);
    expect(mockTrashItem).not.toHaveBeenCalled();
  });

  it('flushes to shell.trashItem once the undo window elapses, and drops off the pending list (§15 test 8)', async () => {
    writeNote(root, 'Idea.md', 'hello\n');
    trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(mockTrashItem).toHaveBeenCalledWith(path.join(root, 'Idea.md'));
    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(false);
    expect(listPendingForVault(root)).toEqual([]);
  });

  it('Ctrl+Z before the window elapses restores it — un-hidden, never trashed (§15 test 8)', async () => {
    writeNote(root, 'Idea.md', 'hello\n');
    const { entries } = trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    const result = restoreEntry(entries[0]!.id);
    expect(result.restored).toBe(true);
    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(false);

    // Even if the original timer somehow still fired, restoreEntry already
    // cleared it — advancing past the window must not trash it after the fact.
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(mockTrashItem).not.toHaveBeenCalled();
  });

  it('preserves the item\'s own layout entry through the pending window, so a restore lands it back at the same position', () => {
    writeNote(root, 'Idea.md', 'hello\n');
    const { id } = patchLayout(root, '', 'Idea.md', { x: 10, y: 20 });
    flushPendingNotesBoardWrites(root);

    trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    const board = getBoard(root, '');
    // getBoard doesn't know about pending state itself (that's a main.ts-level
    // filter) — the layout entry must still be sitting there, untouched.
    expect(board.layout[`n:${id}`]).toEqual({ x: 10, y: 20 });
  });

  it('trashing a folder cascades every live descendant into the SAME restore group (§15 test 9)', () => {
    writeNote(root, 'Board/Card A.md');
    writeNote(root, 'Board/Sub/Card B.md');
    const { entries } = trashTargets(root, '', [{ kind: 'folder', itemPath: 'Board', label: 'Board' }]);

    // The folder itself + both descendants each get their OWN entry...
    const paths = entries.map((e) => e.vaultRelPath).sort();
    expect(paths).toEqual(['Board', 'Board/Card A.md', 'Board/Sub', 'Board/Sub/Card B.md'].sort());
    // ...but they all share one group, so restoring any one restores all.
    const groupIds = new Set(entries.map((e) => e.groupId));
    expect(groupIds.size).toBe(1);

    expect(isVaultRelPathPending(root, 'Board')).toBe(true);
    expect(isVaultRelPathPending(root, 'Board/Card A.md')).toBe(true);
    expect(isVaultRelPathPending(root, 'Board/Sub/Card B.md')).toBe(true);

    const restored = restoreEntry(entries.find((e) => e.vaultRelPath === 'Board/Card A.md')!.id);
    expect(restored.restored).toBe(true);
    expect(isVaultRelPathPending(root, 'Board')).toBe(false);
    expect(isVaultRelPathPending(root, 'Board/Card A.md')).toBe(false);
  });

  it('flushing a trashed folder trashes only the folder — descendants are skipped as already-gone', async () => {
    writeNote(root, 'Board/Card A.md');
    trashTargets(root, '', [{ kind: 'folder', itemPath: 'Board', label: 'Board' }]);

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(mockTrashItem).toHaveBeenCalledTimes(1);
    expect(mockTrashItem).toHaveBeenCalledWith(path.join(root, 'Board'));
  });

  it('an unrelated multi-select gets INDEPENDENT groups — restoring one leaves the other pending', () => {
    writeNote(root, 'A.md');
    writeNote(root, 'B.md');
    const { entries } = trashTargets(root, '', [
      { kind: 'note', itemPath: 'A.md', label: 'A.md' },
      { kind: 'note', itemPath: 'B.md', label: 'B.md' },
    ]);
    expect(entries[0]!.groupId).not.toBe(entries[1]!.groupId);

    restoreEntry(entries[0]!.id);
    expect(isVaultRelPathPending(root, 'A.md')).toBe(false);
    expect(isVaultRelPathPending(root, 'B.md')).toBe(true);
  });

  it('cascade-deletes a connector line immediately at trash-time, and restoring the card does not resurrect it (§15 test 10)', () => {
    writeNote(root, 'Board/Card A.md');
    writeNote(root, 'Board/Card B.md');
    const a = patchLayout(root, 'Board', 'Card A.md', { x: 0, y: 0 });
    const b = patchLayout(root, 'Board', 'Card B.md', { x: 100, y: 0 });
    flushPendingNotesBoardWrites(root);
    furnitureCreate(root, 'Board', { k: 'line', x: 0, y: 0, from: a.key, to: b.key } as never);

    const { entries } = trashTargets(root, 'Board', [{ kind: 'note', itemPath: 'Card A.md', label: 'Card A.md' }]);
    // Connector is gone the instant the card is marked pending — not deferred.
    expect(getBoard(root, 'Board').furniture.some((f) => f.k === 'line')).toBe(false);

    restoreEntry(entries[0]!.id);
    // Still gone after restore — documented behaviour, not a bug.
    expect(getBoard(root, 'Board').furniture.some((f) => f.k === 'line')).toBe(false);
  });

  it('furniture trash is deferred the same way, and flush converts it into the PERMANENT record (§7/§8)', async () => {
    fs.mkdirSync(path.join(root, 'Board'));
    const item = furnitureCreate(root, 'Board', { k: 'swatch', x: 0, y: 0 });

    trashTargets(root, 'Board', [{ kind: 'furniture', furnitureId: item.id, label: 'Swatch' }]);
    expect(isFurniturePending(root, 'Board', item.id)).toBe(true);
    // Still live in Store B until flush — nothing moved yet.
    expect(getBoard(root, 'Board').furniture.some((f) => f.id === item.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(isFurniturePending(root, 'Board', item.id)).toBe(false);
    const board = getBoard(root, 'Board');
    expect(board.furniture.some((f) => f.id === item.id)).toBe(false);
    // shell.trashItem has no furniture equivalent — the permanent record IS
    // the flush outcome for furniture, not an OS trash call.
    expect(mockTrashItem).not.toHaveBeenCalled();
  });

  it('the "Empty" action force-flushes immediately, without waiting for the window', async () => {
    writeNote(root, 'Idea.md');
    trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    await emptyTrash(root);

    expect(mockTrashItem).toHaveBeenCalledWith(path.join(root, 'Idea.md'));
    expect(listPendingForVault(root)).toEqual([]);
  });

  it('flushAllPendingNotesTrash (app-quit hook) flushes every pending group across vaults', async () => {
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notestrash-b-'));
    try {
      writeNote(root, 'Idea.md');
      writeNote(rootB, 'Other.md');
      trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);
      trashTargets(rootB, '', [{ kind: 'note', itemPath: 'Other.md', label: 'Other.md' }]);

      await flushAllPendingNotesTrash();

      expect(mockTrashItem).toHaveBeenCalledWith(path.join(root, 'Idea.md'));
      expect(mockTrashItem).toHaveBeenCalledWith(path.join(rootB, 'Other.md'));
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('invalidates (drops without flushing) a pending entry whose target changed externally AFTER it was marked pending (§8)', async () => {
    writeNote(root, 'Idea.md');
    const { entries } = trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    // Simulate the notes watcher firing for this path — e.g. Obsidian or sync
    // touched it while we believed it was sitting untouched, pending. Bump
    // the mtime strictly past `deletedAt` so it is unambiguously a write
    // that happened AFTER this entry became pending, not a delayed report
    // of the write that created it (see the next test).
    const laterMtime = new Date(Date.parse(entries[0]!.deletedAt) + 1000);
    fs.utimesSync(path.join(root, 'Idea.md'), laterMtime, laterMtime);

    invalidatePendingUnderPath(root, 'Idea.md');

    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(false);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(mockTrashItem).not.toHaveBeenCalled();
  });

  it('does NOT invalidate when the watcher event is just a delayed echo of the write that predates the entry becoming pending', () => {
    // Regression: a chokidar event for the app's OWN earlier write (e.g. the
    // create/rename that gave this file its current name) can arrive after
    // vault.ts's SELF_WRITE_TTL_MS (2.5s) has already elapsed under load,
    // landing here looking exactly like a fresh external edit. Without the
    // mtime check, this silently abandoned every pending-delete it touched —
    // found via a real end-to-end run, not appearing in a synthetic pure-unit
    // scenario. The file's mtime here is from BEFORE trashTargets ran (no
    // write happens after it), so it must NOT be treated as a conflict.
    writeNote(root, 'Idea.md');
    const { entries } = trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);

    invalidatePendingUnderPath(root, 'Idea.md');

    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(true);
    restoreEntry(entries[0]!.id); // cleanup — leave nothing pending for the next test
  });

  it('invalidation matches a changed descendant path under a still-pending folder', () => {
    writeNote(root, 'Board/Card A.md');
    const { entries } = trashTargets(root, '', [{ kind: 'folder', itemPath: 'Board', label: 'Board' }]);
    const cardEntry = entries.find((e) => e.vaultRelPath === 'Board/Card A.md')!;
    const laterMtime = new Date(Date.parse(cardEntry.deletedAt) + 1000);
    fs.utimesSync(path.join(root, 'Board', 'Card A.md'), laterMtime, laterMtime);

    invalidatePendingUnderPath(root, 'Board/Card A.md');

    // The whole group is dropped, not just the one descendant — our belief
    // about the WHOLE folder's contents is stale, not just one file's.
    expect(isVaultRelPathPending(root, 'Board')).toBe(false);
  });

  it('invalidates unconditionally when the changed path no longer exists at all (external unlink)', () => {
    writeNote(root, 'Idea.md');
    trashTargets(root, '', [{ kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' }]);
    // Nothing to stat any more — always ambiguous in the entry's favor: treat
    // a vanished path as a real external change rather than risk a stale flush.
    fs.rmSync(path.join(root, 'Idea.md'));

    invalidatePendingUnderPath(root, 'Idea.md');

    expect(isVaultRelPathPending(root, 'Idea.md')).toBe(false);
  });

  it('a target already gone from disk before trashTargets runs is silently skipped', () => {
    const { entries } = trashTargets(root, '', [{ kind: 'note', itemPath: 'Ghost.md', label: 'Ghost.md' }]);
    expect(entries).toEqual([]);
  });
});
