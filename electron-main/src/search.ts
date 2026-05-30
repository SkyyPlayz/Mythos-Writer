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

    // Notes vault — entities
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
): SearchResult[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  // Each token gets prefix wildcard for "fuzzy" prefix matching
  const tokens = sanitized.split(/\s+/).filter(Boolean);
  const ftsQuery = tokens.map((t) => `${t}*`).join(' ');

  const results: SearchResult[] = [];

  try {
    // column index for snippet(): doc_id=0 vault=1 kind=2 title=3 body=4
    // We want body snippets (index 4) or fallback to title (index 3)
    let sql = `
      SELECT doc_id, vault, kind, title,
             snippet(fts_index, 4, '[[', ']]', '…', 24) AS snippet,
             rank
      FROM fts_index
      WHERE fts_index MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (scope !== 'both') {
      sql += ` AND vault = ?`;
      params.push(scope);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<{
      doc_id: string;
      vault: string;
      kind: string;
      title: string;
      snippet: string;
      rank: number;
    }>;

    for (const row of rows) {
      results.push({
        resultType: row.kind === 'scene' ? 'scene' : 'entity',
        docId: row.doc_id,
        vault: row.vault as 'story' | 'notes',
        kind: row.kind,
        title: row.title,
        snippet: row.snippet ?? '',
        rank: row.rank,
      });
    }
  } catch {
    // FTS5 syntax error — skip FTS results
  }

  // Additional fuzzy name match for character/location titles using LIKE
  // (catches substrings the FTS stemmer might miss, e.g. partial name)
  if (scope !== 'story') {
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
        doc_id: string;
        vault: string;
        kind: string;
        title: string;
      }>;

      const seen = new Set(results.map((r) => r.docId));
      for (const row of fuzzyRows) {
        if (!seen.has(row.doc_id)) {
          results.push({
            resultType: 'entity',
            docId: row.doc_id,
            vault: row.vault as 'story' | 'notes',
            kind: row.kind,
            title: row.title,
            snippet: '',
            rank: 0,
          });
          seen.add(row.doc_id);
        }
      }
    } catch { /* non-fatal */ }
  }

  return results.slice(0, limit);
}
