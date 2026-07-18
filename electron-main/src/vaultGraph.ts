// SKY-1756: Notes Vault graph — in-memory link index, degree, category, watcher-driven invalidation.
// Scans the Notes Vault, extracts [[wikilink]] references, builds a bidirectional edge map,
// and caches the result until a topology change (link added/removed) invalidates it.

import path from 'path';
import { listVaultFiles, readVaultFile } from './vault.js';
import { SESSIONS_DIRNAME } from './mythosFormat/agentSessions.js';

// ─── Category mapping (§3.1 of SKY-1743 UX spec) ───

export type VaultGraphCategory =
  | 'characters'
  | 'locations'
  | 'factions'
  | 'history'
  | 'systems'
  | 'items'
  | 'misc'
  | 'default';

// Ordered: first match wins. Each entry is ([folder names], category).
const CATEGORY_RULES: Array<[string[], VaultGraphCategory]> = [
  [['characters'], 'characters'],
  [['locations'], 'locations'],
  [['factions'], 'factions'],
  [['history'], 'history'],
  [['systems'], 'systems'],
  [['items'], 'items'],
  [['inbox', 'research', 'daily notes'], 'misc'],
];

/** Map a vault-relative file path to its display category using the §3.1 folder table. */
export function mapCategory(filePath: string): VaultGraphCategory {
  const segments = filePath.split(/[\\/]/).map((s) => s.toLowerCase());
  for (const [keys, cat] of CATEGORY_RULES) {
    if (segments.some((seg) => keys.includes(seg))) return cat;
  }
  return 'default';
}

// ─── Wiki-link extraction ───

// Matches [[target]], [[target|alias]], [[target#heading]], [[folder/target]]
const WIKI_LINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;

/**
 * Extract all [[wikilink]] target strings from markdown content.
 * Returns lowercased stems for consistent case-insensitive resolution.
 */
export function extractWikiLinkTargets(content: string): string[] {
  const targets: string[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    const target = m[1].trim();
    if (target) targets.push(target.toLowerCase());
  }
  return targets;
}

// ─── Public graph types ───

export interface NoteGraphNode {
  id: string;
  label: string;
  path: string;
  category: VaultGraphCategory;
  /** Count of unique edges this node participates in (in + out, undirected). */
  degree: number;
}

export interface NoteGraphEdge {
  source: string;
  target: string;
  /** Number of [[...]] references from source to target in the source file. */
  weight: number;
}

// ─── Internal index ───

interface NoteGraphIndex {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
  /** vault-relative path → frozenset of lowercased wikilink target stems (for topology delta) */
  linkSets: Map<string, ReadonlySet<string>>;
  /** stem (lowercased, no .md, last segment) → vault-relative path */
  stemToPath: Map<string, string>;
}

// ─── Cache ───

let _cache: NoteGraphIndex | null = null;
let _cachedRoot = '';

/** Force the next query to rebuild the index from disk. */
export function invalidateNoteGraphIndex(): void {
  _cache = null;
}

// ─── Index builder ───

/** Agent chat transcripts (SKY-6228) are vault-resident system files, not
 *  user-authored notes — they carry no wikilink semantics of their own and
 *  must not appear as graph nodes (a passive Brainstorm-panel mount would
 *  otherwise silently seed the "empty vault" state with a chat transcript). */
function isSessionFile(relPath: string): boolean {
  return relPath.split(/[\\/]/)[0] === SESSIONS_DIRNAME;
}

