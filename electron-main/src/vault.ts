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
} from './ipc.js';
import { writeManifestAtomic, SCHEMA_VERSION } from './manifest.js';

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

// ─── Path safety ───

export function safePath(vaultRoot: string, relativePath: string): string {
  const resolved = path.resolve(vaultRoot, relativePath);
  if (!resolved.startsWith(path.resolve(vaultRoot) + path.sep) && resolved !== path.resolve(vaultRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

// ─── Basic R/W (used by legacy IPC channels) ───

export function readVaultFile(vaultRoot: string, filePath: string): { content: string; path: string } {
  const fullPath = safePath(vaultRoot, filePath);
  return { content: fs.readFileSync(fullPath, 'utf-8'), path: filePath };
}

export function writeVaultFile(
  vaultRoot: string,
  filePath: string,
  content: string
): { path: string; bytes: number } {
  const fullPath = safePath(vaultRoot, filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return { path: filePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

export function listVaultFiles(
  vaultRoot: string,
  root?: string
): { items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> } {
  const baseDir = root ? safePath(vaultRoot, root) : vaultRoot;
  const items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> = [];

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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
  const fullPath = safePath(vaultRoot, filePath);
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
  writeVaultFile(vaultRoot, relativePath, content);
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
  writeVaultFile(vaultRoot, relativePath, serializeFrontmatter(fm, data.prose));
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

  const files = collectMarkdownFiles(sourcePath);
  for (const relPath of files) {
    try {
      const srcFull = path.join(sourcePath, relPath);
      const dstFull = path.join(vaultRoot, relPath);
      const dstDir = path.dirname(dstFull);

      if (fs.existsSync(dstFull)) {
        skipped++;
        continue;
      }

      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

      let content = fs.readFileSync(srcFull, 'utf-8');
      const { frontmatter, prose } = parseFrontmatter(content);

      // Assign an id if none present (standard Obsidian files won't have one)
      if (!frontmatter.id) {
        frontmatter.id = crypto.randomUUID();
        frontmatter.title = frontmatter.title ?? path.basename(relPath, '.md');
        content = serializeFrontmatter(frontmatter, prose);
      }

      fs.writeFileSync(dstFull, content, 'utf-8');
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
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
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
