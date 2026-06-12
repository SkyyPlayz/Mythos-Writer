// SKY-10: versions.ts — per-chapter visible snapshots with intent + content hash.
// SKY-1464: retention policy tests — boundary values, age pruning, pruneAllVersions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  saveVersion,
  listVersions,
  getVersion,
  rollbackVersion,
  pruneAllVersions,
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

// ─── SKY-1464: VersionRetention policy tests ─────────────────────────────────

describe('normalizeRetention', () => {
  it('converts a plain number to { maxPerScene, maxAgeDays: 0 }', () => {
    expect(_internal.normalizeRetention(5)).toEqual({ maxPerScene: 5, maxAgeDays: 0 });
  });

  it('passes through a VersionRetention object unchanged', () => {
    const r = { maxPerScene: 10, maxAgeDays: 7 };
    expect(_internal.normalizeRetention(r)).toEqual(r);
  });
});

describe('parseTsFromFilename', () => {
  it('parses a valid filename timestamp', () => {
    const filename = '2026-06-12T14-30-00-000Z_00000001-abcd1234.md';
    const d = _internal.parseTsFromFilename(filename);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-06-12T14:30:00.000Z');
  });

  it('returns null for filenames without a timestamp prefix', () => {
    expect(_internal.parseTsFromFilename('no-timestamp.md')).toBeNull();
    expect(_internal.parseTsFromFilename('')).toBeNull();
  });
});

describe('saveVersion — retention object (full VersionRetention)', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('accepts a VersionRetention object and prunes by count', () => {
    for (let i = 0; i < 5; i++) {
      saveVersion(vaultRoot, 'scene-obj', `body-${i}`, {
        chapterRelPath,
        intent: 'save',
        retention: { maxPerScene: 2, maxAgeDays: 0 },
      });
    }
    expect(listVersions(vaultRoot, 'scene-obj', { chapterRelPath })).toHaveLength(2);
  });

  it('does not prune when count limit is 0 (unlimited)', () => {
    for (let i = 0; i < 4; i++) {
      saveVersion(vaultRoot, 'scene-unlimited', `body-${i}`, {
        chapterRelPath,
        intent: 'save',
        retention: { maxPerScene: 0, maxAgeDays: 0 },
      });
    }
    expect(listVersions(vaultRoot, 'scene-unlimited', { chapterRelPath })).toHaveLength(4);
  });

  it('boundary: exactly at the cap keeps all versions', () => {
    for (let i = 0; i < 3; i++) {
      saveVersion(vaultRoot, 'scene-exact', `body-${i}`, {
        chapterRelPath,
        intent: 'save',
        retention: { maxPerScene: 3, maxAgeDays: 0 },
      });
    }
    expect(listVersions(vaultRoot, 'scene-exact', { chapterRelPath })).toHaveLength(3);
  });
});

describe('saveVersion — age-based pruning', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  /** Backdates the oldest .md file in the scene's versions dir by the given ms. */
  function backdateOldestVersion(sceneId: string, byMs: number): void {
    const dir = path.join(vaultRoot, chapterRelPath, 'versions', sceneId);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    if (files.length === 0) return;
    // Rename: replace the ISO timestamp prefix with a backdated one.
    const oldest = files[0];
    const oldDate = new Date(Date.now() - byMs);
    const newPrefix = oldDate.toISOString().replace(/[:.]/g, '-');
    const withoutPrefix = oldest.replace(/^[^_]+/, newPrefix);
    fs.renameSync(path.join(dir, oldest), path.join(dir, withoutPrefix));
  }

  it('prunes versions older than maxAgeDays on next save', () => {
    // Save one version, then backdate its file to 35 days ago.
    saveVersion(vaultRoot, 'scene-age', 'old body', { chapterRelPath, intent: 'save' });
    backdateOldestVersion('scene-age', 35 * 24 * 60 * 60 * 1000);

    // Second save triggers pruning with 30-day limit → old file removed.
    saveVersion(vaultRoot, 'scene-age', 'new body', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 100, maxAgeDays: 30 },
    });

    const versions = listVersions(vaultRoot, 'scene-age', { chapterRelPath });
    expect(versions).toHaveLength(1);
    // The old (backdated) file is pruned; only the recently-written 'new body' survives.
    expect(versions[0].content).toBe('new body');
  });

  it('keeps versions within the age window', () => {
    saveVersion(vaultRoot, 'scene-keep', 'keep body', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 100, maxAgeDays: 30 },
    });
    expect(listVersions(vaultRoot, 'scene-keep', { chapterRelPath })).toHaveLength(1);
  });

  it('age limit 0 keeps all versions regardless of age', () => {
    saveVersion(vaultRoot, 'scene-noage', 'body', { chapterRelPath, intent: 'save' });
    backdateOldestVersion('scene-noage', 365 * 24 * 60 * 60 * 1000); // 1 year old
    saveVersion(vaultRoot, 'scene-noage', 'newer', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 0, maxAgeDays: 0 },
    });
    expect(listVersions(vaultRoot, 'scene-noage', { chapterRelPath })).toHaveLength(2);
  });
});

