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
  resultType: 'scene' | 'entity';
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

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
    db.prepare('DELETE FROM entity_fts').run();

    const now = new Date().toISOString();
    const insertFts = db.prepare(
      `INSERT INTO fts_index (doc_id, vault, kind, title, body) VALUES (?, ?, ?, ?, ?)`
    );
    const insertMeta = db.prepare(
      `INSERT OR REPLACE INTO fts_indexed_at (doc_id, indexed_at) VALUES (?, ?)`
    );
    const insertEntityFts = db.prepare(
      `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
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

    // Notes vault — entities
    for (const entity of manifest.entities ?? []) {
      let prose = '';
      try {
        const { content } = readVaultFile(vaultRoot, entity.path);
        prose = parseFrontmatter(content).prose;
      } catch { /* missing */ }
      const aliasesText = entity.aliases?.join(' ') ?? '';
      const bodyParts = [
        aliasesText,
        entity.tags?.join(' ') ?? '',
        prose,
      ].filter(Boolean);
      insertFts.run(entity.id, 'notes', entity.type, entity.name, bodyParts.join('\n'));
      insertMeta.run(entity.id, now);

      // Also populate entity_fts for richer per-field search (SKY-171)
      const customFieldsText = entity.properties
        ? Object.values(entity.properties).join(' ')
        : null;
      insertEntityFts.run(
        entity.id,
        entity.name,
        aliasesText || null,
        prose || null,
        customFieldsText || null,
      );
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
): SearchResult[] {
  // Tag-only filter: if no query but tags provided, return all items with those tags
  if (!query.trim() && filterTags?.length) {
    const lowerTags = filterTags.map((t) => t.toLowerCase());
    const placeholders = lowerTags.map(() => '?').join(', ');
    const params: (string | number)[] = [...lowerTags];
    let sql = `
      SELECT fi.doc_id, fi.vault, fi.kind, fi.title
      FROM fts_index fi
      JOIN item_tags it ON it.item_id = fi.doc_id
      JOIN tags t ON t.id = it.tag_id
      WHERE lower(t.name) IN (${placeholders})
    `;
    if (scope !== 'both') { sql += ` AND fi.vault = ?`; params.push(scope); }
    sql += ` GROUP BY fi.doc_id ORDER BY fi.title LIMIT ?`;
    params.push(limit);
    try {
      const rows = db.prepare(sql).all(...params) as Array<{ doc_id: string; vault: string; kind: string; title: string }>;
      return rows.map((r) => {
        const vault = r.vault as 'story' | 'notes';
        return { resultType: vault === 'notes' ? 'entity' as const : 'scene' as const, docId: r.doc_id, vault, kind: r.kind, title: r.title, snippet: '', rank: 0 };
      });
    } catch { return []; }
  }

  if (!query.trim() && !filterTags?.length) return [];

  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  // Each token gets prefix wildcard for "fuzzy" prefix matching
  const tokens = sanitized.split(/\s+/).filter(Boolean);
  const ftsQuery = tokens.map((t) => `${t}*`).join(' ');

  const results: SearchResult[] = [];
  const seenIds = new Set<string>();

  // ── Scene query: fts_index WHERE vault='story' ──
  if (scope !== 'notes') {
    try {
      // column index for snippet(): doc_id=0 vault=1 kind=2 title=3 body=4
      let sql = `
        SELECT doc_id, vault, kind, title,
               snippet(fts_index, 4, '[[', ']]', '…', 24) AS snippet,
               rank
        FROM fts_index
        WHERE fts_index MATCH ?
          AND vault = 'story'
      `;
      const params: (string | number)[] = [ftsQuery];
      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as Array<{
        doc_id: string; vault: string; kind: string; title: string; snippet: string; rank: number;
      }>;

      for (const row of rows) {
        if (seenIds.has(row.doc_id)) continue;
        seenIds.add(row.doc_id);
        results.push({
          resultType: 'scene',
          docId: row.doc_id,
          vault: 'story',
          kind: row.kind,
          title: row.title,
          snippet: row.snippet ?? '',
          rank: row.rank,
        });
      }
    } catch { /* FTS5 syntax error */ }
  }

  // ── Entity query: entity_fts (includes custom fields) ──
  if (scope !== 'story') {
    try {
      // Join with fts_index to get kind (entity type) and title
      const entitySql = `
        SELECT ef.entity_id,
               COALESCE(fi.kind, 'entity') AS kind,
               COALESCE(fi.title, ef.name) AS title,
               snippet(entity_fts, -1, '[[', ']]', '…', 24) AS snippet,
               ef.rank
        FROM entity_fts ef
        LEFT JOIN fts_index fi ON fi.doc_id = ef.entity_id AND fi.vault = 'notes'
        WHERE entity_fts MATCH ?
        ORDER BY ef.rank
        LIMIT ?
      `;
      const entityRows = db.prepare(entitySql).all(ftsQuery, limit) as Array<{
        entity_id: string; kind: string; title: string; snippet: string; rank: number;
      }>;

      for (const row of entityRows) {
        if (seenIds.has(row.entity_id)) continue;
        seenIds.add(row.entity_id);
        results.push({
          resultType: 'entity',
          docId: row.entity_id,
          vault: 'notes',
          kind: row.kind,
          title: row.title,
          snippet: row.snippet ?? '',
          rank: row.rank,
        });
      }
    } catch { /* entity_fts empty or FTS5 syntax error — skip */ }

    // Additional fuzzy name match for character/location titles using LIKE
    // (catches substrings the FTS stemmer might miss, e.g. partial name)
    const fuzzyTerm = `%${tokens.join('%')}%`.toLowerCase();
    let fuzzySql = `
      SELECT doc_id, vault, kind, title
      FROM fts_index
      WHERE lower(title) LIKE ?
        AND kind IN ('character', 'location', 'item')
    `;
    const fuzzyParams: (string | number)[] = [fuzzyTerm];
    if (scope === 'notes') {
      fuzzySql += ` AND vault = 'notes'`;
    }
    fuzzySql += ` LIMIT ?`;
    fuzzyParams.push(10);

    try {
      const fuzzyRows = db.prepare(fuzzySql).all(...fuzzyParams) as Array<{
        doc_id: string; vault: string; kind: string; title: string;
      }>;

      for (const row of fuzzyRows) {
        if (!seenIds.has(row.doc_id)) {
          const vault = row.vault as 'story' | 'notes';
          results.push({
            resultType: vault === 'notes' ? 'entity' : 'scene',
            docId: row.doc_id,
            vault,
            kind: row.kind,
            title: row.title,
            snippet: '',
            rank: 0,
          });
          seenIds.add(row.doc_id);
        }
      }
    } catch { /* non-fatal */ }
  }

  // Sort by rank (FTS5 rank is negative; more negative = more relevant)
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
