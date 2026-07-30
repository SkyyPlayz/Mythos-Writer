// Vault I/O — Obsidian-compatible markdown with YAML frontmatter.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { FSWatcher } from 'chokidar';
import type {
  Manifest,
  StoryEntry,
  ChapterEntry,
  SceneEntry,
  BlockEntry,
  EntityEntry,
  VaultObsidianDryRunReport,
  ObsidianBrokenLink,
  ObsidianNameCollision,
  ArcEntry,
  TimelineSettings,
} from './ipc.js';
import { writeManifestAtomic, SCHEMA_VERSION } from './manifest.js';
import { blocksToMarkdownBody, unwrapBlockSegment } from './sceneBody.js';
import { safeVaultJoin } from './vault/safeVaultJoin.js';

export {
  safeVaultJoin,
  safeVaultIpcJoin,
  safeVaultDirIpcJoin,
  safeVaultEntryIpcJoin,
  VAULT_IPC_ALLOWED_EXTENSIONS,
} from './vault/safeVaultJoin.js';
export type { SafeVaultJoinOptions } from './vault/safeVaultJoin.js';

// ─── Manuscript layout ───

export const MANUSCRIPT_DIR = 'Manuscript';

/** Convert a human title to a filesystem-safe slug. */
export function toSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')    // keep alphanum, spaces, hyphens
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/**
 * Deterministically resolve slug collisions inside a parent directory.
 * Returns the first relative path (parentDir/slug[ext] or parentDir/slug-N[ext]) not yet on disk.
 */
export function resolveSlugCollision(
  vaultRoot: string,
  parentDir: string,
  baseSlug: string,
  ext = ''
): string {
  const make = (suffix: string) => {
    const name = `${baseSlug}${suffix}${ext}`;
    return parentDir ? `${parentDir}/${name}` : name;
  };
  if (!fs.existsSync(path.join(vaultRoot, make('')))) return make('');
  for (let i = 2; i <= 9999; i++) {
    const candidate = make(`-${i}`);
    if (!fs.existsSync(path.join(vaultRoot, candidate))) return candidate;
  }
  throw new Error(`Too many slug collisions for: ${baseSlug}`);
}

/**
 * Compute a chapter directory path: Manuscript/<story-slug>/<chapter-slug>.
 * Resolves collisions deterministically against existing directories.
 */
export function chapterVaultPath(
  vaultRoot: string,
  storyTitle: string,
  chapterTitle: string
): string {
  return resolveSlugCollision(
    vaultRoot,
    `${MANUSCRIPT_DIR}/${toSlug(storyTitle)}`,
    toSlug(chapterTitle)
  );
}

/**
 * Compute a scene file path: <chapterDir>/<scene-slug>.md.
 * chapterDir is the actual chapter directory path as stored in the manifest.
 * Resolves collisions deterministically against existing .md files.
 */
export function sceneVaultPath(
  vaultRoot: string,
  chapterDir: string,
  sceneTitle: string
): string {
  return resolveSlugCollision(vaultRoot, chapterDir, toSlug(sceneTitle), '.md');
}

// ─── Size limits ───

export const MAX_VAULT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — well above any scene

export class VaultFileTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly limitBytes: number;
  constructor(sizeBytes: number, limitBytes = MAX_VAULT_FILE_BYTES) {
    super(
      `File too large: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${(limitBytes / 1024 / 1024).toFixed(0)} MB limit.`
    );
    this.name = 'VaultFileTooLargeError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}
/**
 * Resolve a relative path inside the vault, hardening against escape vectors
 * (traversal, symlinks, null bytes, encoded ".." and cross-OS payloads).
 *
 * Thin wrapper around {@link safeVaultJoin} (MYT-774) so existing call sites
 * and the `safePath` legacy alias keep working; new code should call
 * `safeVaultJoin` directly to expose the option surface (dotfile + extension
 * allow-list) at the call site.
 */
export function realSafePath(vaultRoot: string, relativePath: string, writeMode = false): string {
  return safeVaultJoin(vaultRoot, relativePath, { writeMode });
}

// Legacy alias — deprecated, use realSafePath.
export const safePath = realSafePath;

/**
 * Resolve an EPUB export target (MYT-675).
 *
 * `export:epub` accepts an optional renderer-supplied `targetPath` as a headless
 * export escape hatch. Left unconstrained it allowed writing EPUB bytes to an
 * arbitrary absolute path (out-of-vault write), so a compromised/buggy renderer
 * could clobber files anywhere on disk. We constrain it to a vault-relative
 * `.epub` path and reuse the realSafePath containment hardening (MYT-672 /
 * MYT-641) so `..` traversal, absolute paths, and symlink escapes are all
 * rejected before any bytes are written.
 *
 * Returns the contained absolute path to write to.
 */
export function resolveEpubExportPath(vaultRoot: string, targetPath: string): string {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('export:epub targetPath must be a non-empty string');
  }
  if (path.extname(targetPath).toLowerCase() !== '.epub') {
    throw new Error('export:epub targetPath must end in .epub');
  }
  // realSafePath rejects absolute paths and "../" escapes (and symlink escapes),
  // anchoring the write inside the vault root.
  return realSafePath(vaultRoot, targetPath, true);
}

// ─── Basic R/W (used by legacy IPC channels) ───

export function readVaultFile(vaultRoot: string, filePath: string): { content: string; path: string } {
  const fullPath = safePath(vaultRoot, filePath);
  const size = fs.statSync(fullPath).size;
  if (size > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError(size);
  return { content: fs.readFileSync(fullPath, 'utf-8'), path: filePath };
}

/** Non-atomic write — leaves a torn file if the process crashes mid-write. Only for tests. */
export function writeVaultFileUnsafe_testOnly(
  vaultRoot: string,
  filePath: string,
  content: string
): { path: string; bytes: number } {
  const fullPath = realSafePath(vaultRoot, filePath, true);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  markSelfWrite(fullPath);
  return { path: filePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

/**
 * Atomic vault write: temp file → fdatasync → rename.
 * A crash between writeSync and renameSync leaves the original file intact.
 */
export function writeVaultFileAtomic(
  vaultRoot: string,
  filePath: string,
  content: string
): { path: string; bytes: number } {
  const fullPath = realSafePath(vaultRoot, filePath, true);
  const buf = Buffer.from(content, 'utf-8');
  if (buf.byteLength > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError(buf.byteLength);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fullPath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buf);
    fs.fdatasyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, fullPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
    throw err;
  }
  markSelfWrite(fullPath);
  return { path: filePath, bytes: buf.byteLength };
}

/**
 * Generic atomic write for arbitrary absolute paths (e.g. export targets outside the vault).
 * Does NOT enforce the vault sandbox — callers are responsible for path safety.
 */
export function writeFileAtomic(absPath: string, data: Buffer | string): void {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buf);
    fs.fdatasyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}

export function listVaultFiles(
  vaultRoot: string,
  root?: string
): { items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> } {
  const baseDir = root ? realSafePath(vaultRoot, root, false) : vaultRoot;
  const items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> = [];

  function walk(dir: string, prefix: string) {
    // GH#622: skip unreadable subdirectories instead of aborting the entire scan.
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // skip symlinks — they may escape the vault
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);
      let modifiedAt: string;
      try {
        modifiedAt = new Date(fs.statSync(fullPath).mtime).toISOString();
      } catch {
        modifiedAt = new Date(0).toISOString();
      }
      items.push({
        path: relativePath,
        name: entry.name,
        isDirectory: entry.isDirectory(),
        modifiedAt,
      });
      if (entry.isDirectory()) walk(fullPath, relativePath);
    }
  }

  walk(baseDir, '');
  return { items };
}

