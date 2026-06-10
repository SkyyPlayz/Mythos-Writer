// Cloud-sync conflict detection, lockfile management, and event logging.
// No Electron dependency — fully testable in Node.
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Constants ───────────────────────────────────────────────────────────────

export const MYTHOS_DIR = '.mythos';
export const SYNC_LOG = 'sync_events.log';

const LOCK_FILE = 'vault.lock';
const ARCHIVE_SUBDIR = '.archive';

// ─── Conflict patterns (spec note 3) ─────────────────────────────────────────
//  Dropbox:   "My Scene (conflicted copy 2024-01-15).md"
//  iCloud:    "My Scene (conflict 2).md"  |  "My Scene.conflict.1.md"
//  Syncthing: "My Scene.sync-conflict-20240115-120000-ABCDEF12.md"
//
// Each regex captures two groups: (stem)(extension) so the original filename
// can be reconstructed as `${m[1]}${m[2]}`.

export const CONFLICT_PATTERNS: ReadonlyArray<{
  provider: 'dropbox' | 'icloud' | 'syncthing';
  regex: RegExp;
}> = [
  {
    provider: 'dropbox',
    regex: /^(.+)\s+\(conflicted copy [^)]+\)(\.md)$/i,
  },
  {
    provider: 'icloud',
    regex: /^(.+)\s+\(conflict\s+\d+\)(\.md)$/i,
  },
  {
    provider: 'icloud',
    // dot-separated form: "file.conflict.1.md"
    regex: /^(.+)\.conflict\.\d+(\.md)$/i,
  },
  {
    provider: 'syncthing',
    regex: /^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(\.md)$/i,
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConflictFile {
  conflictPath: string;  // relative to vaultRoot
  originalPath: string;  // inferred original, relative to vaultRoot
  provider: 'dropbox' | 'icloud' | 'syncthing';
}

export interface ResolvedConflict extends ConflictFile {
  keptPath: string;     // relative to vaultRoot — path that now holds the content
  archivedPath: string; // relative to vaultRoot — .mythos/.archive/<ts>/<file>
  resolvedAt: string;   // ISO timestamp
}

export interface LockfileData {
  hostname: string;
  pid: number;
  timestamp: string;
  vaultPath: string;
}

export interface SyncEvent {
  type: 'conflict_resolved' | 'lockfile_acquired' | 'lockfile_released' | 'concurrent_session_detected';
  ts: string;
  detail: Record<string, unknown>;
}

// ─── Conflict detection ───────────────────────────────────────────────────────

function walkDir(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === MYTHOS_DIR) continue; // never scan our own directory
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out);
    } else {
      out.push(full);
    }
  }
}

/**
 * Walk `vaultRoot` and return every file matching a known conflict pattern.
 * Skips `.mythos/` to avoid false positives in the archive.
 */
export function detectConflicts(vaultRoot: string): ConflictFile[] {
  const allFiles: string[] = [];
  walkDir(vaultRoot, allFiles);

  const conflicts: ConflictFile[] = [];
  for (const absPath of allFiles) {
    const basename = path.basename(absPath);
    const dir = path.dirname(absPath);
    for (const { provider, regex } of CONFLICT_PATTERNS) {
      const m = regex.exec(basename);
      if (!m) continue;
      const originalBasename = `${m[1]}${m[2]}`;
      conflicts.push({
        conflictPath: path.relative(vaultRoot, absPath),
        originalPath: path.relative(vaultRoot, path.join(dir, originalBasename)),
        provider,
      });
      break; // first matching pattern wins
    }
  }
  return conflicts;
}

// ─── Resolver: lastModifiedTime-wins ─────────────────────────────────────────

/** Convert an ISO timestamp to a filesystem-safe string (no colons). */
function fsTimestamp(ts: string): string {
  return ts.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

/**
 * Resolve a single conflict using the lastModifiedTime-wins heuristic.
 *
 * Strategy:
 *  1. stat() both files.
 *  2. The file with the higher mtime wins and is placed at `originalPath`.
 *  3. The loser is moved to `.mythos/.archive/<ts>/`.
 *
 * If the original does not yet exist, the conflict file is simply renamed to
 * `originalPath` (treated as "conflict wins by default").
 */
export function resolveConflict(vaultRoot: string, conflict: ConflictFile): ResolvedConflict {
  const conflictAbs = path.join(vaultRoot, conflict.conflictPath);
  const originalAbs = path.join(vaultRoot, conflict.originalPath);
  const ts = new Date().toISOString();
  const archiveRelDir = path.join(MYTHOS_DIR, ARCHIVE_SUBDIR, fsTimestamp(ts));
  const archiveDir = path.join(vaultRoot, archiveRelDir);
  fs.mkdirSync(archiveDir, { recursive: true });

  const conflictStat = fs.statSync(conflictAbs);
  const originalExists = fs.existsSync(originalAbs);
  const originalStat = originalExists ? fs.statSync(originalAbs) : null;

  let keptPath: string;
  let archivedPath: string;

  if (!originalStat || conflictStat.mtimeMs > originalStat.mtimeMs) {
    // Conflict file is newer (or original is absent): conflict content wins.
    if (originalStat) {
      // Archive the original, then move conflict → original path.
      const archiveName = path.basename(originalAbs);
      fs.renameSync(originalAbs, path.join(archiveDir, archiveName));
      archivedPath = path.posix.join(archiveRelDir.split(path.sep).join('/'), archiveName);
    } else {
      // No original exists; archive nothing meaningful — archive slot is for the conflict.
      archivedPath = path.posix.join(archiveRelDir.split(path.sep).join('/'), path.basename(conflictAbs));
    }
    fs.renameSync(conflictAbs, originalAbs);
    keptPath = conflict.originalPath;
  } else {
    // Original is newer (or equal): archive the conflict file.
    const archiveName = path.basename(conflictAbs);
    fs.renameSync(conflictAbs, path.join(archiveDir, archiveName));
    keptPath = conflict.originalPath;
    archivedPath = path.posix.join(archiveRelDir.split(path.sep).join('/'), archiveName);
  }

  return { ...conflict, keptPath, archivedPath, resolvedAt: ts };
}

// ─── Lockfile ────────────────────────────────────────────────────────────────

function lockfilePath(vaultRoot: string): string {
  return path.join(vaultRoot, MYTHOS_DIR, LOCK_FILE);
}

/** Write a fresh lockfile for the current process. Creates `.mythos/` if needed. */
export function acquireLockfile(vaultRoot: string): LockfileData {
  fs.mkdirSync(path.join(vaultRoot, MYTHOS_DIR), { recursive: true });
  const data: LockfileData = {
    hostname: os.hostname(),
    pid: process.pid,
    timestamp: new Date().toISOString(),
    vaultPath: vaultRoot,
  };
  fs.writeFileSync(lockfilePath(vaultRoot), JSON.stringify(data, null, 2), 'utf-8');
  return data;
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
