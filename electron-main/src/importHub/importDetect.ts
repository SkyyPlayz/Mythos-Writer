// #1765 — Import hub source detection. Runs only on a path importSafety has
// already cleared; picks which importer builds the plan.
//
// Files: by extension, confirmed by content (a .docx must be a Word ZIP, an
// .rtf must start with `{\rtf`, text kinds must not be binary). A ZIP whose
// name disagrees with its content gets a "rename it" error instead of a guess.
// Folders: a `.scriv` bundle or a folder holding a `.scrivx` is Scrivener;
// otherwise any folder with Markdown/text files (depth ≤ 4, hidden and tool
// folders skipped) is a Markdown folder.
//
// Pure Node — no Electron.

import fs from 'node:fs';
import path from 'node:path';
import type { ImportSourceKind } from './types.js';
import type { AssessedImportPath } from './importSafety.js';
import { isGoogleDocsHtml } from './htmlBlocks.js';

export type ImportDetection = { ok: true; kind: ImportSourceKind } | { ok: false; error: string };

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);
const TEXT_EXTENSIONS = new Set(['txt', 'text']);
/** Files that make a folder a Markdown folder. */
const FOLDER_NOTE_EXTENSIONS = new Set([...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS]);
const SKIPPED_DIRS = new Set(['.obsidian', '.git', 'node_modules', '.trash']);
export const MARKDOWN_FOLDER_MAX_DEPTH = 4;
/** Directory entries examined before giving up on a huge tree. */
const FOLDER_SCAN_MAX_ENTRIES = 20000;

const ZIP_KIND_LABEL: Record<'docx' | 'epub', { label: string; ext: string }> = {
  docx: { label: 'a Word document', ext: '.docx' },
  epub: { label: 'an ePub book', ext: '.epub' },
};

function extOf(name: string): string {
  return path.extname(name).replace(/^\./, '').toLowerCase();
}

/** 'utf-16le' / 'utf-16be' when the head starts with a UTF-16 byte-order mark. */
function utf16Bom(head: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * A NUL byte in the first 4 KB means binary, not text — except in UTF-16 text
 * (Word's "Plain Text → Unicode", older Notepad "Unicode"), which is full of
 * NULs and announces itself with a BOM. The readers decode it by that BOM.
 */
function looksBinary(head: Buffer): boolean {
  if (utf16Bom(head)) return false;
  return head.includes(0);
}

function isScrivxName(name: string): boolean {
  return extOf(name) === 'scrivx';
}

function detectDirectory(assessed: AssessedImportPath): ImportDetection {
  if (/\.scriv$/i.test(assessed.name)) return { ok: true, kind: 'scrivener' };
  let top: fs.Dirent[];
  try {
    top = fs.readdirSync(assessed.realPath, { withFileTypes: true });
  } catch {
    return { ok: false, error: 'Mythos couldn\'t open that folder. Check that you can open it, then try again.' };
  }
  if (top.some((e) => e.isFile() && isScrivxName(e.name))) return { ok: true, kind: 'scrivener' };

  // Breadth-first so a shallow Markdown file is found without walking deep trees.
  let seen = 0;
  let level: Array<{ abs: string; entries?: fs.Dirent[] }> = [{ abs: assessed.realPath, entries: top }];
  for (let depth = 0; depth <= MARKDOWN_FOLDER_MAX_DEPTH && level.length > 0; depth++) {
    const next: Array<{ abs: string }> = [];
    for (const dir of level) {
      let entries = dir.entries;
      if (!entries) {
        try {
          entries = fs.readdirSync(dir.abs, { withFileTypes: true });
        } catch {
          continue;
        }
      }
      for (const entry of entries) {
        if (++seen > FOLDER_SCAN_MAX_ENTRIES) break;
        // Dirent.isDirectory() is false for symlinks, so links are never followed.
        if (entry.isFile() && FOLDER_NOTE_EXTENSIONS.has(extOf(entry.name))) {
          return { ok: true, kind: 'markdown-folder' };
        }
        if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) {
          next.push({ abs: path.join(dir.abs, entry.name) });
        }
      }
    }
    level = next;
  }
  return { ok: false, error: 'This folder has no Markdown or Scrivener files Mythos can read.' };
}

function readWholeText(realPath: string): string | null {
  try {
    const buf = fs.readFileSync(realPath);
    const bom = utf16Bom(buf);
    if (bom) return new TextDecoder(bom).decode(buf.subarray(2));
    return new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

/** Decide which importer handles an already-assessed path. Never throws. */
export function detectImportSource(assessed: AssessedImportPath): ImportDetection {
  if (assessed.isDirectory) return detectDirectory(assessed);

  const ext = assessed.ext || extOf(assessed.name);
  if (assessed.size === 0) return { ok: false, error: 'This file is empty — there\'s nothing to import.' };

  // ZIP content wins over a mismatched name: tell the writer, don't guess.
  if (assessed.zip) {
    const zipKind = assessed.zip.kind;
    if (zipKind === ext) return { ok: true, kind: zipKind };
    const want = ZIP_KIND_LABEL[zipKind];
    return {
      ok: false,
      error: `This file's name ends in .${ext || '(nothing)'} but it is really ${want.label}. Rename it to end in ${want.ext} and import it again.`,
    };
  }
  if (ext === 'docx') {
    return { ok: false, error: 'This .docx file isn\'t a Word document Mythos can read — it may be damaged.' };
  }
  if (ext === 'epub') {
    return { ok: false, error: 'This .epub file isn\'t an ePub book Mythos can read — it may be damaged.' };
  }

  if (ext === 'rtf') {
    const start = assessed.head.toString('latin1', 0, 16).replace(/^\uFEFF|^\xEF\xBB\xBF/, '').trimStart();
    if (start.startsWith('{\\rtf')) return { ok: true, kind: 'rtf' };
    return { ok: false, error: 'This .rtf file doesn\'t look like Rich Text — it may be damaged or misnamed.' };
  }

  if (looksBinary(assessed.head)) {
    return { ok: false, error: `This .${ext} file doesn't look like text — it may be damaged or misnamed.` };
  }

  if (ext === 'html' || ext === 'htm') {
    const html = readWholeText(assessed.realPath);
    if (html === null) return { ok: false, error: 'Mythos couldn\'t open that file. Try again.' };
    return { ok: true, kind: isGoogleDocsHtml(html) ? 'gdoc-html' : 'html' };
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) return { ok: true, kind: 'markdown' };
  if (TEXT_EXTENSIONS.has(ext)) return { ok: true, kind: 'text' };
  if (ext === 'scrivx') {
    const start = assessed.head.toString('utf8', 0, 64).replace(/^\uFEFF/, '').trimStart();
    if (start.startsWith('<')) return { ok: true, kind: 'scrivener' };
    return { ok: false, error: 'This .scrivx file doesn\'t look like a Scrivener project — it may be damaged.' };
  }
  return { ok: false, error: `Mythos can't read .${ext} files yet.` };
}
