import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildFullIndex, indexDocument, deleteDocumentFromIndex, searchVault } from './search.js';
import type { Manifest } from './ipc.js';

// ─── In-memory DB with migration 7 schema ───

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
      doc_id    UNINDEXED,
      vault     UNINDEXED,
      kind      UNINDEXED,
      title,
      body,
      tokenize = 'porter ascii'
    );
    CREATE TABLE IF NOT EXISTS fts_indexed_at (
      doc_id     TEXT PRIMARY KEY,
      indexed_at TEXT NOT NULL
    );
  `);
  return db;
}

function emptyManifest(): Manifest {
  return {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: '/tmp/vault',
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };
}

describe('search subsystem', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns empty results for empty query', () => {
    const results = searchVault(db, '', 'both');
    expect(results).toHaveLength(0);
  });

  it('returns empty results when index is empty', () => {
    const results = searchVault(db, 'eira', 'both');
    expect(results).toHaveLength(0);
  });

  it('indexes a document and finds it by title', () => {
    indexDocument(db, {
      docId: 'scene-1',
      vault: 'story',
      kind: 'scene',
      title: 'The Glass Market',
      body: 'Eira stepped into the Glass Market as the sun dipped behind the towers.',
    });

    const results = searchVault(db, 'Glass Market', 'both');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('The Glass Market');
    expect(results[0].vault).toBe('story');
    expect(results[0].kind).toBe('scene');
  });

  it('finds text in body', () => {
    indexDocument(db, {
      docId: 'scene-2',
      vault: 'story',
      kind: 'scene',
      title: 'Chapter One',
      body: 'Kalen waited in the shadows, watching the square.',
    });

    const results = searchVault(db, 'Kalen', 'both');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('scene-2');
  });

  it('scope filter: story-only returns no notes results', () => {
    indexDocument(db, { docId: 'e-1', vault: 'notes', kind: 'character', title: 'Eira', body: 'A skilled mage.' });
    indexDocument(db, { docId: 's-1', vault: 'story', kind: 'scene', title: 'Eira Arrives', body: 'She arrived.' });

    const storyResults = searchVault(db, 'eira', 'story');
    expect(storyResults.every((r) => r.vault === 'story')).toBe(true);

    const notesResults = searchVault(db, 'eira', 'notes');
    expect(notesResults.every((r) => r.vault === 'notes')).toBe(true);
  });

  it('fuzzy name match finds character by partial name', () => {
    indexDocument(db, { docId: 'char-1', vault: 'notes', kind: 'character', title: 'Eira Moonshadow', body: 'A mage.' });

    const results = searchVault(db, 'moonsh', 'notes');
    // Should find via LIKE fuzzy match even if porter stemmer doesn't cover the suffix
    const found = results.find((r) => r.docId === 'char-1');
    expect(found).toBeDefined();
  });

  it('deletes document from index', () => {
    indexDocument(db, { docId: 'scene-3', vault: 'story', kind: 'scene', title: 'Unique Title Zyx', body: '' });
    deleteDocumentFromIndex(db, 'scene-3');

    const results = searchVault(db, 'Unique Title Zyx', 'both');
    expect(results.find((r) => r.docId === 'scene-3')).toBeUndefined();
  });

  it('buildFullIndex populates from manifest entities', () => {
    const manifest = emptyManifest();
    manifest.entities = [
      {
        id: 'ent-1',
        name: 'Kalen Blackwood',
        type: 'character',
        path: 'entities/characters/ent-1.md',
        aliases: ['The Shadow'],
        tags: ['antagonist'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // buildFullIndex will fail to read files (no vaultRoot) but should still index aliases/tags
    // The function swallows FS errors and indexes what it can
    buildFullIndex(db, '/nonexistent/vault', manifest);

    const results = searchVault(db, 'Kalen', 'notes');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('ent-1');
    expect(results[0].title).toBe('Kalen Blackwood');
  });

  it('returns results within 200ms on vault with 500 documents (perf budget)', () => {
    // Insert 500 documents
    const insert = db.prepare(
      `INSERT INTO fts_index (doc_id, vault, kind, title, body) VALUES (?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        insert.run(
          `doc-${i}`,
          i % 2 === 0 ? 'story' : 'notes',
          'scene',
          `Scene Title ${i}`,
          `This is the body text for document ${i}. It contains various words and phrases.`,
        );
      }
    });
    tx();

    const t0 = Date.now();
    const results = searchVault(db, 'body text', 'both', 20);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(200);
    expect(results.length).toBeGreaterThan(0);
  });
});
