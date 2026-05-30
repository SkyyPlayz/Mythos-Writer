// Notes-Vault tag wrangler — list / rename / merge tags across all notes.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import { parseFrontmatter, serializeFrontmatter, writeFileAtomic } from './vault.js';

// ─── Public types ───

export interface TagEntry {
  /** Short display label (last path segment after '/') */
  name: string;
  /** Full dot-separated tag path, e.g. "world/factions/order-of-dawn" */
  fullName: string;
  /** Number of notes files that carry exactly this tag */
  count: number;
  /** Vault-relative paths of notes that carry exactly this tag */
  paths: string[];
  children: TagEntry[];
}

export interface TagRenameResult {
  affectedFiles: number;
}

export interface TagMergeResult {
  affectedFiles: number;
}

// ─── Internal helpers ───

/** Walk the notes vault and return all .md relative paths, ignoring dotfile dirs. */
function collectNotesMdFiles(dir: string, base = ''): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectNotesMdFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      results.push(rel);
    }
  }
  return results;
}

/** Read the `tags` array from the YAML frontmatter of a notes file. Returns [] on any error. */
function readFileTags(notesRoot: string, relPath: string): string[] {
  try {
    const content = fs.readFileSync(path.join(notesRoot, relPath), 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    if (Array.isArray(frontmatter.tags)) {
      return frontmatter.tags.map(String).filter(Boolean);
    }
  } catch { /* skip unreadable / missing files */ }
  return [];
}

/**
 * Build a nested TagEntry tree from a flat map of tag → { count, paths }.
 *
 * Tags are split on '/' to build hierarchy:
 *   "world/factions/order-of-dawn" → world > factions > order-of-dawn
 */
function buildTagTree(tagData: Map<string, { count: number; paths: string[] }>): TagEntry[] {
  interface Node {
    fullName: string;
    count: number;
    paths: string[];
    children: Map<string, Node>;
  }

  const roots = new Map<string, Node>();

  function getOrCreate(map: Map<string, Node>, segment: string, fullName: string): Node {
    if (!map.has(segment)) {
      map.set(segment, { fullName, count: 0, paths: [], children: new Map() });
    }
    return map.get(segment)!;
  }

  // Sort for stable ordering
  const sorted = [...tagData.keys()].sort();

  for (const tag of sorted) {
    const parts = tag.split('/').filter(Boolean);
    let currentMap = roots;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const fullName = parts.slice(0, i + 1).join('/');
      const node = getOrCreate(currentMap, segment, fullName);
      if (i === parts.length - 1) {
        // Leaf node: assign actual count and paths
        const data = tagData.get(tag)!;
        node.count = data.count;
        node.paths = data.paths;
      }
      currentMap = node.children;
    }
  }

  function toEntry(name: string, node: Node): TagEntry {
    return {
      name,
      fullName: node.fullName,
      count: node.count,
      paths: node.paths,
      children: [...node.children.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([seg, child]) => toEntry(seg, child)),
    };
  }

  return [...roots.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([seg, node]) => toEntry(seg, node));
}

// ─── Public API ───

/**
 * Scan all .md files in the notes vault and return a nested tag tree.
 * Each leaf entry includes count and vault-relative file paths.
 */
export function listNotesTags(notesRoot: string): TagEntry[] {
  const files = collectNotesMdFiles(notesRoot);
  const tagData = new Map<string, { count: number; paths: string[] }>();

  for (const relPath of files) {
    const tags = readFileTags(notesRoot, relPath);
    for (const tag of tags) {
      if (!tagData.has(tag)) tagData.set(tag, { count: 0, paths: [] });
      const entry = tagData.get(tag)!;
      entry.count++;
      entry.paths.push(relPath);
    }
  }

  return buildTagTree(tagData);
}

/**
 * Rename a tag across every notes vault file that carries it.
 *
 * Saves a backup of affected files to {notesRoot}/.tag-wrangler/backups/
 * before making any changes so the operation can be manually undone.
 *
 * Treats oldTag / newTag as exact full names (no sub-tree expansion here;
 * the caller decides whether to rename a leaf or a branch).
 */