// SKY-7995: delete needs to handle directories too — unlinkSync throws EISDIR
// for a directory target, which is how folder-delete silently failed before.
export function deleteVaultFile(vaultRoot: string, filePath: string): { path: string; deleted: boolean } {
  const fullPath = realSafePath(vaultRoot, filePath, true);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    // does not exist
  }
  if (!stat) return { path: filePath, deleted: false };
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }
  return { path: filePath, deleted: true };
}

// SKY-9: atomic intra-vault rename. Both endpoints resolve under the same
// vaultRoot via realSafePath, so a move can never cross vault boundaries or
// escape via "../". fs.renameSync is atomic on a single filesystem; cross-
// device moves throw EXDEV and the caller should retry via copy+delete (not
// implemented here — both vaults live under userData by default).
//
// SKY-7995: also used to move/rename directories, so a descendant guard is
// required — without it, dragging (or renaming) a folder "into" itself or
// one of its own children would call fs.renameSync with `to` nested inside
// `from`, orphaning/deleting data on most filesystems.
export function moveVaultFile(
  vaultRoot: string,
  fromPath: string,
  toPath: string
): { fromPath: string; toPath: string; moved: boolean } {
  const fromFull = realSafePath(vaultRoot, fromPath, true);
  const toFull = realSafePath(vaultRoot, toPath, true);
  if (fromFull === toFull) return { fromPath, toPath, moved: false };
  if (!fs.existsSync(fromFull)) {
    throw new Error(`Source does not exist: ${fromPath}`);
  }
  if (fs.statSync(fromFull).isDirectory()) {
    if (toFull === fromFull || toFull.startsWith(fromFull + path.sep)) {
      throw new Error(
        `Cannot move "${fromPath}" into itself or one of its own subfolders.`
      );
    }
  }
  fs.mkdirSync(path.dirname(toFull), { recursive: true });
  fs.renameSync(fromFull, toFull);
  return { fromPath, toPath, moved: true };
}

// ─── YAML frontmatter helpers ───
// Obsidian uses `---\nkey: value\n---\ncontent` format.

interface Frontmatter {
  [key: string]: unknown;
}

/**
 * Quote a scalar for a YAML inline array (`[a, b]`) when it contains a comma,
 * double-quote, backslash, or newline. Without this, the naive comma-split
 * parser below would break a value like `Smith, John` into two tokens
 * (GH#611 / SKY-5159). Backslashes and double-quotes are escaped inside the
 * quoted form so they round-trip through {@link parseInlineArray}.
 */
export function yamlInlineQuote(s: string): string {
  if (/[,"\\\n]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Split the inside of a YAML inline array (`[ ... ]`) into values, honoring
 * both single- and double-quoted entries so a quoted comma (`"Smith, John"` or
 * `'Smith, John'`) stays a single token. Double-quoted values additionally
 * decode `\"` / `\\` escape sequences. Surrounding quotes are stripped.
 * Unquoted values are trimmed. Empty unquoted tokens are dropped (matching the
 * previous `filter(Boolean)` behavior), so `[]` and `[a, ]` parse cleanly.
 */
function parseInlineArray(inner: string): string[] {
  const values: string[] = [];
  let cur = '';
  let quoteChar: '"' | "'" | null = null;
  const flush = () => {
    if (quoteChar !== null) {
      values.push(cur);
    } else {
      const trimmed = cur.trim();
      if (trimmed) values.push(trimmed);
    }
    cur = '';
    quoteChar = null;
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quoteChar !== null) {
      if (quoteChar === '"' && ch === '\\' && i + 1 < inner.length) {
        cur += inner[i + 1];
        i++;
      } else if (ch === quoteChar) {
        quoteChar = null;
      } else {
        cur += ch;
      }
    } else if ((ch === '"' || ch === "'") && cur.trim() === '') {
      cur = '';
      quoteChar = ch;
    } else if (ch === ',') {
      flush();
    } else {
      cur += ch;
    }
  }
  flush();
  return values;
}

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; prose: string } {
  // Null bytes (\x00) are not valid in YAML; strip them before processing
  // (SKY-398: prevents ambiguous key comparisons in fuzz roundtrip checks).
  const sanitized = raw.replace(/\x00/g, '');

  // Closing delimiter must be exactly "---" on its own line (only optional
  // spaces/tabs after it, then newline or end-of-string). This prevents a
  // frontmatter key starting with "---" from being mis-identified as the
  // closing delimiter (SKY-384, crash 47c4c1f3; SKY-398).
  const match = sanitized.match(/^---\r?\n([\s\S]*?)\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { frontmatter: {}, prose: sanitized };
  // Object.create(null) prevents prototype-pollution: keys like '__proto__' or
  // 'constructor' become plain own properties instead of intercepting prototype
  // chain operations.  Callers spread into {} literals, so downstream code is safe.
  const fm: Frontmatter = Object.create(null) as Frontmatter;
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    const val = line.slice(colon + 1).trim();
    // Parse arrays like `tags: [a, b]`
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = parseInlineArray(val.slice(1, -1));
    } else if (val === 'true') {
      fm[key] = true;
    } else if (val === 'false') {
      fm[key] = false;
    } else if (val !== '' && !isNaN(Number(val))) {
      fm[key] = Number(val);
    } else {
      fm[key] = val;
    }
  }
  return { frontmatter: fm, prose: match[2] };
}

