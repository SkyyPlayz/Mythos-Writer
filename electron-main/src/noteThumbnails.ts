// SKY-11186 (Notes Board 6/9): note thumbnails — main-process half.
//
// Implements BOARDS-SPEC.md v2 §6 (LOD tiles show a cover image when the
// note has one) and §9 (how that cover is chosen + cached). The renderer owns
// the pixels: it downscales the source into a WebP derivative and hands it
// back via `notesThumb:put`. This module only ever RESOLVES (which image, if
// any, is a note's cover), SERVES (cached derivative if present, else the raw
// source bytes for the renderer to derive from) and STORES derivatives.
//
// Resolution order per note (§9), first hit wins:
//   1. frontmatter `thumb:` — a vault image ref (explicit), or `false` /
//      "off" / "none" for "text-only even though the note has images" (off).
//   2. the note's FIRST image block in prose — Obsidian embed `![[x.png]]` or
//      markdown image `![alt](x.png)` (auto).
//   3. none.
// A referenced image that isn't on disk is reported as `missing: true` (the
// tile shows a broken-cover state, not the next image down — the user asked
// for THAT image, §9).
//
// Image refs use Obsidian link semantics: relative to the note's folder, then
// relative to the vault root, then — for a bare filename — a case-insensitive
// shortest-path basename match across the whole vault (Obsidian's default
// "shortest path when possible" link style). The basename index is one
// listVaultFiles walk, built lazily at most once per resolveNoteThumbs call.
//
// Security posture mirrors bgLoad.ts / vaultIconFile.ts: the extension
// allowlist gates BEFORE any filesystem access, nothing outside the vault is
// ever returned (path.relative containment), and every failure collapses to a
// null/missing/unsupported result instead of throwing into the renderer.
// All reads are fs.promises — a sync read of a 50 MB source would stall every
// other in-flight IPC round trip (SKY-11108). The derivative cache lives under
// userData (like vault-index-cache, keyed by vaultRootHash) and is disposable:
// a corrupt/missing cache entry just means the renderer re-derives.
//
// Pure Node (fs/path/crypto + vault.ts helpers, no Electron imports) —
// unit-testable without Electron, matching notesBoard.ts.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter, listVaultFiles } from './vault.js';

// ─── Constants ───

/**
 * Extension → MIME allowlist. This is the security gate: any path whose
 * extension isn't here is `unsupported` before we touch the filesystem
 * (bgLoad.ts precedent). SVG is included because the renderer rasterises the
 * derivative itself; the raw SVG bytes never reach a DOM as markup.
 */
export const THUMB_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/** 50 MB — a source above this is `unsupported`; the renderer would choke deriving it anyway. */
export const MAX_THUMB_SOURCE_BYTES = 50 * 1024 * 1024;

/** 2 MB — a renderer-derived WebP thumbnail is a few KB; anything bigger is a bug or abuse. */
export const MAX_THUMB_CACHE_BYTES = 2 * 1024 * 1024;

/**
 * How much of a note to scan for its first image block. A note's first image
 * lives near the top in practice; an image ref past this point is simply not
 * a "first image" (§9) — reading whole multi-MB notes for a tile is not worth it.
 */
export const MAX_THUMB_NOTE_SCAN_BYTES = 512 * 1024;

/** `notesThumb:resolve` batch cap — a board never has more items than this on screen. */
export const MAX_THUMB_RESOLVE_BATCH = 5000;

/** Per-vault derivative cache: `<userData>/note-thumb-cache/<vaultRootHash>/`. */
export const THUMB_CACHE_DIR_NAME = 'note-thumb-cache';

/** How many notes resolveNoteThumbs reads at once — bounded so a 5000-tile board doesn't open 5000 fds. */
const RESOLVE_CONCURRENCY = 16;

/**
 * `${mtimeMs}-${size}` — the same cheap change signal vault-index-cache uses.
 * Also the only shape accepted from the renderer on `put`, since the version
 * becomes part of a cache file name.
 */
const THUMB_VERSION_RE = /^\d+(\.\d+)?-\d+$/;

// ─── Types ───