export function renameNotesTag(
  notesRoot: string,
  oldTag: string,
  newTag: string,
): TagRenameResult {
  if (!oldTag || !newTag || oldTag === newTag) return { affectedFiles: 0 };

  const files = collectNotesMdFiles(notesRoot);
  const affected: Array<{ relPath: string; content: string; newContent: string }> = [];

  for (const relPath of files) {
    const absPath = path.join(notesRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch { continue; }

    const { frontmatter, prose } = parseFrontmatter(content);
    if (!Array.isArray(frontmatter.tags)) continue;

    const tags = frontmatter.tags.map(String);
    const idx = tags.indexOf(oldTag);
    if (idx === -1) continue;

    // Replace the tag; deduplicate in case newTag already exists
    const next = tags.map((t) => (t === oldTag ? newTag : t));
    const deduped = [...new Set(next)];

    const newContent = serializeFrontmatter({ ...frontmatter, tags: deduped }, prose);
    affected.push({ relPath, content, newContent });
  }

  if (affected.length === 0) return { affectedFiles: 0 };

  // Write backup before mutating any file
  saveTagBackup(notesRoot, { operation: 'rename', oldTag, newTag, files: affected });

  // Apply changes
  for (const { relPath, newContent } of affected) {
    writeFileAtomic(path.join(notesRoot, relPath), newContent);
  }

  return { affectedFiles: affected.length };
}

/**
 * Merge sourceTag into targetTag across every notes file.
 *
 * Files that carry sourceTag have it replaced with targetTag.
 * Files that already carry both have sourceTag removed (deduplicate).
 * A backup is saved before the operation.
 */
export function mergeNotesTags(
  notesRoot: string,
  sourceTag: string,
  targetTag: string,
): TagMergeResult {
  if (!sourceTag || !targetTag || sourceTag === targetTag) return { affectedFiles: 0 };

  const files = collectNotesMdFiles(notesRoot);
  const affected: Array<{ relPath: string; content: string; newContent: string }> = [];

  for (const relPath of files) {
    const absPath = path.join(notesRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch { continue; }

    const { frontmatter, prose } = parseFrontmatter(content);
    if (!Array.isArray(frontmatter.tags)) continue;

    const tags = frontmatter.tags.map(String);
    if (!tags.includes(sourceTag)) continue;

    const next = tags.map((t) => (t === sourceTag ? targetTag : t));
    const deduped = [...new Set(next)];

    const newContent = serializeFrontmatter({ ...frontmatter, tags: deduped }, prose);
    affected.push({ relPath, content, newContent });
  }

  if (affected.length === 0) return { affectedFiles: 0 };

  saveTagBackup(notesRoot, { operation: 'merge', oldTag: sourceTag, newTag: targetTag, files: affected });

  for (const { relPath, newContent } of affected) {
    writeFileAtomic(path.join(notesRoot, relPath), newContent);
  }

  return { affectedFiles: affected.length };
}

// ─── Backup helper ───

interface BackupEntry {
  operation: 'rename' | 'merge';
  oldTag: string;
  newTag: string;
  timestamp: string;
  files: Array<{ relPath: string; content: string }>;
}

function saveTagBackup(
  notesRoot: string,
  data: {
    operation: 'rename' | 'merge';
    oldTag: string;
    newTag: string;
    files: Array<{ relPath: string; content: string }>;
  },
): void {
  const backupDir = path.join(notesRoot, '.tag-wrangler', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const entry: BackupEntry = {
    operation: data.operation,
    oldTag: data.oldTag,
    newTag: data.newTag,
    timestamp: ts,
    files: data.files.map((f) => ({ relPath: f.relPath, content: f.content })),
  };
  const dest = path.join(backupDir, `${ts}.json`);
  writeFileAtomic(dest, JSON.stringify(entry, null, 2));
}