function buildIndex(notesVaultRoot: string): NoteGraphIndex {
  const { items } = listVaultFiles(notesVaultRoot);
  const mdFiles = items.filter(
    (f) => !f.isDirectory && f.path.endsWith('.md') && !isSessionFile(f.path),
  );

  // Pass 1: read all files, build stem → path map
  const stemToPath = new Map<string, string>();
  const fileContents = new Map<string, string>();

  for (const file of mdFiles) {
    let content = '';
    try {
      content = readVaultFile(notesVaultRoot, file.path).content;
    } catch {
      continue;
    }
    fileContents.set(file.path, content);
    const stem = path.basename(file.path, '.md').toLowerCase();
    // Last writer wins on stem collision — same behaviour as Obsidian
    stemToPath.set(stem, file.path);
  }

  // Pass 2: resolve links, build adjacency
  const linkSets = new Map<string, ReadonlySet<string>>();
  // outMap: sourcePath → (targetPath → raw link count)
  const outMap = new Map<string, Map<string, number>>();
  // inPaths: targetPath → set of unique source paths
  const inPaths = new Map<string, Set<string>>();

  for (const [filePath, content] of fileContents) {
    const rawTargets = extractWikiLinkTargets(content);
    linkSets.set(filePath, new Set(rawTargets));

    const fileOut = outMap.get(filePath) ?? new Map<string, number>();

    for (const rawTarget of rawTargets) {
      // Support [[folder/stem]] by taking the last path segment as the stem key
      const stem = path.basename(rawTarget, '.md').toLowerCase();
      const targetPath = stemToPath.get(stem);
      if (!targetPath || targetPath === filePath) continue;

      fileOut.set(targetPath, (fileOut.get(targetPath) ?? 0) + 1);

      const ins = inPaths.get(targetPath) ?? new Set<string>();
      ins.add(filePath);
      inPaths.set(targetPath, ins);
    }

    if (fileOut.size > 0) outMap.set(filePath, fileOut);
  }

  // Build edges
  const edges: NoteGraphEdge[] = [];
  for (const [sourcePath, targets] of outMap) {
    for (const [targetPath, weight] of targets) {
      edges.push({ source: sourcePath, target: targetPath, weight });
    }
  }

  // Compute degree = unique out-neighbours + unique in-neighbours
  const outDegree = new Map<string, number>();
  for (const [sourcePath, targets] of outMap) {
    outDegree.set(sourcePath, targets.size);
  }
  const inDegree = new Map<string, number>();
  for (const [targetPath, sources] of inPaths) {
    inDegree.set(targetPath, sources.size);
  }

  // Build nodes — include ALL files, even orphans (degree 0)
  const nodes: NoteGraphNode[] = [];
  for (const filePath of fileContents.keys()) {
    nodes.push({
      id: filePath,
      label: path.basename(filePath, '.md'),
      path: filePath,
      category: mapCategory(filePath),
      degree: (outDegree.get(filePath) ?? 0) + (inDegree.get(filePath) ?? 0),
    });
  }

  return { nodes, edges, linkSets, stemToPath };
}

function getOrBuildIndex(notesVaultRoot: string): NoteGraphIndex {
  if (_cache === null || _cachedRoot !== notesVaultRoot) {
    _cachedRoot = notesVaultRoot;
    _cache = buildIndex(notesVaultRoot);
  }
  return _cache;
}

// ─── Watcher hook ───

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Called by the Notes Vault file watcher on every file-system event.
 * Returns true (and invalidates the cache) only when the event represents a
 * topology change — a link added, removed, or the file itself added/deleted.
 * Content-only saves (prose changed but wikilinks unchanged) return false.
 *
 * @param notesVaultRoot  Absolute path to the Notes Vault root
 * @param absolutePath    Absolute path of the changed file (as emitted by chokidar)
 */
export function handleNoteFileChanged(notesVaultRoot: string, absolutePath: string): boolean {
  if (_cache === null) return false; // Nothing cached; will rebuild on next request

  const relPath = path.relative(notesVaultRoot, absolutePath);

  if (!relPath.endsWith('.md')) {
    // Directory event or non-md file — may affect stem resolution
    _cache = null;
    return true;
  }

  // Try to read new content; if unreadable (deleted), that's a topology change
  let newContent = '';
  try {
    newContent = readVaultFile(notesVaultRoot, relPath).content;
  } catch {
    _cache = null;
    return true;
  }

  // New file not yet indexed → topology change
  const oldLinkSet = _cache.linkSets.get(relPath);
  if (oldLinkSet === undefined) {
    _cache = null;
    return true;
  }

  const newTargets = new Set(extractWikiLinkTargets(newContent));
  if (!setsEqual(oldLinkSet, newTargets)) {
    _cache = null;
    return true;
  }

  return false; // Content-only change — index remains valid
}

// ─── Public query API ───

/** Return all Notes Vault notes as graph nodes (including orphans). */
export function getGraphNodes(notesVaultRoot: string): NoteGraphNode[] {
  return getOrBuildIndex(notesVaultRoot).nodes;
}

/** Return all directed wikilink edges in the Notes Vault. */
export function getGraphEdges(notesVaultRoot: string): NoteGraphEdge[] {
  return getOrBuildIndex(notesVaultRoot).edges;
}
