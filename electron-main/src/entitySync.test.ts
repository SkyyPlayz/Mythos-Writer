import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openDb, closeDb, getEntityIndex, searchEntityFts } from './db.js';
import { defaultManifest } from './vault.js';
import type { Manifest } from './ipc.js';
import { createEntity, updateEntity, deleteEntity } from './entities.js';
import {
  buildEntityIndexRow,
  syncEntityToIndex,
  removeEntityFromIndex,
  syncAllEntitiesToIndex,
} from './entitySync.js';

let tmpDir: string;
let manifest: Manifest;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-sync-'));
  manifest = defaultManifest(tmpDir);
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── buildEntityIndexRow ───

describe('buildEntityIndexRow', () => {
  it('serializes aliases and tags as JSON arrays', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria Voss',
      type: 'character',
      aliases: ['Aria', 'The Weaver'],
      tags: ['protagonist'],
    });
    const row = buildEntityIndexRow(entry, 'Prose body.');
    expect(row.aliases).toBe('["Aria","The Weaver"]');
    expect(row.tags).toBe('["protagonist"]');
    expect(row.notes_text).toBe('Prose body.');
    expect(row.status).toBe('active');
    expect(row.file_path).toBe(entry.path);
  });

  it('stores null for absent aliases/tags/notes', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Plain', type: 'location' });
    const row = buildEntityIndexRow(entry, '');
    expect(row.aliases).toBeNull();
    expect(row.tags).toBeNull();
    expect(row.notes_text).toBeNull();
    expect(row.custom_fields).toBeNull();
  });

  it('serializes user properties as custom_fields JSON', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Kael',
      type: 'character',
      properties: { occupation: 'Ranger', age: 28 },
    });
    const row = buildEntityIndexRow(entry, '');
    const cf = JSON.parse(row.custom_fields!);
    expect(cf.occupation).toBe('Ranger');
    expect(cf.age).toBe(28);
  });
});

// ─── ENTITY_CREATE ───

describe('syncEntityToIndex — create path', () => {
  it('inserts a row in entity_index after create', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria Voss',
      type: 'character',
      aliases: ['Aria'],
      prose: 'A powerful sorceress.',
    });
    syncEntityToIndex(entry, 'A powerful sorceress.');

    const indexed = getEntityIndex(entry.id);
    expect(indexed).not.toBeNull();
    expect(indexed!.name).toBe('Aria Voss');
    expect(indexed!.type).toBe('character');
    expect(indexed!.aliases).toBe('["Aria"]');
    expect(indexed!.notes_text).toBe('A powerful sorceress.');
    expect(indexed!.file_path).toBe(entry.path);
  });

  it('inserts a row in entity_fts after create, findable by name', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Thornfeld',
      type: 'location',
      prose: 'A dark city at the edge of the world.',
    });
    syncEntityToIndex(entry, 'A dark city at the edge of the world.');

    const results = searchEntityFts('Thornfeld');
    expect(results.some((r) => r.entity_id === entry.id)).toBe(true);
  });

  it('inserts entity_fts row findable by alias', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria Voss',
      type: 'character',
      aliases: ['The Weaver'],
    });
    syncEntityToIndex(entry, '');

    const results = searchEntityFts('Weaver');
    expect(results.some((r) => r.entity_id === entry.id)).toBe(true);
  });
});

// ─── ENTITY_UPDATE ───

