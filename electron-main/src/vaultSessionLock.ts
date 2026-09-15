// Vault session lock (SKY-863) — a per-vault-root lockfile that detects a
// second Mythos Writer session holding the same vault, plus the JSON-lines
// event log that records lock activity.
//
// Local-first, not sync: `isLockfileLive` probes `process.kill(pid, 0)` only
// for locks written by THIS host, which is the "two app instances on one
// machine" case. `isForeignHostLock` covers a vault reached over a network
// share, where the PID cannot be probed and the lock must not be stolen.
//
// No Electron dependency — fully testable in Node.
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Constants ───────────────────────────────────────────────────────────────

export const MYTHOS_DIR = '.mythos';
export const SYNC_LOG = 'sync_events.log';

const LOCK_FILE = 'vault.lock';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LockfileData {
  hostname: string;
  pid: number;
  timestamp: string;
  vaultPath: string;
}

export interface SyncEvent {
  type: 'lockfile_acquired' | 'lockfile_released' | 'concurrent_session_detected';
  ts: string;
  detail: Record<string, unknown>;
}

// ─── Lockfile ────────────────────────────────────────────────────────────────

function lockfilePath(vaultRoot: string): string {
  return path.join(vaultRoot, MYTHOS_DIR, LOCK_FILE);
}

/**
 * Atomically acquire the vault lockfile.
 *
 * Uses O_CREAT|O_EXCL ('ax') so the create-or-fail is a single syscall with
 * no TOCTOU window. If EEXIST, the existing lock is checked for liveness:
 * - live same-host process  → returns null (caller sees contention)
 * - foreign-host lock       → returns null (caller warns user)
 * - stale / dead PID        → removes the stale file and re-acquires
 *
 * Returns the acquired LockfileData, or null when contention is detected.
 */
export function acquireLockfile(vaultRoot: string): LockfileData | null {
  fs.mkdirSync(path.join(vaultRoot, MYTHOS_DIR), { recursive: true });
  const data: LockfileData = {
    hostname: os.hostname(),
    pid: process.pid,
    timestamp: new Date().toISOString(),
    vaultPath: vaultRoot,
  };
  const lp = lockfilePath(vaultRoot);
  const content = JSON.stringify(data, null, 2);

  try {
    // Atomic exclusive create — throws EEXIST if already present.
    const fd = fs.openSync(lp, 'ax');
    fs.writeSync(fd, content);
    fs.closeSync(fd);
    return data;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // EEXIST: read the existing lock and decide.
  const existing = checkLockfile(vaultRoot);
  if (existing === null) {
    // Lockfile vanished between our open and read — try once more recursively.
    return acquireLockfile(vaultRoot);
  }
  if (isLockfileLive(existing) || isForeignHostLock(existing)) {
    return null; // live contention
  }
  // Stale lock from a crashed process — remove and re-acquire.
  try { fs.unlinkSync(lp); } catch { /* already gone */ }
  return acquireLockfile(vaultRoot);
}

/** Remove the lockfile. Safe to call when no lockfile exists. */
export function releaseLockfile(vaultRoot: string): void {
  try {
    fs.unlinkSync(lockfilePath(vaultRoot));
  } catch {
    // already gone or path invalid — non-fatal
  }
}

/** Read the lockfile. Returns `null` when absent or unparseable. */
export function checkLockfile(vaultRoot: string): LockfileData | null {
  const lf = lockfilePath(vaultRoot);
  if (!fs.existsSync(lf)) return null;
  try {
    return JSON.parse(fs.readFileSync(lf, 'utf-8')) as LockfileData;
  } catch {
    return null;
  }
}

/**
 * Returns true when `lock` describes a different, still-running process on
 * the current host. Cross-host locks are not "live" here (PID cannot be
 * checked remotely); use `isForeignHostLock` to detect those separately.
 */
export function isLockfileLive(lock: LockfileData): boolean {
  if (lock.pid === process.pid) return false; // our own lock
  if (lock.hostname !== os.hostname()) return false; // different host → not checkable here
  try {
    process.kill(lock.pid, 0); // signal 0 = existence probe; throws ESRCH when gone
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when `lock` was written by a different machine.
 * These require the user to be warned before overriding (SKY-1143).
 */
export function isForeignHostLock(lock: LockfileData): boolean {
  return lock.hostname !== os.hostname();
}

// ─── Sync event log ───────────────────────────────────────────────────────────

/** Append a JSON-lines entry to `.mythos/sync_events.log`. */
export function appendSyncEvent(vaultRoot: string, event: SyncEvent): void {
  fs.mkdirSync(path.join(vaultRoot, MYTHOS_DIR), { recursive: true });
  fs.appendFileSync(
    path.join(vaultRoot, MYTHOS_DIR, SYNC_LOG),
    JSON.stringify(event) + '\n',
    'utf-8',
  );
}