export type NoteThumbMode = 'explicit' | 'auto' | 'off' | 'none';

export interface NoteThumbInfo {
  mode: NoteThumbMode;
  /** vault-relative POSIX path of the resolved source image; null when off/none or unresolvable */
  src: string | null;
  /** `${mtimeMs}-${size}` of the source file at resolution time; null when src null or missing */
  version: string | null;
  /** true when the note references an image (explicit or auto) that is not on disk / unresolvable */
  missing: boolean;
  /** cover caption: markdown alt text if present, else the image basename without extension; '' when none */
  caption: string;
}

export type ThumbFieldParse =
  | { kind: 'off' }
  | { kind: 'ref'; target: string }
  | { kind: 'unset' };

export interface ImageRef {
  target: string;
  alt: string;
}

/** lowercase basename → vault-relative POSIX paths, shortest first. */
export type VaultImageIndex = Map<string, string[]>;

/** Either a prebuilt index or a thunk that builds one on first use (lazy, once). */
export type VaultImageIndexSource = VaultImageIndex | (() => VaultImageIndex);

export type ThumbSourceResult =
  | { status: 'source'; mime: string; bytes: Buffer; version: string }
  | { status: 'missing' }
  | { status: 'unsupported' };

export type ThumbGetResult =
  | { status: 'ready'; dataUrl: string; version: string }
  | { status: 'source'; mime: string; bytes: Uint8Array; version: string }
  | { status: 'missing' }
  | { status: 'unsupported' };

// ─── Small helpers ───

/** The "nothing to show" info — also what an invalid/unreadable path resolves to. */
export function noneThumbInfo(): NoteThumbInfo {
  return { mode: 'none', src: null, version: null, missing: false, caption: '' };
}

export function isValidThumbVersion(version: unknown): version is string {
  return typeof version === 'string' && THUMB_VERSION_RE.test(version);
}

function versionOf(stat: { mtimeMs: number; size: number }): string {
  return `${stat.mtimeMs}-${stat.size}`;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Allowlisted extension (lowercase, no dot) of a path, or null. */
function imageExtOf(target: string): string | null {
  const ext = path.posix.extname(target).slice(1).toLowerCase();
  return ext && Object.prototype.hasOwnProperty.call(THUMB_IMAGE_MIME, ext) ? ext : null;
}

function basenameWithoutExt(target: string): string {
  const base = path.posix.basename(target);
  return base.slice(0, base.length - path.posix.extname(base).length);
}

function hasDotSegment(relPosix: string): boolean {
  return relPosix.split('/').some((seg) => seg !== '.' && seg.startsWith('.'));
}

/**
 * True when `rel` (vault-relative) resolves to somewhere inside `vaultRoot`.
 * Lexical check via path.relative — the only escape vectors that survive
 * resolveImageRef's own rejections are ones this catches by construction.
 */
function isInsideVault(vaultRoot: string, rel: string): boolean {
  const rootAbs = path.resolve(vaultRoot);
  const back = path.relative(rootAbs, path.resolve(rootAbs, rel));
  return back !== '' && !back.startsWith('..') && !path.isAbsolute(back);
}

// ─── Frontmatter `thumb:` (§9 step 1) ───

/** Every spelling of "no thumbnail" — YAML's own falsy words included, so `thumb: no` / `thumb: ~` read as intended. */
const OFF_WORDS = new Set(['false', 'off', 'none', 'no', 'null', '~']);

/**
 * Interpret a raw frontmatter `thumb:` value. vault.ts's parseFrontmatter
 * hands us `false` for a bare `thumb: false`, a string for most refs, and an
 * array for a bare wikilink (`thumb: [[x.png]]` trips its inline array
 * parser, arriving as `['[x.png]']` — or in more pieces when the file name
 * has a comma) — all of these are normalised here. Wikilink wrappers,
 * `|alias` / `#heading` suffixes (Obsidian link syntax) and surrounding
 * quotes are stripped; suffix stripping only applies inside a wikilink so a
 * plain `thumb: Cover #2.png` keeps its `#`.
 */
export function parseThumbField(value: unknown): ThumbFieldParse {
  if (value === false) return { kind: 'off' };
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part) => typeof part === 'string') &&
    value[0].startsWith('[')
  ) {
    // `thumb: [[x.png]]` → parseInlineArray → ['[x.png]'] (and
    // `[[My, Cover.png]]` → ['[My', 'Cover.png]']): rejoin and re-wrap so the
    // wikilink stripping below sees the shape the user actually wrote.
    raw = `[[${value.map((part) => part.trim()).join(', ').replace(/^\[+/, '').replace(/\]+$/, '')}]]`;
  } else {
    return { kind: 'unset' };
  }
  raw = raw.trim();
  const quoted = raw.match(/^(["'])([\s\S]*)\1$/);
  if (quoted) raw = quoted[2].trim();
  if (OFF_WORDS.has(raw.toLowerCase())) return { kind: 'off' };

  const wiki = raw.match(/^!?\[\[([\s\S]*)\]\]$/);
  if (wiki) {
    raw = wiki[1].split('|')[0].split('#')[0].trim();
  }
  if (!raw) return { kind: 'unset' };
  return { kind: 'ref', target: raw };
}

// ─── First image block in prose (§9 step 2) — pure ───

const FENCED_CODE_RE = /(?:```|~~~)[\s\S]*?(?:```|~~~|$)/g;
const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;
const MD_IMAGE_RE = /!\[([^\]\n]*)\]\(\s*(?:<([^<>\n]*)>|([^\s()]+))\s*(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))?\s*\)/g;
const REMOTE_TARGET_RE = /^(?:https?:|data:|file:|\/\/)/i;

