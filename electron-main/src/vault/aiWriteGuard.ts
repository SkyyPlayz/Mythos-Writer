// AI suggestion write allowlist. Manuscript paths come from the manifest.
// Plain realpath + case-fold lives only in this module.

import fs from 'fs';
import path from 'path';
import { openNoFollow } from './noFollowOpen.js';
import { safeVaultJoin } from './safeVaultJoin.js';
import { resolveManifestPath } from '../mythosFormat/mythosJson.js';
import { BOOK_FILENAME } from '../mythosFormat/bookFile.js';
import { chapterMetaPath, NOTES_VAULT_EXAMPLE_UNIVERSE_DIRS, writeVaultFileAtomicAbs } from '../vault.js';

export type AiWriteRefuseReason =
  | 'manuscript_target'
  | 'not_allowlisted'
  | 'resolve_failed'
  | 'unresolved_relation'
  | 'unknown_kind'
  | 'no_manifest';

export type AiWriteResult =
  | { ok: true; abs: string }
  | { ok: false; reason: AiWriteRefuseReason };

export interface AssertAiWritableOptions {
  /** W7: allow class C under the notes root when it does not overlap the story root. */
  classC?: { notesRoot: string; storyRoot: string };
}

const STORY_BOOK_FILES = ['Outline.md', 'Synopsis.md', BOOK_FILENAME] as const;
const CLASS_C_KINDS = new Set(
  NOTES_VAULT_EXAMPLE_UNIVERSE_DIRS.map((name) => name.toLowerCase()),
);

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\/;

interface WriteIndex {
  vaultReal: string;
  files: Set<string>;
  dirs: Set<string>;
  allow: Set<string>;
}

/**
 * Case-fold for path compare. M-B2f: folding lives only in this function.
 * Linux keeps the original case. win32 and darwin compare lowercased.
 */
function caseFold(p: string): string {
  if (process.platform === 'win32' || process.platform === 'darwin') return p.toLowerCase();
  return p;
}

function isInside(rootReal: string, candidate: string): boolean {
  const root = caseFold(rootReal);
  const cand = caseFold(candidate);
  return cand === root || cand.startsWith(root + path.sep);
}

function isErrno(err: unknown, codes: ReadonlySet<string>): boolean {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && codes.has(code);
}

const RESOLVE_FAIL_CODES = new Set(['EACCES', 'EPERM']);

/**
 * Realpath the deepest existing ancestor and require the result to stay
 * inside `vaultReal`. M-B2j: the inside() checks are the containment.
 * Returning the resolved path without them lets a manifest entry escape.
 */
export function canonicalFromRoot(vaultReal: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) return null;
  if (path.win32.isAbsolute(rel) || path.posix.isAbsolute(rel)) return null;
  if (WINDOWS_DRIVE_RE.test(rel) || UNC_RE.test(rel)) return null;

  const resolved = path.resolve(vaultReal, rel);
  let ancestor = resolved;
  const missing: string[] = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return null;
    missing.push(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync.native(ancestor);
  if (!isInside(vaultReal, realAncestor)) return null;
  const full = missing.length === 0
    ? realAncestor
    : path.join(realAncestor, ...missing.reverse());
  if (!isInside(vaultReal, full)) return null;
  return full;
}

function schemaOk(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false;
  const manifest = raw as Record<string, unknown>;
  // M-B2k: a missing array is not []. Treating it as [] would hide no_manifest.
  if (!Array.isArray(manifest.stories)) return false;
  if (!Array.isArray(manifest.scenes)) return false;
  if (!Array.isArray(manifest.entities)) return false;
  if ('chapters' in manifest && manifest.chapters != null && !Array.isArray(manifest.chapters)) {
    return false;
  }
  for (const story of manifest.stories) {
    if (!story || typeof story !== 'object') return false;
    const storyObj = story as Record<string, unknown>;
    if ('chapters' in storyObj && storyObj.chapters != null && !Array.isArray(storyObj.chapters)) {
      return false;
    }
    if ('parts' in storyObj && storyObj.parts != null && !Array.isArray(storyObj.parts)) {
      return false;
    }
    if (Array.isArray(storyObj.parts)) {
      for (const part of storyObj.parts) {
        if (!part || typeof part !== 'object') return false;
        const partObj = part as Record<string, unknown>;
        if ('chapters' in partObj && partObj.chapters != null && !Array.isArray(partObj.chapters)) {
          return false;
        }
      }
    }
    const chapters = collectChapters(storyObj);
    for (const chapter of chapters) {
      if ('scenes' in chapter && chapter.scenes != null && !Array.isArray(chapter.scenes)) {
        return false;
      }
    }
  }
  return true;
}