export function serializeFrontmatter(fm: Frontmatter, prose: string): string {
  const lines: string[] = ['---'];
  for (const [key, val] of Object.entries(fm)) {
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.map((v) => yamlInlineQuote(String(v))).join(', ')}]`);
    } else if (val !== undefined && val !== null) {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + prose;
}

// ─── Obsidian-compatible scene file ───

export interface SceneFileData {
  id: string;
  title: string;
  chapterId?: string;
  storyId?: string;
  order?: number;
  tags?: string[];
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov?: string;
  storyTime?: string;
  /** SKY-207: writer-defined custom frontmatter fields (e.g. mood, tension). */
  customFields?: Record<string, unknown>;
  // SKY-791: chronological timeline metadata (stored in frontmatter)
  chronologicalDate?: string;
  chronologicalIsEstimated?: boolean;
  chronologicalConfidence?: number;
  chronologicalSource?: string;
  entityCharacterIds?: string[];
  entityLocationId?: string;
  entityArcs?: string[];
  metaWordCount?: number;
  metaMood?: string;
  metaPov?: string;
  prose: string;
}

/** Built-in frontmatter keys that are managed by the app. Custom fields must not shadow these. */
const BUILTIN_FM_KEYS = new Set([
  'id', 'title', 'chapterId', 'storyId', 'order', 'tags',
  'goal', 'conflict', 'outcome', 'pov', 'storyTime', 'updatedAt',
  // SKY-791: timeline fields
  'chronologicalDate', 'chronologicalIsEstimated', 'chronologicalConfidence', 'chronologicalSource',
  'entityCharacterIds', 'entityLocationId', 'entityArcs',
  'metaWordCount', 'metaMood', 'metaPov',
]);

function sceneTimelineFrontmatter(data: SceneFileData): Frontmatter {
  return {
    ...(data.chronologicalDate ? { chronologicalDate: data.chronologicalDate } : {}),
    ...(data.chronologicalIsEstimated !== undefined ? { chronologicalIsEstimated: data.chronologicalIsEstimated } : {}),
    ...(data.chronologicalConfidence !== undefined ? { chronologicalConfidence: data.chronologicalConfidence } : {}),
    ...(data.chronologicalSource ? { chronologicalSource: data.chronologicalSource } : {}),
    ...(data.entityCharacterIds?.length ? { entityCharacterIds: data.entityCharacterIds } : {}),
    ...(data.entityLocationId ? { entityLocationId: data.entityLocationId } : {}),
    ...(data.entityArcs?.length ? { entityArcs: data.entityArcs } : {}),
    ...(data.metaWordCount !== undefined ? { metaWordCount: data.metaWordCount } : {}),
    ...(data.metaMood ? { metaMood: data.metaMood } : {}),
    ...(data.metaPov ? { metaPov: data.metaPov } : {}),
  };
}

function buildSceneFrontmatter(data: SceneFileData): Frontmatter {
  return {
    id: data.id,
    title: data.title,
    ...(data.chapterId ? { chapterId: data.chapterId } : {}),
    ...(data.storyId ? { storyId: data.storyId } : {}),
    ...(data.order !== undefined ? { order: data.order } : {}),
    ...(data.tags?.length ? { tags: data.tags } : {}),
    ...(data.goal ? { goal: data.goal } : {}),
    ...(data.conflict ? { conflict: data.conflict } : {}),
    ...(data.outcome ? { outcome: data.outcome } : {}),
    ...(data.pov ? { pov: data.pov } : {}),
    ...(data.storyTime ? { storyTime: data.storyTime } : {}),
    // SKY-791: timeline metadata fields
    ...sceneTimelineFrontmatter(data),
    // SKY-207: custom fields go after built-ins; shadow protection via BUILTIN_FM_KEYS
    ...(data.customFields
      ? Object.fromEntries(
          Object.entries(data.customFields).filter(
            ([k, v]) => !BUILTIN_FM_KEYS.has(k) && v !== undefined && v !== null && v !== '',
          ),
        )
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function writeSceneFile(vaultRoot: string, relativePath: string, data: SceneFileData): void {
  const content = serializeFrontmatter(buildSceneFrontmatter(data), data.prose);
  writeVaultFileAtomic(vaultRoot, relativePath, content);
}

/** Atomic variant of writeSceneFile — temp + fdatasync + rename. */
export function writeSceneFileAtomic(vaultRoot: string, relativePath: string, data: SceneFileData): void {
  const content = serializeFrontmatter(buildSceneFrontmatter(data), data.prose);
  writeVaultFileAtomic(vaultRoot, relativePath, content);
}

export function readSceneFile(vaultRoot: string, relativePath: string): SceneFileData {
  const { content } = readVaultFile(vaultRoot, relativePath);
  const { frontmatter, prose } = parseFrontmatter(content);

  // SKY-207: extract any key not in the built-in set as a custom field
  const customFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!BUILTIN_FM_KEYS.has(k)) customFields[k] = v;
  }

  return {
    id: String(frontmatter.id ?? crypto.randomUUID()),
    title: String(frontmatter.title ?? path.basename(relativePath, '.md')),
    chapterId: frontmatter.chapterId ? String(frontmatter.chapterId) : undefined,
    storyId: frontmatter.storyId ? String(frontmatter.storyId) : undefined,
    order: frontmatter.order !== undefined ? Number(frontmatter.order) : undefined,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined,
    goal: frontmatter.goal ? String(frontmatter.goal) : undefined,
    conflict: frontmatter.conflict ? String(frontmatter.conflict) : undefined,
    outcome: frontmatter.outcome ? String(frontmatter.outcome) : undefined,
    pov: frontmatter.pov ? String(frontmatter.pov) : undefined,
    storyTime: frontmatter.storyTime ? String(frontmatter.storyTime) : undefined,
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    // SKY-791: timeline metadata
    chronologicalDate: frontmatter.chronologicalDate ? String(frontmatter.chronologicalDate) : undefined,
    chronologicalIsEstimated: frontmatter.chronologicalIsEstimated !== undefined ? Boolean(frontmatter.chronologicalIsEstimated) : undefined,
    chronologicalConfidence: frontmatter.chronologicalConfidence !== undefined ? Number(frontmatter.chronologicalConfidence) : undefined,
    chronologicalSource: frontmatter.chronologicalSource ? String(frontmatter.chronologicalSource) : undefined,
    entityCharacterIds: Array.isArray(frontmatter.entityCharacterIds) ? frontmatter.entityCharacterIds.map(String) : undefined,
    entityLocationId: frontmatter.entityLocationId ? String(frontmatter.entityLocationId) : undefined,
    entityArcs: Array.isArray(frontmatter.entityArcs) ? frontmatter.entityArcs.map(String) : undefined,
    metaWordCount: frontmatter.metaWordCount !== undefined ? Number(frontmatter.metaWordCount) : undefined,
    metaMood: frontmatter.metaMood ? String(frontmatter.metaMood) : undefined,
    metaPov: frontmatter.metaPov ? String(frontmatter.metaPov) : undefined,
    prose,
  };
}

// ─── SKY-10: chapter.md (chapter-level metadata) ───
//
// `chapter.md` lives at the root of the chapter folder. It holds the stable
// chapter `id` (so renaming the folder does not lose identity), title, order,
// and any optional chapter-level prose (epigraph, author notes). It is the
// chapter analog of a scene file and is excluded from scene reindexing.

export const CHAPTER_META_FILENAME = 'chapter.md';

export interface ChapterFileData {
  id: string;
  title: string;
  storyId?: string;
  order?: number;
  prose: string;
}

export function chapterMetaPath(chapterRelPath: string): string {
  return path.posix.join(chapterRelPath.split(path.sep).join('/'), CHAPTER_META_FILENAME);
}

export function writeChapterMetaFile(
  vaultRoot: string,
  chapterRelPath: string,
  data: ChapterFileData,
): void {
  const fm: Frontmatter = {
    id: data.id,
    title: data.title,
    ...(data.storyId ? { storyId: data.storyId } : {}),
    ...(data.order !== undefined ? { order: data.order } : {}),
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  writeVaultFileAtomic(vaultRoot, chapterMetaPath(chapterRelPath), serializeFrontmatter(fm, data.prose));
}

export function readChapterMetaFile(vaultRoot: string, chapterRelPath: string): ChapterFileData | null {
  const rel = chapterMetaPath(chapterRelPath);
  const full = safePath(vaultRoot, rel);
  if (!fs.existsSync(full)) return null;
  const { content } = readVaultFile(vaultRoot, rel);
  const { frontmatter, prose } = parseFrontmatter(content);
  if (!frontmatter.id) return null;
  return {
    id: String(frontmatter.id),
    title: String(frontmatter.title ?? path.basename(chapterRelPath)),
    storyId: frontmatter.storyId ? String(frontmatter.storyId) : undefined,
    order: frontmatter.order !== undefined ? Number(frontmatter.order) : undefined,
    prose,
  };
}

// ─── Entity file ───

export interface EntityFileData {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  prose: string;
}

export function writeEntityFile(vaultRoot: string, relativePath: string, data: EntityFileData): void {
  const fm: Frontmatter = {
    id: data.id,
    name: data.name,
    type: data.type,
    ...(data.aliases?.length ? { aliases: data.aliases } : {}),
    ...(data.tags?.length ? { tags: data.tags } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeVaultFileAtomic(vaultRoot, relativePath, serializeFrontmatter(fm, data.prose));
}

export function readEntityFile(vaultRoot: string, relativePath: string): EntityFileData {
  const { content } = readVaultFile(vaultRoot, relativePath);
  const { frontmatter, prose } = parseFrontmatter(content);
  return {
    id: String(frontmatter.id ?? crypto.randomUUID()),
    name: String(frontmatter.name ?? path.basename(relativePath, '.md')),
    type: (frontmatter.type as EntityEntry['type']) ?? 'other',
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : undefined,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined,
    prose,
  };
}

// ─── Manifest helpers ───
//
// SKY-6596 / GH #893: manifest.json is structure-only on disk (see
// stripEmbeddedProseForPersist in manifest.ts) — every scene's prose lives in
// its `.md` file. readManifest rehydrates `blocks[].content` from disk on
// every call so the in-memory/IPC manifest shape is unchanged for every
// existing consumer; only the on-disk bytes shrank. Hydration is block-aware
// (PR #932 review): when the stripped manifest carries per-block boundary
// metadata (`bodySegLen`, written by stripSceneProse in manifest.ts) that is
// consistent with the `.md` body, each block's serialized segment is sliced
// back out and its type marker inverted (see sceneBody.ts), so multi-block
// scenes round-trip with content, types, ids, and order intact. On any
// inconsistency — external edit, legacy manifest without metadata — the
// whole body goes into the first prose block (the pre-#932 behavior) with a
// console.warn naming the scene; the body is never lost and nothing throws.
//
// A per-process cache keyed by the scene's resolved absolute file path (not
// scene id — ids are only unique *within* a vault, and a running app session
// can open more than one vault) + the `.md` file's mtime/size avoids
// re-reading unchanged scenes across the many `readManifest` calls in a
// session.

interface SceneProseCacheEntry {
  mtimeMs: number;
  size: number;
  content: string;
}

const sceneProseHydrationCache = new Map<string, SceneProseCacheEntry>();

interface HydratedSceneBody {
  /** Raw markdown body of the scene's `.md` ('' when missing/unreadable). */
  body: string;
  /** Identity of the on-disk file this body came from (path@mtime:size), or
   * null when no readable file exists. Used to de-duplicate fallback warns. */
  fileKey: string | null;
}

function hydrateSceneBody(vaultRoot: string, scene: SceneEntry): HydratedSceneBody {
  let absPath: string;
  let stat: fs.Stats;
  try {
    absPath = safePath(vaultRoot, scene.path);
    stat = fs.statSync(absPath);
  } catch {
    // No `.md` file on disk — an orphaned manifest entry. Nothing to hydrate.
    return { body: '', fileKey: null };
  }
  const fileKey = `${absPath}@${stat.mtimeMs}:${stat.size}`;
  const cached = sceneProseHydrationCache.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { body: cached.content, fileKey };
  }
  let content = '';
  try {
    content = readSceneFile(vaultRoot, scene.path).prose;
  } catch {
    // Unreadable/corrupt `.md` — treat as empty, same as every other
    // `.md`-sourced read path in this codebase (export, search, SCENE_GET).
  }
  sceneProseHydrationCache.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, content });
  return { body: content, fileKey };
}

/** Set (or create) a scene's sole prose block content, in place. */
function setSceneProse(scene: SceneEntry, content: string): void {
  const proseBlock = scene.blocks?.find((b) => b.type === 'prose');
  if (proseBlock) {
    proseBlock.content = content;
  } else {
    scene.blocks = [
      ...(scene.blocks ?? []),
      { id: crypto.randomUUID(), type: 'prose', order: 0, content, updatedAt: scene.updatedAt },
    ];
  }
}

/** Whole-body-into-the-prose-block hydration is exact (not a fallback) when
 * there is no block structure beyond a single prose block to restore. */
function hasTrivialBlockStructure(blocks: BlockEntry[] | undefined): boolean {
  if (!blocks || blocks.length === 0) return true;
  return blocks.length === 1 && blocks[0].type === 'prose';
}

// One warn per scene per on-disk `.md` version — readManifest runs constantly
// (dozens of calls per user action), so an unconditional warn would flood the
// log for a scene that stays in the fallback state.
const warnedBlockHydrationFallbacks = new Set<string>();

function warnBlockHydrationFallback(scene: SceneEntry, fileKey: string | null, reason: string): void {
  const key = `${scene.id}|${fileKey ?? 'missing'}`;
  if (warnedBlockHydrationFallbacks.has(key)) return;
  warnedBlockHydrationFallbacks.add(key);
  console.warn(
    `[vault] scene "${scene.title}" (id ${scene.id}, ${scene.path}): ${reason}; ` +
      'hydrating the whole .md body into the first prose block. No text is lost, ' +
      'but per-block structure is unavailable for this scene until its next in-app save.'
  );
}

/**
 * Block-aware hydration (PR #932 review). Restores every block's content from
 * the scene's `.md` body using the boundary metadata stripSceneProse recorded
 * at write time; falls back to whole-body-in-first-prose-block (with a warn)
 * whenever that metadata is absent or inconsistent with the file. Consumes
 * the one-shot `bodySegLen` metadata (call once per scene object — see
 * readManifest's identity de-duplication). Never throws; never drops the body.
 */
function hydrateSceneBlocks(vaultRoot: string, scene: SceneEntry): void {
  const { body, fileKey } = hydrateSceneBody(vaultRoot, scene);
  const blocks = scene.blocks ?? [];
  const clearMeta = () => {
    for (const b of blocks) delete b.bodySegLen;
  };

  if (hasTrivialBlockStructure(blocks)) {
    // 0 blocks or a single prose block — whole-body hydration IS exact.
    clearMeta();
    setSceneProse(scene, body);
    return;
  }

  const metaBlocks = blocks.filter((b) => b.bodySegLen !== undefined);
  const metaValid =
    metaBlocks.length > 0 &&
    metaBlocks.every((b) => Number.isInteger(b.bodySegLen) && (b.bodySegLen as number) > 0);

  if (metaValid) {
    // Reconstruct the layout: segment-bearing blocks in serialization order
    // (stable sort by `order`, matching blocksToMarkdownBody), joined by the
    // fixed two-character blank-line separator.
    const ordered = [...blocks].sort((a, b) => a.order - b.order);
    const withSeg = ordered.filter((b) => b.bodySegLen !== undefined);
    let expectedTotal = 2 * (withSeg.length - 1);
    for (const b of withSeg) expectedTotal += b.bodySegLen as number;

    if (expectedTotal === body.length) {
      // Slice each segment, verify the separators and type markers, and only
      // commit if the WHOLE scene is consistent — a partial restore would
      // silently drop the unverified remainder.
      const contents: string[] = [];
      let offset = 0;
      let consistent = true;
      for (let k = 0; k < withSeg.length; k++) {
        if (k > 0) {
          if (body.slice(offset, offset + 2) !== '\n\n') {
            consistent = false;
            break;
          }
          offset += 2;
        }
        const len = withSeg[k].bodySegLen as number;
        const content = unwrapBlockSegment(withSeg[k].type, body.slice(offset, offset + len));
        if (content === null) {
          consistent = false;
          break;
        }
        contents.push(content);
        offset += len;
      }
      if (consistent) {
        for (let k = 0; k < withSeg.length; k++) withSeg[k].content = contents[k];
        for (const b of blocks) if (b.bodySegLen === undefined) b.content = '';
        clearMeta();
        return;
      }
    }
  }

  // Fallback: whole body into the first prose block (pre-#932 behavior).
  clearMeta();
  if (body === '') {
    // Missing or empty `.md` — nothing to place. Not an external-edit signal
    // (orphaned manifest entries land here), so no warn.
    setSceneProse(scene, body);
    return;
  }
  warnBlockHydrationFallback(
    scene,
    fileKey,
    metaBlocks.length === 0
      ? 'structure-only manifest has no block boundary metadata for this multi-block scene (legacy or hand-edited manifest)'
      : 'block boundary metadata does not match the scene .md body (externally edited?)'
  );
  setSceneProse(scene, body);
}

/**
 * Visit every scene reachable from a manifest — both the nested
 * `stories[].chapters[].scenes[]` structure and the flat legacy `scenes[]` /
 * `chapters[].scenes[]` lists kept for backward compat. Some write paths
 * share object references between the two; others don't. Callers whose `fn`
 * is not idempotent per scene OBJECT (block-aware hydration consumes the
 * one-shot `bodySegLen` metadata) must de-duplicate by object identity.
 */
function forEachManifestScene(manifest: Manifest, fn: (scene: SceneEntry) => void): void {
  for (const story of manifest.stories ?? []) {
    for (const chapter of story.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) fn(scene);
    }
  }
  for (const chapter of manifest.chapters ?? []) {
    for (const scene of chapter.scenes ?? []) fn(scene);
  }
  for (const scene of manifest.scenes ?? []) fn(scene);
}

export function readManifest(manifestPath: string): Manifest {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
  const manifestDir = path.dirname(manifestPath);
  // Beta 4 M9 (found by the comments vault-copy round-trip): a MythosVault v2
  // manifest is the regenerable cache at `<Story Vault>/.mythos/manifest-cache.json`
  // (MYTHOS_MACHINE_DIRNAME in mythosFormat/mythosJson.ts — not imported here
  // to keep vault.ts free of a module cycle). Scene `path`s are relative to
  // the STORY VAULT root, so hydrating against `.mythos/` resolved every
  // scene body to a missing file and served empty block content for all v2
  // vaults. v0.4 manifests live at `<Story Vault>/manifest.json`, where the
  // dirname IS the vault root.
  const vaultRoot =
    path.basename(manifestDir) === '.mythos' ? path.dirname(manifestDir) : manifestDir;
  // De-duplicate by object identity: hydration consumes the one-shot
  // `bodySegLen` metadata, so a scene object shared between the nested and
  // flat lists must be hydrated exactly once. (JSON.parse never produces
  // shared references, but readManifest's contract shouldn't depend on that.)
  const hydrated = new Set<SceneEntry>();
  forEachManifestScene(manifest, (scene) => {
    if (hydrated.has(scene)) return;
    hydrated.add(scene);
    hydrateSceneBlocks(vaultRoot, scene);
  });
  return manifest;
}

/** Returns the byte length of the manifest content actually written to disk. */
export function writeManifest(manifestPath: string, manifest: Manifest): number {
  return writeManifestAtomic(manifestPath, manifest);
}

/**
 * SKY-6596 migration safety net. For every scene whose manifest entry still
 * carries embedded block content (a pre-migration vault, or a hand-edited
 * one) but has no readable `.md` file backing it, write the full serialized
 * body out to a `.md` file now — *before* the migration write-back
 * (`beforeMigrationWrite` in manifest.ts's `openManifest`) unconditionally
 * strips embedded prose from the manifest on write. Never lets prose be
 * dropped without another home. Pure side effect — returns the manifest
 * unchanged.
 */
export function ensureSceneFilesForManifestScenes(manifest: Manifest, vaultRoot: string): Manifest {
  forEachManifestScene(manifest, (scene) => {
    // PR #932 review: recover the FULL serialized body — every block, in
    // order, wrapped in its type marker — not just the first prose block's
    // content, so a multi-block pre-migration scene loses nothing. Written
    // with the exact serializer stripSceneProse derives its `bodySegLen`
    // boundary metadata from, so the migrated manifest's metadata matches
    // this file byte-for-byte and the next readManifest restores every block.
    const embeddedBody = blocksToMarkdownBody(scene.blocks ?? []);
    if (!embeddedBody) return;
    try {
      readSceneFile(vaultRoot, scene.path);
      return; // `.md` already exists and parses — nothing to recover.
    } catch {
      // Missing or corrupt — recover it below.
    }
    try {
      writeSceneFileAtomic(vaultRoot, scene.path, {
        id: scene.id,
        title: scene.title,
        chapterId: scene.chapterId,
        storyId: scene.storyId,
        order: scene.order,
        prose: embeddedBody,
      });
    } catch {
      // Path is unsafe or unwritable — leave the embedded prose in the
      // manifest object; the pre-migration backup written by openManifest
      // just before this hook runs still has it either way.
    }
  });
  return manifest;
}

export function defaultManifest(vaultRoot: string): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    version: '2.0.0',
    vaultRoot,
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };
}

// ─── Vault index cache ────────────────────────────────────────────────────────
// Persisted between runs to skip re-reading files whose mtime+size are unchanged.

export interface VaultIndexCacheEntry {
  mtimeMs: number;
  size: number;
}

export interface VaultIndexCache {
  /** app version string that wrote this cache — invalidated on upgrade */
  appVersion: string;
  /** manifest schemaVersion that wrote this cache — invalidated on schema bump */
  schemaVersion: number;
  /** relative path → { mtimeMs, size } for each scanned file */
  entries: Record<string, VaultIndexCacheEntry>;
}

/** Stable hash of the vault root path used as the cache filename. */
export function vaultRootHash(vaultRoot: string): string {
  return crypto.createHash('sha1').update(vaultRoot).digest('hex').slice(0, 16);
}

/**
 * Load the per-vault index cache from disk.
 * Returns null when the file is absent, malformed, or invalidated by version/schema change.
 */
export function loadVaultIndexCache(
  cacheDir: string,
  vaultRoot: string,
  appVersion: string,
  schemaVersion: number,
): VaultIndexCache | null {
  const cachePath = path.join(cacheDir, `${vaultRootHash(vaultRoot)}.json`);
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as VaultIndexCache;
    if (parsed.appVersion !== appVersion || parsed.schemaVersion !== schemaVersion) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the vault index cache to disk (best-effort; errors are swallowed). */
export function saveVaultIndexCache(
  cacheDir: string,
  vaultRoot: string,
  cache: VaultIndexCache,
): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${vaultRootHash(vaultRoot)}.json`);
    writeFileAtomic(cachePath, JSON.stringify(cache));
  } catch {
    // Non-fatal — warm start just degrades to cold next time
  }
}

