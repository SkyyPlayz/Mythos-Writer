// SKY-11058 item 4 — unit tests for importObsidianAsExtraNotesVault:
// verbatim copy into a NEW dir inside the Mythos vault root + registry entry,
// source never mutated, active vault never changed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importObsidianAsExtraNotesVault } from '../obsidianImporter.js';
import {
  ensureNotesVaultRegistry,
  readNotesVaultRegistry,
  DEFAULT_NOTES_VAULT_DIRNAME,
} from './notesVaultRegistry.js';

let tmpDir: string;
let mythosRoot: string;
let srcDir: string;

/** Recursive relPath → file content snapshot (dirs excluded). */
function snapshotDir(root: string, base = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [k, v] of snapshotDir(path.join(root, entry.name), rel)) out.set(k, v);
    } else {
      out.set(rel, fs.readFileSync(path.join(root, entry.name), 'utf-8'));
    }
  }
  return out;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-test-'));
  // A v2-shaped Mythos root: default Notes Vault dir so migration finds it.
  mythosRoot = path.join(tmpDir, 'mythos');
  fs.mkdirSync(path.join(mythosRoot, DEFAULT_NOTES_VAULT_DIRNAME), { recursive: true });
  // An Obsidian-style source vault OUTSIDE the Mythos root.
  srcDir = path.join(tmpDir, 'My Obsidian');
  fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'Hero.md'), '# Hero\n\nSee [[Villain]] and [[Missing Stem]].\n');
  fs.writeFileSync(path.join(srcDir, 'sub', 'Villain.md'), '# Villain\n');
  fs.writeFileSync(path.join(srcDir, 'img.png'), 'not-really-a-png');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('importObsidianAsExtraNotesVault — happy path', () => {
  it('copies files verbatim into a new dir and registers it (origin=imported)', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
    ]);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.displayName).toBe('My Obsidian');
    expect(result.dirName).toBe('My Obsidian');
    expect(result.imported).toBe(3);
    expect(result.sourceCount).toBe(3);

    const destDir = path.join(mythosRoot, result.dirName!);
    // Wikilinks stay verbatim — byte-for-byte copy, no rewriting.
    expect(fs.readFileSync(path.join(destDir, 'Hero.md'), 'utf-8'))
      .toBe('# Hero\n\nSee [[Villain]] and [[Missing Stem]].\n');
    expect(fs.existsSync(path.join(destDir, 'sub', 'Villain.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'img.png'))).toBe(true);

    const registry = readNotesVaultRegistry(mythosRoot);
    expect(registry?.vaults).toHaveLength(2);
    const entry = registry?.vaults.find((v) => v.id === result.vaultId);
    expect(entry?.origin).toBe('imported');
    expect(entry?.dirName).toBe(result.dirName);
  });
});

describe('importObsidianAsExtraNotesVault — target validation', () => {
  it('rejects a story-kind target and leaves the registry untouched', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'story', srcPath: srcDir },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notes-kind/);
    expect(readNotesVaultRegistry(mythosRoot)?.vaults).toHaveLength(1);
  });

  it('rejects notes+story target pairs', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
      { kind: 'story', srcPath: srcDir },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exactly one/);
  });

  it('rejects a missing source path', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: path.join(tmpDir, 'does-not-exist') },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });
});

describe('importObsidianAsExtraNotesVault — source safety', () => {
  it('never mutates the source folder', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const before = snapshotDir(srcDir);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
    ]);
    expect(result.ok).toBe(true);
    const after = snapshotDir(srcDir);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of before) {
      expect(after.get(rel)).toBe(content);
    }
  });
});

describe('importObsidianAsExtraNotesVault — dirName collisions', () => {
  it('imports the same-named vault twice into distinct dirs', () => {
    ensureNotesVaultRegistry(mythosRoot);
    const first = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
    ]);
    const second = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.dirName).not.toBe(first.dirName);
    expect(fs.existsSync(path.join(mythosRoot, first.dirName!, 'Hero.md'))).toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, second.dirName!, 'Hero.md'))).toBe(true);
    // Both registered with the same display name but distinct ids.
    const registry = readNotesVaultRegistry(mythosRoot);
    expect(registry?.vaults).toHaveLength(3);
    expect(first.vaultId).not.toBe(second.vaultId);
  });
});

describe('importObsidianAsExtraNotesVault — active vault unchanged', () => {
  it('keeps activeId exactly as it was before the import', () => {
    const initial = ensureNotesVaultRegistry(mythosRoot);
    const result = importObsidianAsExtraNotesVault(mythosRoot, [
      { kind: 'notes', srcPath: srcDir },
    ]);
    expect(result.ok).toBe(true);
    const registry = readNotesVaultRegistry(mythosRoot);
    expect(registry?.activeId).toBe(initial.activeId);
    expect(registry?.activeId).not.toBe(result.vaultId);
  });
});
