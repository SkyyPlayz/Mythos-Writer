import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createEntity,
  readEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  reindexEntities,
  migrateEntityAliases,
  entityRelPath,
  applyTypedRelation,
} from './entities.js';
import { defaultManifest } from './vault.js';
import type { Manifest } from './ipc.js';

let tmpDir: string;
let manifest: Manifest;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entities-'));
  manifest = defaultManifest(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('entityRelPath', () => {
  it('maps type to plural folder', () => {
    expect(entityRelPath('character', 'abc')).toBe('entities/characters/abc.md');
    expect(entityRelPath('location', 'xyz')).toBe('entities/locations/xyz.md');
    expect(entityRelPath('item', '1')).toBe('entities/items/1.md');
    expect(entityRelPath('concept', '2')).toBe('entities/concepts/2.md');
    expect(entityRelPath('other', '3')).toBe('entities/others/3.md');
    expect(entityRelPath('faction', '4')).toBe('entities/factions/4.md');
    expect(entityRelPath('event', '5')).toBe('entities/events/5.md');
  });
});

describe('createEntity', () => {
  it('creates a markdown file with valid YAML frontmatter', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria Voss',
      type: 'character',
      aliases: ['Aria', 'The Weaver'],
      tags: ['protagonist', 'mage'],
      prose: 'A powerful sorceress from the Eastern Reaches.',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe('Aria Voss');
    expect(entry.type).toBe('character');
    expect(entry.path).toBe(`entities/characters/${entry.id}.md`);

    const fullPath = path.join(tmpDir, entry.path);
    expect(fs.existsSync(fullPath)).toBe(true);

    const raw = fs.readFileSync(fullPath, 'utf-8');
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain(`id: ${entry.id}`);
    expect(raw).toContain('name: Aria Voss');
    expect(raw).toContain('type: character');
    expect(raw).toContain('aliases: [Aria, The Weaver]');
    expect(raw).toContain('tags: [protagonist, mage]');
    expect(raw).toContain('A powerful sorceress from the Eastern Reaches.');
  });

  it('adds entry to manifest', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Thornfeld', type: 'location' });
    expect(manifest.entities).toHaveLength(1);
    expect(manifest.entities[0].id).toBe(entry.id);
  });

  it('creates entity without optional fields', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Sword of Light', type: 'item' });
    expect(entry.aliases).toBeUndefined();
    expect(entry.tags).toBeUndefined();
  });

  it('creates entities/characters/<uuid>.md when vault root is a symlink', () => {
    const linkedRoot = `${tmpDir}-link`;
    fs.symlinkSync(tmpDir, linkedRoot);
    try {
      const entry = createEntity(linkedRoot, manifest, { name: 'Aria Voss', type: 'character' });
      expect(entry.path).toBe(`entities/characters/${entry.id}.md`);
      expect(fs.existsSync(path.join(tmpDir, entry.path))).toBe(true);
    } finally {
      fs.rmSync(linkedRoot, { force: true });
    }
  });
});

describe('readEntity', () => {
  it('reads back the entity by id', () => {
    const created = createEntity(tmpDir, manifest, {
      name: 'Aria Voss',
      type: 'character',
      prose: 'Protagonist.',
    });

    const read = readEntity(tmpDir, manifest, created.id);
    expect(read).not.toBeNull();
    expect(read!.name).toBe('Aria Voss');
    expect(read!.id).toBe(created.id);
  });

  it('returns null for unknown id', () => {
    expect(readEntity(tmpDir, manifest, 'no-such-id')).toBeNull();
  });
});

describe('updateEntity', () => {
  it('updates name and writes new frontmatter', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Old Name', type: 'character' });
    const updated = updateEntity(tmpDir, manifest, entry.id, { name: 'New Name' });

    expect(updated.name).toBe('New Name');
    const raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).toContain('name: New Name');
  });

  it('updates prose without losing frontmatter', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria',
      type: 'character',
      prose: 'Old prose.',
    });
    updateEntity(tmpDir, manifest, entry.id, { prose: 'New prose.' });
    const raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).toContain('name: Aria');
    expect(raw).toContain('New prose.');
    expect(raw).not.toContain('Old prose.');
  });

  it('updates manifest entry', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    updateEntity(tmpDir, manifest, entry.id, { name: 'Aria Voss' });
    expect(manifest.entities[0].name).toBe('Aria Voss');
  });

  it('throws for unknown id', () => {
    expect(() => updateEntity(tmpDir, manifest, 'no-such', { name: 'X' })).toThrow('Entity not found');
  });
});