// ─── Reconcile: markdown → manifest ───
// On app open, scan vault for .md files and update manifest entries
// that have changed prose since last index.
// Conflict policy: manifest is source of truth for structure;
// markdown prose overwrites manifest block content.

export function reindexVault(
  vaultRoot: string,
  manifest: Manifest,
  cache?: VaultIndexCache | null,
): {
  manifest: Manifest;
  scanned: number;
  updated: number;
  skipped: number;
  cacheEntries: Record<string, VaultIndexCacheEntry>;
} {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const cacheEntries: Record<string, VaultIndexCacheEntry> = {};

  const allFiles = collectMarkdownFiles(vaultRoot);

  // Build lookup maps for quick access
  const sceneById = new Map<string, SceneEntry>();
  for (const story of manifest.stories ?? []) {
    for (const chapter of story.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) {
        sceneById.set(scene.id, scene);
      }
    }
  }
  for (const scene of manifest.scenes) sceneById.set(scene.id, scene);

  for (const relPath of allFiles) {
    scanned++;
    const fullPath = path.join(vaultRoot, relPath);
    const stat = fs.statSync(fullPath);
    const modifiedAt = stat.mtime.toISOString();

    // Warm-start: skip full read when mtime + size unchanged since last cache write
    const cached = cache?.entries[relPath];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cacheEntries[relPath] = cached;
      skipped++;
      continue;
    }

    cacheEntries[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size };

    try {
      const data = readSceneFile(vaultRoot, relPath);
      const existing = sceneById.get(data.id);

      if (existing) {
        const existingModified = existing.updatedAt;
        if (modifiedAt > existingModified) {
          // Markdown changed after last manifest write — sync prose into the first prose block
          const proseBlock = existing.blocks.find((b) => b.type === 'prose');
          if (proseBlock) {
            if (proseBlock.content !== data.prose) {
              proseBlock.content = data.prose;
              proseBlock.updatedAt = modifiedAt;
              existing.updatedAt = modifiedAt;
              updated++;
            }
          } else {
            existing.blocks.push({
              id: crypto.randomUUID(),
              type: 'prose',
              order: 0,
              content: data.prose,
              updatedAt: modifiedAt,
            });
            existing.updatedAt = modifiedAt;
            updated++;
          }
          // Update card fields from frontmatter if present
          if (data.goal || data.conflict || data.outcome) {
            existing.card = {
              goal: data.goal,
              conflict: data.conflict,
              outcome: data.outcome,
              pov: data.pov,
              tags: data.tags,
            };
          }
        }
      } else {
        // New file not in manifest — add as orphan scene
        const newScene: SceneEntry = {
          id: data.id,
          title: data.title,
          path: relPath,
          order: 0,
          blocks: [
            {
              id: crypto.randomUUID(),
              type: 'prose',
              order: 0,
              content: data.prose,
              updatedAt: modifiedAt,
            },
          ],
          card: {
            goal: data.goal,
            conflict: data.conflict,
            outcome: data.outcome,
            pov: data.pov,
            tags: data.tags,
          },
          createdAt: modifiedAt,
          updatedAt: modifiedAt,
        };
        manifest.scenes.push(newScene);
        sceneById.set(newScene.id, newScene);
        updated++;
      }
    } catch {
      // Not a scene file — skip silently
    }
  }

  return { manifest, scanned, updated, skipped, cacheEntries };
}

