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
} from './ipc.js';
import { writeManifestAtomic, SCHEMA_VERSION } from './manifest.js';
import { safeVaultJoin } from './vault/safeVaultJoin.js';

export {
  safeVaultJoin,
  safeVaultIpcJoin,
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
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // skip symlinks — they may escape the vault
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);
      items.push({
        path: relativePath,
        name: entry.name,
        isDirectory: entry.isDirectory(),
        modifiedAt: new Date(fs.statSync(fullPath).mtime).toISOString(),
      });
      if (entry.isDirectory()) walk(fullPath, relativePath);
    }
  }

  walk(baseDir, '');
  return { items };
}

export function deleteVaultFile(vaultRoot: string, filePath: string): { path: string; deleted: boolean } {
  const fullPath = realSafePath(vaultRoot, filePath, true);
  const exists = fs.existsSync(fullPath);
  if (exists) fs.unlinkSync(fullPath);
  return { path: filePath, deleted: exists };
}

// ─── YAML frontmatter helpers ───
// Obsidian uses `---\nkey: value\n---\ncontent` format.

interface Frontmatter {
  [key: string]: unknown;
}

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; prose: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, prose: raw };

  const fm: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    // Parse arrays like `tags: [a, b]`
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
      lines.push(`${key}: [${val.join(', ')}]`);
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
  prose: string;
}

export function writeSceneFile(vaultRoot: string, relativePath: string, data: SceneFileData): void {
  const fm: Frontmatter = {
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
    updatedAt: new Date().toISOString(),
  };
  const content = serializeFrontmatter(fm, data.prose);
  writeVaultFileAtomic(vaultRoot, relativePath, content);
}

/** Atomic variant of writeSceneFile — temp + fdatasync + rename. */
export function writeSceneFileAtomic(vaultRoot: string, relativePath: string, data: SceneFileData): void {
  const fm: Frontmatter = {
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
    updatedAt: new Date().toISOString(),
  };
  const content = serializeFrontmatter(fm, data.prose);
  writeVaultFileAtomic(vaultRoot, relativePath, content);
}

export function readSceneFile(vaultRoot: string, relativePath: string): SceneFileData {
  const { content } = readVaultFile(vaultRoot, relativePath);
  const { frontmatter, prose } = parseFrontmatter(content);

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

export function readManifest(manifestPath: string): Manifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
}

export function writeManifest(manifestPath: string, manifest: Manifest): void {
  writeManifestAtomic(manifestPath, manifest);
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

// ─── Reconcile: markdown → manifest ───
// On app open, scan vault for .md files and update manifest entries
// that have changed prose since last index.
// Conflict policy: manifest is source of truth for structure;
// markdown prose overwrites manifest block content.

export function reindexVault(
  vaultRoot: string,
  manifest: Manifest
): { manifest: Manifest; scanned: number; updated: number } {
  let scanned = 0;
  let updated = 0;

  const allFiles = collectMarkdownFiles(vaultRoot);

  // Build lookup maps for quick access
  const sceneById = new Map<string, SceneEntry>();
  for (const story of manifest.stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
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

  return { manifest, scanned, updated };
}

function collectMarkdownFiles(dir: string, base = ''): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // skip symlinks — they may escape the vault
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      results.push(...collectMarkdownFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
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

let activeWatcher: FSWatcher | null = null;

export async function startVaultWatcher(
  vaultRoot: string,
  onChanged: (filePath: string) => void
): Promise<void> {
  if (activeWatcher) return;

  const { default: chokidar } = await import('chokidar');
  activeWatcher = chokidar.watch(vaultRoot, {
    ignored: /(^|[/\\\\])\\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    followSymlinks: false, // MYT-445/MYT-362: don't recurse into symlinked dirs
  });

  activeWatcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md')) onChanged(filePath);
  });
  activeWatcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.md')) onChanged(filePath);
  });
  activeWatcher.on('unlink', (filePath: string) => {
    onChanged(filePath);
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

export function scaffoldStoryVault(storyVaultRoot: string): void {
  const dirs = ['Projects'];
  for (const dir of dirs) {
    const full = path.join(storyVaultRoot, dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}

const NOTES_VAULT_DIRS = ['Notes', 'Characters', 'Locations', 'Items', 'Concepts'];

export function scaffoldNotesVault(vaultRoot: string): void {
  for (const dir of NOTES_VAULT_DIRS) {
    const full = path.join(vaultRoot, dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
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
  activeNotesWatcher = chokidar.watch(vaultRoot, {
    ignored: /(^|[/\\\\])\\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    followSymlinks: false, // MYT-362: don't recurse into symlinked dirs
  });

  activeNotesWatcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md')) onChanged(filePath);
  });
  activeNotesWatcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.md')) onChanged(filePath);
  });
  activeNotesWatcher.on('unlink', (filePath: string) => onChanged(filePath));
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
