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

import type { ObsidianImportPreview, ObsidianImportTargetSpec } from './ipc.js';
import {
  registerImportedNotesVault,
  reserveNotesVaultDirName,
} from './mythosFormat/notesVaultRegistry.js';

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
  /** SKY-11814: .docx files — story-kind imports convert these into
   *  chapters/scenes (see importObsidianToVaultDir's docxHandledByCaller
   *  option); every other caller reports them by name instead of silently
   *  dropping them. */
  docxFiles: string[];
  /** Files matching no known extension — always reported by name, never
   *  silently dropped (SKY-11814). */
  unknownFiles: string[];
}

/**
 * Recursively walk srcPath and classify every file into:
 *   - .md files (markdownFiles)
 *   - known attachment extensions (attachmentFiles)
 *   - .docx files (docxFiles)
 *   - anything else (unknownFiles)
 * Skips dotfiles, symlinks, and .obsidian metadata directories. Every file
 * lands in exactly one bucket — nothing found on disk is invisible to the
 * caller (SKY-11814: a file used to vanish silently if it matched none of
 * the first two buckets).
 */
export function collectObsidianFiles(srcPath: string, base = ''): ObsidianFileList {
  const markdownFiles: string[] = [];
  const attachmentFiles: string[] = [];
  const docxFiles: string[] = [];
  const unknownFiles: string[] = [];

  if (!fs.existsSync(srcPath)) return { markdownFiles, attachmentFiles, docxFiles, unknownFiles };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcPath, { withFileTypes: true });
  } catch {
    return { markdownFiles, attachmentFiles, docxFiles, unknownFiles };
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;

    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const sub = collectObsidianFiles(path.join(srcPath, entry.name), rel);
      markdownFiles.push(...sub.markdownFiles);
      attachmentFiles.push(...sub.attachmentFiles);
      docxFiles.push(...sub.docxFiles);
      unknownFiles.push(...sub.unknownFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.md') {
        markdownFiles.push(rel);
      } else if (OBSIDIAN_ATTACHMENT_EXTS.has(ext)) {
        attachmentFiles.push(rel);
      } else if (ext === '.docx') {
        docxFiles.push(rel);
      } else {
        unknownFiles.push(rel);
      }
    }
  }

  return { markdownFiles, attachmentFiles, docxFiles, unknownFiles };
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ObsidianImportResult {
  ok: boolean;
  targetPath: string;
  /** Total files found in the source vault (every file, whatever its type). */
  sourceCount: number;
  imported: number;
  skipped: number;
  errors: string[];
  /** Non-empty when files were not imported — names every one (SKY-11814). */
  dropWarning: string;
  /**
   * .docx files found under srcPath (absolute paths), not copied here.
   * Populated whenever `opts.docxHandledByCaller` is true, so a story-kind
   * caller can convert them into chapters/scenes without a second directory
   * walk (see createVaultFromOptions.ts).
   */
  docxFiles: string[];
}

export interface ImportObsidianOptions {
  /**
   * When true, .docx files are excluded from the skipped/dropWarning
   * accounting and returned via `docxFiles` instead — the caller (a
   * story-kind import) is responsible for converting and counting them.
   * When false/omitted, .docx files are reported like any other unsupported
   * file: named in `dropWarning`, never copied (SKY-11814).
   */
  docxHandledByCaller?: boolean;
}

/**
 * Copy all .md and attachment files from srcPath into vaultRoot,
 * preserving directory structure. Every file is copied byte-for-byte —
 * wikilinks and frontmatter are never rewritten (SKY-10383: "notes, folders
 * and [[links]] come across as-is"). Bare-stem `[[name]]` links resolve at
 * read time via noteBacklinks.ts; ambiguous or unresolvable links stay
 * verbatim in the note, exactly as Obsidian left them.
 *
 * Every other file found (unrecognized extensions, and .docx unless
 * `opts.docxHandledByCaller`) is named in `dropWarning` rather than silently
 * dropped (SKY-11814 — a Word manuscript or any other unsupported file used
 * to vanish with zero user-facing feedback).
 *
 * Returns stats; does NOT update the manifest (caller's responsibility).
 */
