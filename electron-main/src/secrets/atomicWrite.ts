/**
 * Atomic JSON / text file writes with restrictive temp modes (KEYS-B B3 / S-B7).
 *
 * Pattern: unique temp in same dir → open wx + mode 0o600 → write → fsync →
 * rename over target. Unlink temp on failure. Leftover temps matching
 * `<basename>.*.tmp` are cleaned on boot via deleteLeftoverAtomicTemps.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Same-dir unique temp next to `targetPath` (pid + random). */
export function atomicTempPath(targetPath: string): string {
  const rand = crypto.randomBytes(6).toString('hex');
  return `${targetPath}.${process.pid}-${rand}.tmp`;
}

/**
 * Write `data` atomically to `targetPath`.
 * Temp opened with flag `wx` and mode `0o600` so it never replaces an existing
 * temp and is owner-read/write only on POSIX.
 */
export function writeFileAtomicSecure(targetPath: string, data: string | Buffer): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = atomicTempPath(targetPath);
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  try {
    fs.closeSync(fd);
  } catch {
    /* ignore */
  }
  try {
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function writeJsonAtomicSecure(targetPath: string, value: unknown): void {
  writeFileAtomicSecure(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Delete leftover `<basename>.*.tmp` siblings of known targets before migration.
 * Only unlinks regular files (lstat); never follows symlinks into unlink of the
 * wrong inode by checking isFile() on the lstat result.
 */
export function deleteLeftoverAtomicTemps(targetPaths: readonly string[]): void {
  for (const targetPath of targetPaths) {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const prefix = `${base}.`;
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      // Require something between basename. and .tmp (pid-random).
      if (name.length <= prefix.length + '.tmp'.length) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile()) continue;
        fs.unlinkSync(full);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
