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
import type { CloudSyncProvider } from './ipc.js';

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
  action: 'vault:guidedFolderMove';
  fromPath: string;
  toPath: string;
  syncProvider: CloudSyncProvider;
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
  /** Sync provider, recorded in the audit log. */
  syncProvider: CloudSyncProvider;
}

/**
 * Atomically moves `srcVaultRoot` to `targetPath` via `fs.promises.rename`.
 *
 * Sequence:
 *   1. `fs.promises.rename(src, dest)` — OS-level rename (atomic on same FS).
 *   2. `updateSettings(targetPath)` — persist new vaultRoot; on failure, roll
 *      back by renaming the directory back to its original location.
 *   3. `appendAuditEntry` — non-fatal; logged to `.mythos/settings_audit.log`.
 *
 * Throws when:
 *   - rename fails (e.g., EXDEV — cross-device move, ENOTEMPTY — non-empty target).
 *   - settings update fails AND rollback also fails (double-fault).
 */
export async function moveVaultAtomic(
  srcVaultRoot: string,
  targetPath: string,
  opts: GuidedMoveOptions,
): Promise<void> {
  await fs.promises.rename(srcVaultRoot, targetPath);

  try {
    opts.updateSettings(targetPath);
  } catch (settingsErr) {
    // Rollback: move the vault back to its original location.
    try {
      await fs.promises.rename(targetPath, srcVaultRoot);
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
      action: 'vault:guidedFolderMove',
      fromPath: srcVaultRoot,
      toPath: targetPath,
      syncProvider: opts.syncProvider,
    });
  } catch {
    // Non-fatal; log to main-process stderr so operators can investigate.
    // eslint-disable-next-line no-console
    console.error('[vaultGuidedMove] audit log write failed — move itself succeeded');
  }
}