describe('deleteEntity', () => {
  it('removes the file and manifest entry', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    const fullPath = path.join(tmpDir, entry.path);
    expect(fs.existsSync(fullPath)).toBe(true);

    const result = deleteEntity(tmpDir, manifest, entry.id);
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(fullPath)).toBe(false);
    expect(manifest.entities).toHaveLength(0);
  });

  it('returns deleted:false for unknown id', () => {
    const result = deleteEntity(tmpDir, manifest, 'ghost');
    expect(result.deleted).toBe(false);
  });
});

describe('listEntities', () => {
  beforeEach(() => {
    createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    createEntity(tmpDir, manifest, { name: 'Thornfeld', type: 'location' });
    createEntity(tmpDir, manifest, { name: 'Kael', type: 'character' });
  });

  it('lists all entities', () => {
    const all = listEntities(tmpDir, manifest);
    expect(all).toHaveLength(3);
  });

  it('filters by type', () => {
    const chars = listEntities(tmpDir, manifest, 'character');
    expect(chars).toHaveLength(2);
    expect(chars.every((e) => e.type === 'character')).toBe(true);
  });
});

describe('reindexEntities', () => {
  it('picks up entity files not in manifest', () => {
    // Create entity, then wipe manifest entries to simulate fresh open
    const entry = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    manifest.entities = [];

    reindexEntities(tmpDir, manifest);
    expect(manifest.entities).toHaveLength(1);
    expect(manifest.entities[0].id).toBe(entry.id);
    expect(manifest.entities[0].name).toBe('Aria');
  });

  it('does not duplicate existing entries', () => {
    createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    reindexEntities(tmpDir, manifest);
    expect(manifest.entities).toHaveLength(1);
  });

  // GH#632: one unreadable type directory must not abort the whole index.
  it('skips unreadable type directories and continues indexing others (GH#632)', () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses chmod

    const goodEntry = createEntity(tmpDir, manifest, { name: 'Lyra', type: 'character' });
    // Create a second type directory and lock it
    const lockedTypeDir = path.join(tmpDir, 'entities', 'locations');
    fs.mkdirSync(lockedTypeDir, { recursive: true });
    fs.writeFileSync(path.join(lockedTypeDir, 'city.md'), '---\nid: fake-loc\nname: Midcity\ntype: location\n---\n');
    fs.chmodSync(lockedTypeDir, 0o000);

    manifest.entities = [];
    try {
      reindexEntities(tmpDir, manifest);
    } finally {
      fs.chmodSync(lockedTypeDir, 0o700);
    }

    // The readable character type must still be indexed
    expect(manifest.entities.some((e) => e.id === goodEntry.id)).toBe(true);
    // The locked location type is simply skipped — no throw, and count is 1 not 2
    expect(manifest.entities).toHaveLength(1);
  });
});

describe('aliases frontmatter serialization', () => {
  it('writes aliases: [] when aliases is an empty array', () => {
    // Simulate migration: entity created without aliases, then migrated
    const entry = createEntity(tmpDir, manifest, { name: 'Nameless', type: 'character' });
    expect(entry.aliases).toBeUndefined();

    // Run migration — should write aliases: []
    const { migrated } = migrateEntityAliases(tmpDir, manifest);
    expect(migrated).toBe(1);

    const raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).toContain('aliases: []');
  });

  it('writes aliases: [a, b] for non-empty arrays', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Lyra',
      type: 'character',
      aliases: ['the Stranger', 'she who walks the wall'],
    });
    const raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).toContain('aliases: [the Stranger, she who walks the wall]');
  });

  it('round-trips multi-word aliases through parse/serialize', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Aria',
      type: 'character',
      aliases: ['the Weaver', 'Aria Voss'],
    });
    const read = readEntity(tmpDir, manifest, entry.id);
    expect(read!.aliases).toEqual(['the Weaver', 'Aria Voss']);
  });
});

