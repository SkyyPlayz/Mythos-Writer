// Continuity Peek IPC handlers (SKY-2011).
// Filesystem + matching logic; no LLM calls.
import fs from 'fs';
import path from 'path';
import { buildEntityIndex } from './vault/entityIndex.js';
import { findBestMatch, searchEntities } from './vault/entityMatcher.js';
import { parseEntityFrontmatter } from './vault/entityFrontmatterParser.js';
import type {
  ContinuityMatchSelectionPayload,
  ContinuityMatchSelectionResponse,
  ContinuitySearchPayload,
  ContinuitySearchResponse,
  ContinuityReadEntityPayload,
  ContinuityReadEntityResponse,
  ContinuityEntityResult,
} from './ipc.js';

/** Strip markdown syntax and return first `maxChars` characters of the prose body. */
function extractExcerpt(prose: string, maxChars = 200): string {
  const stripped = prose
    .replace(/^#{1,6}\s+/gm, '')   // headings
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')  // bold/italic
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))  // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // images
    .trim();
  return stripped.slice(0, maxChars);
}

function readEntityFile(filePath: string): { prose: string; aliases: string[]; type: string | null } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const { aliases, type } = parseEntityFrontmatter(raw);
  // Strip frontmatter block to get prose
  const prose = raw.startsWith('---')
    ? raw.replace(/^---[\s\S]*?---\n?/, '').trim()
    : raw.trim();
  return { prose, aliases, type };
}

function toEntityResult(
  entry: { name: string; aliases: string[]; type: string | null; path: string },
  filePath: string,
  notesVaultRoot: string,
): ContinuityEntityResult {
  const data = readEntityFile(filePath);
  const excerpt = data ? extractExcerpt(data.prose) : '';
  return {
    name: entry.name,
    aliases: entry.aliases,
    type: entry.type,
    path: path.relative(notesVaultRoot, entry.path),
    excerpt,
  };
}

export function handleContinuityMatchSelection(
  payload: ContinuityMatchSelectionPayload,
): ContinuityMatchSelectionResponse {
  const { selectedText, notesVaultRoot } = payload;
  if (!selectedText.trim() || !notesVaultRoot) return { match: null };

  const index = buildEntityIndex(notesVaultRoot);
  const entry = findBestMatch(selectedText, index);
  if (!entry) return { match: null };

  return { match: toEntityResult(entry, entry.path, notesVaultRoot) };
}

export function handleContinuitySearch(
  payload: ContinuitySearchPayload,
): ContinuitySearchResponse {
  const { query, notesVaultRoot } = payload;
  if (!query.trim() || !notesVaultRoot) return { results: [] };

  const index = buildEntityIndex(notesVaultRoot);
  const entries = searchEntities(query, index);
  const results = entries.map((e) => toEntityResult(e, e.path, notesVaultRoot));
  return { results };
}

export function handleContinuityReadEntity(
  payload: ContinuityReadEntityPayload,
): ContinuityReadEntityResponse {
  const { path: filePath } = payload;
  const stem = path.basename(filePath, '.md');
  const data = readEntityFile(filePath);
  if (!data) {
    return { name: stem, aliases: [], type: null, excerpt: '' };
  }
  return {
    name: stem,
    aliases: data.aliases,
    type: data.type,
    excerpt: extractExcerpt(data.prose),
  };
}
