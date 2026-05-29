// SKY-10: versions.ts — per-chapter visible snapshots with intent + content hash.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  saveVersion,
  listVersions,
  getVersion,
  rollbackVersion,
  _internal,
} from './versions.js';

function setupVault(): { vaultRoot: string; chapterRelPath: string } {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10-'));
  const chapterRelPath = path.join('Manuscript', 'My Story', '01 - Opening');
  fs.mkdirSync(path.join(vaultRoot, chapterRelPath), { recursive: true });
  return { vaultRoot, chapterRelPath };
}

function teardown(vaultRoot: string): void {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
}

describe('saveVersion — path traversal hardening (MYT-638 carryover)', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  const badIds = ['../escape', '..\\escape', '/abs', 'a/b', 'a\\b', '.hidden', ''];
  for (const badId of badIds) {
    it(`rejects sceneId "${badId}"`, () => {
      expect(() =>
        saveVersion(vaultRoot, badId, 'x', { chapterRelPath }),
      ).toThrow('Invalid sceneId');
    });
  }

  it('rejects chapterRelPath escaping the vault root', () => {
    expect(() =>
      saveVersion(vaultRoot, 'scene-1', 'x', { chapterRelPath: '../escape' }),
    ).toThrow('Invalid chapterRelPath');
  });

  it('rejects intent values not in the allowlist', () => {
    expect(() =>
      // @ts-expect-error — explicit bad input
      saveVersion(vaultRoot, 'scene-1', 'x', { chapterRelPath, intent: 'sneaky' }),
    ).toThrow('Invalid intent');
  });
});

describe('saveVersion — file layout', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('writes versions/<sceneId>/<ts>-<hash>.md inside the chapter folder (visible, not dotfile)', () => {
    saveVersion(vaultRoot, 'scene-1', 'prose body', { chapterRelPath, intent: 'save' });
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', 'scene-1');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.+_\d{8}-[0-9a-f]{8}\.md$/);
    expect(fs.existsSync(path.join(vaultRoot, '.versions'))).toBe(false);
  });

  it('snapshot file body embeds the SKY-10 fence header with intent + contentHash', () => {
    saveVersion(vaultRoot, 'scene-2', 'hello', { chapterRelPath, intent: 'save' });
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', 'scene-2');
    const file = fs.readdirSync(dir)[0];
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    expect(raw.startsWith(_internal.VERSION_FENCE)).toBe(true);
    expect(raw).toContain('intent: save');
    expect(raw).toContain(`contentHash: ${_internal.sha256Hex('hello')}`);
    expect(raw.endsWith('hello')).toBe(true);
  });
});

describe('saveVersion — dedup', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it("auto-intent save with identical content is coalesced (no new file)", () => {
    saveVersion(vaultRoot, 'scene-d', 'body', { chapterRelPath, intent: 'auto' });
    saveVersion(vaultRoot, 'scene-d', 'body', { chapterRelPath, intent: 'auto' });
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', 'scene-d');
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it('save-intent always writes even when content matches', () => {
    saveVersion(vaultRoot, 'scene-e', 'body', { chapterRelPath, intent: 'auto' });
    saveVersion(vaultRoot, 'scene-e', 'body', { chapterRelPath, intent: 'save' });
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', 'scene-e');
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });
});

describe('saveVersion — retention', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('prunes oldest snapshots beyond the cap', () => {
    for (let i = 0; i < 6; i++) {
      saveVersion(vaultRoot, 'scene-cap', `body-${i}`, {
        chapterRelPath,
        intent: 'save',
        retention: 3,
      });
    }
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', 'scene-cap');
    expect(fs.readdirSync(dir)).toHaveLength(3);
  });
});

describe('listVersions', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('returns empty when no history exists', () => {
    expect(listVersions(vaultRoot, 'scene-empty', { chapterRelPath })).toEqual([]);
  });

  it('returns newest-first', () => {
    saveVersion(vaultRoot, 'scene-l', 'one', { chapterRelPath, intent: 'save' });
    saveVersion(vaultRoot, 'scene-l', 'two', { chapterRelPath, intent: 'save' });
    const items = listVersions(vaultRoot, 'scene-l', { chapterRelPath });
    expect(items).toHaveLength(2);
    expect(items[0].content).toBe('two');
    expect(items[1].content).toBe('one');
    expect(items[0].intent).toBe('save');
    expect(items[0].contentHash).toBe(_internal.sha256Hex('two'));
  });
});

describe('rollbackVersion', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('round-trip restores the target content and snapshots the prior state', () => {
    const v1 = saveVersion(vaultRoot, 'scene-rb', 'original', {
      chapterRelPath,
      intent: 'save',
    });
    saveVersion(vaultRoot, 'scene-rb', 'modified', {
      chapterRelPath,
      intent: 'save',
    });
    const { restoredVersion, preRollbackVersion } = rollbackVersion(
      vaultRoot,
      'scene-rb',
      v1.ts,
      'modified',
      { chapterRelPath },
    );
    expect(restoredVersion.content).toBe('original');
    expect(preRollbackVersion.content).toBe('modified');
    expect(preRollbackVersion.intent).toBe('pre-rollback');
  });

  it('throws when the target ts does not exist; scene history is unchanged', () => {
    saveVersion(vaultRoot, 'scene-miss', 'x', { chapterRelPath, intent: 'save' });
    const before = listVersions(vaultRoot, 'scene-miss', { chapterRelPath }).length;
    expect(() =>
      rollbackVersion(vaultRoot, 'scene-miss', 'nope', 'x', { chapterRelPath }),
    ).toThrow('Version not found');
    expect(listVersions(vaultRoot, 'scene-miss', { chapterRelPath })).toHaveLength(before);
  });

  it('the pre-rollback snapshot is retrievable after rollback', () => {
    const v1 = saveVersion(vaultRoot, 'scene-pr', 'A', { chapterRelPath, intent: 'save' });
    saveVersion(vaultRoot, 'scene-pr', 'B', { chapterRelPath, intent: 'save' });
    const { preRollbackVersion } = rollbackVersion(
      vaultRoot,
      'scene-pr',
      v1.ts,
      'B',
      { chapterRelPath },
    );
    const fetched = getVersion(vaultRoot, 'scene-pr', preRollbackVersion.ts, {
      chapterRelPath,
    });
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe('B');
    expect(fetched!.intent).toBe('pre-rollback');
  });
});

describe('getVersion — ts validation', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  const traversalTs = ['../escape', '..\\escape', '/abs/path', 'a/b', 'a\\b', ''];
  for (const badTs of traversalTs) {
    it(`rejects ts "${badTs}"`, () => {
      expect(() => getVersion(vaultRoot, 'scene-1', badTs, { chapterRelPath })).toThrow(
        'Invalid ts',
      );
    });
  }
});
