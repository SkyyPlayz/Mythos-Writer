// Unit tests for VERSION_LIST, VERSION_GET, VERSION_ROLLBACK handler logic.
// Real temp directories; no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveVersion, listVersions, getVersion, rollbackVersion } from './versions.js';

// ─── VERSION_LIST ───

describe('VERSION_LIST (listVersions)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vlist-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no versions exist', () => {
    expect(listVersions(tmpDir, 'scene-none')).toEqual([]);
  });

  it('returns versions newest-first', () => {
    saveVersion(tmpDir, 'scene-order', 'Draft one');
    saveVersion(tmpDir, 'scene-order', 'Draft two');
    const versions = listVersions(tmpDir, 'scene-order');
    expect(versions).toHaveLength(2);
    expect(versions[0].content).toBe('Draft two');
    expect(versions[1].content).toBe('Draft one');
  });

  it('stores files in .versions/<sceneId>/ directory as .md files', () => {
    saveVersion(tmpDir, 'scene-path', 'Some prose');
    const dir = path.join(tmpDir, '.versions', 'scene-path');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
  });

  it('each version carries correct sceneId', () => {
    saveVersion(tmpDir, 'scene-id-check', 'Prose');
    const versions = listVersions(tmpDir, 'scene-id-check');
    expect(versions[0].sceneId).toBe('scene-id-check');
  });

  it('does not mix versions from different sceneIds', () => {
    saveVersion(tmpDir, 'scene-a', 'A prose');
    saveVersion(tmpDir, 'scene-b', 'B prose');
    expect(listVersions(tmpDir, 'scene-a')).toHaveLength(1);
    expect(listVersions(tmpDir, 'scene-b')).toHaveLength(1);
  });
});

// ─── VERSION_GET ───

describe('VERSION_GET (getVersion)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vget-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieves a version by its ts', () => {
    const saved = saveVersion(tmpDir, 'scene-get', 'Hello world');
    const found = getVersion(tmpDir, 'scene-get', saved.ts);
    expect(found).not.toBeNull();
    expect(found!.content).toBe('Hello world');
    expect(found!.ts).toBe(saved.ts);
    expect(found!.sceneId).toBe('scene-get');
  });

  it('returns null for an unknown ts', () => {
    saveVersion(tmpDir, 'scene-missing', 'Content');
    expect(getVersion(tmpDir, 'scene-missing', 'nonexistent-ts')).toBeNull();
  });

  it('returns null when the scene has no versions', () => {
    expect(getVersion(tmpDir, 'no-versions', '2026-01-01T00-00-00-000Z')).toBeNull();
  });

  it('ts in the returned version matches the filename stem', () => {
    const saved = saveVersion(tmpDir, 'scene-ts', 'Content');
    const dir = path.join(tmpDir, '.versions', 'scene-ts');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${saved.ts}.md`);
  });
});

// ─── VERSION_ROLLBACK ───

describe('VERSION_ROLLBACK (rollbackVersion)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vrb-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rollback round-trip preserves original prose', () => {
    const v1 = saveVersion(tmpDir, 'scene-rb', 'Original prose');
    saveVersion(tmpDir, 'scene-rb', 'Modified prose');

    const { restoredVersion, preRollbackVersion } = rollbackVersion(
      tmpDir,
      'scene-rb',
      v1.ts,
      'Modified prose',
    );

    expect(restoredVersion.content).toBe('Original prose');
    expect(preRollbackVersion.content).toBe('Modified prose');
  });

  it('saves a pre-rollback snapshot before restoring', () => {
    const v1 = saveVersion(tmpDir, 'scene-preroll', 'V1');
    saveVersion(tmpDir, 'scene-preroll', 'V2');

    rollbackVersion(tmpDir, 'scene-preroll', v1.ts, 'V2');

    // .versions dir should now have 3 entries: v1, v2, pre-rollback
    const versions = listVersions(tmpDir, 'scene-preroll');
    expect(versions).toHaveLength(3);
  });

  it('throws when the target ts does not exist', () => {
    saveVersion(tmpDir, 'scene-notfound', 'Some content');
    expect(() =>
      rollbackVersion(tmpDir, 'scene-notfound', 'nonexistent-ts', 'current'),
    ).toThrow('Version not found');
  });

  it('the pre-rollback snapshot is retrievable after rollback', () => {
    const v1 = saveVersion(tmpDir, 'scene-precheck', 'First');
    saveVersion(tmpDir, 'scene-precheck', 'Second');

    const { preRollbackVersion } = rollbackVersion(tmpDir, 'scene-precheck', v1.ts, 'Second');
    const fetched = getVersion(tmpDir, 'scene-precheck', preRollbackVersion.ts);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe('Second');
  });

  it('two saves within the same millisecond produce unique ts values that sort newest-first', () => {
    const v1 = saveVersion(tmpDir, 'scene-coll', 'first');
    const v2 = saveVersion(tmpDir, 'scene-coll', 'second');
    expect(v1.ts).not.toBe(v2.ts);
    // sequence counter ensures v2.ts > v1.ts lexicographically
    expect(v2.ts > v1.ts).toBe(true);
    const listed = listVersions(tmpDir, 'scene-coll');
    expect(listed[0].content).toBe('second');
  });
});
