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
