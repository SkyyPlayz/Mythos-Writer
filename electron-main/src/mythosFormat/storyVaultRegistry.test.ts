// SKY-11150 — unit tests for storyVaultRegistry.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureStoryVaultRegistry,
  createBlankStoryVault,
  createStoryVaultFromOptions,
  setActiveStoryVault,
  renameStoryVault,
  pairStoryVaultToNotesVault,
  storyVaultsForNotesVault,
  readStoryVaultRegistry,
  storyVaultAbsPath,
  STORY_VAULT_REGISTRY_FILENAME,
  DEFAULT_STORY_VAULT_DIRNAME,
} from './storyVaultRegistry.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svr-test-'));
  fs.mkdirSync(path.join(tmpDir, DEFAULT_STORY_VAULT_DIRNAME));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureStoryVaultRegistry', () => {
  it('creates registry with one entry on first call', () => {
    const registry = ensureStoryVaultRegistry(tmpDir);
    expect(registry.vaults).toHaveLength(1);
    expect(registry.vaults[0].dirName).toBe(DEFAULT_STORY_VAULT_DIRNAME);
    expect(registry.vaults[0].pairedNotesVaultId).toBeNull();
    expect(registry.activeId).toBe(registry.vaults[0].id);
  });

  it('is idempotent — second call returns same registry', () => {
    const first = ensureStoryVaultRegistry(tmpDir);
    const second = ensureStoryVaultRegistry(tmpDir);
    expect(second.vaults[0].id).toBe(first.vaults[0].id);
  });

  it('writes story-vaults.json to mythosRoot', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, STORY_VAULT_REGISTRY_FILENAME))).toBe(true);
  });
});

describe('createBlankStoryVault', () => {
  it('creates directory and appends entry with null pairing', () => {
    ensureStoryVaultRegistry(tmpDir);
    const { entry } = createBlankStoryVault(tmpDir, 'New World');
    expect(entry.pairedNotesVaultId).toBeNull();
    expect(fs.existsSync(storyVaultAbsPath(tmpDir, entry))).toBe(true);
  });

  it('deduplicates dirName when slug collides', () => {
    ensureStoryVaultRegistry(tmpDir);
    const { entry: a } = createBlankStoryVault(tmpDir, 'Worlds');
    const { entry: b } = createBlankStoryVault(tmpDir, 'Worlds');
    expect(a.dirName).not.toBe(b.dirName);
  });
});

describe('createStoryVaultFromOptions', () => {
  it('blank mode leaves the directory empty, unpaired', () => {
    ensureStoryVaultRegistry(tmpDir);
    const { entry } = createStoryVaultFromOptions(tmpDir, 'Empty', 'blank');
    expect(entry.pairedNotesVaultId).toBeNull();
    const absDir = storyVaultAbsPath(tmpDir, entry);
    expect(fs.readdirSync(absDir)).toHaveLength(0);
  });

  it('import mode copies files in and returns a tally', () => {
    ensureStoryVaultRegistry(tmpDir);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'svr-import-src-'));
    fs.writeFileSync(path.join(src, 'scene.md'), '# Scene\n');
    const { entry, importTally } = createStoryVaultFromOptions(
      tmpDir,
      'Imported',
      'import',
      src,
    );
    const absDir = storyVaultAbsPath(tmpDir, entry);
    expect(fs.existsSync(path.join(absDir, 'scene.md'))).toBe(true);
    expect(importTally?.imported).toBe(1);
    expect(importTally?.sourceCount).toBe(1);
    fs.rmSync(src, { recursive: true, force: true });
  });

  it('import mode throws when importSourcePath is missing', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(() => createStoryVaultFromOptions(tmpDir, 'Bad', 'import')).toThrow();
  });

  it('import mode throws when the source path does not exist', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(() =>
      createStoryVaultFromOptions(tmpDir, 'Bad', 'import', path.join(tmpDir, 'does-not-exist')),
    ).toThrow();
  });
});

