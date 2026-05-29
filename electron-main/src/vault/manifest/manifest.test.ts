import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { SCHEMA_VERSION } from './types.js';
import { emptyManifestV1, validateManifestV1, ManifestValidationError } from './schema.js';
import { writeManifestV1 } from './writer.js';
import {
  openManifestV1,
  ManifestVersionError,
  ManifestMigrationError,
} from './reader.js';
import { runMigrations, needsMigration } from './migrationRunner.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function v0Manifest(vaultRoot: string) {
  return {
    version: '2.0.0',
    vaultRoot,
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };
}

function v0WithData(vaultRoot: string) {
  return {
    version: '1.5.0',
    vaultRoot,
    scenes: [
      {
        id: 'sc-1',
        title: 'Opening',
        path: 'Manuscript/ch1/scene-1.md',
        order: 0,
        chapterId: 'ch-1',
        blocks: [{ id: 'b1', type: 'prose', order: 0, content: 'Once upon a time…', updatedAt: '' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ],
    entities: [
      {
        id: 'ent-1',
        name: 'Alice',
        type: 'character',
        path: 'Characters/alice.md',
        tags: ['protagonist'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    suggestions: [
      { id: 'sug-1', status: 'accepted', targetPath: 'Manuscript/ch1/scene-1.md' },
    ],
    provenance: { 'sug-1': 'Manuscript/ch1/scene-1.md' },
    boardReferences: ['Boards/main.json'],
    stories: [],
    chapters: [],
  };
}

// ─── SCHEMA_VERSION ──────────────────────────────────────────────────────────

describe('SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

// ─── emptyManifestV1 ─────────────────────────────────────────────────────────

describe('emptyManifestV1', () => {
  it('produces a schemaVersion 1 manifest', () => {
    const m = emptyManifestV1('/vault');
    expect(m.schemaVersion).toBe(1);
  });

  it('has empty arrays for all collection fields', () => {
    const m = emptyManifestV1('/vault');
    expect(m.scenes).toEqual([]);
    expect(m.entities).toEqual([]);
    expect(m.suggestions).toEqual([]);
    expect(m.provenance).toEqual([]);
    expect(m.boards).toEqual([]);
  });

  it('sets vaultRoot to the supplied path', () => {
    const m = emptyManifestV1('/some/vault');
    expect(m.vaultRoot).toBe('/some/vault');
  });
});

// ─── validateManifestV1 ──────────────────────────────────────────────────────

describe('validateManifestV1', () => {
  it('accepts a valid empty manifest', () => {
    expect(() => validateManifestV1(emptyManifestV1('/v'))).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validateManifestV1(null)).toThrow(ManifestValidationError);
    expect(() => validateManifestV1('string')).toThrow(ManifestValidationError);
    expect(() => validateManifestV1(42)).toThrow(ManifestValidationError);
  });

  it('rejects wrong schemaVersion', () => {
    const bad = { ...emptyManifestV1('/v'), schemaVersion: 2 };
    expect(() => validateManifestV1(bad)).toThrow(/schemaVersion/);
  });

  it('rejects missing scenes array', () => {
    const { scenes: _, ...bad } = emptyManifestV1('/v');
    expect(() => validateManifestV1(bad)).toThrow(/scenes/);
  });

  it('rejects a scene entry missing required fields', () => {
    const m = { ...emptyManifestV1('/v'), scenes: [{ id: 's1' }] };
    expect(() => validateManifestV1(m)).toThrow(/scenes\[0\]/);
  });

  it('rejects an entity with an invalid type', () => {
    const m = {
      ...emptyManifestV1('/v'),
      entities: [{
        id: 'e1', name: 'Alice', type: 'dragon', path: 'p.md',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
    };
    expect(() => validateManifestV1(m)).toThrow(/entities\[0\].type/);
  });

  it('rejects a suggestion with an invalid status', () => {
    const m = {
      ...emptyManifestV1('/v'),
      suggestions: [{ id: 's1', status: 'pending' }],
    };
    expect(() => validateManifestV1(m)).toThrow(/suggestions\[0\].status/);
  });

  it('rejects a provenance entry missing vaultPath', () => {
    const m = {
      ...emptyManifestV1('/v'),
      provenance: [{ createdAt: new Date().toISOString() }],
    };
    expect(() => validateManifestV1(m)).toThrow(/provenance\[0\].vaultPath/);
  });

  it('rejects a board ref missing id', () => {
    const m = {
      ...emptyManifestV1('/v'),
      boards: [{ path: 'b.json', updatedAt: new Date().toISOString() }],
    };
    expect(() => validateManifestV1(m)).toThrow(/boards\[0\].id/);
  });
});

// ─── runMigrations ───────────────────────────────────────────────────────────

describe('runMigrations', () => {
  it('upgrades a v0 manifest (no schemaVersion) to v1', () => {
    const raw = v0Manifest('/vault');
    const migrated = runMigrations(raw as Record<string, unknown>);
    expect(migrated.schemaVersion).toBe(1);
  });

  it('is a no-op on a manifest already at SCHEMA_VERSION', () => {
    const m = emptyManifestV1('/vault');
    const result = runMigrations(m as unknown as Record<string, unknown>);
    expect(result.schemaVersion).toBe(1);
  });

  it('throws ManifestVersionError for a future schemaVersion', () => {
    const future = { schemaVersion: 99 };
    expect(() => runMigrations(future)).toThrow(ManifestVersionError);
  });

  it('preserves scene data through migration', () => {
    const raw = v0WithData('/vault');
    const migrated = runMigrations(raw as Record<string, unknown>);
    const scenes = migrated.scenes as Array<Record<string, unknown>>;
    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe('sc-1');
    expect(scenes[0].title).toBe('Opening');
    // blocks should NOT be present in the v1 index entry
    expect(scenes[0].blocks).toBeUndefined();
  });

  it('migrates old provenance Record to ProvenanceEntry[]', () => {
    const raw = v0WithData('/vault');
    const migrated = runMigrations(raw as Record<string, unknown>);
    const prov = migrated.provenance as Array<Record<string, unknown>>;
    expect(Array.isArray(prov)).toBe(true);
    expect(prov).toHaveLength(1);
    expect(prov[0].vaultPath).toBe('Manuscript/ch1/scene-1.md');
    expect(prov[0].suggestionId).toBe('sug-1');
  });

  it('migrates boardReferences string[] to BoardRef[]', () => {
    const raw = v0WithData('/vault');
    const migrated = runMigrations(raw as Record<string, unknown>);
    const boards = migrated.boards as Array<Record<string, unknown>>;
    expect(Array.isArray(boards)).toBe(true);
    expect(boards).toHaveLength(1);
    expect(boards[0].path).toBe('Boards/main.json');
  });

  it('migrates entity fields correctly', () => {
    const raw = v0WithData('/vault');
    const migrated = runMigrations(raw as Record<string, unknown>);
    const entities = migrated.entities as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('character');
    expect(entities[0].name).toBe('Alice');
  });
});

describe('needsMigration', () => {
  it('returns true when schemaVersion is absent', () => {
    expect(needsMigration({ version: '1.0.0' })).toBe(true);
  });

  it('returns true when schemaVersion is 0', () => {
    expect(needsMigration({ schemaVersion: 0 })).toBe(true);
  });

  it('returns false when schemaVersion equals SCHEMA_VERSION', () => {
    expect(needsMigration({ schemaVersion: SCHEMA_VERSION })).toBe(false);
  });
});

// ─── writeManifestV1 ─────────────────────────────────────────────────────────

describe('writeManifestV1', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mf-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid v1 manifest to disk', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, emptyManifestV1(tmpDir));
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(parsed.schemaVersion).toBe(1);
  });

  it('leaves no .tmp file after a successful write', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, emptyManifestV1(tmpDir));
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
  });

  it('overwrites an existing manifest', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, { ...emptyManifestV1(tmpDir), version: '1.0.0' });
    writeManifestV1(p, { ...emptyManifestV1(tmpDir), version: '2.0.0' });
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(parsed.version).toBe('2.0.0');
  });
});

// ─── openManifestV1 ──────────────────────────────────────────────────────────

describe('openManifestV1', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-open-v1-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads and returns an existing v1 manifest unchanged', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, emptyManifestV1(tmpDir));
    const m = openManifestV1(p);
    expect(m.schemaVersion).toBe(1);
  });

  it('does not rewrite a manifest already at SCHEMA_VERSION', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, emptyManifestV1(tmpDir));
    const before = fs.statSync(p).mtimeMs;
    openManifestV1(p);
    expect(fs.statSync(p).mtimeMs).toBe(before);
  });

  it('migrates a v0 manifest, writes it back as v1', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(v0Manifest(tmpDir), null, 2), 'utf-8');

    const m = openManifestV1(p, { vaultRoot: tmpDir });
    expect(m.schemaVersion).toBe(1);

    const onDisk = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(onDisk.schemaVersion).toBe(1);
  });

  it('creates a backup before migrating a v0 manifest', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(v0Manifest(tmpDir), null, 2), 'utf-8');

    openManifestV1(p, { vaultRoot: tmpDir });

    const backupDir = path.join(tmpDir, '.mythos', 'backups');
    expect(fs.existsSync(backupDir)).toBe(true);
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith('manifest-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);

    const backupContent = JSON.parse(
      fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8')
    ) as Record<string, unknown>;
    expect(backupContent.schemaVersion).toBeUndefined();
  });

  it('calls onMigrated with correct version info', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(v0Manifest(tmpDir), null, 2), 'utf-8');

    type Entry = { id: string; fromVersion: number; toVersion: number; backupPath: string; createdAt: string };
    let entry: Entry | null = null;
    openManifestV1(p, { vaultRoot: tmpDir, onMigrated: (e) => { entry = e; } });

    expect(entry).not.toBeNull();
    expect(entry!.fromVersion).toBe(0);
    expect(entry!.toVersion).toBe(SCHEMA_VERSION);
    expect(typeof entry!.id).toBe('string');
    expect(entry!.backupPath).toContain('.mythos');
  });

  it('does NOT call onMigrated when manifest is already v1', () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestV1(p, emptyManifestV1(tmpDir));

    const onMigrated = vi.fn();
    openManifestV1(p, { vaultRoot: tmpDir, onMigrated });
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it('throws ManifestVersionError for a future schemaVersion (file untouched)', () => {
    const p = path.join(tmpDir, 'manifest.json');
    const future = { ...emptyManifestV1(tmpDir), schemaVersion: 99 as unknown as 1 };
    fs.writeFileSync(p, JSON.stringify(future, null, 2), 'utf-8');
    const before = fs.statSync(p).mtimeMs;

    expect(() => openManifestV1(p)).toThrow(ManifestVersionError);
    expect(fs.statSync(p).mtimeMs).toBe(before);
  });

  it('ManifestVersionError carries the found version', () => {
    const p = path.join(tmpDir, 'manifest.json');
    const future = { ...emptyManifestV1(tmpDir), schemaVersion: 42 as unknown as 1 };
    fs.writeFileSync(p, JSON.stringify(future, null, 2), 'utf-8');

    let err: ManifestVersionError | null = null;
    try { openManifestV1(p); } catch (e) { err = e as ManifestVersionError; }
    expect(err).toBeInstanceOf(ManifestVersionError);
    expect(err!.foundVersion).toBe(42);
  });

  it('corrupted JSON throws ManifestMigrationError and creates a backup', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, '{ not: valid json', 'utf-8');

    let err: ManifestMigrationError | null = null;
    try { openManifestV1(p, { vaultRoot: tmpDir }); } catch (e) { err = e as ManifestMigrationError; }

    expect(err).toBeInstanceOf(ManifestMigrationError);
    expect(typeof err!.backupPath).toBe('string');
    expect(fs.existsSync(err!.backupPath)).toBe(true);
    expect(fs.readFileSync(err!.backupPath, 'utf-8')).toBe('{ not: valid json');
  });

  it('partial corruption (null scene entry) throws ManifestMigrationError with backup', () => {
    const p = path.join(tmpDir, 'manifest.json');
    // Valid JSON, valid schemaVersion 0, but scenes array contains null — migrateScene will TypeError
    const corrupt = { version: '1.0.0', vaultRoot: tmpDir, scenes: [null], entities: [], suggestions: [], provenance: {}, boardReferences: [] };
    fs.writeFileSync(p, JSON.stringify(corrupt), 'utf-8');

    let err: ManifestMigrationError | null = null;
    try { openManifestV1(p, { vaultRoot: tmpDir }); } catch (e) { err = e as ManifestMigrationError; }

    expect(err).toBeInstanceOf(ManifestMigrationError);
    expect(typeof err!.backupPath).toBe('string');
    expect(fs.existsSync(err!.backupPath)).toBe(true);
  });

  it('leaves no .tmp file after a successful migration write', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(v0Manifest(tmpDir), null, 2), 'utf-8');

    openManifestV1(p, { vaultRoot: tmpDir });
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
  });

  it('fully round-trips: migrate v0, re-open as v1 without re-migration', () => {
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(v0WithData(tmpDir), null, 2), 'utf-8');

    const first = openManifestV1(p, { vaultRoot: tmpDir });
    expect(first.schemaVersion).toBe(1);

    const onMigrated = vi.fn();
    const second = openManifestV1(p, { vaultRoot: tmpDir, onMigrated });
    expect(second.schemaVersion).toBe(1);
    expect(onMigrated).not.toHaveBeenCalled();
  });
});