/** Obsidian embed alias is a size (`100`, `100x50`) or an alt text — only the latter is a caption. */
function embedAliasAsAlt(alias: string | undefined): string {
  const a = (alias ?? '').trim();
  if (!a || /^\d+(?:x\d+)?$/.test(a)) return '';
  return a;
}

function decodeMarkdownTarget(target: string): string {
  // URL semantics: a `#fragment` is not part of the path, and a literal `#`
  // in a filename must be written `%23` (CommonMark), which decodes below.
  const noFragment = target.split('#')[0];
  try {
    return decodeURIComponent(noFragment);
  } catch {
    return noFragment;
  }
}

/**
 * Earliest image reference in `prose` whose target has an allowlisted image
 * extension and is not remote/absolute-scheme (`http(s):`, `data:`, `file:`).
 * Fenced code blocks are ignored. Both `![[embed]]` and `![alt](target)`
 * forms are scanned together and the lowest index wins.
 */
export function findFirstImageRef(prose: string): ImageRef | null {
  const text = prose.replace(FENCED_CODE_RE, '');
  const candidates: Array<{ index: number; ref: ImageRef }> = [];

  for (const m of text.matchAll(EMBED_RE)) {
    const [inner, alias] = m[1].split('|');
    const target = inner.split('#')[0].trim();
    candidates.push({ index: m.index ?? 0, ref: { target, alt: embedAliasAsAlt(alias) } });
  }
  for (const m of text.matchAll(MD_IMAGE_RE)) {
    const rawTarget = (m[2] ?? m[3] ?? '').trim();
    candidates.push({
      index: m.index ?? 0,
      ref: { target: decodeMarkdownTarget(rawTarget), alt: m[1].trim() },
    });
  }
  candidates.sort((a, b) => a.index - b.index);

  for (const { ref } of candidates) {
    if (!ref.target || REMOTE_TARGET_RE.test(ref.target)) continue;
    if (!imageExtOf(ref.target)) continue;
    return ref;
  }
  return null;
}

// ─── Vault image index + ref resolution (Obsidian link semantics) ───

/**
 * One listVaultFiles walk → lowercase basename → vault-relative POSIX paths
 * (shortest first, then lexical, so "shortest path" resolution is stable).
 * Dot-prefixed segments (`.obsidian/`, `.mythos/`, `.trash`) are bookkeeping,
 * never link targets — Obsidian itself can't link into them either.
 */
