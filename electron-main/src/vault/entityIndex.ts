// Entity index — scans Notes Vault directories to build a flat lookup array.
// M12.2 (SKY-10731, SKY-10666 ruling): loadEntityIndex() persists the parsed
// index in vault_index_cache keyed by SHA-256 content hash, so a panel open
// re-parses only files whose content actually changed. buildEntityIndex()
// remains the pure, DB-free full rebuild the cache regenerates from.
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parseEntityFrontmatter } from './entityFrontmatterParser.js';
import { findBestMatch } from './entityMatcher.js';
import {
  isDbOpen,
  getVaultIndexCacheRows,
  upsertVaultIndexCacheRow,
  deleteVaultIndexCacheRows,
} from '../db.js';

export interface EntityIndexEntry {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
}

function stemOf(filePath: string): string {
  return path.basename(filePath, '.md');
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function listMdFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMdFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function searchDirsOf(notesVaultRoot: string): string[] {
  return [path.join(notesVaultRoot, 'Universes'), path.join(notesVaultRoot, 'Stories')];
}

/** Full rebuild from disk — pure filesystem, no DB. Prefer loadEntityIndex()
 *  on hot paths; this remains for callers without an open vault DB. */
export function buildEntityIndex(notesVaultRoot: string): EntityIndexEntry[] {
  const entries: EntityIndexEntry[] = [];

  for (const dir of searchDirsOf(notesVaultRoot)) {
    const files = listMdFilesRecursive(dir);
    for (const filePath of files) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const { aliases, type } = parseEntityFrontmatter(content);
      entries.push({
        name: stemOf(filePath),
        aliases,
        type,
        path: filePath,
      });
    }
  }

  return entries;
}

/**
 * Cache-backed entity index. Per file: hash the content, and only when the
 * hash differs from the cached row re-parse the frontmatter and flip
 * needs_rescan (consumed by the M12.1 scan job). Cache rows for deleted files
 * are purged. Falls back to a plain rebuild when no vault DB is open.
 */
export function loadEntityIndex(notesVaultRoot: string): EntityIndexEntry[] {
  if (!isDbOpen()) return buildEntityIndex(notesVaultRoot);

  const cached = new Map(getVaultIndexCacheRows().map((r) => [r.file_path, r]));
  const seen = new Set<string>();
  const entries: EntityIndexEntry[] = [];

  for (const dir of searchDirsOf(notesVaultRoot)) {
    for (const filePath of listMdFilesRecursive(dir)) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      seen.add(filePath);
      const contentHash = sha256Hex(content);
      const row = cached.get(filePath);

      if (row && row.content_hash === contentHash) {
        entries.push({
          name: row.name,
          aliases: JSON.parse(row.aliases_json) as string[],
          type: row.type,
          path: filePath,
        });
        continue;
      }

      const { aliases, type } = parseEntityFrontmatter(content);
      const entry: EntityIndexEntry = { name: stemOf(filePath), aliases, type, path: filePath };
      entries.push(entry);
      upsertVaultIndexCacheRow({
        file_path: filePath,
        content_hash: contentHash,
        name: entry.name,
        aliases_json: JSON.stringify(aliases),
        type,
        needs_rescan: 1,
        indexed_at: new Date().toISOString(),
      });
    }
  }

  // Orphan purge — drop cache rows for files no longer on disk.
  const orphans: string[] = [];
  for (const cachedPath of cached.keys()) {
    if (!seen.has(cachedPath)) orphans.push(cachedPath);
  }
  deleteVaultIndexCacheRows(orphans);

  return entries;
}

/**
 * Entity-resolution anchor for the fact-ledger extractor (M12.4 builds its
 * coreference logic on top of this). Delegates to the existing alias-aware
 * matcher over the index — per the SKY-10666 ruling there must never be a
 * second name/alias matcher. Returns the resolved vault note path (the
 * wikilink target) or null when the mention matches no known entity.
 */
export function resolveEntityKeyForFact(mention: string, index: EntityIndexEntry[]): string | null {
  const match = findBestMatch(mention, index);
  return match ? match.path : null;
}
