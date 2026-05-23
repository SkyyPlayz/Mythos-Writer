// Version storage tests — real temp directories, no mocks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveVersion, listVersions, getVersion, rollbackVersion } from './versions.js';

describe('VERSION_LIST', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ver-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no versions exist', () => {
    expect(listVersions(tmpDir, 'no-scene')).toEqual([]);
  });

  it('returns versions newest-first', () => {
    // Simulate two saves within the same millisecond by writing files directly.
    // The second file gets the '_2' collision suffix so its filename sorts AFTER
    // the first when naively reversed — this is the bug localeCompare triggered.
    const sceneId = 'scene-same-ms';
    const dir = path.join(tmpDir, '.versions', sceneId);
    fs.mkdirSync(dir, { recursive: true });

    const ts = '2026-05-23T09-01-00-000Z';
    fs.writeFileSync(path.join(dir, `${ts}.md`), 'Draft one', 'utf-8');
    fs.writeFileSync(path.join(dir, `${ts}_2.md`), 'Draft two', 'utf-8');

    const versions = listVersions(tmpDir, sceneId);
    expect(versions).toHaveLength(2);
    expect(versions[0].prose).toBe('Draft two');
    expect(versions[1].prose).toBe('Draft one');
  });

  it('sorts multiple sequential saves newest-first', () => {
    saveVersion(tmpDir, 'scene-seq', 'First');
    saveVersion(tmpDir, 'scene-seq', 'Second');
    const versions = listVersions(tmpDir, 'scene-seq');
    expect(versions).toHaveLength(2);
    expect(versions[0].prose).toBe('Second');
    expect(versions[1].prose).toBe('First');
  });

  it('ts field strips the .md extension', () => {
    const saved = saveVersion(tmpDir, 'scene-ts', 'Hello');
    const versions = listVersions(tmpDir, 'scene-ts');
    expect(versions[0].ts).toBe(saved.ts);
    expect(versions[0].ts).not.toMatch(/\.md$/);
  });
});

describe('VERSION_GET', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ver-get-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieves a version by ts', () => {
    const saved = saveVersion(tmpDir, 'scene-get', 'My prose');
    const found = getVersion(tmpDir, 'scene-get', saved.ts);
    expect(found?.prose).toBe('My prose');
    expect(found?.ts).toBe(saved.ts);
  });

  it('returns null for an unknown ts', () => {
    saveVersion(tmpDir, 'scene-missing', 'Something');
    expect(getVersion(tmpDir, 'scene-missing', 'nonexistent')).toBeNull();
  });

  it('returns null when scene has no versions', () => {
    expect(getVersion(tmpDir, 'empty-scene', 'any-ts')).toBeNull();
  });
});

describe('VERSION_ROLLBACK', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ver-rb-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the target version prose and saves a pre-rollback snapshot', () => {
    const v1 = saveVersion(tmpDir, 'scene-rb', 'Original draft');
    saveVersion(tmpDir, 'scene-rb', 'Modified draft');

    const { restored, preRollback } = rollbackVersion(tmpDir, 'scene-rb', v1.ts, 'Modified draft');
    expect(restored.prose).toBe('Original draft');
    expect(preRollback.prose).toBe('Modified draft');
  });

  it('throws when the target ts does not exist', () => {
    expect(() => rollbackVersion(tmpDir, 'scene-err', 'nonexistent', 'current')).toThrow(
      'Version not found: nonexistent',
    );
  });

  it('round-trip preserves prose', () => {
    const original = saveVersion(tmpDir, 'scene-rt', 'Round-trip prose');
    const found = getVersion(tmpDir, 'scene-rt', original.ts);
    expect(found?.prose).toBe('Round-trip prose');
  });

  it('pre-rollback snapshot appears in version list', () => {
    const v1 = saveVersion(tmpDir, 'scene-rb-list', 'v1');
    saveVersion(tmpDir, 'scene-rb-list', 'v2');
    rollbackVersion(tmpDir, 'scene-rb-list', v1.ts, 'v2');

    const versions = listVersions(tmpDir, 'scene-rb-list');
    expect(versions.length).toBe(3);
    expect(versions[0].prose).toBe('v2'); // pre-rollback snapshot is newest
  });
});

describe('saveVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ver-save-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the versions directory if it does not exist', () => {
    saveVersion(tmpDir, 'new-scene', 'Hello');
    expect(fs.existsSync(path.join(tmpDir, '.versions', 'new-scene'))).toBe(true);
  });

  it('returns the saved prose unchanged', () => {
    const prose = 'The quick brown fox.';
    const saved = saveVersion(tmpDir, 'scene-prose', prose);
    expect(saved.prose).toBe(prose);
  });

  it('generates a non-empty ts', () => {
    const saved = saveVersion(tmpDir, 'scene-ts-check', 'content');
    expect(saved.ts.length).toBeGreaterThan(0);
  });

  it('assigns collision suffix when two saves share a timestamp', () => {
    // Freeze the clock so both saves get the same millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T09:01:00.000Z'));
    try {
      const first = saveVersion(tmpDir, 'scene-collision', 'first');
      const second = saveVersion(tmpDir, 'scene-collision', 'second');
      expect(second.ts).toMatch(/_2$/);
      expect(second.ts.startsWith(first.ts.replace(/_2$/, ''))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
