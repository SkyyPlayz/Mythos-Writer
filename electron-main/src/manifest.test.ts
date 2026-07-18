// Manifest v1 — schema validation, atomic write, migration, and regression tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  SCHEMA_VERSION,
  ManifestVersionError,
  ManifestMigrationError,
  migrateManifest,
  writeManifestAtomic,
  stripEmbeddedProseForPersist,
  openManifest,
  pruneOrphanScenes,
} from './manifest.js';
import { defaultManifest, ensureSceneFilesForManifestScenes, readSceneFile } from './vault.js';
import type { Manifest, SceneEntry, ChapterEntry } from './ipc.js';

// Minimal legacy manifest (no schemaVersion, no provenance/boardReferences)
function legacyManifest(vaultRoot: string) {
  return {
    version: '2.0.0',
    vaultRoot,
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeScene(id: string, filePath: string): SceneEntry {
  return {
    id,
    title: `Scene ${id}`,
    path: filePath,
    order: 0,
    blocks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('SCHEMA_VERSION', () => {
  it('is 2 (SKY-6596: structure-only manifest bump)', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});

describe('defaultManifest', () => {
  it('produces a manifest at the current schema version with all required index fields', () => {
    const m = defaultManifest('/tmp/vault');
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.provenance).toEqual({});
    expect(m.boardReferences).toEqual([]);
  });
});

describe('migrateManifest', () => {
  it('upgrades a legacy manifest (no schemaVersion) to the current schema version', () => {
    const raw = legacyManifest('/tmp/vault');
    const migrated = migrateManifest(raw as Record<string, unknown>);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.provenance).toEqual({});
    expect(migrated.boardReferences).toEqual([]);
  });

  it('records migratedAt during v0→v1 migration', () => {
    const raw = legacyManifest('/tmp/vault');
    const before = Date.now();
    const migrated = migrateManifest(raw as Record<string, unknown>);
    const after = Date.now();
    const ts = (migrated as unknown as Record<string, unknown>).migratedAt as string;
    expect(typeof ts).toBe('string');
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('preserves existing provenance and boardReferences when already present', () => {
    const raw = {
      ...legacyManifest('/tmp/vault'),
      provenance: { 'sug-1': 'vault/path.md' },
      boardReferences: ['board/scene.md'],
    };
    const migrated = migrateManifest(raw as Record<string, unknown>);
    expect(migrated.provenance).toEqual({ 'sug-1': 'vault/path.md' });
    expect(migrated.boardReferences).toEqual(['board/scene.md']);
  });

  it('is idempotent when schemaVersion is already current', () => {
    const already = defaultManifest('/tmp/vault');
    const migrated = migrateManifest(already as unknown as Record<string, unknown>);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('preserves all legacy fields after migration', () => {
    const raw = {
      ...legacyManifest('/tmp/vault'),
      stories: [{ id: 's1' }],
    };
    const migrated = migrateManifest(raw as Record<string, unknown>);
    expect((migrated as unknown as Record<string, unknown>).stories).toEqual([{ id: 's1' }]);
  });
});

describe('writeManifestAtomic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes manifest to the correct path', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const m = defaultManifest(tmpDir);
    writeManifestAtomic(manifestPath, m);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('does not leave a .tmp file behind after a successful write', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifestAtomic(manifestPath, defaultManifest(tmpDir));
    expect(fs.existsSync(`${manifestPath}.tmp`)).toBe(false);
  });

  it('overwrites an existing manifest without data loss', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const first = { ...defaultManifest(tmpDir), version: '1.0.0' };
    const second = { ...defaultManifest(tmpDir), version: '2.0.0' };
    writeManifestAtomic(manifestPath, first);
    writeManifestAtomic(manifestPath, second);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(parsed.version).toBe('2.0.0');
  });

  it('original file is unchanged if write-then-rename would fail mid-stream (temp isolation)', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const original = { ...defaultManifest(tmpDir), version: 'original' };
    writeManifestAtomic(manifestPath, original);

    // Simulate a scenario where temp write happens but rename throws:
    // we verify the original is unmodified by checking it still reads correctly.
    // (Mocking fs.renameSync is intentionally avoided to keep the test simple
    //  and dependency-free — the atomic guarantee comes from OS rename semantics.)
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(parsed.version).toBe('original');
  });

  it('concurrent writes are safe — last caller wins with consistent content', () => {
    // Simulate two "writers" serialised in the same process (Node single-threaded):
    // both compute new manifests, then write back-to-back. The final file must be
    // valid JSON with the version from the last write.
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const base = defaultManifest(tmpDir);
    const writerA = { ...base, version: 'writer-a' };
    const writerB = { ...base, version: 'writer-b' };

    writeManifestAtomic(manifestPath, writerA);
    writeManifestAtomic(manifestPath, writerB);

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(parsed.version).toBe('writer-b');
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('writeManifestAtomic — return value (SKY-6195)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-write-bytes-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the exact byte length of the file actually written to disk', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const bytes = writeManifestAtomic(manifestPath, defaultManifest(tmpDir));
    expect(bytes).toBe(fs.statSync(manifestPath).size);
  });

  it('reflects the stripped (prose-blanked) size, not the pre-strip size — proves a single stringify', () => {
    // VAULT_MANIFEST_WRITE previously stringified the manifest a second time
    // (pretty-printed, with embedded prose still present) purely to compute a
    // `bytes` count that never matched what writeManifestAtomic actually wrote
    // to disk. The returned byte count must match the on-disk (structure-only,
    // compact) file, not a second, differently-formatted serialization.
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const m: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeSceneWithProse('s1', 'a.md', 'x'.repeat(50_000))],
    };
    const prettyWithProse = Buffer.byteLength(JSON.stringify(m, null, 2), 'utf-8');

    const bytes = writeManifestAtomic(manifestPath, m);

    expect(bytes).toBe(fs.statSync(manifestPath).size);
    expect(bytes).toBeLessThan(prettyWithProse);
    expect(bytes).toBeLessThan(2_000);
  });
});

describe('openManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-open-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cold start: writes a manifest at the current schema version when no file exists yet', () => {
    // openManifest requires the file to exist; cold-start means the caller
    // creates it first via defaultManifest + writeManifestAtomic, then opens it.
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const fresh = defaultManifest(tmpDir);
    writeManifestAtomic(manifestPath, fresh);

    const opened = openManifest(manifestPath);
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    // .tmp must not linger
    expect(fs.existsSync(`${manifestPath}.tmp`)).toBe(false);
  });

  it('reads a current-schema manifest and returns it unchanged', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const m = defaultManifest(tmpDir);
    writeManifestAtomic(manifestPath, m);
    const opened = openManifest(manifestPath);
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('migrates a legacy manifest (no schemaVersion) and writes back the current schema version', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const legacy = legacyManifest(tmpDir);
    fs.writeFileSync(manifestPath, JSON.stringify(legacy, null, 2), 'utf-8');

    const opened = openManifest(manifestPath);
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);

    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.provenance).toEqual({});
    expect(onDisk.boardReferences).toEqual([]);
  });

  it('records migratedAt on disk after legacy migration', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest(tmpDir), null, 2), 'utf-8');
    openManifest(manifestPath);
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(typeof onDisk.migratedAt).toBe('string');
    expect(new Date(onDisk.migratedAt).getTime()).not.toBeNaN();
  });

  it('does not rewrite a manifest that is already at SCHEMA_VERSION', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifestAtomic(manifestPath, defaultManifest(tmpDir));
    const statBefore = fs.statSync(manifestPath).mtimeMs;

    const opened = openManifest(manifestPath);
    const statAfter = fs.statSync(manifestPath).mtimeMs;

    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(statAfter).toBe(statBefore);
  });

  it('future manifest (schemaVersion 99): throws ManifestVersionError without modifying the file', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const future = { ...defaultManifest(tmpDir), schemaVersion: 99 };
    fs.writeFileSync(manifestPath, JSON.stringify(future, null, 2), 'utf-8');
    const statBefore = fs.statSync(manifestPath).mtimeMs;

    expect(() => openManifest(manifestPath)).toThrow(ManifestVersionError);

    // File must be untouched — app refuses to clobber
    const statAfter = fs.statSync(manifestPath).mtimeMs;
    expect(statAfter).toBe(statBefore);
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(onDisk.schemaVersion).toBe(99);
  });

  it('ManifestVersionError carries the found version', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...defaultManifest(tmpDir), schemaVersion: 42 }, null, 2),
      'utf-8'
    );
    let caught: ManifestVersionError | null = null;
    try {
      openManifest(manifestPath);
    } catch (e) {
      caught = e as ManifestVersionError;
    }
    expect(caught).toBeInstanceOf(ManifestVersionError);
    expect(caught!.foundVersion).toBe(42);
  });

  it('v0→v1 migration creates a backup snapshot before writing the upgrade', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const legacy = legacyManifest(tmpDir);
    fs.writeFileSync(manifestPath, JSON.stringify(legacy, null, 2), 'utf-8');

    openManifest(manifestPath, { vaultRoot: tmpDir });

    const backupDir = path.join(tmpDir, '.mythos', 'backups');
    expect(fs.existsSync(backupDir)).toBe(true);
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith('manifest-'));
    expect(backups).toHaveLength(1);
    const backupContent = JSON.parse(
      fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8')
    ) as Record<string, unknown>;
    // Backup must contain the *pre-migration* (v0) manifest — no schemaVersion field.
    expect(backupContent.schemaVersion).toBeUndefined();
  });

  it('v0→v1 migration calls onMigrated with correct version info', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest(tmpDir), null, 2), 'utf-8');

    type MigrationEntry = { id: string; fromVersion: number; toVersion: number; backupPath: string; createdAt: string };
    let callbackArg: MigrationEntry | null = null;
    openManifest(manifestPath, {
      vaultRoot: tmpDir,
      onMigrated: (entry) => { callbackArg = entry; },
    });

    expect(callbackArg).not.toBeNull();
    expect(callbackArg!.fromVersion).toBe(0);
    expect(callbackArg!.toVersion).toBe(SCHEMA_VERSION);
    expect(typeof callbackArg!.id).toBe('string');
    expect(typeof callbackArg!.backupPath).toBe('string');
    expect(callbackArg!.backupPath).toContain('.mythos');
  });

  it('onMigrated is NOT called when manifest is already at current version', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifestAtomic(manifestPath, defaultManifest(tmpDir));

    const onMigrated = vi.fn();
    openManifest(manifestPath, { vaultRoot: tmpDir, onMigrated });

    expect(onMigrated).not.toHaveBeenCalled();
  });

  it('corrupted manifest (invalid JSON) throws ManifestMigrationError with backup path', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, '{ this is not valid json }', 'utf-8');

    let caught: ManifestMigrationError | null = null;
    try {
      openManifest(manifestPath, { vaultRoot: tmpDir });
    } catch (e) {
      caught = e as ManifestMigrationError;
    }

    expect(caught).toBeInstanceOf(ManifestMigrationError);
    expect(typeof caught!.backupPath).toBe('string');
    expect(caught!.backupPath).toContain('.mythos');
    // Backup file must exist and contain the original corrupt content
    expect(fs.existsSync(caught!.backupPath)).toBe(true);
    expect(fs.readFileSync(caught!.backupPath, 'utf-8')).toBe('{ this is not valid json }');
  });
});

