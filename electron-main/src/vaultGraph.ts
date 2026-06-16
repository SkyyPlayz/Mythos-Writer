import path from 'path';
import { listVaultFiles, parseFrontmatter, readVaultFile } from './vault.js';
import type { VaultGraphDataResponse, VaultGraphEdge, VaultGraphNode } from './ipc.js';

export type VaultGraphCategory =
  | 'characters'
  | 'locations'
  | 'factions'
  | 'history'
  | 'systems'
  | 'items'
  | 'misc'
  | 'default';

const WIKI_LINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;

const CATEGORY_SEGMENTS: Array<{ segment: string; category: VaultGraphCategory }> = [
  { segment: 'characters', category: 'characters' },
  { segment: 'locations', category: 'locations' },
  { segment: 'factions', category: 'factions' },
  { segment: 'history', category: 'history' },
  { segment: 'systems', category: 'systems' },
  { segment: 'items', category: 'items' },
  { segment: 'inbox', category: 'misc' },
  { segment: 'research', category: 'misc' },
  { segment: 'daily notes', category: 'misc' },
];

interface NoteRecord {
  id: string;
  label: string;
  path: string;
  folder?: string;
  tags?: string[];
  category: VaultGraphCategory;
  links: string[];
}

export function extractVaultGraphWikiLinks(content: string): string[] {
  const links: string[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const target = match[1].trim();
    if (target) links.push(target);
  }
  return links;
}

export function vaultGraphCategoryForPath(notePath: string): VaultGraphCategory {
  const segments = notePath.split(/[\\/]+/).slice(0, -1).map((segment) => segment.toLowerCase());
  for (const segment of segments) {
    const match = CATEGORY_SEGMENTS.find((entry) => entry.segment === segment);
    if (match) return match.category;
  }
  return 'default';
}

function wikiTargetKey(target: string): string {
  return path.basename(target, '.md').toLowerCase();
}

function edgeKey(source: string, target: string): string {
  return `${source}\u2192${target}`;
}

export function graphTopologySignatureFromContent(content: string): string {
  return extractVaultGraphWikiLinks(content).map(wikiTargetKey).sort().join('\n');
}

export function didVaultGraphTopologyChange(before: string, after: string): boolean {
  return graphTopologySignatureFromContent(before) !== graphTopologySignatureFromContent(after);
}

export function buildVaultGraphTopologySignatures(notesVaultRoot: string): Map<string, string> {
  const { items } = listVaultFiles(notesVaultRoot);
  const signatures = new Map<string, string>();

  for (const file of items) {
    if (file.isDirectory || !file.path.endsWith('.md')) continue;
    try {
      signatures.set(file.path, graphTopologySignatureFromContent(readVaultFile(notesVaultRoot, file.path).content));
    } catch {
      // Missing or unreadable files are ignored; the next successful scan will
      // reconcile the cache from the live filesystem.
    }
  }

  return signatures;
}

export function buildVaultGraphIndex(notesVaultRoot: string): VaultGraphDataResponse {
  const { items } = listVaultFiles(notesVaultRoot);
  const mdFiles = items
    .filter((item) => !item.isDirectory && item.path.endsWith('.md'))
    .sort((a, b) => a.path.localeCompare(b.path));

  const notes: NoteRecord[] = [];
  const stemToId = new Map<string, string>();

  for (const file of mdFiles) {
    let content: string;
    try {
      ({ content } = readVaultFile(notesVaultRoot, file.path));
    } catch {
      continue;
    }

    const { frontmatter, prose } = parseFrontmatter(content);
    const id = String(frontmatter.id ?? file.path);
    const label = String(frontmatter.title ?? path.basename(file.path, '.md'));
    const folder = path.dirname(file.path) === '.' ? undefined : path.dirname(file.path);
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined;

    notes.push({
      id,
      label,
      path: file.path,
      folder,
      tags,
      category: vaultGraphCategoryForPath(file.path),
      links: extractVaultGraphWikiLinks(prose),
    });
    stemToId.set(path.basename(file.path, '.md').toLowerCase(), id);
  }

  const degreeById = new Map<string, number>();
  const weightByEdge = new Map<string, number>();
  const edgeEndpoints = new Map<string, { source: string; target: string }>();

  for (const note of notes) {
    degreeById.set(note.id, degreeById.get(note.id) ?? 0);
    for (const link of note.links) {
      const targetId = stemToId.get(wikiTargetKey(link));
      if (!targetId || targetId === note.id) continue;

      const key = edgeKey(note.id, targetId);
      weightByEdge.set(key, (weightByEdge.get(key) ?? 0) + 1);
      edgeEndpoints.set(key, { source: note.id, target: targetId });
      degreeById.set(note.id, (degreeById.get(note.id) ?? 0) + 1);
      degreeById.set(targetId, (degreeById.get(targetId) ?? 0) + 1);
    }
  }

  const nodes: VaultGraphNode[] = notes.map(({ links: _links, ...note }) => ({
    ...note,
    degree: degreeById.get(note.id) ?? 0,
  }));

  const edges: VaultGraphEdge[] = Array.from(edgeEndpoints.entries())
    .map(([key, endpoints]) => ({
      ...endpoints,
      weight: weightByEdge.get(key) ?? 1,
    }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

  return { nodes, edges };
}
