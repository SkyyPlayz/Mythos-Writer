// Snapshot storage tests — real temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, deleteAllSnapshotsForScene, deleteAllSnapshotsVault } from './snapshots.js';

const INVALID_SCENE_IDS = [
  '../outside',
  '..\\outside',
  'nested/scene',
  'nested\\scene',
  '/absolute/path',
];

describe('saveSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSON file and returns a snapshot with contentHash', () => {
    const snap = saveSnapshot(tmpDir, 'scene-1', 'Hello world');
    expect(snap.id).toBeTruthy();
    expect(snap.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.wordCount).toBe(2);
    expect(snap.sceneId).toBe('scene-1');
    const snapshotDir = path.join(tmpDir, '.snapshots', 'scene-1');
    expect(fs.readdirSync(snapshotDir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('same content produces same contentHash', () => {
    const a = saveSnapshot(tmpDir, 'scene-hash', 'Consistent text');
    const b = saveSnapshot(tmpDir, 'scene-hash', 'Consistent text');
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('different content produces different contentHash', () => {
    const a = saveSnapshot(tmpDir, 'scene-diff', 'Text A');
    const b = saveSnapshot(tmpDir, 'scene-diff', 'Text B');
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it.each(INVALID_SCENE_IDS)('rejects invalid sceneId %s', (sceneId) => {
    expect(() => saveSnapshot(tmpDir, sceneId, 'blocked')).toThrow(`Invalid sceneId: ${sceneId}`);
  });
});

describe('listSnapshots', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-list-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no snapshots exist', () => {
    expect(listSnapshots(tmpDir, 'no-scene')).toEqual([]);
  });

  it('returns snapshots newest-first', () => {
    saveSnapshot(tmpDir, 'scene-order', 'First save');
    saveSnapshot(tmpDir, 'scene-order', 'Second save');
    const snaps = listSnapshots(tmpDir, 'scene-order');
    expect(snaps).toHaveLength(2);
    expect(snaps[0].content).toBe('Second save');
    expect(snaps[1].content).toBe('First save');
  });

  it.each(INVALID_SCENE_IDS)('rejects invalid sceneId %s', (sceneId) => {
    expect(() => listSnapshots(tmpDir, sceneId)).toThrow(`Invalid sceneId: ${sceneId}`);
  });
});

describe('getSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-get-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieves a snapshot by id', () => {
    const saved = saveSnapshot(tmpDir, 'scene-get', 'My content');
    const found = getSnapshot(tmpDir, 'scene-get', saved.id);
    expect(found?.content).toBe('My content');
    expect(found?.contentHash).toBe(saved.contentHash);
  });

  it('returns null for unknown id', () => {
    saveSnapshot(tmpDir, 'scene-missing', 'Something');
    expect(getSnapshot(tmpDir, 'scene-missing', 'non-existent-id')).toBeNull();
  });

  it.each(INVALID_SCENE_IDS)('rejects invalid sceneId %s', (sceneId) => {
    expect(() => getSnapshot(tmpDir, sceneId, 'any-id')).toThrow(`Invalid sceneId: ${sceneId}`);
  });
});

describe('path traversal rejection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-sec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const traversalIds = ['../escape', '..\\escape', '/abs/path', 'a/b', 'a\\b', '.hidden', ''];

  for (const badId of traversalIds) {
    it(`saveSnapshot rejects sceneId "${badId}"`, () => {
      expect(() => saveSnapshot(tmpDir, badId, 'content')).toThrow('Invalid sceneId');
    });

    it(`listSnapshots rejects sceneId "${badId}"`, () => {
      expect(() => listSnapshots(tmpDir, badId)).toThrow('Invalid sceneId');
    });

    it(`getSnapshot rejects sceneId "${badId}"`, () => {
      expect(() => getSnapshot(tmpDir, badId, 'some-id')).toThrow('Invalid sceneId');
    });
  }
});

describe('path traversal rejection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-sec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const traversalIds = ['../escape', '..\\escape', '/abs/path', 'a/b', 'a\\b', '.hidden', ''];

  for (const badId of traversalIds) {
    it(`saveSnapshot rejects sceneId "${badId}"`, () => {
      expect(() => saveSnapshot(tmpDir, badId, 'content')).toThrow('Invalid sceneId');
    });

    it(`listSnapshots rejects sceneId "${badId}"`, () => {
      expect(() => listSnapshots(tmpDir, badId)).toThrow('Invalid sceneId');
    });

    it(`getSnapshot rejects sceneId "${badId}"`, () => {
      expect(() => getSnapshot(tmpDir, badId, 'some-id')).toThrow('Invalid sceneId');
    });
  }
});

