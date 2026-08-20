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
// uninstallHelper.ts's removeEntry() learned this same lesson for deletes
// (fs.rmSync's maxRetries/retryDelay); rename has no built-in retry, so we
// apply the identical budget by hand here.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const RENAME_MAX_RETRIES = 10;
const RENAME_RETRY_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renames `src` to `dest`, falling back to a recursive copy + source removal
 * when the OS refuses a plain rename across filesystems (EXDEV — e.g. moving
 * a local vault to a different drive, common on Windows). The copy fallback
 * is not atomic, but a failure partway through leaves the untouched source
 * intact (dest is removed and the error re-thrown) so callers never observe
 * a state where both copies are incomplete.
 */
async function renameOrCopy(src: string, dest: string): Promise<void> {
  let needsCopyFallback = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        needsCopyFallback = true;
        break;
      }
      if (code && RENAME_RETRY_CODES.has(code) && attempt < RENAME_MAX_RETRIES) {
        await delay(RENAME_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  if (!needsCopyFallback) return;
  try {
    await fs.promises.cp(src, dest, { recursive: true });
  } catch (copyErr) {
    await fs.promises.rm(dest, { recursive: true, force: true });
    throw copyErr;
  }
  await fs.promises.rm(src, { recursive: true, force: true });
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