function collectMarkdownFiles(dir: string, base = ''): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // skip symlinks — they may escape the vault
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      // SKY-10: skip `versions/` — snapshot files are not scenes.
      if (entry.name === 'versions') continue;
      // M5 (MythosVault v2): skip `drafts/` — numbered draft snapshots are
      // history, not scenes (they would otherwise be adopted as orphans).
      if (entry.name === 'drafts') continue;
      results.push(...collectMarkdownFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      // SKY-10: chapter.md is metadata, not a scene.
      if (entry.name === CHAPTER_META_FILENAME) continue;
      // M5 (MythosVault v2): book.md is compiled order + metadata, not a scene.
      if (entry.name === 'book.md') continue;
      results.push(rel);
    }
  }
  return results;
}

// ─── Import existing Obsidian vault ───
// Copies .md files into the vault folder and reindexes.

export function importObsidianVault(
  sourcePath: string,
  vaultRoot: string,
  manifest: Manifest
): { imported: number; skipped: number; errors: string[] } {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // realpath-check source — don't import from symlinked directories
  const realSource = fs.realpathSync.native(sourcePath);
  // (No vault containment check for source — it's user-provided, but we realpath it
  // so the collected files are resolved to their actual targets.)

  const files = collectMarkdownFiles(sourcePath);
  for (const relPath of files) {
    try {
      const srcFull = path.join(sourcePath, relPath);
      const realSrcFull = fs.realpathSync.native(srcFull);
      const dstFull = path.join(vaultRoot, relPath);

      if (fs.existsSync(dstFull)) {
        skipped++;
        continue;
      }

      // MYT-447: cap source file size before reading so a multi-GB .md doesn't OOM the main process.
      const srcSize = fs.statSync(srcFull).size;
      if (srcSize > MAX_VAULT_FILE_BYTES) {
        errors.push(`${relPath}: ${new VaultFileTooLargeError(srcSize).message}`);
        continue;
      }

      let content = fs.readFileSync(realSrcFull, 'utf-8');
      const { frontmatter, prose } = parseFrontmatter(content);

      // Assign an id if none present (standard Obsidian files won't have one)
      if (!frontmatter.id) {
        frontmatter.id = crypto.randomUUID();
        frontmatter.title = frontmatter.title ?? path.basename(relPath, '.md');
        content = serializeFrontmatter(frontmatter, prose);
      }

      writeVaultFileAtomic(vaultRoot, relPath, content);
      imported++;
    } catch (err) {
      errors.push(`${relPath}: ${(err as Error).message}`);
    }
  }

  return { imported, skipped, errors };
}