export function importObsidianToVaultDir(
  srcPath: string,
  vaultRoot: string,
  opts: ImportObsidianOptions = {},
): ObsidianImportResult {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!fs.existsSync(srcPath)) {
    return { ok: false, targetPath: vaultRoot, sourceCount: 0, imported: 0, skipped: 0, errors: [`Source path does not exist: ${srcPath}`], dropWarning: '', docxFiles: [] };
  }

  let realSrc: string;
  try {
    realSrc = fs.realpathSync.native(srcPath);
  } catch {
    return { ok: false, targetPath: vaultRoot, sourceCount: 0, imported: 0, skipped: 0, errors: [`Cannot resolve source path: ${srcPath}`], dropWarning: '', docxFiles: [] };
  }

  const { markdownFiles, attachmentFiles, docxFiles, unknownFiles } = collectObsidianFiles(realSrc);
  const sourceCount = markdownFiles.length + attachmentFiles.length + docxFiles.length + unknownFiles.length;

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

  const skippedNames = opts.docxHandledByCaller ? [...unknownFiles] : [...docxFiles, ...unknownFiles];
  const dropWarning =
    skippedNames.length > 0
      ? `${skippedNames.length} file(s) were not imported (unsupported type): ` +
        `${skippedNames.slice(0, 5).join(', ')}${skippedNames.length > 5 ? `, +${skippedNames.length - 5} more` : ''}`
      : '';

  return {
    ok: errors.length === 0 || imported > 0,
    targetPath: vaultRoot,
    sourceCount,
    imported,
    skipped,
    errors,
    dropWarning,
    docxFiles: opts.docxHandledByCaller ? docxFiles.map((rel) => path.join(realSrc, rel)) : [],
  };
}

// ─── SKY-11058 item 4: import as an ADDITIONAL notes vault ──────────────────

export interface ExtraNotesVaultImportResult {
  ok: boolean;
  error?: string;
  /** Registry id of the newly registered notes vault. */
  vaultId?: string;
  /** User-visible label (source folder basename). */
  displayName?: string;
  /** Directory name created directly inside mythosRoot. */
  dirName?: string;
  sourceCount?: number;
  imported?: number;
  skipped?: number;
  dropWarning?: string;
}

/**
 * SKY-11058 item 4 (owner ruling): copy an Obsidian folder's files verbatim
 * into a NEW directory inside the currently-open Mythos vault root and
 * register it as an additional notes vault. Bare [[stem]] wikilinks stay
 * byte-for-byte untouched (same rule as importObsidianToVaultDir), the
 * source is never mutated, and the imported vault does NOT become active —
 * registerImportedNotesVault never changes activeId; the picker surfaces the
 * new entry via the notesVaultRegistry:changed push instead.
 */
export function importObsidianAsExtraNotesVault(
  mythosRoot: string,
  targets: ObsidianImportTargetSpec[],
): ExtraNotesVaultImportResult {
  if (targets.length !== 1 || targets[0].kind !== 'notes') {
    return { ok: false, error: 'Adding a notes vault accepts exactly one notes-kind source folder' };
  }
  const srcPath = targets[0].srcPath;
  if (!fs.existsSync(srcPath)) {
    return { ok: false, error: `Source path does not exist: ${srcPath}` };
  }
  let realSrc: string;
  try {
    realSrc = fs.realpathSync.native(srcPath);
  } catch {
    return { ok: false, error: `Cannot resolve source path: ${srcPath}` };
  }
  if (!fs.statSync(realSrc).isDirectory()) {
    return { ok: false, error: `Not a directory: ${srcPath}` };
  }

  // Name the vault after the source folder; reserve a collision-free dir
  // name against the registry BEFORE copying anything into place.
  const displayName = path.basename(realSrc) || 'Imported Notes';
  const dirName = reserveNotesVaultDirName(mythosRoot, displayName);
  const destDir = path.join(mythosRoot, dirName);
  fs.mkdirSync(destDir, { recursive: true });

  const copy = importObsidianToVaultDir(realSrc, destDir);
  if (copy.errors.length > 0) {
    // Copy failed — don't register a broken vault. Partial copies stay on
    // disk (same policy as the new-Mythos-vault path) but the unregistered
    // directory is invisible to the app.
    return {
      ok: false,
      error: copy.errors.join('; '),
      sourceCount: copy.sourceCount,
      imported: copy.imported,
      skipped: copy.skipped,
    };
  }

  const { entry } = registerImportedNotesVault(mythosRoot, dirName, displayName);
  return {
    ok: true,
    vaultId: entry.id,
    displayName: entry.displayName,
    dirName: entry.dirName,
    sourceCount: copy.sourceCount,
    imported: copy.imported,
    skipped: copy.skipped,
    dropWarning: copy.dropWarning || undefined,
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