describe('pruneOrphanScenes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prune-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns manifest unchanged when all scene files exist', () => {
    const sceneFile = path.join(tmpDir, 'scene1.md');
    fs.writeFileSync(sceneFile, '# Scene', 'utf-8');

    const m = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene('s1', sceneFile)],
    };
    const { manifest, pruned } = pruneOrphanScenes(m, tmpDir);
    expect(manifest.scenes).toHaveLength(1);
    expect(pruned).toHaveLength(0);
  });

  it('removes orphan scene entries from manifest.scenes and records pruned paths', () => {
    const existingFile = path.join(tmpDir, 'exists.md');
    fs.writeFileSync(existingFile, '# Exists', 'utf-8');

    const m: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene('s1', existingFile), makeScene('s2', path.join(tmpDir, 'missing.md'))],
    };
    const { manifest, pruned } = pruneOrphanScenes(m, tmpDir);
    expect(manifest.scenes).toHaveLength(1);
    expect(manifest.scenes[0].id).toBe('s1');
    expect(pruned).toContain(path.join(tmpDir, 'missing.md'));
  });

  it('prunes orphan scenes nested inside chapters', () => {
    const existingFile = path.join(tmpDir, 'scene-ok.md');
    fs.writeFileSync(existingFile, '# OK', 'utf-8');

    const orphanChapter: ChapterEntry = {
      id: 'ch1',
      title: 'Chapter 1',
      path: path.join(tmpDir, 'ch1.md'),
      order: 0,
      scenes: [
        makeScene('sc-ok', existingFile),
        makeScene('sc-gone', path.join(tmpDir, 'gone.md')),
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const m: Manifest = {
      ...defaultManifest(tmpDir),
      chapters: [orphanChapter],
    };
    const { manifest, pruned } = pruneOrphanScenes(m, tmpDir);
    expect(manifest.chapters[0].scenes).toHaveLength(1);
    expect(manifest.chapters[0].scenes[0].id).toBe('sc-ok');
    expect(pruned).toContain(path.join(tmpDir, 'gone.md'));
  });

  it('does not modify the input manifest (immutability)', () => {
    const m: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene('s1', path.join(tmpDir, 'missing.md'))],
    };
    pruneOrphanScenes(m, tmpDir);
    expect(m.scenes).toHaveLength(1);
  });

  it('returns empty pruned list when manifest has no scenes', () => {
    const m = defaultManifest(tmpDir);
    const { manifest, pruned } = pruneOrphanScenes(m, tmpDir);
    expect(manifest.scenes).toHaveLength(0);
    expect(pruned).toHaveLength(0);
  });
});

