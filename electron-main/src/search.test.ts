import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFullIndex, indexDocument, deleteDocumentFromIndex, searchVault } from './search.js';
import type { Manifest } from './ipc.js';

// ─── In-memory DB with migration 7 schema ───

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
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
      entity_id UNINDEXED,
      name,
      aliases,
      notes_text,
      custom_fields_text
    );
    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS item_tags (
      item_id   TEXT NOT NULL,
      item_kind TEXT NOT NULL,
      tag_id    TEXT NOT NULL,
      PRIMARY KEY (item_id, item_kind, tag_id)
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
    db.exec('BEGIN');
    for (let i = 0; i < 500; i++) {
      insert.run(
        `doc-${i}`,
        i % 2 === 0 ? 'story' : 'notes',
        'scene',
        `Scene Title ${i}`,
        `This is the body text for document ${i}. It contains various words and phrases.`,
      );
    }
    db.exec('COMMIT');

    const t0 = Date.now();
    const results = searchVault(db, 'body text', 'both', 20);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(200);
    expect(results.length).toBeGreaterThan(0);
  });

  describe('resultType field (SKY-171)', () => {
    it('scene results have resultType scene', () => {
      indexDocument(db, {
        docId: 'scene-rt-1',
        vault: 'story',
        kind: 'scene',
        title: 'The Crystal Spire',
        body: 'Mira climbed the spire at dawn.',
      });

      const results = searchVault(db, 'Crystal Spire', 'both');
      const hit = results.find((r) => r.docId === 'scene-rt-1');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('scene');
    });

    it('entity results have resultType entity (via entity_fts)', () => {
      // Populate entity_fts directly for this test
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-rt-1', 'Mira Coldwater', 'Mira', 'A renowned alchemist.', null);
      // Also insert into fts_index so the JOIN resolves kind/title
      indexDocument(db, { docId: 'ent-rt-1', vault: 'notes', kind: 'character', title: 'Mira Coldwater', body: 'A renowned alchemist.' });

      const results = searchVault(db, 'Mira', 'notes');
      const hit = results.find((r) => r.docId === 'ent-rt-1');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('entity');
      expect(hit?.kind).toBe('character');
    });

    it('searching entity name returns entity result', () => {
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-rt-2', 'Ashenvale Keep', null, 'A ruined fortress in the eastern marshes.', null);
      indexDocument(db, { docId: 'ent-rt-2', vault: 'notes', kind: 'location', title: 'Ashenvale Keep', body: 'A ruined fortress.' });

      const results = searchVault(db, 'Ashenvale', 'both');
      const hit = results.find((r) => r.docId === 'ent-rt-2');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('entity');
      expect(hit?.kind).toBe('location');
    });

    it('searching text from entity notes returns entity', () => {
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-rt-3', 'The Iron Circle', null, 'Controls the southern grain trade routes.', null);
      indexDocument(db, { docId: 'ent-rt-3', vault: 'notes', kind: 'faction', title: 'The Iron Circle', body: 'Controls the southern grain trade routes.' });

      const results = searchVault(db, 'grain trade', 'notes');
      const hit = results.find((r) => r.docId === 'ent-rt-3');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('entity');
    });

    it('searching custom fields text returns entity', () => {
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-rt-4', 'Dragonsbane Sword', null, null, 'enchanted vorpal weapon legendary artifact');
      indexDocument(db, { docId: 'ent-rt-4', vault: 'notes', kind: 'item', title: 'Dragonsbane Sword', body: '' });

      const results = searchVault(db, 'vorpal', 'notes');
      const hit = results.find((r) => r.docId === 'ent-rt-4');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('entity');
    });

    it('scene results not returned by entity query (no regression)', () => {
      indexDocument(db, {
        docId: 'scene-rt-2',
        vault: 'story',
        kind: 'scene',
        title: 'Shadowgate Crossing',
        body: 'The caravan passed through at nightfall.',
      });
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-rt-5', 'Shadowgate', null, 'An ancient crossing.', null);
      indexDocument(db, { docId: 'ent-rt-5', vault: 'notes', kind: 'location', title: 'Shadowgate', body: 'An ancient crossing.' });

      const results = searchVault(db, 'Shadowgate', 'both');
      const sceneHit = results.find((r) => r.docId === 'scene-rt-2');
      const entityHit = results.find((r) => r.docId === 'ent-rt-5');

      expect(sceneHit?.resultType).toBe('scene');
      expect(entityHit?.resultType).toBe('entity');
    });

    it('scope=story excludes entity results', () => {
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-scope-1', 'Eira Moondancer', null, 'A dancer of the old order.', null);
      indexDocument(db, { docId: 'ent-scope-1', vault: 'notes', kind: 'character', title: 'Eira Moondancer', body: '' });
      indexDocument(db, { docId: 'scene-scope-1', vault: 'story', kind: 'scene', title: 'Eira Arrives', body: 'She arrived at dawn.' });

      const storyResults = searchVault(db, 'eira', 'story');
      expect(storyResults.every((r) => r.resultType === 'scene')).toBe(true);
    });

    it('scope=notes excludes scene results', () => {
      db.prepare(
        `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text) VALUES (?, ?, ?, ?, ?)`
      ).run('ent-scope-2', 'Kalen Blackthorn', null, 'A wandering knight.', null);
      indexDocument(db, { docId: 'ent-scope-2', vault: 'notes', kind: 'character', title: 'Kalen Blackthorn', body: '' });
      indexDocument(db, { docId: 'scene-scope-2', vault: 'story', kind: 'scene', title: 'Kalen Fights', body: 'He fought valiantly.' });

      const notesResults = searchVault(db, 'kalen', 'notes');
      expect(notesResults.every((r) => r.resultType === 'entity')).toBe(true);
    });

    it('buildFullIndex populates entity_fts and results have resultType entity', () => {
      const manifest = emptyManifest();
      manifest.entities = [
        {
          id: 'ent-full-1',
          name: 'Thalindra Voss',
          type: 'character',
          path: 'entities/characters/ent-full-1.md',
          aliases: ['The Architect'],
          tags: ['protagonist'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      buildFullIndex(db, '/nonexistent/vault', manifest);

      const results = searchVault(db, 'Thalindra', 'notes');
      const hit = results.find((r) => r.docId === 'ent-full-1');
      expect(hit).toBeDefined();
      expect(hit?.resultType).toBe('entity');
      expect(hit?.kind).toBe('character');
    });
  });

});
