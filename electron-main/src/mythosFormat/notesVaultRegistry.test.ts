// SKY-11058 — unit tests for the notes vault registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureNotesVaultRegistry,
  createBlankNotesVault,
  setActiveNotesVault,
  renameNotesVault,
  registerImportedNotesVault,
  notesVaultAbsPath,
  readNotesVaultRegistry,
  buildLinkResolutionReport,
  NOTES_VAULT_REGISTRY_FILENAME,
  DEFAULT_NOTES_VAULT_DIRNAME,
} from './notesVaultRegistry.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvr-test-'));
  // Create default Notes Vault dir so migration doesn't need to create it.
  fs.mkdirSync(path.join(tmpDir, DEFAULT_NOTES_VAULT_DIRNAME));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureNotesVaultRegistry', () => {
  it('creates registry with one entry on first call', () => {
    const registry = ensureNotesVaultRegistry(tmpDir);
    expect(registry.vaults).toHaveLength(1);
    expect(registry.vaults[0].displayName).toBe('Notes');
    expect(registry.vaults[0].dirName).toBe(DEFAULT_NOTES_VAULT_DIRNAME);
    expect(registry.vaults[0].origin).toBe('created');
    expect(registry.activeId).toBe(registry.vaults[0].id);
  });

  it('is idempotent — second call returns same registry', () => {
    const first = ensureNotesVaultRegistry(tmpDir);
    const second = ensureNotesVaultRegistry(tmpDir);
    expect(second.vaults[0].id).toBe(first.vaults[0].id);
    expect(second.activeId).toBe(first.activeId);
  });

  it('writes registry file to mythosRoot', () => {
    ensureNotesVaultRegistry(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, NOTES_VAULT_REGISTRY_FILENAME))).toBe(true);
  });
});

describe('createBlankNotesVault', () => {
  it('creates directory and appends entry', () => {
    ensureNotesVaultRegistry(tmpDir);
    const { entry } = createBlankNotesVault(tmpDir, 'Import 1');
    expect(entry.displayName).toBe('Import 1');
    expect(entry.origin).toBe('created');
    expect(fs.existsSync(notesVaultAbsPath(tmpDir, entry))).toBe(true);
  });

  it('deduplicates dirName when slug collides', () => {
    ensureNotesVaultRegistry(tmpDir);
    const { entry: a } = createBlankNotesVault(tmpDir, 'Extra');
    const { entry: b } = createBlankNotesVault(tmpDir, 'Extra');
    expect(a.dirName).not.toBe(b.dirName);
  });

  it('does not change activeId', () => {
    const initial = ensureNotesVaultRegistry(tmpDir);
    const { registry } = createBlankNotesVault(tmpDir, 'Another');
    expect(registry.activeId).toBe(initial.activeId);
  });
});

describe('setActiveNotesVault', () => {
  it('updates activeId to the new vault', () => {
    ensureNotesVaultRegistry(tmpDir);
    const { entry } = createBlankNotesVault(tmpDir, 'Second');
    const { registry } = setActiveNotesVault(tmpDir, entry.id);
    expect(registry.activeId).toBe(entry.id);
  });

  it('throws on unknown id', () => {
    ensureNotesVaultRegistry(tmpDir);
    expect(() => setActiveNotesVault(tmpDir, 'does-not-exist')).toThrow();
  });

  it('persists the change to disk', () => {
    ensureNotesVaultRegistry(tmpDir);
    const { entry } = createBlankNotesVault(tmpDir, 'Second');
    setActiveNotesVault(tmpDir, entry.id);
    const onDisk = readNotesVaultRegistry(tmpDir);
    expect(onDisk?.activeId).toBe(entry.id);
  });
});

describe('renameNotesVault', () => {
  it('updates displayName only, leaves dirName unchanged', () => {
    const initial = ensureNotesVaultRegistry(tmpDir);
    const origDirName = initial.vaults[0].dirName;
    const { entry } = renameNotesVault(tmpDir, initial.vaults[0].id, 'My Notes');
    expect(entry.displayName).toBe('My Notes');
    expect(entry.dirName).toBe(origDirName);
  });

  it('throws on unknown id', () => {
    ensureNotesVaultRegistry(tmpDir);
    expect(() => renameNotesVault(tmpDir, 'bad-id', 'X')).toThrow();
  });
});

describe('registerImportedNotesVault', () => {
  it('adds entry with origin=imported', () => {
    ensureNotesVaultRegistry(tmpDir);
    const importDir = 'Obsidian Import';
    fs.mkdirSync(path.join(tmpDir, importDir));
    const { entry } = registerImportedNotesVault(tmpDir, importDir, 'Obsidian');
    expect(entry.origin).toBe('imported');
    expect(entry.dirName).toBe(importDir);
  });
});

describe('buildLinkResolutionReport', () => {
  let storyVaultRoot: string;
  let notesVaultA: string;
  let notesVaultB: string;

  beforeEach(() => {
    storyVaultRoot = path.join(tmpDir, 'story');
    notesVaultA = path.join(tmpDir, 'notes-a');
    notesVaultB = path.join(tmpDir, 'notes-b');
    fs.mkdirSync(storyVaultRoot, { recursive: true });
    fs.mkdirSync(notesVaultA, { recursive: true });
    fs.mkdirSync(notesVaultB, { recursive: true });
  });

  it('returns zero counts for empty story vault', () => {
    const r = buildLinkResolutionReport(storyVaultRoot, notesVaultA, notesVaultB);
    expect(r.totalStems).toBe(0);
    expect(r.resolvedCount).toBe(0);
    expect(r.unresolvedStems).toHaveLength(0);
  });

  it('reports stems that resolve in target vault', () => {
    fs.writeFileSync(path.join(storyVaultRoot, 'scene.md'), '[[Character]] and [[Place]]');
    fs.writeFileSync(path.join(notesVaultB, 'Character.md'), '# Character');
    fs.writeFileSync(path.join(notesVaultB, 'Place.md'), '# Place');

    const r = buildLinkResolutionReport(storyVaultRoot, notesVaultA, notesVaultB);
    expect(r.totalStems).toBe(2);
    expect(r.resolvedCount).toBe(2);
    expect(r.unresolvedStems).toHaveLength(0);
  });

  it('reports stems that do NOT resolve in target vault', () => {
    fs.writeFileSync(path.join(storyVaultRoot, 'scene.md'), '[[Missing Link]]');
    // notesVaultB has no matching file

    const r = buildLinkResolutionReport(storyVaultRoot, notesVaultA, notesVaultB);
    expect(r.totalStems).toBe(1);
    expect(r.resolvedCount).toBe(0);
    expect(r.unresolvedStems).toContain('missing link');
  });

  it('handles piped links [[Stem|Alias]]', () => {
    fs.writeFileSync(path.join(storyVaultRoot, 'scene.md'), '[[Hero|the hero]]');
    fs.writeFileSync(path.join(notesVaultB, 'Hero.md'), '');

    const r = buildLinkResolutionReport(storyVaultRoot, notesVaultA, notesVaultB);
    expect(r.resolvedCount).toBe(1);
  });

  it('deduplicates repeated stems', () => {
    fs.writeFileSync(
      path.join(storyVaultRoot, 'scene.md'),
      '[[Hero]] mentioned twice [[Hero]]',
    );
    const r = buildLinkResolutionReport(storyVaultRoot, notesVaultA, notesVaultB);
    expect(r.totalStems).toBe(1);
  });
});
