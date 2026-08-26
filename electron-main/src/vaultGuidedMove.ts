// vault:guidedFolderMove FS logic (SKY-862) — atomic vault relocation for
// cloud-sync guided folder.
//
// Moves the entire story-vault directory to a cloud-synced folder chosen by
// the user, updates persisted vault settings, and appends a settings audit-log
// entry inside the new vault location.
//
// Security contract:
//   - The caller MUST validate input via checkGuidedMoveGate (vaultGate.ts)
//     before invoking any function here. This module does not re-check tokens.
//   - `validateMoveTarget` checks writable access and an unoccupied destination.
//   - `moveVaultAtomic` uses fs.promises.rename (OS-level atomic on the same
//     filesystem); on failure it rolls back by renaming back to the original.
//
// No IPC or Electron deps — fully testable in Node.

import fs from 'fs';
import path from 'path';
import type { VaultMoveDestination } from './ipc.js';
import { snapshotDirectory, verifyPostMove } from './migrationVerify.js';
import type { PostMoveVerification } from './migrationVerify.js';

// ─── Target validation ────────────────────────────────────────────────────────

export type ValidateMoveTargetResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Runtime checks before the atomic rename. Verifies:
 *   - Source vault directory actually exists.
 *   - Target is not the same path as the source.
 *   - Target does not already contain files (prevents accidental overwrite).
 *   - Target (or its nearest existing ancestor) is writable.
 *
 * Injectable FS helpers keep this function testable without real disk access.
 */
export function validateMoveTarget(
  srcVaultRoot: string,
  targetPath: string,
  opts: {
    existsSync?: (p: string) => boolean;
    readdirSync?: (p: string) => string[];
    accessSync?: (p: string, mode: number) => void;
    statSync?: (p: string) => { isDirectory(): boolean };
  } = {},
): ValidateMoveTargetResult {
  const {
    existsSync = fs.existsSync,
    readdirSync = (p) => fs.readdirSync(p) as string[],
    accessSync = fs.accessSync,
    statSync = fs.statSync,
  } = opts;

  if (!existsSync(srcVaultRoot)) {
    return { ok: false, error: 'Source vault directory does not exist' };
  }

  const resolvedSrc = path.resolve(srcVaultRoot);
  const resolvedDst = path.resolve(targetPath);
  if (resolvedSrc === resolvedDst) {
    return { ok: false, error: 'Target path is the same as the current vault location' };
  }

  if (existsSync(targetPath)) {
    // Must be a directory (not a file).
    try {
      if (!statSync(targetPath).isDirectory()) {
        return { ok: false, error: 'Target path exists but is not a directory' };
      }
    } catch {
      return { ok: false, error: 'Target path exists but could not be stat-ted' };
    }

    let isEmpty = false;
    try {
      const entries = readdirSync(targetPath);
      isEmpty = entries.length === 0;
    } catch {
      return { ok: false, error: 'Target path exists but could not be read' };
    }
    if (!isEmpty) {
      return { ok: false, error: 'Target directory is not empty — choose an empty or new folder' };
    }
    // Empty target is acceptable; rename will replace it.
    try {
      accessSync(targetPath, fs.constants.W_OK);
    } catch {
      return { ok: false, error: 'Target directory exists but is not writable' };
    }
  } else {
    // Walk up to the nearest existing ancestor and verify write access.
    let ancestor = path.dirname(targetPath);
    while (ancestor !== path.dirname(ancestor)) {
      if (existsSync(ancestor)) {
        try {
          accessSync(ancestor, fs.constants.W_OK);
        } catch {
          return { ok: false, error: 'Target location is not writable' };
        }
        break;
      }
      ancestor = path.dirname(ancestor);
    }
  }

  return { ok: true };
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  action: 'vault:guidedFolderMove' | 'vault:localFolderMove';
  fromPath: string;
  toPath: string;
  syncProvider: VaultMoveDestination;
}

/**
 * Appends a newline-delimited JSON entry to `<vaultPath>/.mythos/settings_audit.log`.
 * Creates the `.mythos` directory if absent. Non-fatal — a log failure must
 * never roll back a successful move.
 */
export function appendAuditEntry(vaultPath: string, entry: AuditEntry): void {
  const mythosDir = path.join(vaultPath, '.mythos');
  fs.mkdirSync(mythosDir, { recursive: true });
  const logPath = path.join(mythosDir, 'settings_audit.log');
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}

// ─── Atomic move + settings update ───────────────────────────────────────────

export interface GuidedMoveOptions {
  /** Called after the rename succeeds to persist the new vaultRoot. */
  updateSettings: (newVaultPath: string) => void;
  /** Move destination, recorded in the audit log. */
  syncProvider: VaultMoveDestination;
}