// ─── File watcher ───

// Self-write suppression: the app's own vault writes must not re-enter the
// change watchers. Before this guard, every autosave fired watcher →
// debounced full reindex + manifest rewrite + FTS rebuild, all synchronous on
// the main-process event loop, with cost growing with vault size (the
// long-session freeze root cause). IPC handlers already keep the manifest and
// FTS in sync for their own writes, so watcher-driven reindexing is only
// needed for external edits (e.g. Obsidian).
// TTL must exceed chokidar's awaitWriteFinish window (300 ms stability) plus
// fs event latency; entries self-expire so external edits are never masked
// for long.
const SELF_WRITE_TTL_MS = 2500;
const selfWrites = new Map<string, { mtimeMs: number; size: number; expiresAt: number }>();

/**
 * Record the on-disk identity (mtime + size) of a file the app just wrote.
 * Must be called AFTER the write/rename lands so the recorded stat matches
 * what the watcher will observe.
 */
export function markSelfWrite(absPath: string, ttlMs = SELF_WRITE_TTL_MS): void {
  const now = Date.now();
  if (selfWrites.size > 64) {
    for (const [key, entry] of selfWrites) {
      if (entry.expiresAt <= now) selfWrites.delete(key);
    }
  }
  const key = path.normalize(absPath);
  try {
    const st = fs.statSync(key);
    selfWrites.set(key, { mtimeMs: st.mtimeMs, size: st.size, expiresAt: now + ttlMs });
  } catch { /* file vanished — nothing to suppress */ }
}

/**
 * True when a watcher event refers to a file that is byte-for-byte still the
 * app's own recent write (same mtime + size as recorded). Identity-based
 * rather than count-based on purpose: chokidar's awaitWriteFinish coalesces
 * an app write and an external edit landing shortly after into ONE event —
 * the stat comparison detects the external content and lets it through,
 * where consume-once/TTL suppression silently dropped it.
 */
export function isRecentSelfWrite(absPath: string): boolean {
  const key = path.normalize(absPath);
  const entry = selfWrites.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    selfWrites.delete(key);
    return false;
  }
  try {
    const st = fs.statSync(key);
    return st.mtimeMs === entry.mtimeMs && st.size === entry.size;
  } catch {
    return false; // deleted since our write — external, let it through
  }
}

let activeWatcher: FSWatcher | null = null;

