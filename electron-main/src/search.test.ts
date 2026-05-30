import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFullIndex, indexDocument, deleteDocumentFromIndex, searchVault } from './search.js';
import type { EntitySearchResult } from './search.js';
import type { Manifest } from './ipc.js';

// ─── In-memory DB with fts_index + entity_fts + entity_index schema ───

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
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
    CREATE TABLE IF NOT EXISTS entity_index (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      name          TEXT NOT NULL,
      aliases       TEXT,
      tags          TEXT,
      status        TEXT,
      core_fields   TEXT,
      custom_fields TEXT,
      notes_text    TEXT,
      file_path     TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT '',
      updated_at    TEXT NOT NULL DEFAULT ''
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
      entity_id UNINDEXED,
      name,
      aliases,
      notes_text,
      custom_fields_text
    );
  `);
  return db;
}

function insertEntity(
  db: DatabaseSync,
  id: string,
  type: string,
  name: string,
  aliases = '',
  notesText = '',
  customFieldsText = '',
): void {
  db.prepare(
    `INSERT OR REPLACE INTO entity_index (id, type, name, aliases, notes_text, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', '', '')`
  ).run(id, type, name, aliases, notesText);
  db.prepare('DELETE FROM entity_fts WHERE entity_id = ?').run(id);
  db.prepare(
    `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
  ).run(id, name, aliases, notesText, customFieldsText);
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
  let db: DatabaseSync;

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
    expect(results[0].resultType).toBe('scene');
  });

  it('finds text in body', () => {
    indexDocument(db, {
      docId: 'scene-2',
      vault: 'story',
      kind: 'scene',
      title: 'Chapter One',
      body: 'Kalen waited in the shadows, watching the square.',
    });

    const results = searchVault(db, 'Kalen', 'story');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('scene-2');
  });

  it('scope filter: story-only returns no entity results', () => {
    insertEntity(db, 'e-1', 'character', 'Eira', '', 'A skilled mage.');
    indexDocument(db, { docId: 's-1', vault: 'story', kind: 'scene', title: 'Eira Arrives', body: 'She arrived.' });

    const storyResults = searchVault(db, 'eira', 'story');
    expect(storyResults.every((r) => r.vault === 'story')).toBe(true);
    expect(storyResults.every((r) => r.resultType === 'scene')).toBe(true);

    const notesResults = searchVault(db, 'eira', 'notes');
    expect(notesResults.every((r) => r.vault === 'notes')).toBe(true);
    expect(notesResults.every((r) => r.resultType === 'entity')).toBe(true);
  });

  it('fuzzy name match finds character by partial name via LIKE fallback', () => {
    insertEntity(db, 'char-1', 'character', 'Eira Moonshadow', '', 'A mage.');

    const results = searchVault(db, 'moonsh', 'notes');
    // Should find via LIKE fuzzy match even if FTS prefix does not cover the substring
    const found = results.find((r) => r.docId === 'char-1');
    expect(found).toBeDefined();
  });

  it('deletes document from index', () => {
    indexDocument(db, { docId: 'scene-3', vault: 'story', kind: 'scene', title: 'Unique Title Zyx', body: '' });
    deleteDocumentFromIndex(db, 'scene-3');

    const results = searchVault(db, 'Unique Title Zyx', 'both');
    expect(results.find((r) => r.docId === 'scene-3')).toBeUndefined();
  });

  it('buildFullIndex populates scenes from manifest', () => {
    const manifest = emptyManifest();
    manifest.stories = [
      {
        id: 'story-1',
        title: 'Test Story',
        path: 'stories/story-1.json',
        chapters: [
          {
            id: 'ch-1',
            title: 'Chapter 1',
            path: 'chapters/ch-1.json',
            order: 0,
            scenes: [
              {
                id: 'sc-1',
                title: 'Glass Market Scene',
                order: 0,
                path: 'scenes/sc-1.md',
                blocks: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    buildFullIndex(db, '/nonexistent/vault', manifest);

    const results = searchVault(db, 'Glass Market', 'story');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('sc-1');
    expect(results[0].resultType).toBe('scene');
  });

  it('returns results within 200ms on vault with 500 documents (perf budget)', () => {
    // Insert 500 scene documents into fts_index
    const insert = db.prepare(
      `INSERT INTO fts_index (doc_id, vault, kind, title, body) VALUES (?, ?, ?, ?, ?)`
    );
    db.exec('BEGIN');
    for (let i = 0; i < 500; i++) {
      insert.run(
        `doc-${i}`,
        'story',
        'scene',
        `Scene Title ${i}`,
        `This is the body text for document ${i}. It contains various words and phrases.`,
      );
    }
    db.exec('COMMIT');

    const t0 = Date.now();
    const results = searchVault(db, 'body text', 'story', 20);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(200);
    expect(results.length).toBeGreaterThan(0);
  });

  // ─── Entity FTS tests (SKY-171) ───

  it('entity search: finds entity by name', () => {
    insertEntity(db, 'char-eira', 'character', 'Eira Moonshadow', '', '');

    const results = searchVault(db, 'Eira', 'notes');
    const found = results.find((r) => r.docId === 'char-eira') as EntitySearchResult | undefined;
    expect(found).toBeDefined();
    expect(found?.resultType).toBe('entity');
    expect(found?.entityId).toBe('char-eira');
    expect(found?.entityType).toBe('character');
    expect(found?.name).toBe('Eira Moonshadow');
    expect(found?.vault).toBe('notes');
    expect(found?.kind).toBe('character');
    expect(found?.title).toBe('Eira Moonshadow');
  });

  it('entity search: finds entity by notes text', () => {
    insertEntity(db, 'loc-market', 'location', 'The Grand Bazaar', '', 'Famous trading post in the eastern quarter.');

    const results = searchVault(db, 'trading post', 'notes');
    const found = results.find((r) => r.docId === 'loc-market') as EntitySearchResult | undefined;
    expect(found).toBeDefined();
    expect(found?.resultType).toBe('entity');
    expect(found?.entityType).toBe('location');
  });

  it('entity search: finds entity by alias', () => {
    insertEntity(db, 'char-kalen', 'character', 'Kalen Blackwood', 'The Shadow Broker', '');

    const results = searchVault(db, 'Shadow Broker', 'notes');
    const found = results.find((r) => r.docId === 'char-kalen');
    expect(found).toBeDefined();
    expect(found?.resultType).toBe('entity');
  });

  it('entity search: scope=both returns both scene and entity results', () => {
    indexDocument(db, { docId: 'sc-eira', vault: 'story', kind: 'scene', title: 'Eira Scene', body: 'Eira appears.' });
    insertEntity(db, 'char-eira2', 'character', 'Eira', '', '');

    const results = searchVault(db, 'Eira', 'both');
    const sceneResult = results.find((r) => r.resultType === 'scene');
    const entityResult = results.find((r) => r.resultType === 'entity');
    expect(sceneResult).toBeDefined();
    expect(entityResult).toBeDefined();
  });

  it('entity search: story scope excludes entity results', () => {
    insertEntity(db, 'char-x', 'character', 'Zethari', '', '');

    const results = searchVault(db, 'Zethari', 'story');
    expect(results.find((r) => r.resultType === 'entity')).toBeUndefined();
  });

  it('entity search: notes scope excludes scene results', () => {
    indexDocument(db, { docId: 'sc-zethari', vault: 'story', kind: 'scene', title: 'Zethari Scene', body: 'Zethari walks.' });
    insertEntity(db, 'char-zethari', 'character', 'Zethari', '', '');

    const results = searchVault(db, 'Zethari', 'notes');
    expect(results.find((r) => r.resultType === 'scene')).toBeUndefined();
    expect(results.find((r) => r.resultType === 'entity')).toBeDefined();
  });

  it('entity search: no duplicate results for same entity', () => {
    insertEntity(db, 'char-unique', 'character', 'Xorrath', 'Xorrath the Terrible', 'Notes about Xorrath.');

    const results = searchVault(db, 'Xorrath', 'notes');
    const ids = results.map((r) => r.docId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.filter((id) => id === 'char-unique').length).toBe(1);
  });
});