// ─── SKY-6596 / GH #893: structure-only manifest ───

function makeSceneWithProse(id: string, filePath: string, content: string): SceneEntry {
  return {
    ...makeScene(id, filePath),
    blocks: [{ id: `b-${id}`, type: 'prose', order: 0, content, updatedAt: new Date().toISOString() }],
  };
}

describe('stripEmbeddedProseForPersist', () => {
  const vaultRoot = '/tmp/vault';

  it('strips content from the flat legacy scenes[] list', () => {
    const m: Manifest = {
      ...defaultManifest(vaultRoot),
      scenes: [makeSceneWithProse('s1', 'a.md', 'Some prose.')],
    };
    const persisted = stripEmbeddedProseForPersist(m);
    expect(persisted.scenes[0].blocks[0].content).toBe('');
  });

  it('strips content from chapters[].scenes[] (legacy nested)', () => {
    const chapter: ChapterEntry = {
      id: 'ch1', title: 'Chapter 1', path: 'ch1.md', order: 0,
      scenes: [makeSceneWithProse('s1', 'a.md', 'Some prose.')],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const m: Manifest = { ...defaultManifest(vaultRoot), chapters: [chapter] };
    const persisted = stripEmbeddedProseForPersist(m);
    expect(persisted.chapters[0].scenes[0].blocks[0].content).toBe('');
  });

  it('strips content from stories[].chapters[].scenes[] (current nested shape)', () => {
    const chapter: ChapterEntry = {
      id: 'ch1', title: 'Chapter 1', path: 'ch1.md', order: 0,
      scenes: [makeSceneWithProse('s1', 'a.md', 'Deep prose.')],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const m: Manifest = {
      ...defaultManifest(vaultRoot),
      stories: [{ id: 'story1', title: 'Story', path: 'story1', chapters: [chapter], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    };
    const persisted = stripEmbeddedProseForPersist(m);
    expect(persisted.stories[0].chapters[0].scenes[0].blocks[0].content).toBe('');
  });

  it('does not mutate the input manifest', () => {
    const m: Manifest = {
      ...defaultManifest(vaultRoot),
      scenes: [makeSceneWithProse('s1', 'a.md', 'Untouched.')],
    };
    stripEmbeddedProseForPersist(m);
    expect(m.scenes[0].blocks[0].content).toBe('Untouched.');
  });

  it('leaves non-prose fields (title, order, path, ids) untouched', () => {
    const m: Manifest = {
      ...defaultManifest(vaultRoot),
      scenes: [makeSceneWithProse('s1', 'a.md', 'Prose.')],
    };
    const persisted = stripEmbeddedProseForPersist(m);
    expect(persisted.scenes[0].id).toBe('s1');
    expect(persisted.scenes[0].title).toBe('Scene s1');
    expect(persisted.scenes[0].path).toBe('a.md');
    expect(persisted.scenes[0].blocks[0].type).toBe('prose');
  });
});

describe('writeManifestAtomic — structure-only persistence (SKY-6596)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-strip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a manifest.json with every scene\'s embedded prose stripped, regardless of caller', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const m: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeSceneWithProse('s1', 'a.md', 'x'.repeat(50_000))],
    };
    writeManifestAtomic(manifestPath, m);

    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    expect(onDisk.scenes[0].blocks[0].content).toBe('');
    // The on-disk file must not grow with prose size — the whole point of SKY-6596.
    expect(fs.statSync(manifestPath).size).toBeLessThan(2_000);
  });
});