function collectChapters(story: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (Array.isArray(story.chapters)) {
    for (const chapter of story.chapters) {
      if (chapter && typeof chapter === 'object') out.push(chapter as Record<string, unknown>);
    }
  }
  if (Array.isArray(story.parts)) {
    for (const part of story.parts) {
      if (!part || typeof part !== 'object') continue;
      const chapters = (part as Record<string, unknown>).chapters;
      if (!Array.isArray(chapters)) continue;
      for (const chapter of chapters) {
        if (chapter && typeof chapter === 'object') out.push(chapter as Record<string, unknown>);
      }
    }
  }
  return out;
}

function bindManuscript(vaultReal: string, rel: string): string | null {
  const abs = canonicalFromRoot(vaultReal, rel);
  return abs;
}

/** Read a manifest without following a symlink or junction placed at its path. */
function readManifestText(manifestPath: string): string {
  const fd = openNoFollow(fs, manifestPath, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) throw new Error('manifest is not a regular file');
    const buf = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buf.length) {
      const n = fs.readSync(fd, buf, offset, buf.length - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    return buf.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function loadIndex(vaultRoot: string): { ok: true; index: WriteIndex } | { ok: false } {
  let vaultReal: string;
  try {
    vaultReal = fs.realpathSync.native(vaultRoot);
  } catch {
    return { ok: false };
  }
  let manifestPath: string;
  try {
    manifestPath = resolveManifestPath(vaultRoot);
  } catch {
    return { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readManifestText(manifestPath));
  } catch {
    return { ok: false };
  }
  if (!schemaOk(parsed)) return { ok: false };

  const files = new Set<string>();
  const dirs = new Set<string>();
  const allow = new Set<string>();

  const addFile = (rel: string): boolean => {
    try {
      const abs = bindManuscript(vaultReal, rel);
      if (abs === null) return false;
      files.add(caseFold(abs));
      return true;
    } catch {
      return false;
    }
  };
  const addDir = (rel: string): boolean => {
    try {
      const abs = bindManuscript(vaultReal, rel);
      if (abs === null) return false;
      dirs.add(caseFold(abs));
      return true;
    } catch {
      return false;
    }
  };

  const stories = parsed.stories as unknown[];
  for (const story of stories) {
    const storyObj = story as Record<string, unknown>;
    if (typeof storyObj.path === 'string' && storyObj.path.length > 0) {
      const storyPosix = storyObj.path.split('\\').join('/');
      for (const name of STORY_BOOK_FILES) {
        if (!addFile(path.posix.join(storyPosix, name))) return { ok: false };
      }
    }
    for (const chapter of collectChapters(storyObj)) {
      if (typeof chapter.path === 'string' && chapter.path.length > 0) {
        if (!addDir(chapter.path)) return { ok: false };
        if (!addFile(chapterMetaPath(chapter.path))) return { ok: false };
      }
      const scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
      for (const scene of scenes) {
        if (!scene || typeof scene !== 'object') return { ok: false };
        const scenePath = (scene as Record<string, unknown>).path;
        if (typeof scenePath === 'string' && scenePath.length > 0) {
          if (!addFile(scenePath)) return { ok: false };
        }
      }
    }
  }

  for (const scene of parsed.scenes as unknown[]) {
    if (!scene || typeof scene !== 'object') continue;
    const scenePath = (scene as Record<string, unknown>).path;
    if (typeof scenePath === 'string' && scenePath.length > 0) {
      if (!addFile(scenePath)) return { ok: false };
    }
  }

  if (Array.isArray(parsed.chapters)) {
    for (const chapter of parsed.chapters) {
      if (!chapter || typeof chapter !== 'object') return { ok: false };
      const chapterObj = chapter as Record<string, unknown>;
      if (typeof chapterObj.path === 'string' && chapterObj.path.length > 0) {
        if (!addDir(chapterObj.path)) return { ok: false };
        if (!addFile(chapterMetaPath(chapterObj.path))) return { ok: false };
      }
    }
  }

  for (const entity of parsed.entities as unknown[]) {
    if (!entity || typeof entity !== 'object') continue;
    const entityPath = (entity as Record<string, unknown>).path;
    if (typeof entityPath !== 'string' || entityPath.length === 0) continue;
    try {
      const abs = canonicalFromRoot(vaultReal, entityPath);
      if (abs === null) continue;
      allow.add(caseFold(abs));
    } catch {
      // Unreadable entity entry is dropped from set A. A manuscript entry
      // that throws is fatal (addFile returns false → no_manifest).
      continue;
    }
  }

  return { ok: true, index: { vaultReal, files, dirs, allow } };
}

function pathIsManuscript(abs: string, index: WriteIndex): boolean {
  const folded = caseFold(abs);
  if (index.files.has(folded)) return true;
  for (const dir of index.dirs) {
    if (folded === dir || folded.startsWith(dir + path.sep)) return true;
  }
  return false;
}

function isEntityTreeFile(vaultReal: string, abs: string): boolean {
  const rel = path.relative(vaultReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep).filter((part) => part.length > 0);
  if (parts.length !== 3) return false;
  if (caseFold(parts[0]) !== caseFold('entities')) return false;
  if (parts[1] === '.' || parts[1] === '..') return false;
  return path.extname(parts[2]).toLowerCase() === '.md';
}

/** M-B2i: class C is this shape only. Widening to any .md fails the Daily Notes test. */
function isClassCNote(notesReal: string, abs: string): boolean {
  const rel = path.relative(notesReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep).filter((part) => part.length > 0);
  if (parts.length !== 4) return false;
  if (parts[0].toLowerCase() !== 'universes') return false;
  if (!parts[1] || parts[1] === '.' || parts[1] === '..') return false;
  if (!CLASS_C_KINDS.has(parts[2].toLowerCase())) return false;
  return path.extname(parts[3]).toLowerCase() === '.md';
}

/**
 * Symlink and hardlink check on the lexical path, before realpath.
 * M-B2g: dropping the symlink branch lets a link to a scene through.
 */
function inspectLinks(vaultRoot: string, relPath: string): 'ok' | 'symlink' | 'hardlink' {
  const lexical = path.resolve(vaultRoot, relPath);
  const rel = path.relative(vaultRoot, lexical);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'ok';
  const segments = rel.split(path.sep).filter((part) => part.length > 0);
  let current = vaultRoot;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return 'ok';
      throw err;
    }
    if (st.isSymbolicLink()) return 'symlink';
    if (i === segments.length - 1 && st.isFile() && st.nlink > 1) return 'hardlink';
  }
  return 'ok';
}

