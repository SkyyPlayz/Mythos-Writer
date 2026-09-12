// SKY-11189 (Notes Board 6/9): trash split by target type + deferred-delete.
// Implements BOARDS-SPEC.md v2 §7, §8.
//
// This module owns the in-memory, SESSION-SCOPED pending-delete registry that
// makes delete undoable without a second permanent store. It is deliberately
// NOT part of notesBoard.ts: it imports Electron's `shell` (notesBoard.ts
// stays pure Node, see that file's header), and its state is transient by
// design — nothing here is ever written to disk before flush.
//
// The model (read this before changing anything, per the ticket's own
// warning — it is easy to get wrong):
//
// - Notes & folders are REAL files. Trash marks them pending (hidden from
//   every listing) and schedules a flush; the flush is the ONLY moment the
//   filesystem changes, via shell.trashItem (OS Recycle Bin/Trash — never a
//   fallback to a permanent delete, matching vaultSurface.ts's philosophy).
//   Nothing is written anywhere to say "this is pending" — that fact lives
//   ONLY in this module's in-memory maps. If the process dies before flush,
//   there is nothing to roll back: the file was never touched. That is the
//   whole crash-safety guarantee, and it falls out of doing nothing rather
//   than needing to be built.
// - Furniture has no OS trash equivalent. Trash marks it pending the same
//   way (hidden, undoable); flush converts it into notesBoard.ts's permanent
//   `trash[]` record instead of touching a filesystem path.
// - A folder's trash cascades to every live descendant note/folder — each
//   gets its OWN pending entry (so Recently Deleted lists them individually,
//   spec §15 test 9) but they all share the SAME restore group as their
//   ancestor: restoring any one of them restores the whole group. That is a
//   deliberate scope call, not an oversight — the files are still physically
//   nested inside the not-yet-trashed folder, so there is no way to restore
//   "just the child" without moving it out of the folder first, and nothing
//   in the spec or its acceptance tests asks for that. A plain multi-select
//   delete of otherwise-unrelated items does NOT share a group — each is
//   independently restorable — which is why trashTargets() below hands every
//   TOP-LEVEL target its own groupId and only nests descendants under it.
// - Connector (line) removal is NOT deferred: cascadeLinesForKey runs at
//   trash-time, immediately, permanently. Restoring the card later does not
//   bring the connector back (spec §15 test 10, documented behaviour).
import { shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { listVaultFiles } from './vault.js';
import { resolveId, itemDeleteStub, cascadeLinesForKey, furnitureTrashPermanent } from './notesBoard.js';
import { readIconMap, writeIconMap, removeIconsUnderPath } from './vaultIcons.js';

/**
 * How long a pending delete sits undoable before it flushes. Exported so
 * tests can assert against it rather than hardcoding the number, matching
 * notesBoard.ts's NOTES_BOARD_DEBOUNCE_MS convention.
 */
export const UNDO_WINDOW_MS = 8000;

export type PendingKind = 'note' | 'folder' | 'furniture';

export interface PendingEntry {
  id: string;
  groupId: string;
  vaultRoot: string;
  kind: PendingKind;
  /** `v:`/`n:`/`x:` key — '' for a note/folder that never acquired an id (nothing can reference it). */
  key: string;
  /** Vault-relative folder this entry's board lives in (the folder whose `.mythos-board.json` it's hidden from). */
  boardRelPath: string;
  /** Vault-relative path of the note/folder itself — absent for furniture. */
  vaultRelPath?: string;
  furnitureId?: string;
  label: string;
  deletedAt: string;
}

interface PendingGroup {
  id: string;
  vaultRoot: string;
  entries: PendingEntry[];
  timer: ReturnType<typeof setTimeout>;
  /** Set once flushGroup has started (or finished) — restore must refuse a group already mid-flush. */
  flushing: boolean;
}

// Keyed by groupId. A group is the atomic restore/flush unit — see the file
// header for why folder+descendants share one but an unrelated multi-select
// does not.
const groups = new Map<string, PendingGroup>();
// entry id -> groupId, so restore-by-entry-id (what the renderer/panel deals
// in) can find its group without a linear scan.
const entryIndex = new Map<string, string>();

function vaultRelJoin(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function splitVaultRelPath(vaultRelPath: string): { parentRelPath: string; itemName: string } {
  const slash = vaultRelPath.lastIndexOf('/');
  return slash === -1
    ? { parentRelPath: '', itemName: vaultRelPath }
    : { parentRelPath: vaultRelPath.slice(0, slash), itemName: vaultRelPath.slice(slash + 1) };
}

function depth(vaultRelPath: string): number {
  return vaultRelPath.split('/').length;
}

// ─── Query: is this path/furniture item currently hidden pending delete? ───
// Linear scans are fine here — pending counts are bounded by what a user has
// deleted in the last UNDO_WINDOW_MS, not vault size.

export function isVaultRelPathPending(vaultRoot: string, vaultRelPath: string): boolean {
  for (const group of groups.values()) {
    if (group.vaultRoot !== vaultRoot) continue;
    for (const e of group.entries) {
      if (e.kind !== 'furniture' && e.vaultRelPath === vaultRelPath) return true;
    }
  }
  return false;
}

export function isFurniturePending(vaultRoot: string, boardRelPath: string, furnitureId: string): boolean {
  for (const group of groups.values()) {
    if (group.vaultRoot !== vaultRoot) continue;
    for (const e of group.entries) {
      if (e.kind === 'furniture' && e.boardRelPath === boardRelPath && e.furnitureId === furnitureId) return true;
    }
  }
  return false;
}

export function listPendingForVault(vaultRoot: string): PendingEntry[] {
  const out: PendingEntry[] = [];
  for (const group of groups.values()) {
    if (group.vaultRoot !== vaultRoot) continue;
    out.push(...group.entries);
  }
  // Newest first — a "Recently Deleted" panel reads top-to-bottom as a stack.
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ─── Trash ──────────────────────────────────────────────────────────────

export type TrashTarget =
  | { kind: 'note' | 'folder'; itemPath: string; label: string }
  | { kind: 'furniture'; furnitureId: string; label: string };

/**
 * Mark one or more board children pending-delete. Each element of `targets`
 * is a TOP-LEVEL selection item (what the user actually clicked Delete on) —
 * a folder target's live descendants are discovered and appended here, all
 * sharing that target's own groupId (see file header).
 *
 * Runs the permanent line-cascade for every target immediately (§8 test 10)
 * but does not touch anything else — no filesystem move, no Store-B removal
 * of the item's own entry. That happens only at flush.
 */
export function trashTargets(
  vaultRoot: string,
  boardRelPath: string,
  targets: TrashTarget[],
): { entries: PendingEntry[] } {
  const deletedAt = new Date().toISOString();
  const allEntries: PendingEntry[] = [];
  const boardAbs = boardRelPath ? path.join(vaultRoot, boardRelPath) : vaultRoot;

  for (const target of targets) {
    const groupId = crypto.randomUUID();
    const groupEntries: PendingEntry[] = [];

    if (target.kind === 'furniture') {
      const key = `x:${target.furnitureId}`;
      cascadeLinesForKey(vaultRoot, boardRelPath, key);
      groupEntries.push({
        id: crypto.randomUUID(),
        groupId,
        vaultRoot,
        kind: 'furniture',
        key,
        boardRelPath,
        furnitureId: target.furnitureId,
        label: target.label,
        deletedAt,
      });
    } else {
      const itemAbs = path.join(boardAbs, target.itemPath);
      let isDir: boolean;
      try {
        isDir = fs.statSync(itemAbs).isDirectory();
      } catch {
        continue; // already gone from disk — nothing to trash
      }
      const kind: 'note' | 'folder' = isDir ? 'folder' : 'note';
      const vaultRelPath = vaultRelJoin(boardRelPath, target.itemPath);
      const id = resolveId(kind, itemAbs);
      const key = id ? `${kind === 'folder' ? 'v' : 'n'}:${id}` : '';
      if (key) cascadeLinesForKey(vaultRoot, boardRelPath, key);
      groupEntries.push({
        id: crypto.randomUUID(),
        groupId,
        vaultRoot,
        kind,
        key,
        boardRelPath,
        vaultRelPath,
        label: target.label,
        deletedAt,
      });

      if (isDir) {
        // §15 test 9: descendants surface individually while pending, but
        // flush (and restore) as part of this same group.
        const { items: descendants } = listVaultFiles(vaultRoot, vaultRelPath);
        for (const d of descendants) {
          const dVaultRelPath = vaultRelJoin(vaultRelPath, d.path);
          const dAbs = path.join(vaultRoot, dVaultRelPath);
          const dKind: 'note' | 'folder' = d.isDirectory ? 'folder' : 'note';
          const dId = resolveId(dKind, dAbs);
          const dKey = dId ? `${dKind === 'folder' ? 'v' : 'n'}:${dId}` : '';
          groupEntries.push({
            id: crypto.randomUUID(),
            groupId,
            vaultRoot,
            kind: dKind,
            key: dKey,
            // The descendant's own "board" is the folder that directly
            // contains it, for isVaultRelPathPending/label purposes.
            boardRelPath: path.posix.dirname(dVaultRelPath) === '.' ? '' : path.posix.dirname(dVaultRelPath),
            vaultRelPath: dVaultRelPath,
            label: d.name,
            deletedAt,
          });
        }
      }
    }

    const timer = setTimeout(() => { void flushGroup(groupId); }, UNDO_WINDOW_MS);
    timer.unref?.();
    groups.set(groupId, { id: groupId, vaultRoot, entries: groupEntries, timer, flushing: false });
    for (const e of groupEntries) entryIndex.set(e.id, groupId);
    allEntries.push(...groupEntries);
  }

  return { entries: allEntries };
}

// ─── Restore ────────────────────────────────────────────────────────────

/** Restoring ANY entry in a group restores the whole group (file header). */
export function restoreEntry(id: string): { restored: boolean; restoredIds: string[] } {
  const groupId = entryIndex.get(id);
  if (!groupId) return { restored: false, restoredIds: [] };
  const group = groups.get(groupId);
  if (!group || group.flushing) return { restored: false, restoredIds: [] };
  clearTimeout(group.timer);
  groups.delete(groupId);
  const ids = group.entries.map((e) => e.id);
  for (const eid of ids) entryIndex.delete(eid);
  return { restored: true, restoredIds: ids };
}

// ─── Flush ──────────────────────────────────────────────────────────────

async function flushGroup(groupId: string): Promise<void> {
  const group = groups.get(groupId);
  if (!group || group.flushing) return;
  group.flushing = true;
  clearTimeout(group.timer);

  // Leaving the registry is what "this group has flushed" means to every
  // reader (Recently Deleted, the board's hide filter, restore). Do it here,
  // up front, so the serialized OS moves below don't stretch that moment out
  // across the trash latency of a whole folder tree.
  groups.delete(groupId);
  for (const e of group.entries) entryIndex.delete(e.id);

  // Shallowest first: a parent folder's shell.trashItem already removes
  // every descendant, so deeper entries below a flushed ancestor must be
  // skipped (checked via fs.existsSync below), not double-trashed.
  const sorted = [...group.entries].sort(
    (a, b) => depth(a.vaultRelPath ?? '') - depth(b.vaultRelPath ?? ''),
  );

  // SKY-11742: strictly sequential, one entry at a time. The fs.existsSync
  // skip below can only observe an ancestor's move once that move has
  // ACTUALLY completed, and shell.trashItem is a real async OS operation —
  // it does not settle in the turn it was called in. Firing the whole group
  // off concurrently therefore made the skip a guaranteed no-op in
  // production, and raced an overlapping trash of every descendant against
  // its still-in-flight ancestor. A group is one top-level target (plus its
  // descendants, which this loop skips), so serializing costs one OS move.
  for (const entry of sorted) {
    try {
      if (entry.kind === 'furniture') {
        if (entry.furnitureId) furnitureTrashPermanent(entry.vaultRoot, entry.boardRelPath, entry.furnitureId);
        continue;
      }
      if (!entry.vaultRelPath) continue;
      const absPath = path.join(entry.vaultRoot, entry.vaultRelPath);
      if (!fs.existsSync(absPath)) continue; // ancestor already took it to OS trash

      // Store-B cleanup (own layout/colors entry) while the item still
      // exists on disk — must run before the move below.
      const { parentRelPath, itemName } = splitVaultRelPath(entry.vaultRelPath);
      try {
        itemDeleteStub(entry.vaultRoot, parentRelPath, itemName);
      } catch {
        // best-effort — GC-on-read still catches a dangling entry.
      }
      // SKY-9310 icon assignment (.mythos/icons.json) is Store-B-adjacent and
      // gets the same "preserved through the pending window, cleaned up only
      // at flush" treatment — removing it at trash-time would lose the badge
      // permanently even if the delete is undone a second later.
      try {
        const rewritten = removeIconsUnderPath(readIconMap(entry.vaultRoot), entry.vaultRelPath);
        if (rewritten) writeIconMap(entry.vaultRoot, rewritten);
      } catch {
        // best-effort.
      }

      // §7: shell.trashItem ONLY, never a fallback to a permanent delete —
      // same guarantee vaultSurface.ts's trashVaultFolder makes. If it
      // fails, the file is simply left on disk (still real, still there);
      // it silently drops off Recently Deleted since its pending entry is
      // gone either way, matching "flush" being a one-shot best-effort move
      // rather than a retried operation.
      //
      // A rejection lands in the per-entry catch below, which is exactly the
      // best-effort behaviour we want: the next entry still gets its turn.
      await shell.trashItem(absPath);
    } catch {
      // best-effort per-entry — one bad entry must not abort the rest of the group.
    }
  }
}

/**
 * Shallowest vault-relative depth in a group, used to order a multi-group
 * force-flush. Furniture-only groups have no path at all and sort last;
 * they touch no filesystem path, so their position is irrelevant.
 */
function groupDepth(group: PendingGroup): number {
  let shallowest = Number.MAX_SAFE_INTEGER;
  for (const e of group.entries) {
    if (!e.vaultRelPath) continue;
    shallowest = Math.min(shallowest, depth(e.vaultRelPath));
  }
  return shallowest;
}

/**
 * SKY-11742: force-flush several groups shallowest-group-first, one at a
 * time, for the same reason flushGroup serializes within a group.
 *
 * A folder and one of its own descendants CAN end up in two different
 * groups: the descendant is trashed on its own first, then the folder is
 * trashed in a later, separate action and trashTargets re-enumerates that
 * still-on-disk descendant into the folder's group. Each flushGroup only
 * sorts and existsSync-checks within its own entries, so it has no way to
 * see the other group's overlapping path.
 *
 * Under the undo timers that is harmless — the timers fire in deletion
 * order, so the descendant's group always flushes before the ancestor's.
 * A force-flush has no such ordering: it fires every pending group at once.
 * Ordering them shallowest-first and awaiting each restores the same
 * ancestor-before-descendant sequence the within-group sort relies on, so
 * the existsSync skip sees real post-move state across groups too.
 */
async function flushGroupsShallowestFirst(ids: string[]): Promise<void> {
  const ordered = ids
    .map((id) => groups.get(id))
    .filter((g): g is PendingGroup => g !== undefined)
    .sort((a, b) => groupDepth(a) - groupDepth(b));
  for (const group of ordered) await flushGroup(group.id);
}

/** The panel's "Empty" button — force-flush every pending entry for one vault, right now. */
export async function emptyTrash(vaultRoot: string): Promise<{ flushedGroupIds: string[] }> {
  const ids = [...groups.values()].filter((g) => g.vaultRoot === vaultRoot).map((g) => g.id);
  await flushGroupsShallowestFirst(ids);
  return { flushedGroupIds: ids };
}

/**
 * App-quit flush (§8: "whichever comes first ... the app quitting"). Flushes
 * EVERY pending entry across every vault — called once from main.ts's
 * mainWindow 'close' handler, awaited before the window is allowed to close,
 * same flush-before-quit shape as flushRendererManifestSave.
 */
export async function flushAllPendingNotesTrash(): Promise<void> {
  await flushGroupsShallowestFirst([...groups.keys()]);
}

// ─── External-change invalidation (§8) ───────────────────────────────────

/**
 * "Invalidate a stack/panel entry if its target changed externally (edited
 * in Obsidian, or via sync) rather than applying a stale undo or restore
 * over someone else's change." Called from the notes-vault watcher for every
 * changed/removed/renamed path — if that path (or an ancestor folder of it)
 * has a pending-delete entry, drop the WHOLE group without flushing: this
 * app's belief that "the file is still exactly where we left it, untouched"
 * is no longer safe to act on, so it neither trashes it nor keeps offering a
 * stale restore.
 *
 * The watcher's own self-write filter (vault.ts's isRecentSelfWrite,
 * SELF_WRITE_TTL_MS = 2500ms) does not fully cover this: a chokidar event
 * for the app's OWN earlier write (e.g. the create+rename that gave this
 * item its current name) can legitimately be delayed past that TTL under
 * load — awaitWriteFinish stabilization, polling, a burst of other
 * filesystem activity — and would otherwise arrive here looking exactly
 * like a fresh external edit, silently abandoning a pending-delete that
 * was never actually touched by anything (the entry just leaks: never
 * flushed, never restorable). Comparing the file's mtime to `deletedAt`
 * (when THIS module marked it pending) tells the two apart: a write that
 * predates the item becoming pending is an old event finally being
 * reported, not a new one — only a write strictly AFTER that point is a
 * genuine external change. A path that no longer exists (mtime
 * unreadable) is unambiguous either way — always invalidate.
 */
export function invalidatePendingUnderPath(vaultRoot: string, changedVaultRelPath: string): void {
  const absPath = path.join(vaultRoot, changedVaultRelPath);
  let externalMtimeMs: number | null;
  try {
    externalMtimeMs = fs.statSync(absPath).mtimeMs;
  } catch {
    externalMtimeMs = null;
  }

  const staleGroupIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.vaultRoot !== vaultRoot || group.flushing) continue;
    for (const e of group.entries) {
      if (e.kind === 'furniture' || !e.vaultRelPath) continue;
      const underThisEntry =
        e.vaultRelPath === changedVaultRelPath || changedVaultRelPath.startsWith(`${e.vaultRelPath}/`);
      if (!underThisEntry) continue;
      if (externalMtimeMs === null || externalMtimeMs > Date.parse(e.deletedAt)) {
        staleGroupIds.add(group.id);
      }
    }
  }
  for (const groupId of staleGroupIds) {
    const group = groups.get(groupId);
    if (!group) continue;
    clearTimeout(group.timer);
    groups.delete(groupId);
    for (const e of group.entries) entryIndex.delete(e.id);
  }
}

// ─── Test-only reset ──────────────────────────────────────────────────────

/** Unit tests only — clears all in-memory state between cases without relying on process exit. */
export function resetNotesTrashForTests(): void {
  for (const group of groups.values()) clearTimeout(group.timer);
  groups.clear();
  entryIndex.clear();
}
