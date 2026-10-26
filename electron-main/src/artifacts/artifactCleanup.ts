// Delete API and vault-removal sweep. The only artifacts module allowed to rename or delete.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isUuidV4, guardMutant } from './artifactSchema.js';

export interface CleanupReport {
  ok: boolean;
  reason?: string;
  deleted: string[];
  trashed: string[];
  skipped: Array<{ path: string; reason: 'symlink' | 'hardlink' }>;
  reported: string[];
}

export function cleanupListHash(paths: readonly string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify([...paths].sort())).digest('hex');
}

function emptyReport(): CleanupReport {
  return { ok: true, deleted: [], trashed: [], skipped: [], reported: [] };
}

/** A storage root must be a real directory. A symlink root is refused, not followed. */
function rootIsPhysical(root: string): boolean {
  if (!fs.existsSync(root)) return true;
  try {
    const st = fs.lstatSync(root);
    if (st.isSymbolicLink()) return false;
    return fs.realpathSync(root) === path.resolve(root);
  } catch {
    return false;
  }
}

function contained(candidate: string, roots: readonly string[]): boolean {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(candidate);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) {
    // Symlinks are classified and skipped. They are not walked.
    const parent = path.dirname(candidate);
    return roots.some((root) => candidate === root || candidate.startsWith(root + path.sep) || parent === root || parent.startsWith(root + path.sep));
  }
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return false;
  }
  return roots.some((root) => {
    let rootReal: string;
    try {
      if (!rootIsPhysical(root)) return false;
      rootReal = fs.realpathSync(root);
    } catch {
      return false;
    }
    return real === rootReal || real.startsWith(rootReal + path.sep);
  });
}

function classify(candidate: string): 'file' | 'symlink' | 'hardlink' | 'missing' {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isFile() && st.nlink > 1) return 'hardlink';
  return 'file';
}

export function artifactVaultDir(vaultRoot: string): string {
  return path.join(vaultRoot, '.mythos', 'artifacts');
}

export function artifactUserDataDir(userData: string, vaultId: string): string | null {
  if (!isUuidV4(vaultId)) return null;
  return path.join(userData, 'artifacts', vaultId);
}

export function appPrivateTrash(userData: string): string {
  return path.join(userData, 'artifacts-trash');
}

/**
 * Flag-off / gate-no sweep reports or moves to the app-private trash.
 * Permanent delete happens only in confirmCleanup, bound to the list hash.
 */
/** Drop pre-image files past the newest `keep`. Symlinks and hard links are left in place. */
export function trimPreimages(dir: string, keep: number): void {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .map((name) => ({ name, file: path.join(dir, name) }))
    .filter((entry) => {
      try {
        const st = fs.lstatSync(entry.file);
        return st.isFile() && !st.isSymbolicLink();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const extra = files.slice(0, Math.max(0, files.length - keep));
  for (const entry of extra) {
    const st = fs.lstatSync(entry.file);
    if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)) continue;
    fs.unlinkSync(entry.file);
  }
}

export function sweepArtifacts(input: {
  vaultRoot: string;
  userData: string;
  vaultId: string;
  flagOff: boolean;
}): CleanupReport {
  const report = emptyReport();
  if (!isUuidV4(input.vaultId)) {
    return { ...report, ok: false, reason: 'bad_vault_id' };
  }
  const roots = [artifactVaultDir(input.vaultRoot), artifactUserDataDir(input.userData, input.vaultId)!];
  if (roots.some((root) => !rootIsPhysical(root))) {
    return { ...emptyReport(), ok: false, reason: 'symlink' };
  }
  const found: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      return { ...emptyReport(), ok: false, reason: 'error', deleted: [] };
    }
    if (!contained(realRoot, roots)) {
      return { ...emptyReport(), ok: false, reason: 'outside' };
    }
    try {
      walkFiles(root, found);
    } catch {
      return { ...emptyReport(), ok: false, reason: 'error' };
    }
  }
  for (const file of found) {
    if (!contained(file, roots)) {
      return { ...emptyReport(), ok: false, reason: 'outside' };
    }
    let kind: ReturnType<typeof classify>;
    try {
      kind = classify(file);
    } catch {
      return { ...emptyReport(), ok: false, reason: 'error' };
    }
    if (kind === 'symlink' || kind === 'hardlink') {
      report.skipped.push({ path: file, reason: kind });
      continue;
    }
    if (kind !== 'file') continue;
    report.reported.push(file);
    if (input.flagOff) {
      const moved = trashMove(file, input.userData);
      if (!moved) return { ...emptyReport(), ok: false, reason: 'error' };
      report.trashed.push(file);
    }
  }
  return report;
}

function walkFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new Error('walk failed');
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(full);
      continue;
    }
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
}

function trashMove(file: string, userData: string): boolean {
  const trash = appPrivateTrash(userData);
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${path.basename(file)}.${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.renameSync(file, dest);
    return true;
  } catch {
    return false;
  }
}

export function confirmCleanup(input: {
  paths: readonly string[];
  listHash: string;
  vaultRoot: string;
  userData: string;
  vaultId: string;
  allowDelete: boolean;
}): CleanupReport {
  const report = emptyReport();
  try {
    if (!isUuidV4(input.vaultId)) return { ...report, ok: false, reason: 'bad_vault_id' };
    const userDir = artifactUserDataDir(input.userData, input.vaultId);
    if (!userDir) return { ...report, ok: false, reason: 'bad_vault_id' };
    const roots = [artifactVaultDir(input.vaultRoot), userDir];
    if (roots.some((root) => !rootIsPhysical(root))) {
      return { ...emptyReport(), ok: false, reason: 'symlink' };
    }
    const expected = cleanupListHash(input.paths);
    if (!guardMutant('skip-confirm') && input.listHash !== expected) {
      return { ...report, ok: false, reason: 'list_changed' };
    }
    const deletable: string[] = [];
    for (const file of input.paths) {
      if (!contained(file, roots)) return { ...emptyReport(), ok: false, reason: 'outside' };
      const kind = classify(file);
      if (kind === 'symlink' || kind === 'hardlink') {
        report.skipped.push({ path: file, reason: kind });
        continue;
      }
      if (kind === 'file') deletable.push(file);
    }
    if (!input.allowDelete) {
      for (const file of deletable) {
        if (!trashMove(file, input.userData)) return { ...emptyReport(), ok: false, reason: 'error' };
        report.trashed.push(file);
      }
      return report;
    }
    const trashed: Array<{ from: string; dest: string }> = [];
    for (const file of deletable) {
      const trash = appPrivateTrash(input.userData);
      fs.mkdirSync(trash, { recursive: true });
      const dest = path.join(trash, `${path.basename(file)}.${crypto.randomBytes(4).toString('hex')}`);
      try {
        fs.renameSync(file, dest);
      } catch {
        for (const moved of trashed) {
          try { fs.renameSync(moved.dest, moved.from); } catch { /* restore best-effort */ }
        }
        return { ...emptyReport(), ok: false, reason: 'error' };
      }
      trashed.push({ from: file, dest });
    }
    for (const moved of trashed) {
      try {
        fs.unlinkSync(moved.dest);
        report.deleted.push(moved.from);
      } catch {
        return { ...emptyReport(), ok: false, reason: 'error', deleted: [] };
      }
    }
    return report;
  } catch {
    return { ...emptyReport(), ok: false, reason: 'error' };
  }
}