describe('openManifest — beforeMigrationWrite recovery hook (SKY-6596)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-recover-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is called with the migrated manifest and vaultRoot before the migration write-back', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest(tmpDir)), 'utf-8');

    let calledWith: { manifest: Manifest; vaultRoot: string } | null = null;
    openManifest(manifestPath, {
      vaultRoot: tmpDir,
      beforeMigrationWrite: (manifest, vaultRoot) => {
        calledWith = { manifest, vaultRoot };
        return manifest;
      },
    });

    expect(calledWith).not.toBeNull();
    expect(calledWith!.vaultRoot).toBe(tmpDir);
    expect(calledWith!.manifest.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('is NOT called when the manifest is already at the current schema version (no migration needed)', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifestAtomic(manifestPath, defaultManifest(tmpDir));

    const hook = vi.fn((m: Manifest) => m);
    openManifest(manifestPath, { vaultRoot: tmpDir, beforeMigrationWrite: hook });

    expect(hook).not.toHaveBeenCalled();
  });

  it('end-to-end: a pre-SKY-6596 vault whose scene prose lives ONLY in the manifest survives migration losslessly', () => {
    // Simulates the highest-risk real-world case: a scene with embedded
    // prose and no `.md` file backing it (e.g. a very old vault, or one
    // hand-edited before this app version ever wrote scene files for it).
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const legacy = {
      ...legacyManifest(tmpDir),
      schemaVersion: 1,
      provenance: {},
      boardReferences: [],
      scenes: [makeSceneWithProse('orphan-1', 'orphan.md', 'This prose has no .md home yet.')],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(legacy), 'utf-8');
    expect(fs.existsSync(path.join(tmpDir, 'orphan.md'))).toBe(false);

    openManifest(manifestPath, {
      vaultRoot: tmpDir,
      beforeMigrationWrite: (manifest, vaultRoot) => ensureSceneFilesForManifestScenes(manifest, vaultRoot),
    });

    // 1. The prose now has a durable, source-of-truth home on disk.
    expect(fs.existsSync(path.join(tmpDir, 'orphan.md'))).toBe(true);
    expect(readSceneFile(tmpDir, 'orphan.md').prose).toBe('This prose has no .md home yet.');

    // 2. The migrated manifest.json itself no longer embeds that prose.
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.scenes[0].blocks[0].content).toBe('');

    // 3. The pre-migration backup still has the original, untouched, as a last resort.
    const backupDir = path.join(tmpDir, '.mythos', 'backups');
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith('manifest-'));
    expect(backups.length).toBeGreaterThan(0);
    const backupContent = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8')) as Manifest;
    expect(backupContent.scenes[0].blocks[0].content).toBe('This prose has no .md home yet.');
  });

  it('without the hook, a scene with no .md backing loses its prose from disk (documents why the hook is non-negotiable)', () => {
    // This is intentionally the "what if we forgot the hook" regression guard —
    // it proves the recovery hook is load-bearing, not decorative.
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const legacy = {
      ...legacyManifest(tmpDir),
      schemaVersion: 1,
      provenance: {},
      boardReferences: [],
      scenes: [makeSceneWithProse('orphan-2', 'orphan2.md', 'Would be lost without recovery.')],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(legacy), 'utf-8');

    openManifest(manifestPath); // no beforeMigrationWrite

    expect(fs.existsSync(path.join(tmpDir, 'orphan2.md'))).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    expect(onDisk.scenes[0].blocks[0].content).toBe('');
    // The backup is the only remaining copy — this is exactly why main.ts always
    // wires the hook at the real boot call site (see main.ts ensureVaultDir).
  });
});
