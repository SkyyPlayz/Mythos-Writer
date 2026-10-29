// #1765 — Import hub safety gate. Every dropped or picked path passes through
// assessImportPath() before any importer sees a byte of it.
//
// Order: path shape → realpath → deny-listed extension (refused, never read)
// → stat → size cap → 4 KB content sniff (executables, scripts, old OLE
// Office files) → for ZIP containers, a bounded central-directory scan
// (entry/size caps, macro parts, non-document archives) → unknown extension.
//
// UNKNOWN-BUT-SAFE FALLBACK (owner decision, #1765): a file whose extension is
// neither deny-listed nor one Mythos imports, and whose content passes the
// sniff, is NOT guessed at as plain text. It returns refused:false with
// "Mythos can't read .xyz files yet. You can import …". Guessing would turn
// binary formats (.pages, .odt, .numbers …) into pages of garbage scenes.
//
// The ZIP scan is a small hand-written central-directory reader rather than
// JSZip: assessImportPath is synchronous, and reading the directory ourselves
// lets the caps apply before anything is inflated. Only [Content_Types].xml and
// the ePub `mimetype` entry are ever inflated here, each capped at 1 MB.
//
// Pure Node — no Electron.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { STORY_IMPORT_MAX_BYTES } from '../storyImport.js';

/**
 * Extensions Mythos never parses: programs, installers, scripts, shortcuts,
 * macro-enabled Office files, disk images and libraries. Matched against the
 * final extension, case-insensitively, after trailing dots/spaces are stripped.
 */
export const DENIED_IMPORT_EXTENSIONS: readonly string[] = Object.freeze([
  'exe', 'msi', 'msix', 'msp', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'msc',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta',
  'jar', 'py', 'pyw', 'pyc', 'rb', 'pl', 'php', 'sh', 'bash', 'zsh', 'fish', 'csh', 'ksh',
  'command', 'tool', 'app', 'action', 'workflow', 'applescript', 'scpt', 'dmg', 'pkg',
  'mpkg', 'deb', 'rpm', 'apk', 'aab', 'appimage', 'snap', 'flatpak', 'run', 'bin', 'elf',
  'dll', 'so', 'dylib', 'sys', 'drv', 'ocx', 'lnk', 'url', 'webloc', 'desktop', 'reg',
  'inf', 'iso', 'img', 'vhd', 'vhdx', 'vmdk', 'docm', 'dotm', 'xlsm', 'xltm', 'xlam',
  'pptm', 'potm', 'ppsm', 'ppam', 'sldm', 'xll', 'chm', 'gadget', 'ins', 'isp', 'jnlp',
  'msh', 'mst', 'ops', 'scf', 'shb', 'shs', 'vb', 'ws', 'xbap',
]);

/** Extensions the import hub reads (also the file picker's filter list). */
export const SUPPORTED_IMPORT_EXTENSIONS: readonly string[] = Object.freeze([
  'docx', 'html', 'htm', 'md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'rtf', 'epub', 'scrivx',
]);

const DENIED = new Set(DENIED_IMPORT_EXTENSIONS);
const SUPPORTED = new Set(SUPPORTED_IMPORT_EXTENSIONS);

/** ZIP containers: refuse before inflating anything past these. */
export const ZIP_MAX_ENTRIES = 5000;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const ZIP_CONTROL_ENTRY_MAX_BYTES = 1024 * 1024;

/** Bytes read for the content sniff. */
export const SNIFF_BYTES = 4096;

const SUPPORTED_LIST_SENTENCE =
  'You can import Word (.docx), Google Docs exports, Markdown, Scrivener, ePub, RTF or plain text.';

/** What a ZIP-based file turned out to be (set only when the head is a ZIP). */
export interface ZipSummary {
  kind: 'docx' | 'epub';
  entryCount: number;
  uncompressedBytes: number;
}

export interface AssessedImportPath {
  ok: true;
  realPath: string;
  /** Basename of the real path — the only part of the path shown to the user. */
  name: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  /** First 4 KB for files, empty for directories. */
  head: Buffer;
  /** Final extension, lower-case, no dot ('' when none or for directories without one). */
  ext: string;
  /** Present for ZIP-based files (.docx / .epub) that passed the container scan. */
  zip?: ZipSummary;
}

export type ImportPathRejection = { ok: false; refused: boolean; reason: string; name?: string };