export interface GuidedMoveResult {
  /** Post-move file count + checksum verification report. */
  verification: PostMoveVerification;
}

// SKY-10895: on Windows, EPERM/EBUSY/ENOTEMPTY renaming the vault directory
// is frequently transient even after we release our own handles (watcher +
// DB) — the OS can take a moment to actually free a just-closed handle, or a
// background scanner (Defender, Windows Search Indexer) briefly holds one.
// uninstallHelper.ts's removeEntry() started from the same 10x/100ms budget
// for deletes, but the native-Windows `notes-windows` CI job reproduced the
// budget being exhausted on this exact rename twice in a row (real
// `EPERM: operation not permitted, rename ...` after all 10 retries) — a
// held-open SQLite handle apparently takes longer to release than a plain
// delete. Widened to 6s of headroom, still comfortably inside the wizard's
// 15s "waiting for the move to finish" UI timeout.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const RENAME_MAX_RETRIES = 40;
const RENAME_RETRY_DELAY_MS = 150;

// Budget for deleting the source tree file-by-file after a copy fallback
// (see `renameOrCopy`). Smaller than the rename budget on purpose: only the
// specific entries that are actually still locked pay this cost — most files
// delete on the first try — so this only matters for the same handful of
// stuck paths the rename retry already spent RENAME_MAX_RETRIES on.
const DELETE_RETRY_MAX = 20;
const DELETE_RETRY_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  codes: Set<string>,
  maxRetries: number,
  delayMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && codes.has(code) && attempt < maxRetries) {
        await delay(delayMs);
        continue;
      }
      throw err;
    }
  }
}

// SKY-10895: `fs.rename`'s EPERM only names the top-level directory being
// renamed, never the specific file/handle actually locked inside it — that's
// why the retry-exhausted log never told us anything more than "Story Vault
// is locked", even after every known app-owned handle (watcher, DB,
// schedulers, job queue, board watcher) was torn down and CI still failed.
//
// The original version of this probe opened each file with `fs.openSync(f,
// 'r+')`, which tests read/write access — but that is NOT what blocks a
// Windows rename. Windows refuses to rename a directory tree if ANY open
// handle anywhere inside it lacks `FILE_SHARE_DELETE`, and a *fresh* r+ open
// from the probe itself succeeds regardless of that flag on someone else's
// handle. It also never tested directories at all (`entry.isDirectory()`
// just recursed, never probed the directory entry itself), so a handle held
// on a directory (not a file) inside the tree was invisible to it — which is
// exactly why every prior run of this probe found nothing.
//
// Test the actual operation that matters instead: try renaming the entry to
// a sibling name and back. This is bottom-up, so a directory is only probed
// once every descendant has already proven clean — if a directory still
// fails after all its children pass, the lock is on that directory's own
// handle, not something inside it.
function canRename(full: string): boolean {
  const probe = `${full}.__sky10895_lockprobe__`;
  try {
    fs.renameSync(full, probe);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // An unrelated failure (e.g. ENOENT — entry vanished mid-walk) is not
    // evidence of a lock; only flag the codes we already treat as lock-like.
    return !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY');
  }
  fs.renameSync(probe, full);
  return true;
}

function findLockedEntries(root: string): string[] {
  const locked: string[] = [];
  // Returns true when `dir` and everything under it renamed clean.
  function walk(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    let allClean = true;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const childClean = entry.isDirectory() ? walk(full) : true;
      if (!childClean) {
        allClean = false;
        continue; // a descendant already failed; blaming this dir too would be noise.
      }
      if (!canRename(full)) {
        locked.push(path.relative(root, full));
        allClean = false;
      }
    }
    return allClean;
  }
  walk(root);
  return locked;
}

/**
 * Removes `dir` file-by-file, bottom-up, retrying each entry independently.
 * A single `fs.rm(dir, {recursive:true})` (or an `fs.rename` of the whole
 * tree) needs every descendant free of conflicting handles at one instant;
 * deleting entry-by-entry only needs each one clear at the moment it is
 * actually touched, which tolerates one lingering handle (see `renameOrCopy`)
 * far better than an all-or-nothing whole-tree operation.
 */
async function removeTreeWithRetry(dir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeTreeWithRetry(full);
    } else {
      await withRetry(RENAME_RETRY_CODES, DELETE_RETRY_MAX, DELETE_RETRY_DELAY_MS, () =>
        fs.promises.unlink(full),
      );
    }
  }
  await withRetry(RENAME_RETRY_CODES, DELETE_RETRY_MAX, DELETE_RETRY_DELAY_MS, () =>
    fs.promises.rmdir(dir),
  );
}

