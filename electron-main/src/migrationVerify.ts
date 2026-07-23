// Migration post-operation verification helpers (SKY-7948).
// Computes file counts + content checksums for import and move paths.
// No Electron imports — fully testable in Node.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// OneDrive dehydrated stub extensions (cloud-only placeholders, not real content).
const ONEDRIVE_STUB_EXTS = new Set(['.cloud', '.cloudmeta']);

export interface DirectorySnapshot {
  /** Total non-stub files counted. */
  count: number;
  /** SHA-256 of all file paths + contents (sorted, deterministic). */
  checksum: string;
  /** Relative paths of OneDrive dehydrated stub files found. */
  dehydratedStubs: string[];
  /** Relative paths of files that could not be read (locked / permission denied). */
  lockedFiles: string[];
}

/**
 * Walk dirPath and compute a deterministic checksum + metadata snapshot.
 * Dotfiles and dot-directories are skipped (matches vault traversal conventions).
 */
export function snapshotDirectory(
  dirPath: string,
  opts: { existsSync?: (p: string) => boolean } = {},
): DirectorySnapshot {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const hash = crypto.createHash('sha256');
  let count = 0;
  const dehydratedStubs: string[] = [];
  const lockedFiles: string[] = [];

  if (!existsSync(dirPath)) {
    return { count: 0, checksum: hash.digest('hex'), dehydratedStubs, lockedFiles };
  }

  function walk(p: string, base: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(path.join(p, entry.name), rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ONEDRIVE_STUB_EXTS.has(ext)) {
          dehydratedStubs.push(rel);
          continue;
        }
        count++;
        hash.update(rel + '\0');
        try {
          const fileContent = fs.readFileSync(path.join(p, entry.name));
          hash.update(fileContent);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code ?? '';
          lockedFiles.push(rel);
          hash.update(`LOCKED:${code}\0`);
        }
      }
    }
  }

  walk(dirPath, '');
  return { count, checksum: hash.digest('hex'), dehydratedStubs, lockedFiles };
}

export interface PostMoveVerification {
  ok: boolean;
  sourceCount: number;
  destCount: number;
  dropped: number;
  checksumMatch: boolean;
  dehydratedStubs: string[];
  lockedFiles: string[];
  /** User-facing summary of any problems found. Empty when ok. */
  message: string;
}

/**
 * Compare a pre-move source snapshot against the destination after the rename.
 * Returns a structured report; ok is false when files are missing or stubs found.
 */
export function verifyPostMove(
  srcSnapshot: DirectorySnapshot,
  dstPath: string,
): PostMoveVerification {
  const dst = snapshotDirectory(dstPath);

  const dropped = srcSnapshot.count - dst.count;
  const checksumMatch = srcSnapshot.checksum === dst.checksum;
  const problems: string[] = [];

  if (dropped > 0) {
    problems.push(
      `${dropped} file(s) missing from destination after move — check disk space and try again`,
    );
  }
  if (!checksumMatch && dropped === 0 && dst.lockedFiles.length === 0) {
    problems.push('File contents changed during move — verify files manually');
  }
  if (dst.dehydratedStubs.length > 0) {
    problems.push(
      `${dst.dehydratedStubs.length} OneDrive cloud-only stub(s) could not be verified — ` +
        'download these files from OneDrive first, then move the vault',
    );
  }
  if (dst.lockedFiles.length > 0) {
    problems.push(
      `${dst.lockedFiles.length} file(s) could not be verified (locked or permission denied)`,
    );
  }

  return {
    ok: problems.length === 0,
    sourceCount: srcSnapshot.count,
    destCount: dst.count,
    dropped,
    checksumMatch,
    dehydratedStubs: dst.dehydratedStubs,
    lockedFiles: dst.lockedFiles,
    message: problems.join('; '),
  };
}

// ─── Docx helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a Node.js FS errno code to an actionable user-facing message.
 */
export function describeFileError(err: unknown, filePath: string): string {
  const code = (err as NodeJS.ErrnoException).code ?? '';
  switch (code) {
    case 'ENOENT':
      return `File not found: ${filePath}`;
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES':
      return `File is locked or in use — close any other application that has "${path.basename(filePath)}" open and try again`;
    case 'ENOSPC':
      return `Not enough disk space to read ${path.basename(filePath)}`;
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

// ─── Obsidian helpers ─────────────────────────────────────────────────────────

export interface ObsidianVerification {
  sourceCount: number;
  importedCount: number;
  skippedCount: number;
  droppedCount: number;
  /** Non-empty when files were dropped (silent-partial-import protection). */
  dropWarning: string;
}

/**
 * Compute post-import verification for an Obsidian vault.
 */
export function verifyObsidianImport(
  sourceCount: number,
  imported: number,
  skipped: number,
  errored: number,
): ObsidianVerification {
  const accountedFor = imported + skipped + errored;
  const droppedCount = Math.max(0, sourceCount - accountedFor);
  const dropWarning =
    droppedCount > 0
      ? `${droppedCount} file(s) from the Obsidian vault were not imported and not reported as errors — ` +
        'check for unsupported file types or permission issues in the source vault'
      : '';

  return {
    sourceCount,
    importedCount: imported,
    skippedCount: skipped,
    droppedCount,
    dropWarning,
  };
}
