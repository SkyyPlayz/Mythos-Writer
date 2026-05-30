// FTS5 search subsystem — indexes both vaults, serves SEARCH_QUERY IPC.
// Uses SQLite FTS5 with porter stemming; incremental re-index on vault watcher events.
import type { DatabaseSync } from 'node:sqlite';
import type { Manifest } from './ipc.js';
import { readVaultFile, parseFrontmatter } from './vault.js';

// ─── Types ───

export interface FtsDoc {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  body: string;
}

export interface SearchResult {
  resultType: 'scene';
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface EntitySearchResult {
  resultType: 'entity';
  entityId: string;
  entityType: string;
  name: string;
  snippet: string;
  score: number;
  // Backward-compat aliases so existing navigation code (docId/vault/kind/title/rank) keeps working
  docId: string;
  vault: 'notes';
  kind: string;
  title: string;
  rank: number;
}

export type AnySearchResult = SearchResult | EntitySearchResult;

// ─── Index mutations ───

export function indexDocument(db: DatabaseSync, doc: FtsDoc): void {
  // FTS5 doesn't support UPDATE — delete then insert
  db.prepare('DELETE FROM fts_index WHERE doc_id = ?').run(doc.docId);
  db.prepare(
    `INSERT INTO fts_index (doc_id, vault, kind, title, body) VALUES (?, ?, ?, ?, ?)`
  ).run(doc.docId, doc.vault, doc.kind, doc.title, doc.body);
  db.prepare(
    `INSERT OR REPLACE INTO fts_indexed_at (doc_id, indexed_at) VALUES (?, ?)`
  ).run(doc.docId, new Date().toISOString());
}

export function deleteDocumentFromIndex(db: DatabaseSync, docId: string): void {
  db.prepare('DELETE FROM fts_index WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM fts_indexed_at WHERE doc_id = ?').run(docId);
}

// ─── Full rebuild ───

export function buildFullIndex(db: DatabaseSync, vaultRoot: string, manifest: Manifest): void {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM fts_index').run();
    db.prepare('DELETE FROM fts_indexed_at').run();

    const now = new Date().toISOString();
    const insertFts = db.prepare(
      `INSERT INTO fts_index (doc_id, vault, kind, title, body) VALUES (?, ?, ?, ?, ?)`
    );
    const insertMeta = db.prepare(
      `INSERT OR REPLACE INTO fts_indexed_at (doc_id, indexed_at) VALUES (?, ?)`
    );

    // Story vault — scenes
    const seen = new Set<string>();
    for (const story of manifest.stories ?? []) {
      for (const chapter of story.chapters ?? []) {
        for (const scene of chapter.scenes ?? []) {
          if (seen.has(scene.id)) continue;
          seen.add(scene.id);
          let body = '';
          try {
            const { content } = readVaultFile(vaultRoot, scene.path);
            body = parseFrontmatter(content).prose;
          } catch { /* missing file — index title only */ }
          insertFts.run(scene.id, 'story', 'scene', scene.title, body);
          insertMeta.run(scene.id, now);
        }
      }
    }
    for (const scene of manifest.scenes ?? []) {
      if (seen.has(scene.id)) continue;
      seen.add(scene.id);
      let body = '';
      try {
        const { content } = readVaultFile(vaultRoot, scene.path);
        body = parseFrontmatter(content).prose;
      } catch { /* missing */ }
      insertFts.run(scene.id, 'story', 'scene', scene.title, body);
      insertMeta.run(scene.id, now);
    }

    // Notes vault — entities (kept in fts_index for buildFullIndex compat; entity_fts is the
    // primary search path, managed by the entity manager via upsertEntityFts)
    for (const entity of manifest.entities ?? []) {
      let prose = '';
      try {
        const { content } = readVaultFile(vaultRoot, entity.path);
        prose = parseFrontmatter(content).prose;
      } catch { /* missing */ }
      const bodyParts = [
        entity.aliases?.join(' ') ?? '',
        entity.tags?.join(' ') ?? '',
        prose,
      ].filter(Boolean);
      insertFts.run(entity.id, 'notes', entity.type, entity.name, bodyParts.join('\n'));
      insertMeta.run(entity.id, now);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── Query ───

function sanitizeFtsQuery(raw: string): string {
  return raw
    .trim()
    .replace(/['"()\-]+/g, ' ') // strip FTS5 special chars we don't want
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchVault(
  db: DatabaseSync,
  query: string,
  scope: 'story' | 'notes' | 'both',
  limit = 20,
  filterTags?: string[],
): AnySearchResult[] {
  // Tag-only filter: if no query but tags provided, return all scene items with those tags
  if (!query.trim() && filterTags?.length) {
    const lowerTags = filterTags.map((t) => t.toLowerCase());
    const placeholders = lowerTags.map(() => '?').join(', ');
    const params: (string | number)[] = [...lowerTags];
    const sql = `
      SELECT fi.doc_id, fi.vault, fi.kind, fi.title
      FROM fts_index fi
      JOIN item_tags it ON it.item_id = fi.doc_id
      JOIN tags t ON t.id = it.tag_id
      WHERE lower(t.name) IN (${placeholders})
        AND fi.vault = 'story'
      GROUP BY fi.doc_id ORDER BY fi.title LIMIT ?
    `;
    params.push(limit);
    try {
      const rows = db.prepare(sql).all(...params) as Array<{ doc_id: string; vault: string; kind: string; title: string }>;
      return rows.map((r) => ({ resultType: 'scene' as const, docId: r.doc_id, vault: r.vault as 'story' | 'notes', kind: r.kind, title: r.title, snippet: '', rank: 0 }));
    } catch { return []; }
  }

  if (!query.trim() && !filterTags?.length) return [];

  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  // Each token gets prefix wildcard for "fuzzy" prefix matching
  const tokens = sanitized.split(/\s+/).filter(Boolean);
  const ftsQuery = tokens.map((t) => `${t}*`).join(' ');

  const results: AnySearchResult[] = [];
  const seenIds = new Set<string>();

  // ─── Scene results from fts_index (vault = 'story' only) ───
  if (scope === 'story' || scope === 'both') {
    try {
      // column index for snippet(): doc_id=0 vault=1 kind=2 title=3 body=4
      const sql = `
        SELECT doc_id, vault, kind, title,
               snippet(fts_index, 4, '[[', ']]', '…', 24) AS snippet,
               rank
        FROM fts_index
        WHERE fts_index MATCH ?
          AND vault = 'story'
        ORDER BY rank LIMIT ?
      `;
      const rows = db.prepare(sql).all(ftsQuery, limit) as Array<{
        doc_id: string;
        vault: string;
        kind: string;
        title: string;
        snippet: string;
        rank: number;
      }>;
      for (const row of rows) {
        seenIds.add(row.doc_id);
        results.push({
          resultType: 'scene',
          docId: row.doc_id,
          vault: row.vault as 'story' | 'notes',
          kind: row.kind,
          title: row.title,
          snippet: row.snippet ?? '',
          rank: row.rank,
        });
      }
    } catch {
      // FTS5 syntax error — skip scene results
    }
  }

  // ─── Entity results from entity_fts + entity_index ───
  if (scope === 'notes' || scope === 'both') {
    try {
      // snippet columns: entity_id=0(UNINDEXED) name=1 aliases=2 notes_text=3 custom_fields_text=4
      const sql = `
        SELECT ef.entity_id, ei.type AS entity_type, ei.name,
               snippet(entity_fts, 1, '[[', ']]', '…', 24) AS name_snippet,
               snippet(entity_fts, 3, '[[', ']]', '…', 24) AS notes_snippet,
               ef.rank
        FROM entity_fts ef
        JOIN entity_index ei ON ei.id = ef.entity_id
        WHERE entity_fts MATCH ?
        ORDER BY ef.rank LIMIT ?
      `;
      const rows = db.prepare(sql).all(ftsQuery, limit) as Array<{
        entity_id: string;
        entity_type: string;
        name: string;
        name_snippet: string;
        notes_snippet: string;
        rank: number;
      }>;
      for (const row of rows) {
        if (seenIds.has(row.entity_id)) continue;
        seenIds.add(row.entity_id);
        const snippet = row.notes_snippet || row.name_snippet || '';
        results.push({
          resultType: 'entity',
          entityId: row.entity_id,
          entityType: row.entity_type,
          name: row.name,
          snippet,
          score: row.rank,
          docId: row.entity_id,
          vault: 'notes',
          kind: row.entity_type,
          title: row.name,
          rank: row.rank,
        });
      }
    } catch {
      // FTS5 syntax error or missing entity_fts table — skip entity FTS results
    }

    // Fuzzy LIKE fallback for partial entity name matches (substrings FTS prefix misses)
    const fuzzyTerm = `%${tokens.join('%')}%`.toLowerCase();
    try {
      const fuzzyRows = db.prepare(`
        SELECT id, type, name FROM entity_index
        WHERE lower(name) LIKE ?
        LIMIT 10
      `).all(fuzzyTerm) as Array<{ id: string; type: string; name: string }>;
      for (const row of fuzzyRows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        results.push({
          resultType: 'entity',
          entityId: row.id,
          entityType: row.type,
          name: row.name,
          snippet: '',
          score: 0,
          docId: row.id,
          vault: 'notes',
          kind: row.type,
          title: row.name,
          rank: 0,
        });
      }
    } catch { /* non-fatal — entity_index may not exist in older DBs */ }
  }

  // Sort by FTS5 rank (negative: lower = better relevance). Score-0 items (LIKE fallback) sort last.
  results.sort((a, b) => a.rank - b.rank);

  if (filterTags?.length) {
    const lowerTags = filterTags.map((t) => t.toLowerCase());
    const placeholders = lowerTags.map(() => '?').join(', ');
    const taggedDocIds = new Set<string>();
    try {
      const rows = db.prepare(
        `SELECT DISTINCT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE lower(t.name) IN (${placeholders})`
      ).all(...lowerTags) as { item_id: string }[];
      for (const r of rows) taggedDocIds.add(r.item_id);
    } catch { /* non-fatal */ }
    return results.filter((r) => taggedDocIds.has(r.docId)).slice(0, limit);
  }
  return results.slice(0, limit);
}