/**
 * Renames `src` to `dest`, falling back to a recursive copy + source removal
 * when the OS refuses a plain rename:
 *   - EXDEV — moving across filesystems (e.g. a different drive).
 *   - EPERM/EBUSY/ENOTEMPTY that survive the full retry budget — same-device,
 *     but Windows won't rename the tree while some handle inside it (ours or
 *     not) lacks FILE_SHARE_DELETE. A copy only needs read access to `src`
 *     (almost always available even while such a handle is open) and a
 *     per-entry retried delete afterwards, instead of requiring the entire
 *     tree lock-free at one instant the way `fs.rename` does.
 * The copy fallback is not atomic, but a failure partway through leaves the
 * untouched source intact (dest is removed and the error re-thrown) so
 * callers never observe a state where both copies are incomplete.
 */
async function renameOrCopy(src: string, dest: string): Promise<void> {
  let sameDeviceFailure: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') break;
      if (code && RENAME_RETRY_CODES.has(code) && attempt < RENAME_MAX_RETRIES) {
        await delay(RENAME_RETRY_DELAY_MS);
        continue;
      }
      if (!code || !RENAME_RETRY_CODES.has(code)) throw err;
      const locked = findLockedEntries(src);
      (err as NodeJS.ErrnoException & { lockedEntries?: string[] }).lockedEntries = locked;
      // eslint-disable-next-line no-console
      console.error(
        `[vault-move] rename retry budget exhausted, falling back to copy+delete: ` +
          `code=${code} lockedEntries=${locked.length ? locked.join(', ') : '(none found by probe)'}`,
      );
      sameDeviceFailure = err as NodeJS.ErrnoException;
      break;
    }
  }
  try {
    await fs.promises.cp(src, dest, { recursive: true });
  } catch (copyErr) {
    await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw sameDeviceFailure ?? copyErr;
  }
  try {
    await removeTreeWithRetry(src);
  } catch (rmErr) {
    if (sameDeviceFailure) {
      const locked = findLockedEntries(src);
      (sameDeviceFailure as NodeJS.ErrnoException & { lockedEntries?: string[] }).lockedEntries = locked;
      // eslint-disable-next-line no-console
      console.error(
        `[vault-move] copy succeeded but source cleanup still failed after its own retry budget: ` +
          `${(rmErr as Error).message} lockedEntries=${locked.length ? locked.join(', ') : '(none found by probe)'}`,
      );
      throw sameDeviceFailure;
    }
    throw rmErr;
  }
}

/**
 * Atomically moves `srcVaultRoot` to `targetPath` via `fs.promises.rename`
 * (falling back to copy+delete across filesystem boundaries — see `renameOrCopy`).
 *
 * Sequence:
 *   1. `renameOrCopy(src, dest)` — OS-level rename, atomic on the same FS.
 *   2. `updateSettings(targetPath)` — persist new vaultRoot; on failure, roll
 *      back by moving the directory back to its original location.
 *   3. `appendAuditEntry` — non-fatal; logged to `.mythos/settings_audit.log`.
 *
 * Throws when:
 *   - the move fails (e.g., ENOTEMPTY — non-empty target, disk full).
 *   - settings update fails AND rollback also fails (double-fault).
 */
export async function moveVaultAtomic(
  srcVaultRoot: string,
  targetPath: string,
  opts: GuidedMoveOptions,
): Promise<GuidedMoveResult> {
  // Snapshot source before rename for post-move verification.
  const srcSnapshot = snapshotDirectory(srcVaultRoot);

  await renameOrCopy(srcVaultRoot, targetPath);

  try {
    opts.updateSettings(targetPath);
  } catch (settingsErr) {
    // Rollback: move the vault back to its original location.
    try {
      await renameOrCopy(targetPath, srcVaultRoot);
    } catch (rollbackErr) {
      // Double-fault: vault is at the new path but settings still point to old.
      // Surface both errors so the operator can manually reconcile.
      throw new Error(
        `Settings update failed and rollback also failed. ` +
          `Vault is at: ${targetPath}. ` +
          `Settings error: ${(settingsErr as Error).message}. ` +
          `Rollback error: ${(rollbackErr as Error).message}.`,
      );
    }
    throw settingsErr;
  }

  // Audit log is best-effort — do not let a log failure undo the move.
  try {
    appendAuditEntry(targetPath, {
      timestamp: new Date().toISOString(),
      action: opts.syncProvider === 'local' ? 'vault:localFolderMove' : 'vault:guidedFolderMove',
      fromPath: srcVaultRoot,
      toPath: targetPath,
      syncProvider: opts.syncProvider,
    });
  } catch {
    // Non-fatal; log to main-process stderr so operators can investigate.
    // eslint-disable-next-line no-console
    console.error('[vaultGuidedMove] audit log write failed — move itself succeeded');
  }

  // Post-move verification: confirm all files arrived at the destination.
  const verification = verifyPostMove(srcSnapshot, targetPath);
  return { verification };
}