export function buildVaultImageIndex(vaultRoot: string): VaultImageIndex {
  const index: VaultImageIndex = new Map();
  const { items } = listVaultFiles(vaultRoot);
  for (const item of items) {
    if (item.isDirectory) continue;
    if (!imageExtOf(item.path)) continue;
    if (hasDotSegment(item.path)) continue;
    const key = item.name.toLowerCase();
    const list = index.get(key);
    if (list) list.push(item.path);
    else index.set(key, [item.path]);
  }
  for (const list of index.values()) {
    list.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  }
  return index;
}

/** A regular file — `lstat`, so a symlink pointing out of the vault is not a match (listVaultFiles skips symlinks the same way). */
function isExistingFile(abs: string): boolean {
  try {
    return fs.lstatSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve an image ref the way Obsidian would: (1) relative to the note's
 * own folder, (2) relative to the vault root, (3) for a bare filename, the
 * shortest-path case-insensitive basename match from the index. Returns the
 * vault-relative POSIX path of an EXISTING file, else null. Absolute paths,
 * `..` segments, dot-prefixed segments and anything that would land outside
 * the vault are rejected outright — a note can only ever point at the vault.
 */
export function resolveImageRef(
  vaultRoot: string,
  noteRelPath: string,
  target: string,
  index: VaultImageIndexSource,
): string | null {
  let t = toPosix(target).trim();
  while (t.startsWith('./')) t = t.slice(2);
  if (!t || t.includes('\0')) return null;
  if (t.startsWith('/') || /^[A-Za-z]:/.test(t) || t.startsWith('\\\\')) return null;
  const segments = t.split('/');
  if (segments.some((seg) => seg === '..')) return null;
  if (hasDotSegment(t)) return null;

  const noteDir = path.posix.dirname(toPosix(noteRelPath));
  const candidates: string[] = [];
  const noteRelative = path.posix.normalize(noteDir === '.' ? t : `${noteDir}/${t}`);
  candidates.push(noteRelative);
  const vaultRelative = path.posix.normalize(t);
  if (vaultRelative !== noteRelative) candidates.push(vaultRelative);

  for (const candidate of candidates) {
    if (!isInsideVault(vaultRoot, candidate)) continue;
    if (isExistingFile(path.join(vaultRoot, candidate))) return candidate;
  }

  if (!t.includes('/')) {
    const idx = typeof index === 'function' ? index() : index;
    for (const candidate of idx.get(t.toLowerCase()) ?? []) {
      if (!isInsideVault(vaultRoot, candidate)) continue;
      if (isExistingFile(path.join(vaultRoot, candidate))) return candidate;
    }
  }
  return null;
}

// ─── Per-note resolution (§9) ───

/**
 * Read at most MAX_THUMB_NOTE_SCAN_BYTES of a note. Frontmatter is always at
 * the top, so a truncated read still sees `thumb:`; an image ref past the
 * cap is simply not the note's first image. Throws on any fs failure —
 * resolveNoteThumbs maps that to mode 'none'.
 */
async function readNoteHead(absPath: string): Promise<string> {
  const handle = await fs.promises.open(absPath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not a file');
    const length = Math.min(stat.size, MAX_THUMB_NOTE_SCAN_BYTES);
    const buf = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buf, offset, length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buf.subarray(0, offset).toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function resolveOneNote(
  vaultRoot: string,
  noteRelPath: string,
  index: VaultImageIndexSource,
): Promise<NoteThumbInfo> {
  let text: string;
  try {
    text = await readNoteHead(path.join(vaultRoot, ...toPosix(noteRelPath).split('/')));
  } catch {
    return noneThumbInfo();
  }
  const { frontmatter, prose } = parseFrontmatter(text);

  let mode: NoteThumbMode;
  let ref: ImageRef;
  const field = parseThumbField(frontmatter.thumb);
  if (field.kind === 'off') {
    return { mode: 'off', src: null, version: null, missing: false, caption: '' };
  } else if (field.kind === 'ref') {
    mode = 'explicit';
    ref = { target: field.target, alt: '' };
  } else {
    const first = findFirstImageRef(prose);
    if (!first) return noneThumbInfo();
    mode = 'auto';
    ref = first;
  }

  const captionFor = (src: string | null): string =>
    ref.alt || basenameWithoutExt(src ?? ref.target);

  // An explicit ref to a non-image (thumb: notes.md) is a broken cover, not a
  // silent fallthrough to auto — same as a ref to a file that isn't there.
  const src = imageExtOf(ref.target) ? resolveImageRef(vaultRoot, noteRelPath, ref.target, index) : null;
  if (!src) return { mode, src: null, version: null, missing: true, caption: captionFor(null) };

  try {
    const stat = await fs.promises.stat(path.join(vaultRoot, ...src.split('/')));
    return { mode, src, version: versionOf(stat), missing: false, caption: captionFor(src) };
  } catch {
    // Raced a delete between resolveImageRef's existence check and the stat.
    return { mode, src: null, version: null, missing: true, caption: captionFor(src) };
  }
}

/**
 * Resolve the cover for each note (keys = the input paths verbatim). Reads
 * run RESOLVE_CONCURRENCY at a time via fs.promises so a big board never
 * stalls the IPC queue (SKY-11108). The basename index is built at most once
 * per call, and only if some note actually needs basename resolution. Path
 * sandboxing is the caller's job (the IPC handler) — this is pure Node.
 */
export async function resolveNoteThumbs(
  vaultRoot: string,
  noteRelPaths: string[],
): Promise<Record<string, NoteThumbInfo>> {
  const results: Record<string, NoteThumbInfo> = {};
  let index: VaultImageIndex | null = null;
  const lazyIndex = (): VaultImageIndex => {
    if (!index) index = buildVaultImageIndex(vaultRoot);
    return index;
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < noteRelPaths.length) {
      const relPath = noteRelPaths[next++];
      results[relPath] = await resolveOneNote(vaultRoot, relPath, lazyIndex);
    }
  };
  const workers = Array.from(
    { length: Math.min(RESOLVE_CONCURRENCY, noteRelPaths.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ─── Source access (gate → stat → read) ───

function sha1Prefix(imageRelPath: string): string {
  return crypto.createHash('sha1').update(imageRelPath).digest('hex').slice(0, 24);
}

/**
 * Extension allowlist + vault containment — no fs access. Anything that
 * fails here is `unsupported` (wrong kind of file) or `missing` (not a
 * vault-relative path at all); the caller never reaches stat/read for it.
 */
function gateThumbSource(
  vaultRoot: string,
  imageRelPath: string,
): { abs: string; mime: string } | { status: 'missing' } | { status: 'unsupported' } {
  if (typeof imageRelPath !== 'string' || !imageRelPath) return { status: 'missing' };
  const ext = imageExtOf(imageRelPath);
  if (!ext) return { status: 'unsupported' };
  const rel = toPosix(imageRelPath);
  if (rel.includes('\0') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')) {
    return { status: 'missing' };
  }
  if (!isInsideVault(vaultRoot, rel)) return { status: 'missing' };
  return { abs: path.join(vaultRoot, ...rel.split('/')), mime: THUMB_IMAGE_MIME[ext] };
}

async function statThumbSourceAbs(
  abs: string,
): Promise<{ status: 'ok'; version: string } | { status: 'missing' } | { status: 'unsupported' }> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return { status: 'missing' };
  }
  if (!stat.isFile()) return { status: 'missing' };
  if (stat.size > MAX_THUMB_SOURCE_BYTES) return { status: 'unsupported' };
  return { status: 'ok', version: versionOf(stat) };
}

/**
 * Raw source bytes for the renderer to derive a thumbnail from. Allowlist
 * gate BEFORE any fs access; over MAX_THUMB_SOURCE_BYTES → unsupported;
 * not on disk (or any read error) → missing.
 */
export async function readThumbSource(
  vaultRoot: string,
  imageRelPath: string,
): Promise<ThumbSourceResult> {
  const gate = gateThumbSource(vaultRoot, imageRelPath);
  if ('status' in gate) return gate;
  const st = await statThumbSourceAbs(gate.abs);
  if (st.status !== 'ok') return st;
  try {
    const bytes = await fs.promises.readFile(gate.abs);
    return { status: 'source', mime: gate.mime, bytes, version: st.version };
  } catch {
    return { status: 'missing' };
  }
}

// ─── Derivative cache (renderer derives, main stores/serves) ───

export function thumbCacheFileName(imageRelPath: string, version: string): string {
  return `${sha1Prefix(imageRelPath)}-${version}.webp`;
}

/** Cached derivative as a `data:image/webp;base64,…` URL, or null (miss, bad version, any error). */
export async function readCachedThumb(
  cacheDir: string,
  imageRelPath: string,
  version: string,
): Promise<string | null> {
  if (!isValidThumbVersion(version)) return null;
  try {
    const data = await fs.promises.readFile(path.join(cacheDir, thumbCacheFileName(imageRelPath, version)));
    return `data:image/webp;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Same tmp+rename atomicity as vault.ts's writeFileAtomic, but fs.promises
 * throughout — a derivative write must not block the IPC queue (SKY-11108).
 */
async function writeFileAtomicAsync(absPath: string, data: Uint8Array): Promise<void> {
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, absPath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Store a renderer-derived WebP for (image, version), then prune sibling
 * derivatives of the SAME image at a different version — a re-saved source
 * must not leave stale thumbnails accumulating. Never throws: the cache is
 * disposable, so a failed write only means the renderer re-derives next
 * time. Returns true when the file landed, false otherwise.
 */
export async function writeCachedThumb(
  cacheDir: string,
  imageRelPath: string,
  version: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!isValidThumbVersion(version)) return false;
  const fileName = thumbCacheFileName(imageRelPath, version);
  try {
    await writeFileAtomicAsync(path.join(cacheDir, fileName), bytes);
  } catch {
    return false;
  }
  const prefix = `${sha1Prefix(imageRelPath)}-`;
  try {
    for (const entry of await fs.promises.readdir(cacheDir)) {
      if (entry === fileName || !entry.startsWith(prefix) || !entry.endsWith('.webp')) continue;
      await fs.promises.unlink(path.join(cacheDir, entry)).catch(() => undefined);
    }
  } catch {
    // cache dir unreadable — nothing to prune, the write itself already landed
  }
  return true;
}

/**
 * `notesThumb:get` body: gate → stat (for the current version) → cached
 * derivative if present → else the raw source for the renderer to derive.
 * One stat per call. Bytes are copied into a standalone Uint8Array before
 * crossing IPC: structured clone serialises a view's WHOLE backing
 * ArrayBuffer, and a small readFile Buffer may live in Node's shared pool
 * alongside other files' bytes.
 */
export async function getThumb(
  vaultRoot: string,
  cacheDir: string,
  imageRelPath: string,
): Promise<ThumbGetResult> {
  const gate = gateThumbSource(vaultRoot, imageRelPath);
  if ('status' in gate) return gate;
  const st = await statThumbSourceAbs(gate.abs);
  if (st.status !== 'ok') return st;

  const cached = await readCachedThumb(cacheDir, imageRelPath, st.version);
  if (cached) return { status: 'ready', dataUrl: cached, version: st.version };

  try {
    const bytes = await fs.promises.readFile(gate.abs);
    return { status: 'source', mime: gate.mime, bytes: new Uint8Array(bytes), version: st.version };
  } catch {
    return { status: 'missing' };
  }
}

/**
 * `notesThumb:put` body: validate what the renderer sent (version shape —
 * it becomes a file name — and a sane byte size), then store. `ok: false`
 * on any rejection or write failure; never throws.
 */
export async function putThumb(
  cacheDir: string,
  imageRelPath: string,
  version: unknown,
  bytes: unknown,
): Promise<{ ok: boolean }> {
  if (typeof imageRelPath !== 'string' || !imageRelPath) return { ok: false };
  if (!imageExtOf(imageRelPath)) return { ok: false };
  if (!isValidThumbVersion(version)) return { ok: false };
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_THUMB_CACHE_BYTES) {
    return { ok: false };
  }
  return { ok: await writeCachedThumb(cacheDir, imageRelPath, version, bytes) };
}