describe('migrateEntityAliases', () => {
  it('adds aliases: [] to entities whose frontmatter lacks the field', () => {
    const entry = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    let raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).not.toContain('aliases');

    const result = migrateEntityAliases(tmpDir, manifest);
    expect(result.migrated).toBe(1);

    raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw).toContain('aliases: []');
  });

  it('does not overwrite entities that already have aliases', () => {
    createEntity(tmpDir, manifest, {
      name: 'Aria',
      type: 'character',
      aliases: ['Ari', 'The Weaver'],
    });
    const result = migrateEntityAliases(tmpDir, manifest);
    expect(result.migrated).toBe(0);

    const raw = fs.readFileSync(path.join(tmpDir, manifest.entities[0].path), 'utf-8');
    expect(raw).toContain('aliases: [Ari, The Weaver]');
  });

  it('does not overwrite entities that have aliases: [] (already migrated)', () => {
    createEntity(tmpDir, manifest, { name: 'Ghost', type: 'character' });
    migrateEntityAliases(tmpDir, manifest); // first pass
    const result = migrateEntityAliases(tmpDir, manifest); // second pass — idempotent
    expect(result.migrated).toBe(0);
  });

  it('updates the in-memory manifest entry aliases', () => {
    createEntity(tmpDir, manifest, { name: 'Kael', type: 'character' });
    expect(manifest.entities[0].aliases).toBeUndefined();

    migrateEntityAliases(tmpDir, manifest);
    expect(manifest.entities[0].aliases).toEqual([]);
  });

  it('skips entities whose files cannot be read and does not throw', () => {
    createEntity(tmpDir, manifest, { name: 'Ghost', type: 'character' });
    fs.rmSync(path.join(tmpDir, manifest.entities[0].path));

    const result = migrateEntityAliases(tmpDir, manifest);
    expect(result.migrated).toBe(0);
  });

  it('migrates only entities without aliases when mixed', () => {
    createEntity(tmpDir, manifest, { name: 'No Aliases', type: 'character' });
    createEntity(tmpDir, manifest, { name: 'Has Aliases', type: 'character', aliases: ['Alias A'] });
    createEntity(tmpDir, manifest, { name: 'Also No Aliases', type: 'location' });

    const result = migrateEntityAliases(tmpDir, manifest);
    expect(result.migrated).toBe(2);
  });
});

describe('Obsidian compatibility', () => {
  it('frontmatter starts and ends with --- delimiters', () => {
    const entry = createEntity(tmpDir, manifest, {
      name: 'Test',
      type: 'character',
      prose: 'Body text.',
    });
    const raw = fs.readFileSync(path.join(tmpDir, entry.path), 'utf-8');
    expect(raw.startsWith('---\n')).toBe(true);
    // Second --- delimiter exists before prose
    const secondDelim = raw.indexOf('---\n', 4);
    expect(secondDelim).toBeGreaterThan(0);
    // Prose appears after frontmatter
    expect(raw.indexOf('Body text.')).toBeGreaterThan(secondDelim);
  });
});

// ─── applyTypedRelation (SKY-195 / SKY-901) ───
//
// Tight unit-level coverage of the same code path the suggestionsAccept IPC
// handler uses for typed-relation suggestions. Catches the SKY-901 regression
// (source-side write skipped) without paying the 8s E2E poll.

