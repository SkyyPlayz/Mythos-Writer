import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFullIndex, indexDocument, deleteDocumentFromIndex, searchVault, planFtsUpdate, indexSceneFromDisk, refreshEntityIndex } from './search.js';
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

  // SKY-905 regression: mirrors the e2e/tests/global-search.spec.ts seed shape.
  // Guards the indexer contract used by the Global Search panel: a manifest
  // with stories[].chapters[].scenes[] + entities[] must produce searchable
  // rows in both 'story' and 'notes' scope without touching the filesystem.
  it('buildFullIndex indexes manifest stories + entities so search returns both scopes', () => {
    const now = new Date().toISOString();
    const manifest = emptyManifest();
    manifest.stories = [
      {
        id: 'sky905-story',
        title: 'Global Search Test Vault',
        path: 'Global Search Test Vault',
        chapters: [
          {
            id: 'sky905-chap',
            title: 'Story Chapter',
            path: 'Global Search Test Vault/Story Chapter',
            order: 0,
            scenes: [
              {
                // Scene title includes the search term so title-only matches succeed
                // when the on-disk prose file is unavailable (the unit harness has no real vault).
                id: 'sky905-scene',
                title: 'The Dragon Scene',
                path: 'Global Search Test Vault/Story Chapter/Dragon Scene.md',
                order: 0,
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];
    manifest.entities = [
      {
        id: 'sky905-entity',
        name: 'Dragon Oracle',
        type: 'character',
        path: 'entities/characters/sky905-entity.md',
        aliases: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    // buildFullIndex tries to read prose from disk and tolerates missing files,
    // so we index titles only here. The 'dragon' term matches the scene title
    // and the entity title.
    buildFullIndex(db, '/nonexistent/vault', manifest);

    const both = searchVault(db, 'dragon', 'both');
    expect(both.length).toBeGreaterThanOrEqual(2);
    expect(both.some((r) => r.docId === 'sky905-scene' && r.vault === 'story')).toBe(true);
    expect(both.some((r) => r.docId === 'sky905-entity' && r.vault === 'notes')).toBe(true);

    const story = searchVault(db, 'dragon', 'story');
    expect(story.every((r) => r.vault === 'story')).toBe(true);
    expect(story.some((r) => r.docId === 'sky905-scene')).toBe(true);

    const notes = searchVault(db, 'dragon', 'notes');
    expect(notes.some((r) => r.docId === 'sky905-entity')).toBe(true);
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

  it('scene results have resultType "scene"', () => {
    indexDocument(db, {
      docId: 'scene-rt',
      vault: 'story',
      kind: 'scene',
      title: 'The Iron Gate',
      body: 'The iron gate creaked open at midnight.',
    });

    const results = searchVault(db, 'iron gate', 'story');
    expect(results.length).toBeGreaterThan(0);
    const scene = results.find((r) => r.docId === 'scene-rt');
    expect(scene?.resultType).toBe('scene');
  });

  it('entity results have resultType "entity"', () => {
    indexDocument(db, {
      docId: 'ent-rt',
      vault: 'notes',
      kind: 'character',
      title: 'Selene Ashveil',
      body: 'A wandering scholar with silver hair.',
    });

    const results = searchVault(db, 'selene', 'notes');
    expect(results.length).toBeGreaterThan(0);
    const entity = results.find((r) => r.docId === 'ent-rt');
    expect(entity?.resultType).toBe('entity');
  });

  it('mixed search returns both scene and entity results with correct resultType', () => {
    indexDocument(db, {
      docId: 'scene-mix',
      vault: 'story',
      kind: 'scene',
      title: 'Thornwood Forest',
      body: 'They crossed the thornwood at dawn.',
    });
    indexDocument(db, {
      docId: 'ent-mix',
      vault: 'notes',
      kind: 'location',
      title: 'Thornwood Forest',
      body: 'An ancient cursed forest in the northern reaches.',
    });

    const results = searchVault(db, 'thornwood', 'both');
    expect(results.length).toBeGreaterThan(0);

    const sceneResult = results.find((r) => r.docId === 'scene-mix');
    const entityResult = results.find((r) => r.docId === 'ent-mix');

    expect(sceneResult?.resultType).toBe('scene');
    expect(entityResult?.resultType).toBe('entity');
  });

  it('entity found via fuzzy name match has resultType "entity"', () => {
    indexDocument(db, {
      docId: 'char-fuzzy',
      vault: 'notes',
      kind: 'character',
      title: 'Dawnstrider Vael',
      body: 'A ranger of the eastern plains.',
    });

    // 'dawnstr' won't hit FTS stemmer but will hit the LIKE fallback
    const results = searchVault(db, 'dawnstr', 'notes');
    const found = results.find((r) => r.docId === 'char-fuzzy');
    expect(found).toBeDefined();
    expect(found?.resultType).toBe('entity');
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
});

// ─── Incremental update planning (perf-audit: watcher reindex rework) ───

import fs from 'fs';
import os from 'os';
import path from 'path';

function manifestWithScenes(): Manifest {
  const m = emptyManifest();
  m.stories = [
    {
      id: 'st-1', title: 'Story', path: 'stories/st-1', createdAt: '', updatedAt: '',
      chapters: [
        {
          id: 'ch-1', title: 'Ch', path: 'stories/st-1/chapters/ch-1', order: 0, createdAt: '', updatedAt: '',
          scenes: [
            { id: 'sc-1', title: 'Gate', path: 'stories/st-1/chapters/ch-1/scenes/sc-1.md', order: 0, chapterId: 'ch-1', storyId: 'st-1', blocks: [], draftState: 'in-progress', createdAt: '', updatedAt: '' },
            { id: 'sc-2', title: 'Tower', path: 'stories/st-1/chapters/ch-1/scenes/sc-2.md', order: 1, chapterId: 'ch-1', storyId: 'st-1', blocks: [], draftState: 'in-progress', createdAt: '', updatedAt: '' },
          ],
        },
      ],
    },
  ] as Manifest['stories'];
  return m;
}

describe('planFtsUpdate', () => {
  it('returns an empty incremental plan for no changes', () => {
    const plan = planFtsUpdate(manifestWithScenes(), []);
    expect(plan).toEqual({ kind: 'incremental', docs: [] });
  });

  it('maps changed scene paths to per-document plans', () => {
    const plan = planFtsUpdate(manifestWithScenes(), ['stories/st-1/chapters/ch-1/scenes/sc-2.md']);
    expect(plan.kind).toBe('incremental');
    if (plan.kind === 'incremental') {
      expect(plan.docs).toEqual([
        { docId: 'sc-2', relPath: 'stories/st-1/chapters/ch-1/scenes/sc-2.md', title: 'Tower' },
      ]);
    }
  });

  it('normalizes Windows separators in changed paths', () => {
    const plan = planFtsUpdate(manifestWithScenes(), ['stories\\st-1\\chapters\\ch-1\\scenes\\sc-1.md']);
    expect(plan.kind).toBe('incremental');
  });

  it('falls back to full rebuild for unknown paths (deletes/renames)', () => {
    const plan = planFtsUpdate(manifestWithScenes(), ['stories/st-1/chapters/ch-1/scenes/deleted.md']);
    expect(plan).toEqual({ kind: 'full' });
  });

  it('falls back to full rebuild past the incremental cap', () => {
    const changed = Array.from({ length: 51 }, (_, i) => `stories/x/${i}.md`);
    expect(planFtsUpdate(manifestWithScenes(), changed, 50)).toEqual({ kind: 'full' });
  });
});

describe('indexSceneFromDisk / refreshEntityIndex', () => {
  let vaultRoot: string;
  let db: DatabaseSync;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-search-inc-'));
    db = makeDb();
  });

  it('indexes a scene from its markdown file and finds new prose', () => {
    const rel = 'stories/st-1/chapters/ch-1/scenes/sc-1.md';
    fs.mkdirSync(path.dirname(path.join(vaultRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, rel), '---\nid: sc-1\n---\n\nThe drowned tower bell rang.');
    indexSceneFromDisk(db, vaultRoot, { docId: 'sc-1', relPath: rel, title: 'Gate' });
    const results = searchVault(db, 'drowned', 'both');
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('sc-1');

    // Re-index with updated prose replaces (not duplicates) the doc.
    fs.writeFileSync(path.join(vaultRoot, rel), '---\nid: sc-1\n---\n\nThe lantern guttered.');
    indexSceneFromDisk(db, vaultRoot, { docId: 'sc-1', relPath: rel, title: 'Gate' });
    expect(searchVault(db, 'drowned', 'both')).toHaveLength(0);
    expect(searchVault(db, 'lantern', 'both')).toHaveLength(1);
  });

  it('indexes title-only when the scene file is unreadable', () => {
    indexSceneFromDisk(db, vaultRoot, { docId: 'sc-x', relPath: 'stories/missing.md', title: 'Ghost Chapter' });
    expect(searchVault(db, 'ghost', 'both')).toHaveLength(1);
  });

  it('refreshes entity docs bounded by entity count', () => {
    const m = emptyManifest();
    m.entities = [
      { id: 'en-1', name: 'Mira', type: 'character', path: 'Characters/Mira.md', aliases: ['The Causeway Girl'], tags: [], createdAt: '', updatedAt: '' },
    ] as Manifest['entities'];
    refreshEntityIndex(db, vaultRoot, m);
    const results = searchVault(db, 'causeway', 'both');
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('en-1');
  });
});