describe('saveVersion — retention: empty / single / equal-timestamps', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('empty history: prune is a no-op', () => {
    // Pruning is triggered inside saveVersion; starting from 0 must not crash.
    const v = saveVersion(vaultRoot, 'scene-empty-prune', 'x', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 1, maxAgeDays: 7 },
    });
    expect(v.content).toBe('x');
    expect(listVersions(vaultRoot, 'scene-empty-prune', { chapterRelPath })).toHaveLength(1);
  });

  it('single version at the cap: not pruned', () => {
    saveVersion(vaultRoot, 'scene-single', 'only', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 1, maxAgeDays: 0 },
    });
    expect(listVersions(vaultRoot, 'scene-single', { chapterRelPath })).toHaveLength(1);
  });

  it('exceeding cap by one removes the oldest', () => {
    saveVersion(vaultRoot, 'scene-capone', 'first', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 1, maxAgeDays: 0 },
    });
    saveVersion(vaultRoot, 'scene-capone', 'second', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 1, maxAgeDays: 0 },
    });
    const versions = listVersions(vaultRoot, 'scene-capone', { chapterRelPath });
    expect(versions).toHaveLength(1);
    // Count-based pruning removes the oldest ('first'); 'second' is the surviving version.
    expect(versions[0].content).toBe('second');
  });
});

describe('saveVersion — widening policy never loses data', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('widening maxPerScene from 2 to 5 keeps existing versions', () => {
    // Write 2 versions with a tight cap.
    for (let i = 0; i < 2; i++) {
      saveVersion(vaultRoot, 'scene-widen', `body-${i}`, {
        chapterRelPath,
        intent: 'save',
        retention: { maxPerScene: 2, maxAgeDays: 0 },
      });
    }
    expect(listVersions(vaultRoot, 'scene-widen', { chapterRelPath })).toHaveLength(2);

    // Now write with a wider cap — existing 2 are untouched.
    saveVersion(vaultRoot, 'scene-widen', 'body-2', {
      chapterRelPath,
      intent: 'save',
      retention: { maxPerScene: 5, maxAgeDays: 0 },
    });
    expect(listVersions(vaultRoot, 'scene-widen', { chapterRelPath })).toHaveLength(3);
  });
});

describe('pruneAllVersions', () => {
  let vaultRoot: string;
  let chapterRelPath: string;

  beforeEach(() => ({ vaultRoot, chapterRelPath } = setupVault()));
  afterEach(() => teardown(vaultRoot));

  it('prunes all scene dirs across the vault by count', () => {
    for (let i = 0; i < 5; i++) {
      saveVersion(vaultRoot, 'scene-a', `a-${i}`, { chapterRelPath, intent: 'save' });
    }
    for (let i = 0; i < 5; i++) {
      saveVersion(vaultRoot, 'scene-b', `b-${i}`, { chapterRelPath, intent: 'save' });
    }

    pruneAllVersions(vaultRoot, { maxPerScene: 2, maxAgeDays: 0 });

    expect(listVersions(vaultRoot, 'scene-a', { chapterRelPath })).toHaveLength(2);
    expect(listVersions(vaultRoot, 'scene-b', { chapterRelPath })).toHaveLength(2);
  });

  it('is idempotent: running twice with the same policy produces the same result', () => {
    for (let i = 0; i < 4; i++) {
      saveVersion(vaultRoot, 'scene-idem', `body-${i}`, { chapterRelPath, intent: 'save' });
    }

    pruneAllVersions(vaultRoot, { maxPerScene: 2, maxAgeDays: 0 });
    pruneAllVersions(vaultRoot, { maxPerScene: 2, maxAgeDays: 0 });

    expect(listVersions(vaultRoot, 'scene-idem', { chapterRelPath })).toHaveLength(2);
  });

  it('no-op on an empty vault', () => {
    expect(() => pruneAllVersions(vaultRoot, { maxPerScene: 10, maxAgeDays: 30 })).not.toThrow();
  });

  it('skips dotfile directories', () => {
    // .snapshots should not be recursed into (and has no .md files anyway)
    const dotDir = path.join(vaultRoot, '.snapshots', 'versions', 'some-scene');
    fs.mkdirSync(dotDir, { recursive: true });
    fs.writeFileSync(path.join(dotDir, '2026-06-12T00-00-00-000Z_00000001-aaaabbbb.md'), 'x');

    pruneAllVersions(vaultRoot, { maxPerScene: 0, maxAgeDays: 0 });
    // File in .snapshots should be untouched (dotfile dir skipped).
    expect(fs.existsSync(path.join(dotDir, '2026-06-12T00-00-00-000Z_00000001-aaaabbbb.md'))).toBe(true);
  });
});