function mapJoinError(err: unknown): AiWriteResult {
  if (isErrno(err, RESOLVE_FAIL_CODES)) return { ok: false, reason: 'resolve_failed' };
  return { ok: false, reason: 'not_allowlisted' };
}

function finishAllowlisted(abs: string, index: WriteIndex, classCNotesReal: string | null): AiWriteResult {
  if (pathIsManuscript(abs, index)) return { ok: false, reason: 'manuscript_target' };
  if (path.extname(abs).toLowerCase() !== '.md') return { ok: false, reason: 'not_allowlisted' };
  if (index.allow.has(caseFold(abs)) || isEntityTreeFile(index.vaultReal, abs)) {
    return { ok: true, abs };
  }
  if (classCNotesReal && isClassCNote(classCNotesReal, abs)) return { ok: true, abs };
  return { ok: false, reason: 'not_allowlisted' };
}

function assertStoryWritable(vaultRoot: string, relPath: string): AiWriteResult {
  const loaded = loadIndex(vaultRoot);
  if (!loaded.ok) return { ok: false, reason: 'no_manifest' };
  try {
    const link = inspectLinks(vaultRoot, relPath);
    if (link !== 'ok') return { ok: false, reason: 'not_allowlisted' };
  } catch (err) {
    if (isErrno(err, RESOLVE_FAIL_CODES)) return { ok: false, reason: 'resolve_failed' };
    return { ok: false, reason: 'resolve_failed' };
  }
  let abs: string;
  try {
    abs = safeVaultJoin(vaultRoot, relPath, { writeMode: true });
  } catch (err) {
    return mapJoinError(err);
  }
  if (!isInside(loaded.index.vaultReal, abs)) return { ok: false, reason: 'not_allowlisted' };
  return finishAllowlisted(abs, loaded.index, null);
}