export async function startVaultWatcher(
  vaultRoot: string,
  onChanged: (filePath: string) => void
): Promise<void> {
  if (activeWatcher) return;

  const { default: chokidar } = await import('chokidar');
  // chokidar v4+ requires ignored to be a function (regex/glob support removed).
  // GH#892: the previous regex was also syntactically wrong — `\\.` in a regex
  // literal is "backslash + any char", not "literal dot" — so dotfiles were
  // never actually ignored and the TypeError from calling a RegExp as a function
  // silently killed event delivery for all paths below the vault root.
  activeWatcher = chokidar.watch(vaultRoot, {
    // Ignore dotdirs (e.g. .mythos SQLite DB + WAL, .snapshots) and the
    // version-history dir — every save writes versions/<id>/*.md, which
    // would otherwise fire the watcher (and a full reindex) twice per save.
    ignored: (filePath: string) => {
      const base = path.basename(filePath);
      return base.startsWith('.') || base === 'versions';
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    followSymlinks: false, // MYT-445/MYT-362: don't recurse into symlinked dirs
  });

  activeWatcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md') && !isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeWatcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.md') && !isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeWatcher.on('unlink', (filePath: string) => {
    if (!isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeWatcher.on('addDir', (filePath: string) => {
    onChanged(filePath);
  });
  activeWatcher.on('unlinkDir', (filePath: string) => {
    onChanged(filePath);
  });
}

export async function stopVaultWatcher(): Promise<void> {
  if (activeWatcher) {
    await activeWatcher.close();
    activeWatcher = null;
  }
}

// ─── Vault scaffold ───
// Creates the standard subdirectory structure for each vault type on first run.
//
// SKY-9 / SKY-15: seeding is idempotent — directories are only created when
// missing, files are only written when missing. `.gitkeep` is only written
// when its parent directory is freshly made. Re-running the scaffold on a
// populated vault is a no-op. Two modes are supported: `default` produces
// the SKY-15 canonical layout with example content; `blank` produces only
// the top-level vault folder (the user organizes from scratch).

/** SKY-15 layout mode. `imported` is treated as `blank` for seeding purposes
 *  — the importer is responsible for writing whatever content the source
 *  vault contains. */
export type VaultLayoutMode = 'default' | 'blank';

function seedDir(parentRoot: string, dirName: string): void {
  const full = path.join(parentRoot, dirName);
  const wasMissing = !fs.existsSync(full);
  if (wasMissing) fs.mkdirSync(full, { recursive: true });
  // Only drop a .gitkeep if the directory we just created is genuinely empty.
  // This avoids littering user-populated structures with stray sentinel files
  // on a re-scaffold.
  if (wasMissing) {
    const gitkeep = path.join(full, '.gitkeep');
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
  }
}

function seedFile(parentRoot: string, relPath: string, contents: string): void {
  const full = path.join(parentRoot, relPath);
  if (fs.existsSync(full)) return; // never overwrite a user-edited seed
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf-8');
}

// ── Story Vault default layout (SKY-15) ─────────────────────────────────────
// Per-story folder → Manuscript/ → numbered chapter folders → numbered scene
// files, plus seeded Outline.md and Synopsis.md at the story root. The example
// `My First Story/` is a real folder name the user can rename — empty
// `<Story Title>` placeholders read as "fill in the blank" homework and
// undermine the point of seeding.
export const STORY_VAULT_EXAMPLE_STORY = 'My First Story';
export const STORY_VAULT_EXAMPLE_CHAPTERS = ['01 - Opening'] as const;
export const STORY_VAULT_EXAMPLE_SCENE_FILE = '01 - Scene One.md';

const OUTLINE_SEED = `---
seeded_by: SKY-9
---
# Outline

One bullet per beat. Rename or delete this file when you have your own.
`;

const SYNOPSIS_SEED = `---
seeded_by: SKY-9
---
# Synopsis

A one-paragraph pitch for this story. Rename or delete this file when you have your own.
`;

const SCENE_SEED = `---
seeded_by: SKY-9
---
# Scene One

The story begins here. Delete this scene or rewrite it — the file path
(\`Manuscript/<chapter>/<scene>.md\`) is what the app indexes.
`;

// SKY-7473 (M29 welcome wizard): starter beat sheet, seeded next to
// Outline.md/Synopsis.md so all three story-planning notes live together.
const BEAT_SHEET_SEED = `---
seeded_by: SKY-7473
---
# Beat Sheet

A short list of the big story beats, in order. Fill in your own as you plan.

1. Opening — where the story starts.
2. Inciting incident — the event that sets things moving.
3. First turn — a choice that raises the stakes.
4. Midpoint — something changes for good or bad.
5. Crisis — the low point before the end.
6. Climax — the final confrontation.
7. Resolution — where things land.

Rename or delete this file when you have your own.
`;

export function scaffoldStoryVault(
  storyVaultRoot: string,
  mode: VaultLayoutMode = 'default'
): void {
  if (mode === 'blank') return;
  const storyRoot = path.join(STORY_VAULT_EXAMPLE_STORY);
  for (const chapter of STORY_VAULT_EXAMPLE_CHAPTERS) {
    const chapterRel = path.join(storyRoot, MANUSCRIPT_DIR, chapter);
    const chapterFull = path.join(storyVaultRoot, chapterRel);
    if (!fs.existsSync(chapterFull)) {
      fs.mkdirSync(chapterFull, { recursive: true });
    }
    seedFile(storyVaultRoot, path.join(chapterRel, STORY_VAULT_EXAMPLE_SCENE_FILE), SCENE_SEED);
  }
  seedFile(storyVaultRoot, path.join(storyRoot, 'Outline.md'), OUTLINE_SEED);
  seedFile(storyVaultRoot, path.join(storyRoot, 'Synopsis.md'), SYNOPSIS_SEED);
  seedFile(storyVaultRoot, path.join(storyRoot, 'Beat Sheet.md'), BEAT_SHEET_SEED);
}

// ── Notes Vault default layout (SKY-15) ─────────────────────────────────────
// Six top-level folders replace the old Q4.5 example (Universes + Story ideas).
// `Stories/` mirrors the Story Vault sibling. `Inbox/` is the Brainstorm
// Agent's drop zone for unclassified notes. `Daily Notes/` matches the
// Obsidian convention. `Archive/` lets notes retire without being deleted.
export const NOTES_VAULT_DIRS = [
  'Universes',
  'Stories',
  'Inbox',
  'Research',
  'Daily Notes',
  'Archive',
] as const;

// Example universe seeded inside `Universes/` in default mode. The six
// sub-categories (Characters/Locations/Factions/History/Systems/Items)
// match the SKY-15 plan exactly — `Systems/` generalises the old
// `Magic & Systems`, and `Society & Governance` is folded into Factions.
export const NOTES_VAULT_EXAMPLE_UNIVERSE = 'My First Universe';
export const NOTES_VAULT_EXAMPLE_UNIVERSE_DIRS = [
  'Characters',
  'Locations',
  'Factions',
  'History',
  'Systems',
  'Items',
] as const;
export const NOTES_VAULT_EXAMPLE_STORY = 'My First Story';

// SKY-7473 (M29 welcome wizard): starter reference notes, seeded once per
// the acceptance criteria ("Templates note", "Personas note" seeded on
// completion). Skipped for mode='blank' like the rest of this scaffold —
// Blank Slate keeps its "no pre-seeded content" promise.
const TEMPLATES_SEED = `---
seeded_by: SKY-7473
---
# Templates

Reusable starting points for new stories and notes live here.

Copy a template into Stories/ or Universes/ when you start something new.
Rename or delete this file anytime.
`;

const PERSONAS_SEED = `---
seeded_by: SKY-7473
---
# Personas

Short profiles for your main characters. One entry per character:

- Name
- Role in the story
- One sentence about what they want

Rename or delete this file when you have your own character notes.
`;

export function scaffoldNotesVault(
  notesVaultRoot: string,
  mode: VaultLayoutMode = 'default'
): void {
  if (mode === 'blank') return;
  for (const dir of NOTES_VAULT_DIRS) seedDir(notesVaultRoot, dir);
  // Seeded example universe under Universes/. seedDir keeps .gitkeep
  // idempotency for the per-category subfolders.
  for (const sub of NOTES_VAULT_EXAMPLE_UNIVERSE_DIRS) {
    seedDir(
      path.join(notesVaultRoot, 'Universes', NOTES_VAULT_EXAMPLE_UNIVERSE),
      sub
    );
  }
  // Per-story notes folder under Stories/ that mirrors the Story Vault
  // example. The Brainstorm Agent uses this on first run.
  seedDir(path.join(notesVaultRoot, 'Stories'), NOTES_VAULT_EXAMPLE_STORY);
  seedFile(notesVaultRoot, 'Templates.md', TEMPLATES_SEED);
  seedFile(
    notesVaultRoot,
    path.join('Universes', NOTES_VAULT_EXAMPLE_UNIVERSE, 'Personas.md'),
    PERSONAS_SEED
  );
}

/**
 * SKY-9: returns true when a vault root either doesn't exist or exists but
 * contains nothing (including no dotfiles). Used by ensure*VaultDir to treat
 * an empty user-chosen directory as "needs first-run seeding".
 */
export function isEmptyOrMissing(root: string): boolean {
  if (!fs.existsSync(root)) return true;
  try {
    return fs.readdirSync(root).length === 0;
  } catch {
    return false;
  }
}

// ─── Notes Vault watcher (separate instance from Story Vault watcher) ───

let activeNotesWatcher: FSWatcher | null = null;

export async function startNotesVaultWatcher(
  vaultRoot: string,
  onChanged: (filePath: string) => void
): Promise<void> {
  if (activeNotesWatcher) return;

  const { default: chokidar } = await import('chokidar');
  // Same fix as startVaultWatcher (GH#892): chokidar v4+ requires a function.
  activeNotesWatcher = chokidar.watch(vaultRoot, {
    ignored: (filePath: string) => path.basename(filePath).startsWith('.'),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    followSymlinks: false, // MYT-362: don't recurse into symlinked dirs
  });

  activeNotesWatcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md') && !isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeNotesWatcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.md') && !isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeNotesWatcher.on('unlink', (filePath: string) => {
    if (!isRecentSelfWrite(filePath)) onChanged(filePath);
  });
  activeNotesWatcher.on('addDir', (filePath: string) => onChanged(filePath));
  activeNotesWatcher.on('unlinkDir', (filePath: string) => onChanged(filePath));
}

export async function stopNotesVaultWatcher(): Promise<void> {
  if (activeNotesWatcher) {
    await activeNotesWatcher.close();
    activeNotesWatcher = null;
  }
}

// ─── Obsidian dry-run ───
// Scans an Obsidian vault directory and reports potential import issues
// without making any changes to disk.

export function obsidianDryRun(
  sourcePath: string,
  existingManifest: Manifest | null
): VaultObsidianDryRunReport {
  if (!fs.existsSync(sourcePath)) {
    return {
      notesCount: 0,
      brokenLinks: [],
      nameCollisions: [],
      missingFrontmatter: [],
      fatalError: `Path does not exist: ${sourcePath}`,
    };
  }

  let fatalError: string | null = null;
  const files: string[] = [];

  try {
    const allFiles = collectMarkdownFiles(sourcePath);
    files.push(...allFiles);
  } catch (err) {
    fatalError = (err as Error).message;
    return {
      notesCount: 0,
      brokenLinks: [],
      nameCollisions: [],
      missingFrontmatter: [],
      fatalError,
    };
  }

  // Build set of file stems for broken-link detection
  const stemSet = new Set(
    files.map((f) => path.basename(f, '.md').toLowerCase()),
  );

  // Build set of existing entity names for collision detection
  const existingNames = new Set<string>();
  if (existingManifest) {
    for (const entity of existingManifest.entities ?? []) {
      existingNames.add(entity.name.toLowerCase());
    }
  }

  const brokenLinks: ObsidianBrokenLink[] = [];
  const nameCollisions: ObsidianNameCollision[] = [];
  const missingFrontmatter: string[] = [];
  const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  for (const relPath of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(sourcePath, relPath), 'utf-8');
    } catch {
      continue;
    }

    // Check for missing frontmatter
    if (!/^---\r?\n/.test(raw)) {
      missingFrontmatter.push(relPath);
    }

    // Check for broken wiki-links
    let m: RegExpExecArray | null;
    WIKI_LINK_RE.lastIndex = 0;
    while ((m = WIKI_LINK_RE.exec(raw)) !== null) {
      const target = m[1].trim();
      if (!stemSet.has(target.toLowerCase())) {
        brokenLinks.push({ file: relPath, target: `[[${target}]]` });
      }
    }

    // Check for name collisions with existing entities
    const stem = path.basename(relPath, '.md');
    if (existingNames.has(stem.toLowerCase())) {
      nameCollisions.push({ name: stem, file: relPath });
    }
  }

  return {
    notesCount: files.length,
    brokenLinks,
    nameCollisions,
    missingFrontmatter,
    fatalError,
  };
}

