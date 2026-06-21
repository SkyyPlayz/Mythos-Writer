// SKY-2993: Obsidian vault import — pure helpers (no Electron imports).
// Implements importObsidianVault and dryRunObsidianImport for the onboarding IPC layer.
//
// Design: reuses collectMarkdownFiles-style traversal from vault.ts but adds:
//   - attachment file collection (.png, .jpg, etc.)
//   - wikilink resolution [[name]] → [[relative/path/to/name]] (best-effort)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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

// ─── Wikilink resolution ──────────────────────────────────────────────────────

/**
 * Build a name→relative-path index from a list of relative .md paths.
 * Key: lowercased filename stem. Value: first matching relative path.
 * When multiple files share the same stem, the first wins (Obsidian behaviour).
 */
export function buildWikilinkIndex(markdownFiles: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const rel of markdownFiles) {
    const stem = path.basename(rel, '.md').toLowerCase();
    if (!index.has(stem)) index.set(stem, rel);
  }
  return index;
}

const WIKI_LINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]]*)?\]\]/g;

/**
 * Expand short Obsidian wikilinks `[[name]]` to `[[relative/path/to/name]]`
 * when the name is unambiguous (exists in the index).
 * Links that already contain a `/` are left as-is (already qualified).
 * Links not found in the index are left as-is.
 */
export function resolveWikilinks(content: string, index: Map<string, string>): string {
  return content.replace(WIKI_LINK_RE, (match, target: string) => {
    const trimmed = target.trim();
    if (trimmed.includes('/')) return match; // already a path — don't touch
    const resolved = index.get(trimmed.toLowerCase());
    if (!resolved) return match;
    // Strip the .md extension from the resolved path (wikilink convention)
    const withoutExt = resolved.endsWith('.md') ? resolved.slice(0, -3) : resolved;
    // Preserve alias/anchor from original if present
    const extras = match.slice(2 + trimmed.length, -2); // e.g. "|Alias" or "#Heading"
    return `[[${withoutExt}${extras}]]`;
  });
}

// ─── Strip Obsidian-specific metadata ────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Remove Obsidian-only frontmatter keys that don't make sense in Mythos.
 * Keys removed: `tags` is preserved (Mythos uses it); `cssclass`, `aliases`,
 * `publish`, `uid` are stripped. `id` is preserved or generated if absent.
 */
export function processObsidianFrontmatter(
  content: string,
  fallbackTitle: string,
): string {
  const OBSIDIAN_ONLY_KEYS = new Set(['cssclass', 'aliases', 'publish', 'uid']);

  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    // No frontmatter — inject minimal one with a fresh id
    const id = crypto.randomUUID();
    return `---\nid: ${id}\ntitle: ${JSON.stringify(fallbackTitle)}\n---\n${content}`;
  }

  const fmBlock = match[1];
  const prose = content.slice(match[0].length);

  const filteredLines = fmBlock
    .split('\n')
    .filter((line) => {
      const key = line.split(':')[0]?.trim();
      return !OBSIDIAN_ONLY_KEYS.has(key ?? '');
    });

  // Ensure `id` is present
  const hasId = filteredLines.some((l) => l.startsWith('id:'));
  if (!hasId) {
    filteredLines.unshift(`id: ${crypto.randomUUID()}`);
  }

  return `---\n${filteredLines.join('\n')}\n---\n${prose}`;
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ObsidianImportResult {
  ok: boolean;
  targetPath: string;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Copy all .md and attachment files from srcPath into vaultRoot,
 * preserving directory structure. Resolves wikilinks in .md files.
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
    return { ok: false, targetPath: vaultRoot, imported: 0, skipped: 0, errors: [`Source path does not exist: ${srcPath}`] };
  }

  let realSrc: string;
  try {
    realSrc = fs.realpathSync.native(srcPath);
  } catch {
    return { ok: false, targetPath: vaultRoot, imported: 0, skipped: 0, errors: [`Cannot resolve source path: ${srcPath}`] };
  }

  const { markdownFiles, attachmentFiles } = collectObsidianFiles(realSrc);
  const wikilinkIndex = buildWikilinkIndex(markdownFiles);
  const allFiles: Array<{ rel: string; isMarkdown: boolean }> = [
    ...markdownFiles.map((rel) => ({ rel, isMarkdown: true })),
    ...attachmentFiles.map((rel) => ({ rel, isMarkdown: false })),
  ];

  for (const { rel, isMarkdown } of allFiles) {
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

      if (isMarkdown) {
        const raw = fs.readFileSync(srcFull, 'utf-8');
        const fallbackTitle = path.basename(rel, '.md');
        const processed = processObsidianFrontmatter(
          resolveWikilinks(raw, wikilinkIndex),
          fallbackTitle,
        );
        fs.writeFileSync(dstFull, processed, 'utf-8');
      } else {
        fs.copyFileSync(srcFull, dstFull);
      }

      imported++;
    } catch (err) {
      errors.push(`${rel}: ${(err as Error).message}`);
    }
  }

  return {
    ok: errors.length === 0 || imported > 0,
    targetPath: vaultRoot,
    imported,
    skipped,
    errors,
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