describe('setActiveStoryVault', () => {
  it('updates activeId', () => {
    ensureStoryVaultRegistry(tmpDir);
    const { entry } = createBlankStoryVault(tmpDir, 'Second');
    const { registry } = setActiveStoryVault(tmpDir, entry.id);
    expect(registry.activeId).toBe(entry.id);
  });

  it('throws on unknown id', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(() => setActiveStoryVault(tmpDir, 'no-such-id')).toThrow();
  });
});

describe('renameStoryVault', () => {
  it('updates displayName, leaves dirName and pairing unchanged', () => {
    const initial = ensureStoryVaultRegistry(tmpDir);
    const origDirName = initial.vaults[0].dirName;
    const { entry } = renameStoryVault(tmpDir, initial.vaults[0].id, 'My Story');
    expect(entry.displayName).toBe('My Story');
    expect(entry.dirName).toBe(origDirName);
    expect(entry.pairedNotesVaultId).toBeNull();
  });

  it('throws on unknown id', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(() => renameStoryVault(tmpDir, 'bad-id', 'X')).toThrow();
  });
});

describe('pairStoryVaultToNotesVault', () => {
  it('sets pairedNotesVaultId', () => {
    const initial = ensureStoryVaultRegistry(tmpDir);
    const storyId = initial.vaults[0].id;
    const { entry } = pairStoryVaultToNotesVault(tmpDir, storyId, 'notes-abc-123');
    expect(entry.pairedNotesVaultId).toBe('notes-abc-123');
  });

  it('replaces existing pairing — never appends', () => {
    const initial = ensureStoryVaultRegistry(tmpDir);
    const storyId = initial.vaults[0].id;
    pairStoryVaultToNotesVault(tmpDir, storyId, 'notes-first');
    const { entry } = pairStoryVaultToNotesVault(tmpDir, storyId, 'notes-second');
    expect(entry.pairedNotesVaultId).toBe('notes-second');
    const onDisk = readStoryVaultRegistry(tmpDir);
    expect(onDisk?.vaults[0].pairedNotesVaultId).toBe('notes-second');
  });

  it('unpairing sets pairedNotesVaultId back to null', () => {
    const initial = ensureStoryVaultRegistry(tmpDir);
    const storyId = initial.vaults[0].id;
    pairStoryVaultToNotesVault(tmpDir, storyId, 'notes-abc');
    const { entry } = pairStoryVaultToNotesVault(tmpDir, storyId, null);
    expect(entry.pairedNotesVaultId).toBeNull();
  });

  it('throws on unknown story vault id', () => {
    ensureStoryVaultRegistry(tmpDir);
    expect(() => pairStoryVaultToNotesVault(tmpDir, 'no-such-id', 'notes-x')).toThrow();
  });

  it('persists pairing to disk', () => {
    const initial = ensureStoryVaultRegistry(tmpDir);
    pairStoryVaultToNotesVault(tmpDir, initial.vaults[0].id, 'notes-persist');
    const onDisk = readStoryVaultRegistry(tmpDir);
    expect(onDisk?.vaults[0].pairedNotesVaultId).toBe('notes-persist');
  });
});

describe('storyVaultsForNotesVault', () => {
  it('returns story vaults paired to a given notes vault', () => {
    const registry = ensureStoryVaultRegistry(tmpDir);
    const storyId = registry.vaults[0].id;
    const notesId = 'notes-xyz';
    pairStoryVaultToNotesVault(tmpDir, storyId, notesId);
    const updated = readStoryVaultRegistry(tmpDir)!;
    const paired = storyVaultsForNotesVault(updated, notesId);
    expect(paired).toHaveLength(1);
    expect(paired[0].id).toBe(storyId);
  });

  it('returns empty array when no story vaults paired to a notes vault', () => {
    const registry = ensureStoryVaultRegistry(tmpDir);
    const result = storyVaultsForNotesVault(registry, 'unknown-notes-id');
    expect(result).toHaveLength(0);
  });
});