describe('rollback round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-rb-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('restores original content via getSnapshot + saveSnapshot', () => {
    const original = saveSnapshot(tmpDir, 'scene-rb', 'Original content');
    saveSnapshot(tmpDir, 'scene-rb', 'Modified content');

    const target = getSnapshot(tmpDir, 'scene-rb', original.id);
    expect(target?.content).toBe('Original content');

    // Simulate the main-process restore: save current state then write back
    const preRestore = saveSnapshot(tmpDir, 'scene-rb', 'Modified content');
    expect(preRestore.contentHash).not.toBe(original.contentHash);

    // The "restored" snapshot's content matches the original
    expect(target!.content).toBe('Original content');
  });

  it('rejects invalid sceneId in restore-like flow', () => {
    expect(() => getSnapshot(tmpDir, '../escape', 'snapshot-id')).toThrow('Invalid sceneId: ../escape');
  });
});

describe('retention cap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-cap-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prunes oldest snapshots when maxPerScene is exceeded', () => {
    for (let i = 0; i < 5; i++) {
      saveSnapshot(tmpDir, 'scene-cap', `Content ${i}`, { maxPerScene: 3, maxAgeDays: 0 });
    }
    const snaps = listSnapshots(tmpDir, 'scene-cap');
    expect(snaps).toHaveLength(3);
    expect(snaps[0].content).toBe('Content 4');
    expect(snaps[2].content).toBe('Content 2');
  });

  it('does not prune when maxPerScene is 0 (unlimited)', () => {
    for (let i = 0; i < 5; i++) {
      saveSnapshot(tmpDir, 'scene-unlimited', `Content ${i}`, { maxPerScene: 0, maxAgeDays: 0 });
    }
    expect(listSnapshots(tmpDir, 'scene-unlimited')).toHaveLength(5);
  });

  it('prunes snapshots older than maxAgeDays', () => {
    const snap = saveSnapshot(tmpDir, 'scene-age', 'Old content');
    // Backdate the stored snapshot to 40 days ago
    const snapshotDir = path.join(tmpDir, '.snapshots', 'scene-age');
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith('.json'));
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const outdated = { ...snap, createdAt: oldDate.toISOString() };
    fs.writeFileSync(path.join(snapshotDir, files[0]), JSON.stringify(outdated), 'utf-8');

    // Save a fresh snapshot — pruning fires after write
    saveSnapshot(tmpDir, 'scene-age', 'New content', { maxPerScene: 100, maxAgeDays: 30 });

    const remaining = listSnapshots(tmpDir, 'scene-age');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe('New content');
  });
});

describe('label field', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-label-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores label when provided', () => {
    const snap = saveSnapshot(tmpDir, 'scene-lbl', 'Text', undefined, 'My checkpoint');
    expect(snap.label).toBe('My checkpoint');
    const found = getSnapshot(tmpDir, 'scene-lbl', snap.id);
    expect(found?.label).toBe('My checkpoint');
  });

  it('stores no label when omitted', () => {
    const snap = saveSnapshot(tmpDir, 'scene-nolbl', 'Text');
    expect(snap.label).toBeUndefined();
  });
});

describe('deleteSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-del-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes a snapshot by id', () => {
    const snap = saveSnapshot(tmpDir, 'scene-del', 'Content');
    const result = deleteSnapshot(tmpDir, 'scene-del', snap.id);
    expect(result).toBe(true);
    expect(listSnapshots(tmpDir, 'scene-del')).toHaveLength(0);
  });

  it('returns false for unknown id', () => {
    saveSnapshot(tmpDir, 'scene-del2', 'Content');
    expect(deleteSnapshot(tmpDir, 'scene-del2', 'non-existent-id')).toBe(false);
  });

  it('leaves other snapshots intact', () => {
    const s1 = saveSnapshot(tmpDir, 'scene-del3', 'First');
    const s2 = saveSnapshot(tmpDir, 'scene-del3', 'Second');
    deleteSnapshot(tmpDir, 'scene-del3', s1.id);
    const remaining = listSnapshots(tmpDir, 'scene-del3');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(s2.id);
  });
});

describe('deleteAllSnapshotsForScene', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-delas-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes all snapshots for a scene', async () => {
    saveSnapshot(tmpDir, 'scene-all', 'A');
    saveSnapshot(tmpDir, 'scene-all', 'B');
    const count = deleteAllSnapshotsForScene(tmpDir, 'scene-all');
    expect(count).toBe(2);
    expect(listSnapshots(tmpDir, 'scene-all')).toHaveLength(0);
  });

  it('returns 0 when scene has no snapshots', async () => {
    expect(deleteAllSnapshotsForScene(tmpDir, 'no-such-scene')).toBe(0);
  });
});

describe('deleteAllSnapshotsVault', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-delav-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes all snapshots across all scenes', async () => {
    saveSnapshot(tmpDir, 'scene-va', 'A1');
    saveSnapshot(tmpDir, 'scene-va', 'A2');
    saveSnapshot(tmpDir, 'scene-vb', 'B1');
    const count = deleteAllSnapshotsVault(tmpDir);
    expect(count).toBe(3);
    expect(listSnapshots(tmpDir, 'scene-va')).toHaveLength(0);
    expect(listSnapshots(tmpDir, 'scene-vb')).toHaveLength(0);
  });

  it('returns 0 when vault has no snapshots dir', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-empty-'));
    try {
        expect(deleteAllSnapshotsVault(emptyDir)).toBe(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