function rootsOverlap(notesRoot: string, storyRoot: string): boolean {
  try {
    const notesReal = fs.realpathSync.native(notesRoot);
    const storyReal = fs.realpathSync.native(storyRoot);
    return isInside(notesReal, storyReal) || isInside(storyReal, notesReal);
  } catch {
    return true;
  }
}

function sameReal(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function assertClassCNote(storyRoot: string, notesRoot: string, relPath: string): AiWriteResult {
  const loaded = loadIndex(storyRoot);
  if (!loaded.ok) return { ok: false, reason: 'no_manifest' };
  try {
    const link = inspectLinks(notesRoot, relPath);
    if (link !== 'ok') return { ok: false, reason: 'not_allowlisted' };
  } catch {
    return { ok: false, reason: 'resolve_failed' };
  }
  let abs: string;
  try {
    abs = safeVaultJoin(notesRoot, relPath, { writeMode: true });
  } catch (err) {
    return mapJoinError(err);
  }
  let notesReal: string;
  try {
    notesReal = fs.realpathSync.native(notesRoot);
  } catch {
    return { ok: false, reason: 'resolve_failed' };
  }
  if (!isInside(notesReal, abs)) return { ok: false, reason: 'not_allowlisted' };
  if (pathIsManuscript(abs, loaded.index)) return { ok: false, reason: 'manuscript_target' };
  if (path.extname(abs).toLowerCase() !== '.md') return { ok: false, reason: 'not_allowlisted' };
  if (!isClassCNote(notesReal, abs)) return { ok: false, reason: 'not_allowlisted' };
  return { ok: true, abs };
}

export function assertAiWritable(
  vaultRoot: string,
  relPath: string,
  opts?: AssertAiWritableOptions,
): AiWriteResult {
  if (opts?.classC && !rootsOverlap(opts.classC.notesRoot, opts.classC.storyRoot)) {
    if (sameReal(vaultRoot, opts.classC.notesRoot)) {
      return assertClassCNote(opts.classC.storyRoot, opts.classC.notesRoot, relPath);
    }
  }
  return assertStoryWritable(vaultRoot, relPath);
}

/** Guarded writers call this with the abs assertAiWritable returned. */
export function writeAiCanonical(abs: string, content: string): { path: string; bytes: number } {
  return writeVaultFileAtomicAbs(abs, content);
}

const lockTails = new Map<string, Promise<void>>();

export function withAiFileLock<T>(abs: string, fn: () => T | Promise<T>): Promise<T> {
  const key = caseFold(abs);
  const prev = lockTails.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  const tail = run.then(() => undefined, () => undefined);
  lockTails.set(key, tail);
  void tail.finally(() => {
    if (lockTails.get(key) === tail) lockTails.delete(key);
  });
  return run;
}

export async function withAiFileLocks<T>(keys: string[], fn: () => T | Promise<T>): Promise<T> {
  const ordered = [...new Set(keys.map((key) => caseFold(key)))].sort();
  const go = (index: number): Promise<T> => {
    if (index >= ordered.length) return Promise.resolve(fn());
    return withAiFileLock(ordered[index], () => go(index + 1));
  };
  return go(0);
}

export function aiWriteLockKey(vaultRoot: string, relPath: string): string {
  try {
    return caseFold(safeVaultJoin(vaultRoot, relPath, { writeMode: true }));
  } catch {
    return caseFold(path.resolve(vaultRoot, relPath));
  }
}