// ─── Provenance frontmatter merge ───
// Merges agent provenance metadata into an existing vault file's frontmatter
// while preserving (or replacing) the prose body.

interface ProvenanceFields {
  source_agent: string;
  confidence: number;
  rationale: string;
  timestamp: string;
  run_id?: string;
  suggestion_id?: string;
}

export function mergeProvenanceFrontmatter(
  vaultRoot: string,
  filePath: string,
  provenance: ProvenanceFields,
  newProse: string
): void {
  const fullPath = safePath(vaultRoot, filePath);

  let existingFm: Frontmatter = {};
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    existingFm = parseFrontmatter(raw).frontmatter;
  } catch {
    // New file — start with empty frontmatter
  }

  const merged: Frontmatter = {
    ...existingFm,
    provenance_source_agent: provenance.source_agent,
    provenance_confidence: provenance.confidence,
    provenance_rationale: provenance.rationale,
    provenance_timestamp: provenance.timestamp,
    ...(provenance.run_id ? { provenance_run_id: provenance.run_id } : {}),
    ...(provenance.suggestion_id
      ? { provenance_suggestion_id: provenance.suggestion_id }
      : {}),
    updatedAt: provenance.timestamp,
  };

  const content = serializeFrontmatter(merged, newProse);
  writeVaultFileAtomic(vaultRoot, filePath, content);
}

// ─── Timeline settings persistence (SKY-791) ───

const TIMELINE_SETTINGS_FILENAME = 'timeline-settings.json';
const ARCS_FILENAME = 'arcs.json';

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  primaryGrouping: 'arc',
  spacingMode: 'uniform',
  showUndatedScenes: true,
  autoLayoutTracks: true,
  defaultColorScheme: 'liquid-neon',
  visibleTrackFilters: [],
};

export function readTimelineSettings(vaultRoot: string): TimelineSettings {
  const settingsPath = path.join(vaultRoot, TIMELINE_SETTINGS_FILENAME);
  if (!fs.existsSync(settingsPath)) return { ...DEFAULT_TIMELINE_SETTINGS };
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    return { ...DEFAULT_TIMELINE_SETTINGS, ...(JSON.parse(raw) as Partial<TimelineSettings>) };
  } catch {
    return { ...DEFAULT_TIMELINE_SETTINGS };
  }
}

export function writeTimelineSettings(vaultRoot: string, settings: TimelineSettings): void {
  const settingsPath = path.join(vaultRoot, TIMELINE_SETTINGS_FILENAME);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function readArcManifest(vaultRoot: string): ArcEntry[] {
  const arcsPath = path.join(vaultRoot, ARCS_FILENAME);
  if (!fs.existsSync(arcsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(arcsPath, 'utf-8')) as ArcEntry[];
  } catch {
    return [];
  }
}

export function writeArcManifest(vaultRoot: string, arcs: ArcEntry[]): void {
  const arcsPath = path.join(vaultRoot, ARCS_FILENAME);
  fs.writeFileSync(arcsPath, JSON.stringify(arcs, null, 2), 'utf-8');
}
