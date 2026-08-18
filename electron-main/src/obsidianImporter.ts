// SKY-2993: Obsidian vault import — pure helpers (no Electron imports).
// Implements importObsidianVault and dryRunObsidianImport for the onboarding IPC layer.
//
// Design: reuses collectMarkdownFiles-style traversal from vault.ts but adds
// attachment file collection (.png, .jpg, etc.).
//
// SKY-10383 (owner ruling): every file — markdown included — is copied
// byte-for-byte. Mythos resolves bare-stem [[wikilinks]] natively at read
// time (noteBacklinks.ts), readers generate missing frontmatter ids on the
// fly (vault.ts readSceneFile/readEntityFile), and readEntityFile consumes
// `aliases`, so any import-time rewrite is both unnecessary and lossy.

import fs from 'fs';
import path from 'path';

import type { ObsidianImportPreview } from './ipc.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const OBSIDIAN_ATTACHMENT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
  '.pdf', '.mp3', '.wav', '.mp4', '.mov', '.ogg', '.m4a',
  '.zip', '.excalidraw',
]);

/** 25 MB — matches vault.ts MAX_VAULT_FILE_BYTES */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

// ─── File collection ─────────────────────────────────────────────────────────

export interface ObsidianFileList {
  markdownFiles: string[];
  attachmentFiles: string[];
}

/**
 * Recursively walk srcPath and collect:
 *   - .md files (markdownFiles)
 *   - known attachment extensions (attachmentFiles)
 * Skips dotfiles, symlinks, and .obsidian metadata directories.
 */
export function collectObsidianFiles(srcPath: string, base = ''): ObsidianFileList {
  const markdownFiles: string[] = [];
  const attachmentFiles: string[] = [];

  if (!fs.existsSync(srcPath)) return { markdownFiles, attachmentFiles };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcPath, { withFileTypes: true });
  } catch {
    return { markdownFiles, attachmentFiles };
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;

    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const sub = collectObsidianFiles(path.join(srcPath, entry.name), rel);
      markdownFiles.push(...sub.markdownFiles);
      attachmentFiles.push(...sub.attachmentFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.md') {
        markdownFiles.push(rel);
      } else if (OBSIDIAN_ATTACHMENT_EXTS.has(ext)) {
        attachmentFiles.push(rel);
      }
    }
  }

  return { markdownFiles, attachmentFiles };
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ObsidianImportResult {
  ok: boolean;
  targetPath: string;
  /** Total files found in the source vault (markdown + attachments). */
  sourceCount: number;
  imported: number;
  skipped: number;
  errors: string[];
  /** Non-empty when files were silently dropped. */
  dropWarning: string;
}

/**
 * Copy all .md and attachment files from srcPath into vaultRoot,
 * preserving directory structure. Every file is copied byte-for-byte —
 * wikilinks and frontmatter are never rewritten (SKY-10383: "notes, folders
 * and [[links]] come across as-is"). Bare-stem `[[name]]` links resolve at
 * read time via noteBacklinks.ts; ambiguous or unresolvable links stay
 * verbatim in the note, exactly as Obsidian left them.
 * Returns stats; does NOT update the manifest (caller's responsibility).
 */
export function importObsidianToVaultDir(
  srcPath: string,
  vaultRoot: string,
): ObsidianImportResult {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!fs.existsSync(srcPath)) {
    return { ok: false, targetPath: vaultRoot, sourceCount: 0, imported: 0, skipped: 0, errors: [`Source path does not exist: ${srcPath}`], dropWarning: '' };
  }

  let realSrc: string;
  try {
    realSrc = fs.realpathSync.native(srcPath);
  } catch {
    return { ok: false, targetPath: vaultRoot, sourceCount: 0, imported: 0, skipped: 0, errors: [`Cannot resolve source path: ${srcPath}`], dropWarning: '' };
  }

  const { markdownFiles, attachmentFiles } = collectObsidianFiles(realSrc);
  const sourceCount = markdownFiles.length + attachmentFiles.length;

  for (const rel of [...markdownFiles, ...attachmentFiles]) {
    try {
      const srcFull = path.join(realSrc, rel);
      const dstFull = path.join(vaultRoot, rel);

      if (fs.existsSync(dstFull)) {
        skipped++;
        continue;
      }

      const srcSize = fs.statSync(srcFull).size;
      if (srcSize > MAX_IMPORT_FILE_BYTES) {
        errors.push(`${rel}: file too large (${Math.round(srcSize / 1024 / 1024)} MB)`);
        continue;
      }

      fs.mkdirSync(path.dirname(dstFull), { recursive: true });
      fs.copyFileSync(srcFull, dstFull);
      imported++;
    } catch (err) {
      errors.push(`${rel}: ${(err as Error).message}`);
    }
  }

  // Post-import: detect silent drops (files in source not accounted for).
  const accountedFor = imported + skipped + errors.length;
  const dropped = Math.max(0, sourceCount - accountedFor);
  const dropWarning =
    dropped > 0
      ? `${dropped} file(s) from the Obsidian vault were not imported and not reported as errors — ` +
        'check for unsupported file types or permission issues in the source vault'
      : '';

  return {
    ok: errors.length === 0 || imported > 0,
    targetPath: vaultRoot,
    sourceCount,
    imported,
    skipped,
    errors,
    dropWarning,
  };
}

// ─── Dry-run preview ─────────────────────────────────────────────────────────

/**
 * Scan srcPath without writing anything. Returns a preview summary.
 */
export function dryRunObsidianImport(srcPath: string): ObsidianImportPreview | { error: string } {
  if (!fs.existsSync(srcPath)) {
    return { error: `Path does not exist: ${srcPath}` };
  }

  let statResult: fs.Stats;
  try {
    statResult = fs.statSync(srcPath);
  } catch (err) {
    return { error: `Cannot stat path: ${(err as Error).message}` };
  }

  if (!statResult.isDirectory()) {
    return { error: `Not a directory: ${srcPath}` };
  }

  let realSrc: string;
  try {
    realSrc = fs.realpathSync.native(srcPath);
  } catch (err) {
    return { error: `Cannot resolve path: ${(err as Error).message}` };
  }

  let topLevel: string[];
  try {
    topLevel = fs.readdirSync(realSrc)
      .filter((n) => !n.startsWith('.'));
  } catch (err) {
    return { error: `Cannot read directory: ${(err as Error).message}` };
  }

  const { markdownFiles, attachmentFiles } = collectObsidianFiles(realSrc);
  const sampleFiles = markdownFiles.slice(0, 5);

  return {
    markdownCount: markdownFiles.length,
    attachmentCount: attachmentFiles.length,
    totalFiles: markdownFiles.length + attachmentFiles.length,
    topLevelFolders: topLevel.slice(0, 20),
    sampleFiles,
  };
}
