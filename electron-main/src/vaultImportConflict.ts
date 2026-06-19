// SKY-2637: Import vault conflict resolution — rename name-collision notes and
// write .vault-import-log.md at the imported vault root.
//
// Security contract:
//   - All file paths from the dry-run report are relative to sourcePath.
//   - Before any rename, we resolve the absolute path and verify it stays within
//     the real sourcePath (no symlink escapes, no traversal sequences).
//   - We reject any relative path that contains null bytes or encoded traversal.
//
// No Electron dependency — fully testable in Node.

import fs from 'fs';
import path from 'path';
import type { ObsidianNameCollision } from './ipc.js';

// ─── Path guard ───────────────────────────────────────────────────────────────

const NULL_BYTE_RE = /\0/;
const ENCODED_DOTDOT_RE = /%2e%2e|%252e/i;

function assertWithinRoot(root: string, relPath: string): string {
  if (NULL_BYTE_RE.test(relPath) || ENCODED_DOTDOT_RE.test(relPath)) {
    throw new Error(`Import path traversal denied: ${JSON.stringify(relPath)}`);
  }
  const realRoot = fs.realpathSync.native(root);
  const resolved = path.resolve(root, relPath);
  // The file must already exist for a rename — use realpath on the parent dir
  // because the file itself is about to be renamed (can't realpath it yet).
  const parent = path.dirname(resolved);
  let realParent: string;
  try {
    realParent = fs.realpathSync.native(parent);
  } catch {
    throw new Error(`Import path traversal denied: cannot resolve parent for ${relPath}`);
  }
  if (!realParent.startsWith(realRoot + path.sep) && realParent !== realRoot) {
    throw new Error(`Import path traversal denied: ${relPath} escapes vault root`);
  }
  return path.join(realParent, path.basename(resolved));
}

// ─── Rename collision files ───────────────────────────────────────────────────

export interface RenameResult {
  /** Original relative path (from dry-run report, relative to sourcePath) */
  from: string;
  /** New relative path after rename */
  to: string;
  /** true = rename succeeded, false = skipped (already exists or error) */
  ok: boolean;
  error?: string;
}

/**
 * Renames each collision note from `<name>.md` to `<name> (Imported).md`
 * inside sourcePath. Skips entries whose target name already exists.
 *
 * Returns one RenameResult per collision.
 */
export function renameCollisionFiles(
  sourcePath: string,
  nameCollisions: ObsidianNameCollision[],
): RenameResult[] {
  const results: RenameResult[] = [];

  for (const collision of nameCollisions) {
    const relFrom = collision.file;
    const dir = path.dirname(relFrom);
    const ext = path.extname(relFrom);
    const stem = path.basename(relFrom, ext);
    const newName = `${stem} (Imported)${ext}`;
    const relTo = dir === '.' ? newName : `${dir}/${newName}`;

    let absFrom: string;
    try {
      absFrom = assertWithinRoot(sourcePath, relFrom);
    } catch (err) {
      results.push({ from: relFrom, to: relTo, ok: false, error: (err as Error).message });
      continue;
    }

    const absTo = path.join(path.dirname(absFrom), newName);

    if (!fs.existsSync(absFrom)) {
      results.push({ from: relFrom, to: relTo, ok: false, error: 'source file not found' });
      continue;
    }

    if (fs.existsSync(absTo)) {
      results.push({ from: relFrom, to: relTo, ok: false, error: 'target already exists' });
      continue;
    }

    try {
      fs.renameSync(absFrom, absTo);
      results.push({ from: relFrom, to: relTo, ok: true });
    } catch (err) {
      results.push({ from: relFrom, to: relTo, ok: false, error: (err as Error).message });
    }
  }

  return results;
}

// ─── Import log ───────────────────────────────────────────────────────────────

export interface ImportLogOptions {
  sourcePath: string;
  renamedFiles: RenameResult[];
  brokenLinkCount: number;
  importedAt: string;
}

/**
 * Writes `.vault-import-log.md` at the vault root (= sourcePath) listing:
 *   - renamed collision files
 *   - broken link count
 *
 * Non-fatal: a failure here must not roll back the import.
 */
export function writeVaultImportLog(opts: ImportLogOptions): void {
  const { sourcePath, renamedFiles, brokenLinkCount, importedAt } = opts;

  const lines: string[] = [
    '# Vault Import Log',
    '',
    `Imported: ${importedAt}`,
    '',
  ];

  const succeeded = renamedFiles.filter((r) => r.ok);
  const failed = renamedFiles.filter((r) => !r.ok);

  if (succeeded.length > 0) {
    lines.push('## Renamed Files (name collisions with existing entities)');
    lines.push('');
    for (const r of succeeded) {
      lines.push(`- \`${r.from}\` → \`${r.to}\``);
    }
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('## Rename Errors');
    lines.push('');
    for (const r of failed) {
      lines.push(`- \`${r.from}\`: ${r.error ?? 'unknown error'}`);
    }
    lines.push('');
  }

  if (brokenLinkCount > 0) {
    lines.push('## Broken Wiki-Links');
    lines.push('');
    lines.push(
      `${brokenLinkCount} note${brokenLinkCount === 1 ? '' : 's'} contain broken [[wiki-links]] ` +
      'whose targets were not found in this vault. ' +
      'Review these in the Archive Agent panel.',
    );
    lines.push('');
  }

  if (succeeded.length === 0 && failed.length === 0 && brokenLinkCount === 0) {
    lines.push('No conflicts or broken links detected. Import completed cleanly.');
    lines.push('');
  }

  const logPath = path.join(sourcePath, '.vault-import-log.md');
  try {
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
  } catch {
    // Non-fatal — log to stderr but do not propagate.
    // eslint-disable-next-line no-console
    console.error('[vaultImportConflict] failed to write .vault-import-log.md');
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface ResolveImportResult {
  renamedFiles: RenameResult[];
  logWritten: boolean;
}

/**
 * Renames collision files and writes the import log in one step.
 * Call this after the dry-run is confirmed and before registering notesVaultRoot.
 */
export function resolveVaultImportCollisions(
  sourcePath: string,
  nameCollisions: ObsidianNameCollision[],
  brokenLinkCount: number,
  importedAt: string,
): ResolveImportResult {
  const renamedFiles = renameCollisionFiles(sourcePath, nameCollisions);

  let logWritten = false;
  try {
    writeVaultImportLog({ sourcePath, renamedFiles, brokenLinkCount, importedAt });
    logWritten = true;
  } catch {
    // already swallowed inside writeVaultImportLog; flag as false
  }

  return { renamedFiles, logWritten };
}