describe('applyTypedRelation', () => {
  it('writes the forward relation to the source entity file', () => {
    const elara = createEntity(tmpDir, manifest, { name: 'Elara', type: 'character' });
    const dorian = createEntity(tmpDir, manifest, { name: 'Dorian', type: 'character' });

    const { sourceWritten, targetWritten } = applyTypedRelation(tmpDir, manifest, {
      relationType: 'married to',
      sourceEntityId: elara.id,
      targetEntityId: dorian.id,
    });

    expect(sourceWritten).toBe(true);
    expect(targetWritten).toBe(true);

    const sourceRaw = fs.readFileSync(path.join(tmpDir, elara.path), 'utf-8');
    expect(sourceRaw).toContain('relations:');
    expect(sourceRaw).toContain('type: married to');
    expect(sourceRaw).toContain(`target: ${dorian.id}`);
  });

  it('writes the reciprocal relation to the target entity file', () => {
    const elara = createEntity(tmpDir, manifest, { name: 'Elara', type: 'character' });
    const dorian = createEntity(tmpDir, manifest, { name: 'Dorian', type: 'character' });

    applyTypedRelation(tmpDir, manifest, {
      relationType: 'married to',
      sourceEntityId: elara.id,
      targetEntityId: dorian.id,
    });

    const targetRaw = fs.readFileSync(path.join(tmpDir, dorian.path), 'utf-8');
    expect(targetRaw).toContain('relations:');
    expect(targetRaw).toContain('type: married to');
    expect(targetRaw).toContain(`target: ${elara.id}`);
  });

  it('writes asymmetric reciprocal (parent of ↔ child of)', () => {
    const parent = createEntity(tmpDir, manifest, { name: 'Aria', type: 'character' });
    const child = createEntity(tmpDir, manifest, { name: 'Lior', type: 'character' });

    applyTypedRelation(tmpDir, manifest, {
      relationType: 'parent of',
      sourceEntityId: parent.id,
      targetEntityId: child.id,
    });

    const parentRaw = fs.readFileSync(path.join(tmpDir, parent.path), 'utf-8');
    const childRaw = fs.readFileSync(path.join(tmpDir, child.path), 'utf-8');
    expect(parentRaw).toContain('type: parent of');
    expect(parentRaw).toContain(`target: ${child.id}`);
    expect(childRaw).toContain('type: child of');
    expect(childRaw).toContain(`target: ${parent.id}`);
  });

  it('updates the manifest entries with the new relations', () => {
    const a = createEntity(tmpDir, manifest, { name: 'A', type: 'character' });
    const b = createEntity(tmpDir, manifest, { name: 'B', type: 'character' });

    applyTypedRelation(tmpDir, manifest, {
      relationType: 'ally of',
      sourceEntityId: a.id,
      targetEntityId: b.id,
    });

    const aEntry = manifest.entities.find((e) => e.id === a.id);
    const bEntry = manifest.entities.find((e) => e.id === b.id);
    expect(aEntry?.relations).toEqual([{ type: 'ally of', target: b.id }]);
    expect(bEntry?.relations).toEqual([{ type: 'ally of', target: a.id }]);
  });

  it('is idempotent — re-applying the same relation does not duplicate', () => {
    const a = createEntity(tmpDir, manifest, { name: 'A', type: 'character' });
    const b = createEntity(tmpDir, manifest, { name: 'B', type: 'character' });

    const first = applyTypedRelation(tmpDir, manifest, {
      relationType: 'sibling of',
      sourceEntityId: a.id,
      targetEntityId: b.id,
    });
    expect(first.sourceWritten).toBe(true);
    expect(first.targetWritten).toBe(true);

    const second = applyTypedRelation(tmpDir, manifest, {
      relationType: 'sibling of',
      sourceEntityId: a.id,
      targetEntityId: b.id,
    });
    expect(second.sourceWritten).toBe(false);
    expect(second.targetWritten).toBe(false);

    const aEntry = manifest.entities.find((e) => e.id === a.id);
    expect(aEntry?.relations).toHaveLength(1);
  });

  it('preserves pre-existing relations and appends the new one', () => {
    const a = createEntity(tmpDir, manifest, {
      name: 'A',
      type: 'character',
      relations: [{ type: 'mentor of', target: 'pre-existing-id' }],
    });
    const b = createEntity(tmpDir, manifest, { name: 'B', type: 'character' });

    applyTypedRelation(tmpDir, manifest, {
      relationType: 'ally of',
      sourceEntityId: a.id,
      targetEntityId: b.id,
    });

    const aEntry = manifest.entities.find((e) => e.id === a.id);
    expect(aEntry?.relations).toEqual([
      { type: 'mentor of', target: 'pre-existing-id' },
      { type: 'ally of', target: b.id },
    ]);
  });

  it('reports sourceWritten=false when the source entity is missing from the manifest', () => {
    const dorian = createEntity(tmpDir, manifest, { name: 'Dorian', type: 'character' });

    const result = applyTypedRelation(tmpDir, manifest, {
      relationType: 'married to',
      sourceEntityId: 'missing-source-id',
      targetEntityId: dorian.id,
    });

    // Caller (suggestionsAccept) uses this to downgrade 'applied' to 'accepted'
    // when nothing was actually persisted, instead of silently claiming success.
    expect(result.sourceWritten).toBe(false);
    expect(result.targetWritten).toBe(false); // reciprocal points at a missing source id; not written
  });

  it('reports both false when both entities are missing (stale suggestion case)', () => {
    const result = applyTypedRelation(tmpDir, manifest, {
      relationType: 'married to',
      sourceEntityId: 'missing-a',
      targetEntityId: 'missing-b',
    });

    expect(result.sourceWritten).toBe(false);
    expect(result.targetWritten).toBe(false);
  });
});