export type ImportPathAssessment = AssessedImportPath | ImportPathRejection;

export interface AssessImportPathOptions {
  maxFileBytes?: number;
  /** Path rules to apply (defaults to process.platform) — lets tests cover win32 rules. */
  platform?: NodeJS.Platform;
}

// Invisible format characters (zero-width, bidi overrides, BOM) that can hide
// a real extension from the eye ("story\u202Excod.exe").
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Lower-case final extension of a basename, ignoring trailing dots/spaces. '' when none. */
export function finalExtension(name: string): string {
  const cleaned = name.replace(INVISIBLE_CHARS, '').replace(/[. ]+$/, '');
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0) return '';
  return cleaned.slice(dot + 1).trim().toLowerCase();
}

/** Deny-list / support classification of a file name by its final extension. */
export function classifyExtension(name: string): 'denied' | 'supported' | 'unknown' {
  const ext = finalExtension(name);
  if (!ext) return 'unknown';
  if (DENIED.has(ext)) return 'denied';
  if (SUPPORTED.has(ext)) return 'supported';
  return 'unknown';
}

function error(reason: string, name?: string): ImportPathRejection {
  return { ok: false, refused: false, reason, ...(name ? { name } : {}) };
}

function refuse(reason: string, name?: string): ImportPathRejection {
  return { ok: false, refused: true, reason, ...(name ? { name } : {}) };
}

function basenameAny(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function deniedReason(ext: string): string {
  return `Mythos never opens .${ext} files — they can run code on your computer. Import a document instead (Word, Markdown, ePub, RTF or plain text).`;
}

/** Shape checks on the raw renderer-supplied string; returns an error or null. */
function checkPathShape(input: string, platform: NodeJS.Platform): string | null {
  if (input.includes('\0')) return 'That path has an invalid character in it.';
  const win = platform === 'win32';
  if (/^[\\/]{2}[?.][\\/]/.test(input)) {
    return 'Mythos can\'t import from a device path. Pick the file from a normal folder.';
  }
  if (win && /^[\\/]{2}/.test(input)) {
    return 'Mythos can\'t import straight from a network path. Copy the file to this computer first.';
  }
  const isAbs = win ? path.win32.isAbsolute(input) : path.posix.isAbsolute(input);
  if (!isAbs || (win && !/^[A-Za-z]:[\\/]/.test(input))) {
    return 'Mythos needs the full location of the file. Drop it again or use the Pick button.';
  }
  // NTFS alternate data streams: any ':' after the drive spec ("C:\a\b.docx:evil").
  if (win && input.indexOf(':', 2) !== -1) {
    return 'That path points inside a file\'s hidden data stream. Pick the file itself.';
  }
  return null;
}

// ─── ZIP container scan ──────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

class ZipScanError extends Error {
  constructor(readonly kindOf: 'damaged' | 'too-large') {
    super(kindOf);
  }
}

function readU64(buf: Buffer, off: number): number {
  const v = buf.readBigUInt64LE(off);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipScanError('too-large');
  return Number(v);
}

function need(buf: Buffer, off: number, len: number): void {
  if (off < 0 || len < 0 || off + len > buf.length) throw new ZipScanError('damaged');
}

/** Read the central directory, enforcing the entry and claimed-size caps. */
function readZipDirectory(buf: Buffer): ZipEntry[] {
  // End of central directory: 22 bytes + up to 64 KB comment, scanned backwards.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipScanError('damaged');
  let total = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64: locator sits right before the classic record.
    const loc = eocd - 20;
    need(buf, loc, 20);
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new ZipScanError('damaged');
    const z64 = readU64(buf, loc + 8);
    need(buf, z64, 56);
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new ZipScanError('damaged');
    total = readU64(buf, z64 + 32);
    cdSize = readU64(buf, z64 + 40);
    cdOffset = readU64(buf, z64 + 48);
  }
  if (total > ZIP_MAX_ENTRIES) throw new ZipScanError('too-large');
  need(buf, cdOffset, cdSize);

  const entries: ZipEntry[] = [];
  let claimed = 0;
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    need(buf, p, 46);
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipScanError('damaged');
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    need(buf, p + 46, nameLen + extraLen + commentLen);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      // ZIP64 extra field (id 0x0001) carries the real values, in this order.
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = buf.readUInt16LE(x);
        const len = buf.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let f = x + 4;
          const fEnd = f + len;
          if (uncompressedSize === 0xffffffff && f + 8 <= fEnd) { uncompressedSize = readU64(buf, f); f += 8; }
          if (compressedSize === 0xffffffff && f + 8 <= fEnd) { compressedSize = readU64(buf, f); f += 8; }
          if (localOffset === 0xffffffff && f + 8 <= fEnd) { localOffset = readU64(buf, f); }
          break;
        }
        x += 4 + len;
      }
    }
    claimed += uncompressedSize;
    if (claimed > ZIP_MAX_UNCOMPRESSED_BYTES) throw new ZipScanError('too-large');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one small control entry ([Content_Types].xml, mimetype). Null when unreadable. */