describe('syncEntityToIndex — update path', () => {
  it('updates entity_index row when name changes', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Old Name', type: 'character' });
    syncEntityToIndex(entry, '');

    const updated = updateEntity(tmpDir, manifest, entry.id, { name: 'New Name' });
    syncEntityToIndex(updated, '');

    const indexed = getEntityIndex(entry.id);
    expect(indexed!.name).toBe('New Name');
  });

  it('replaces entity_fts row — old name gone, new name findable', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Shadowmere', type: 'location' });
    syncEntityToIndex(entry, '');

    const updated = updateEntity(tmpDir, manifest, entry.id, { name: 'Brightmere' });
    syncEntityToIndex(updated, '');

    const oldResults = searchEntityFts('Shadowmere');
    expect(oldResults.some((r) => r.entity_id === entry.id)).toBe(false);

    const newResults = searchEntityFts('Brightmere');
    expect(newResults.some((r) => r.entity_id === entry.id)).toBe(true);
  });

  it('updates notes_text in entity_index when prose changes', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria',
      type: 'character',
      prose: 'Old prose text.',
    });
    syncEntityToIndex(entry, 'Old prose text.');

    const updated = updateEntity(tmpDir, manifest, entry.id, { prose: 'New prose content.' });
    syncEntityToIndex(updated, 'New prose content.');

    const indexed = getEntityIndex(entry.id);
    expect(indexed!.notes_text).toBe('New prose content.');
  });
});

// ─── ENTITY_DELETE ───

describe('removeEntityFromIndex — delete path', () => {
  it('removes row from entity_index after delete', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Ghost', type: 'character' });
    syncEntityToIndex(entry, 'Soon to be gone.');

    expect(getEntityIndex(entry.id)).not.toBeNull();

    deleteEntity(tmpDir, manifest, entry.id);
    removeEntityFromIndex(entry.id);

    expect(getEntityIndex(entry.id)).toBeNull();
  });

  it('removes row from entity_fts after delete', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Vanishing', type: 'character' });
    syncEntityToIndex(entry, '');

    expect(searchEntityFts('Vanishing').some((r) => r.entity_id === entry.id)).toBe(true);

    deleteEntity(tmpDir, manifest, entry.id);
    removeEntityFromIndex(entry.id);

    expect(searchEntityFts('Vanishing').some((r) => r.entity_id === entry.id)).toBe(false);
  });

  it('is safe to call for a non-existent entity id', () => {
    expect(() => removeEntityFromIndex('no-such-id')).not.toThrow();
  });
});

// ─── VAULT_REINDEX ───

describe('syncAllEntitiesToIndex — reindex path', () => {
  it('populates entity_index for all entries', () => {
    const aria = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    const thornfeld = createEntity(tmpDir, manifest, { name: 'Thornfeld', type: 'location' });

    syncAllEntitiesToIndex(tmpDir, manifest.entities);

    expect(getEntityIndex(aria.id)).not.toBeNull();
    expect(getEntityIndex(thornfeld.id)).not.toBeNull();
  });

  it('populates entity_fts for all entries', () => {
    const aria = createEntity(tmpDir, manifest, {
      name: 'Ariadne',
      type: 'character',
      prose: 'A powerful mage.',
    });
    syncAllEntitiesToIndex(tmpDir, manifest.entities);

    expect(searchEntityFts('Ariadne').some((r) => r.entity_id === aria.id)).toBe(true);
  });

  it('removes entity_index rows for entities deleted from disk', () => {
    const aria = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    const ghost = createEntity(tmpDir, manifest, { name: 'Ghost', type: 'character' });

    syncAllEntitiesToIndex(tmpDir, manifest.entities);
    expect(getEntityIndex(aria.id)).not.toBeNull();
    expect(getEntityIndex(ghost.id)).not.toBeNull();

    deleteEntity(tmpDir, manifest, ghost.id);

    syncAllEntitiesToIndex(tmpDir, manifest.entities);

    expect(getEntityIndex(aria.id)).not.toBeNull();
    expect(getEntityIndex(ghost.id)).toBeNull();
  });

  it('removes stale entity_fts rows for entities deleted from disk', () => {
    const ghost = createEntity(tmpDir, manifest, { name: 'Ephemeral', type: 'character' });
    syncAllEntitiesToIndex(tmpDir, manifest.entities);

    expect(searchEntityFts('Ephemeral').some((r) => r.entity_id === ghost.id)).toBe(true);

    deleteEntity(tmpDir, manifest, ghost.id);
    syncAllEntitiesToIndex(tmpDir, manifest.entities);

    expect(searchEntityFts('Ephemeral').some((r) => r.entity_id === ghost.id)).toBe(false);
  });
});
