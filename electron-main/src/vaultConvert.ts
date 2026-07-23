// Beta 3 "Liquid Neon" M24 — Import another vault (Settings → Vault & Files).
// docs/releases/BETA-LIQUID-NEON.md §M24: Obsidian is native — Notion,
// Scrivener and plain Markdown convert on the way in. Destination is either a
// second vault folder inside the current Notes Vault, or its own new folder.
//
// Obsidian + plain Markdown trees reuse the Beta-2 importer
// (obsidianImporter.ts) verbatim; Notion exports get their 32-hex id suffixes
// stripped and inline links rewritten to wiki links; Scrivener projects
// convert binder text documents to markdown notes.

import fs from 'fs';
import path from 'path';
import {
  collectObsidianFiles,
  dryRunObsidianImport,
  importObsidianToVaultDir,
  MAX_IMPORT_FILE_BYTES,
  type ObsidianImportResult,
} from './obsidianImporter.js';
import { parseScrivxBinder, rtfToText, type ScrivBinderItem } from './storyImport.js';

export type VaultImportKind = 'obsidian' | 'notion' | 'scriv' | 'markdown';

export const VAULT_IMPORT_KIND_LABELS: Record<VaultImportKind, string> = {
  obsidian: 'Obsidian',
  notion: 'Notion',
  scriv: 'Scrivener',
  markdown: 'Markdown',
};

// ─── Notion export helpers ────────────────────────────────────────────────────

/** Trailing Notion page id: ` 0123456789abcdef0123456789abcdef` (32 hex). */
const NOTION_SUFFIX_RE = /\s+[0-9a-f]{32}$/i;

/** Strip the Notion export id suffix from one file/folder name (keeps ext). */
export function stripNotionSuffix(name: string): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  const stripped = stem.replace(NOTION_SUFFIX_RE, '').trim();
  return `${stripped || stem}${ext}`;
}

/** Apply stripNotionSuffix to every segment of a relative path. */
export function notionTargetRel(rel: string): string {
  return rel.split('/').map(stripNotionSuffix).join('/');
}

/**
 * Rewrite Notion inline markdown links to wiki links:
 * `[Label](Some%20Page%20<32hex>.md)` → `[[Some Page|Label]]`.
 * External links and non-md targets are left untouched.
 */
export function rewriteNotionLinks(content: string): string {
  return content.replace(/\[([^\]\n]*)\]\(([^)\n]+)\)/g, (match, label: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return match; // http:, mailto:, …
    let decoded: string;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      return match;
    }
    if (!decoded.toLowerCase().endsWith('.md')) return match;
    const cleaned = notionTargetRel(decoded.replace(/\\/g, '/')).replace(/\.md$/i, '');
    const stem = cleaned.split('/').pop() ?? cleaned;
    if (!stem) return match;
    return label && label !== stem ? `[[${stem}|${label}]]` : `[[${stem}]]`;
  });
}

// ─── Scan (dry-run) ───────────────────────────────────────────────────────────

export interface VaultImportScan {
  kind: VaultImportKind;
  noteCount: number;
  attachmentCount: number;
  totalFiles: number;
  sampleFiles: string[];
  warnings: string[];
}

function collectNotionFiles(srcPath: string): { notes: string[]; attachments: string[]; csv: string[] } {
  const { markdownFiles, attachmentFiles } = collectObsidianFiles(srcPath);
  const csv: string[] = [];
  const walk = (dir: string, base = ''): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.csv')) csv.push(rel);
    }
  };
  walk(srcPath);
  return { notes: markdownFiles, attachments: attachmentFiles, csv };
}

function findScrivx(srcPath: string): { projDir: string; scrivxPath?: string } {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    const scrivx = fs.readdirSync(srcPath).find((f) => f.toLowerCase().endsWith('.scrivx'));
    return { projDir: srcPath, scrivxPath: scrivx ? path.join(srcPath, scrivx) : undefined };
  }
  return {
    projDir: path.dirname(srcPath),
    scrivxPath: srcPath.toLowerCase().endsWith('.scrivx') ? srcPath : undefined,
  };
}

function countScrivDocs(items: ScrivBinderItem[]): { texts: number; sample: string[] } {
  let texts = 0;
  const sample: string[] = [];
  const walk = (list: ScrivBinderItem[]): void => {
    for (const item of list) {
      if (item.type === 'Text') {
        texts++;
        if (sample.length < 5) sample.push(item.title || 'Untitled');
      }
      walk(item.children);
    }
  };
  walk(items);
  return { texts, sample };
}