function readZipEntryText(buf: Buffer, entry: ZipEntry): string | null {
  if (entry.uncompressedSize > ZIP_CONTROL_ENTRY_MAX_BYTES) return null;
  try {
    need(buf, entry.localOffset, 30);
    if (buf.readUInt32LE(entry.localOffset) !== 0x04034b50) return null;
    const nameLen = buf.readUInt16LE(entry.localOffset + 26);
    const extraLen = buf.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLen + extraLen;
    need(buf, start, entry.compressedSize);
    const data = buf.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data.toString('utf8');
    if (entry.method === 8) {
      return zlib.inflateRawSync(data, { maxOutputLength: ZIP_CONTROL_ENTRY_MAX_BYTES }).toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

const MACRO_PART = /(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$/i;

type ZipVerdict =
  | { ok: true; summary: ZipSummary }
  | { ok: false; refused: boolean; reason: string };

function assessZip(buf: Buffer, ext: string): ZipVerdict {
  let entries: ZipEntry[];
  try {
    entries = readZipDirectory(buf);
  } catch (err) {
    if (err instanceof ZipScanError && err.kindOf === 'too-large') {
      return {
        ok: false,
        refused: true,
        reason: `This file unpacks to more than Mythos will safely open (over ${ZIP_MAX_ENTRIES.toLocaleString('en-US')} parts or ${ZIP_MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} MB). It may be damaged or unsafe.`,
      };
    }
    return { ok: false, refused: false, reason: 'This file looks damaged — Mythos couldn\'t open it.' };
  }
  const macroMessage =
    'This file contains macros, which can run code on your computer. Open it in Word, Save As a plain .docx (Word Document), then import that.';
  if (entries.some((e) => MACRO_PART.test(e.name))) return { ok: false, refused: true, reason: macroMessage };
  const contentTypes = entries.find((e) => e.name === '[Content_Types].xml');
  if (contentTypes) {
    const xml = readZipEntryText(buf, contentTypes);
    if (xml === null) {
      return { ok: false, refused: false, reason: 'This file looks damaged — Mythos couldn\'t open it.' };
    }
    if (/macroEnabled|vbaProject/i.test(xml)) return { ok: false, refused: true, reason: macroMessage };
  }
  const uncompressedBytes = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  if (entries.some((e) => e.name === 'word/document.xml')) {
    return { ok: true, summary: { kind: 'docx', entryCount: entries.length, uncompressedBytes } };
  }
  const mimetype = entries.find((e) => e.name === 'mimetype');
  if (mimetype && readZipEntryText(buf, mimetype)?.trim() === 'application/epub+zip') {
    return { ok: true, summary: { kind: 'epub', entryCount: entries.length, uncompressedBytes } };
  }
  if (ext === 'docx' || ext === 'epub') {
    return {
      ok: false,
      refused: false,
      reason: `This .${ext} file looks damaged — Mythos couldn't find the document inside it.`,
    };
  }
  return {
    ok: false,
    refused: false,
    reason: 'Mythos can\'t read .zip archives yet — unzip it first and import the file inside.',
  };
}

// ─── Content sniff ───────────────────────────────────────────────────────────

const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** True when the head is a ZIP local header / empty archive / spanned marker. */
export function isZipHead(head: Buffer): boolean {
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) return false;
  const sig = head.readUInt32LE(0);
  return sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50;
}

/** Refusal reason for a disguised program / script / OLE file, or null. */
function sniffDangerous(head: Buffer): string | null {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) {
    return 'This file is really a Windows program, not a document. Mythos won\'t open it.';
  }
  if (head.length >= 4 && head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF') {
    return 'This file is really a Linux program, not a document. Mythos won\'t open it.';
  }
  if (head.length >= 4 && MACHO_MAGICS.has(head.readUInt32BE(0))) {
    return 'This file is really a Mac program, not a document. Mythos won\'t open it.';
  }
  // A UTF-8 BOM before the shebang still runs on most shells.
  const textStart = head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  if (head.length >= textStart + 2 && head[textStart] === 0x23 && head[textStart + 1] === 0x21) {
    return 'This file is really a script that can run code, not a document. Mythos won\'t open it.';
  }
  if (head.length >= 8 && head.subarray(0, 8).equals(OLE_MAGIC)) {
    return 'Old Word .doc files can carry macros. Open it in Word and Save As .docx, then import that.';
  }
  return null;
}

function unknownExtensionReason(ext: string): string {
  return ext
    ? `Mythos can't read .${ext} files yet. ${SUPPORTED_LIST_SENTENCE}`
    : `Mythos can't read this kind of file yet. ${SUPPORTED_LIST_SENTENCE}`;
}

/**
 * Safety-check a renderer-supplied path. Never throws. A refused:true result
 * means "dangerous type — never parsed"; refused:false means unreadable,
 * unsupported or gone. Reasons are plain words and never contain the path.
 */
export function assessImportPath(inputPath: unknown, opts: AssessImportPathOptions = {}): ImportPathAssessment {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    return error('Mythos didn\'t get a file to import. Drop it again or use the Pick button.');
  }
  const platform = opts.platform ?? process.platform;
  const shapeError = checkPathShape(inputPath, platform);
  if (shapeError) return error(shapeError);
  const maxBytes = opts.maxFileBytes ?? STORY_IMPORT_MAX_BYTES;

  // Judge the name the user sees and the name it really resolves to.
  const inputName = basenameAny(inputPath);
  if (classifyExtension(inputName) === 'denied') {
    return refuse(deniedReason(finalExtension(inputName)), inputName);
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync.native(inputPath);
  } catch {
    return error('That file is no longer there. It may have been moved or renamed.', inputName || undefined);
  }
  const name = basenameAny(realPath) || inputName;
  const ext = finalExtension(name);
  if (classifyExtension(name) === 'denied') return refuse(deniedReason(ext), name);

  let st: fs.Stats;
  try {
    st = fs.statSync(realPath);
  } catch {
    return error('That file is no longer there. It may have been moved or renamed.', name);
  }

  if (st.isDirectory()) {
    return {
      ok: true,
      realPath,
      name,
      isDirectory: true,
      size: st.size,
      mtimeMs: st.mtimeMs,
      head: Buffer.alloc(0),
      ext,
    };
  }
  if (!st.isFile()) return error('That isn\'t a regular file Mythos can import.', name);
  if (st.size > maxBytes) {
    return error(
      `This file is too large to import (over ${Math.round(maxBytes / (1024 * 1024))} MB). Split it into smaller files and import them one at a time.`,
      name,
    );
  }

  let fd: number | null = null;
  try {
    fd = fs.openSync(realPath, 'r');
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > maxBytes) {
      return error('The file changed while Mythos was checking it. Drop it again.', name);
    }
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, fst.size));
    const headRead = head.length > 0 ? fs.readSync(fd, head, 0, head.length, 0) : 0;
    const sniffed = head.subarray(0, headRead);

    const danger = sniffDangerous(sniffed);
    if (danger) return refuse(danger, name);

    let zip: ZipSummary | undefined;
    if (isZipHead(sniffed)) {
      const whole = Buffer.alloc(fst.size);
      let off = 0;
      while (off < whole.length) {
        const n = fs.readSync(fd, whole, off, whole.length - off, off);
        if (n <= 0) break;
        off += n;
      }
      const verdict = assessZip(whole.subarray(0, off), ext);
      if (!verdict.ok) return { ok: false, refused: verdict.refused, reason: verdict.reason, name };
      zip = verdict.summary;
    }

    if (classifyExtension(name) === 'unknown') return error(unknownExtensionReason(ext), name);

    return {
      ok: true,
      realPath,
      name,
      isDirectory: false,
      size: fst.size,
      mtimeMs: fst.mtimeMs,
      head: Buffer.from(sniffed),
      ext,
      ...(zip ? { zip } : {}),
    };
  } catch {
    return error('Mythos couldn\'t open that file. Check that it isn\'t open in another app, then try again.', name);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore close errors */ }
    }
  }
}
