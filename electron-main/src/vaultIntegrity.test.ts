// SKY-2308: Unit tests for vault manifest integrity check + manifest rebuild.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkIntegrity, rebuildManifest } from './vaultIntegrity.js';
import { defaultManifest, writeManifest } from './vault.js';
import { SCHEMA_VERSION } from './manifest.js';
import type { Manifest, SceneEntry, EntityEntry } from './ipc.js';

function makeScene(id: string, relPath: string): SceneEntry {
  return {
    id,
    title: `Scene ${id}`,
    path: relPath,
    order: 0,
    blocks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeEntity(id: string, relPath: string): EntityEntry {
  return {
    id,
    name: `Entity ${id}`,
    type: 'character',
    path: relPath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function writeSceneMd(vaultRoot: string, relPath: string, id: string, title = 'My Scene') {
  const abs = path.join(vaultRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\nid: ${id}\ntitle: ${title}\n---\n\nScene prose.\n`, 'utf-8');
}

function writeEntityMd(vaultRoot: string, relPath: string, id: string, name = 'Alice') {
  const abs = path.join(vaultRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `---\nid: ${id}\nname: ${name}\ntype: character\n---\n\nEntity prose.\n`,
    'utf-8',
  );
}

function writeCorruptedMd(vaultRoot: string, relPath: string) {
  const abs = path.join(vaultRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // No frontmatter → parseFrontmatter returns empty frontmatter with no `id`
  fs.writeFileSync(abs, '# No frontmatter here\n\nJust prose.\n', 'utf-8');
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-integrity-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkIntegrity', () => {
  it('returns empty report for a clean vault', () => {
    const sceneId = 'scene-abc';
    const scenePath = 'Manuscript/ch1/scene1.md';
    writeSceneMd(tmpDir, scenePath, sceneId);

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene(sceneId, scenePath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.orphanedManifestEntries).toHaveLength(0);
    expect(report.unindexedFiles).toHaveLength(0);
    expect(report.manifestSchemaMismatch).toBe(false);
    expect(report.corruptedEntries).toHaveLength(0);
  });

  it('AC-VI-01: detects orphaned scene entries (file missing on disk)', () => {
    const existingId = 'scene-exists';
    const missingId = 'scene-missing';
    const existingPath = 'Manuscript/ch1/scene-exists.md';
    const missingPath = 'Manuscript/ch1/scene-missing.md';

    writeSceneMd(tmpDir, existingPath, existingId);
    // scene-missing.md intentionally NOT written to disk

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene(existingId, existingPath), makeScene(missingId, missingPath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.orphanedManifestEntries).toContain(missingId);
    expect(report.orphanedManifestEntries).not.toContain(existingId);
  });

  it('AC-VI-01: detects orphaned entity entries (file missing on disk)', () => {
    const entityId = 'ent-missing';
    const entityPath = 'entities/characters/ent-missing.md';
    // entity file intentionally NOT written

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      entities: [makeEntity(entityId, entityPath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.orphanedManifestEntries).toContain(entityId);
  });

  it('AC-VI-01: detects unindexed .md files on disk', () => {
    const indexedId = 'scene-indexed';
    const indexedPath = 'Manuscript/ch1/indexed.md';
    const unindexedPath = 'Manuscript/ch1/unindexed.md';

    writeSceneMd(tmpDir, indexedPath, indexedId);
    writeSceneMd(tmpDir, unindexedPath, 'scene-extra');

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene(indexedId, indexedPath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.unindexedFiles).toContain(unindexedPath);
    expect(report.unindexedFiles).not.toContain(indexedPath);
  });

  it('AC-VI-01: detects manifest schema version mismatch', () => {
    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      schemaVersion: SCHEMA_VERSION + 1,
    };
    const report = checkIntegrity(manifest, tmpDir);
    expect(report.manifestSchemaMismatch).toBe(true);
  });

  it('AC-VI-01: schemaVersion matches — no mismatch', () => {
    const manifest: Manifest = defaultManifest(tmpDir);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    const report = checkIntegrity(manifest, tmpDir);
    expect(report.manifestSchemaMismatch).toBe(false);
  });

  it('AC-VI-01: detects corrupted entries (file with no `id` in frontmatter)', () => {
    const corruptedId = 'scene-corrupted';
    const corruptedPath = 'Manuscript/ch1/corrupted.md';
    writeCorruptedMd(tmpDir, corruptedPath);

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene(corruptedId, corruptedPath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.corruptedEntries).toContain(corruptedId);
  });

  it('does not flag board reference files as unindexed', () => {
    const boardPath = 'Manuscript/ch1/board.md';
    const abs = path.join(tmpDir, boardPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '# Board\n\nmythos-board-version: 1\n', 'utf-8');

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      boardReferences: [boardPath],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.unindexedFiles).not.toContain(boardPath);
  });

  it('does not scan inside `versions/` directories', () => {
    const scenePath = 'Manuscript/ch1/scene1.md';
    const versionsFile = 'Manuscript/ch1/versions/scene1/2024-01-01-abc12345.md';
    const sceneId = 'scene-1';

    writeSceneMd(tmpDir, scenePath, sceneId);
    const absVersions = path.join(tmpDir, versionsFile);
    fs.mkdirSync(path.dirname(absVersions), { recursive: true });
    fs.writeFileSync(absVersions, '# version\n\ncontent\n', 'utf-8');

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [makeScene(sceneId, scenePath)],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.unindexedFiles).not.toContain(versionsFile);
  });

  it('handles nested scene entries from stories/chapters', () => {
    const sceneId = 'nested-scene';
    const scenePath = 'Manuscript/story1/ch1/scene1.md';
    writeSceneMd(tmpDir, scenePath, sceneId);

    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      stories: [
        {
          id: 'story-1',
          title: 'Story 1',
          path: 'Manuscript/story1',
          chapters: [
            {
              id: 'ch-1',
              title: 'Chapter 1',
              path: 'Manuscript/story1/ch1',
              order: 0,
              scenes: [makeScene(sceneId, scenePath)],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const report = checkIntegrity(manifest, tmpDir);
    expect(report.orphanedManifestEntries).not.toContain(sceneId);
    expect(report.unindexedFiles).not.toContain(scenePath);
  });
});

describe('rebuildManifest', () => {
  it('AC-VI-02: rebuilds manifest from disk and returns stats', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, defaultManifest(tmpDir));

    writeSceneMd(tmpDir, 'Manuscript/ch1/scene1.md', 'scene-1');
    writeSceneMd(tmpDir, 'Manuscript/ch1/scene2.md', 'scene-2');

    const result = rebuildManifest(tmpDir);
    expect(result.rebuilt).toBe(true);
    expect(result.scenesFound).toBe(2);
    expect(result.entitiesFound).toBe(0);
  });

  it('AC-VI-06: calling rebuildManifest twice is idempotent', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, defaultManifest(tmpDir));

    writeSceneMd(tmpDir, 'Manuscript/ch1/scene1.md', 'scene-1');
    writeEntityMd(tmpDir, 'entities/characters/char1.md', 'char-1');

    const result1 = rebuildManifest(tmpDir);
    const result2 = rebuildManifest(tmpDir);

    expect(result1.scenesFound).toBe(result2.scenesFound);
    expect(result1.entitiesFound).toBe(result2.entitiesFound);
    expect(result2.rebuilt).toBe(true);
  });

  it('writes manifest.json to disk', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, defaultManifest(tmpDir));

    writeSceneMd(tmpDir, 'Manuscript/ch1/scene1.md', 'scene-1');
    rebuildManifest(tmpDir);

    expect(fs.existsSync(manifestPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    expect(written.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('AC-VI-02: counts entity files in entities/ subdirectory', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, defaultManifest(tmpDir));

    writeEntityMd(tmpDir, 'entities/characters/alice.md', 'ent-alice');
    writeEntityMd(tmpDir, 'entities/locations/forest.md', 'ent-forest');

    const result = rebuildManifest(tmpDir);
    expect(result.entitiesFound).toBe(2);
  });
});