/** Read-only scan of the import source — nothing is written. */
export function scanVaultSource(kind: VaultImportKind, srcPath: string): VaultImportScan | { error: string } {
  if (!fs.existsSync(srcPath)) return { error: `Path does not exist: ${srcPath}` };

  if (kind === 'obsidian' || kind === 'markdown') {
    const preview = dryRunObsidianImport(srcPath);
    if ('error' in preview) return preview;
    return {
      kind,
      noteCount: preview.markdownCount,
      attachmentCount: preview.attachmentCount,
      totalFiles: preview.totalFiles,
      sampleFiles: preview.sampleFiles,
      warnings: [],
    };
  }

  if (kind === 'notion') {
    if (!fs.statSync(srcPath).isDirectory()) return { error: `Not a directory: ${srcPath}` };
    const { notes, attachments, csv } = collectNotionFiles(srcPath);
    const warnings: string[] = [];
    if (csv.length > 0) warnings.push(`${csv.length} CSV database export(s) will be skipped`);
    return {
      kind,
      noteCount: notes.length,
      attachmentCount: attachments.length,
      totalFiles: notes.length + attachments.length,
      sampleFiles: notes.slice(0, 5).map(notionTargetRel),
      warnings,
    };
  }

  // Scrivener
  try {
    const { projDir, scrivxPath } = findScrivx(srcPath);
    if (!scrivxPath) {
      return { error: 'No .scrivx file found — pick the .scrivx inside your Scrivener project' };
    }
    const binder = parseScrivxBinder(fs.readFileSync(scrivxPath, 'utf-8'));
    const { texts, sample } = countScrivDocs(binder);
    if (texts === 0) return { error: 'The Scrivener binder contains no text documents' };
    void projDir;
    return {
      kind,
      noteCount: texts,
      attachmentCount: 0,
      totalFiles: texts,
      sampleFiles: sample,
      warnings: ['Rich-text formatting converts to plain markdown'],
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Convert / import ─────────────────────────────────────────────────────────

export interface VaultImportRunResult {
  ok: boolean;
  targetPath: string;
  imported: number;
  skipped: number;
  errors: string[];
  /** Total files found in the source vault, when the source kind reports it. */
  sourceCount?: number;
  /** Non-empty when files were silently dropped (not imported, not errored). */
  dropWarning?: string;
}

/** Safe markdown filename for a converted note title. */
function noteFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe || 'Untitled'}.md`;
}

function importNotionExport(srcPath: string, dstDir: string): VaultImportRunResult {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  const { notes, attachments } = collectNotionFiles(srcPath);

  for (const rel of [...notes, ...attachments]) {
    const isMd = rel.toLowerCase().endsWith('.md');
    try {
      const srcFull = path.join(srcPath, rel);
      const dstFull = path.join(dstDir, notionTargetRel(rel));
      if (fs.existsSync(dstFull)) {
        skipped++;
        continue;
      }
      if (fs.statSync(srcFull).size > MAX_IMPORT_FILE_BYTES) {
        errors.push(`${rel}: file too large`);
        continue;
      }
      fs.mkdirSync(path.dirname(dstFull), { recursive: true });
      if (isMd) {
        const raw = fs.readFileSync(srcFull, 'utf-8');
        fs.writeFileSync(dstFull, rewriteNotionLinks(raw), 'utf-8');
      } else {
        fs.copyFileSync(srcFull, dstFull);
      }
      imported++;
    } catch (err) {
      errors.push(`${rel}: ${(err as Error).message}`);
    }
  }

  return { ok: errors.length === 0 || imported > 0, targetPath: dstDir, imported, skipped, errors };
}

function importScrivProject(srcPath: string, dstDir: string): VaultImportRunResult {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const { projDir, scrivxPath } = findScrivx(srcPath);
  if (!scrivxPath) {
    return { ok: false, targetPath: dstDir, imported: 0, skipped: 0, errors: ['No .scrivx file found'] };
  }

  const binder = parseScrivxBinder(fs.readFileSync(scrivxPath, 'utf-8'));

  const writeItem = (item: ScrivBinderItem, relDir: string): void => {
    if (item.type === 'Text') {
      let text = '';
      try {
        text = rtfToText(fs.readFileSync(path.join(projDir, 'Files', 'Data', item.uuid, 'content.rtf'), 'utf-8'));
      } catch {
        // Text item without content — still create the note shell.
      }
      const dstFull = path.join(dstDir, relDir, noteFileName(item.title || 'Untitled'));
      try {
        if (fs.existsSync(dstFull)) {
          skipped++;
        } else {
          fs.mkdirSync(path.dirname(dstFull), { recursive: true });
          fs.writeFileSync(dstFull, `# ${item.title || 'Untitled'}\n\n${text}\n`, 'utf-8');
          imported++;
        }
      } catch (err) {
        errors.push(`${item.title}: ${(err as Error).message}`);
      }
    }
    const childDir = item.type === 'Text'
      ? relDir
      : path.join(relDir, noteFileName(item.title || item.type || 'Folder').replace(/\.md$/, ''));
    for (const child of item.children) writeItem(child, childDir);
  };

  for (const item of binder) writeItem(item, '');
  return { ok: errors.length === 0 || imported > 0, targetPath: dstDir, imported, skipped, errors };
}

/**
 * Import a vault source into `dstDir` (created if missing). Obsidian and plain
 * Markdown trees route through the Beta-2 Obsidian importer unchanged.
 */
export function convertVaultSource(
  kind: VaultImportKind,
  srcPath: string,
  dstDir: string,
): VaultImportRunResult {
  fs.mkdirSync(dstDir, { recursive: true });
  if (kind === 'obsidian' || kind === 'markdown') {
    const res: ObsidianImportResult = importObsidianToVaultDir(srcPath, dstDir);
    return {
      ok: res.ok,
      targetPath: dstDir,
      imported: res.imported,
      skipped: res.skipped,
      errors: res.errors,
      sourceCount: res.sourceCount,
      dropWarning: res.dropWarning || undefined,
    };
  }
  if (kind === 'notion') return importNotionExport(srcPath, dstDir);
  return importScrivProject(srcPath, dstDir);
}

/** Pick a non-clobbering destination folder name for "second vault" imports. */
export function secondVaultDestination(notesVaultRoot: string, srcPath: string): string {
  const base = path.basename(srcPath).replace(/\.(scriv|scrivx)$/i, '').trim() || 'Imported Vault';
  const parent = path.join(notesVaultRoot, 'Imported');
  let candidate = path.join(parent, base);
  let n = 2;
  while (fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0) {
    candidate = path.join(parent, `${base} ${n}`);
    n++;
  }
  return candidate;
}
