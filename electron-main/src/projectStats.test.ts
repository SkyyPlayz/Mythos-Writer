// Beta 4 M2 — vault-switcher stats: bounded .md counting per recent project.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { countMarkdownFiles, collectProjectStats } from './projectStats.js';
import { createMythosFile, writeMythosFile } from './mythosFormat/mythosJson.js';
import { ensureNotesVaultRegistry, createBlankNotesVault } from './mythosFormat/notesVaultRegistry.js';
import { ensureStoryVaultRegistry, createBlankStoryVault } from './mythosFormat/storyVaultRegistry.js';

let tmpRoot: string;

function write(rel: string, content = '# note'): void {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-projstats-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('countMarkdownFiles', () => {
  it('counts .md files recursively and ignores other extensions', () => {
    write('a.md');
    write('sub/b.md');
    write('sub/deep/c.md');
    write('sub/image.png');
    write('notes.txt');
    expect(countMarkdownFiles(tmpRoot)).toBe(3);
  });

  it('skips dot-directories and versions/ snapshots', () => {
    write('a.md');
    write('.obsidian/config.md');
    write('versions/a.v1.md');
    write('sub/versions/b.v2.md');
    expect(countMarkdownFiles(tmpRoot)).toBe(1);
  });

  it('returns 0 for a missing root instead of throwing', () => {
    expect(countMarkdownFiles(path.join(tmpRoot, 'does-not-exist'))).toBe(0);
  });

  it('stops at the visit cap so huge folders cannot stall the title bar', () => {
    for (let i = 0; i < 20; i++) write(`n${i}.md`);
    expect(countMarkdownFiles(tmpRoot, 5)).toBeLessThanOrEqual(5);
    expect(countMarkdownFiles(tmpRoot)).toBe(20);
  });
});

describe('collectProjectStats', () => {
  it('collects story + notes counts per entry and dedupes by vaultRoot', () => {
    const story = path.join(tmpRoot, 'Story Vault');
    const notes = path.join(tmpRoot, 'Notes Vault');
    fs.mkdirSync(story, { recursive: true });
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(path.join(story, 'scene1.md'), 'x');
    fs.writeFileSync(path.join(story, 'scene2.md'), 'x');
    fs.writeFileSync(path.join(notes, 'note1.md'), 'x');

    const stats = collectProjectStats([
      { vaultRoot: story, notesVaultRoot: notes },
      { vaultRoot: story, notesVaultRoot: notes }, // duplicate — dropped
      { vaultRoot: path.join(tmpRoot, 'gone') }, // missing + unpaired
    ]);

    expect(stats).toHaveLength(2);
    // Neither root is the "Story Vault" half of a v2 Mythos bundle (no
    // mythos.json at the parent) — inner counts default to the legacy 1/1.
    expect(stats[0]).toEqual({
      vaultRoot: story, storyFileCount: 2, noteCount: 1, notesVaultCount: 1, storyVaultCount: 1,
    });
    expect(stats[1]).toEqual({
      vaultRoot: path.join(tmpRoot, 'gone'),
      storyFileCount: 0,
      noteCount: null,
      notesVaultCount: 1,
      storyVaultCount: 1,
    });
  });

  it('SKY-11154: reports real inner notes/story vault counts for a v2 Mythos vault', () => {
    const mythosRoot = path.join(tmpRoot, 'MyMythos');
    fs.mkdirSync(mythosRoot, { recursive: true });
    writeMythosFile(mythosRoot, createMythosFile('My Mythos'));

    const storyVaultRoot = path.join(mythosRoot, 'Story Vault');
    fs.mkdirSync(storyVaultRoot, { recursive: true });

    // 1 default + 1 extra story vault; 1 default + 2 extra notes vaults.
    ensureStoryVaultRegistry(mythosRoot);
    createBlankStoryVault(mythosRoot, 'Second Story');
    ensureNotesVaultRegistry(mythosRoot);
    createBlankNotesVault(mythosRoot, 'Second Notes');
    createBlankNotesVault(mythosRoot, 'Third Notes');

    const stats = collectProjectStats([{ vaultRoot: storyVaultRoot }]);
    expect(stats).toHaveLength(1);
    expect(stats[0].storyVaultCount).toBe(2);
    expect(stats[0].notesVaultCount).toBe(3);
  });

  it('SKY-11154: a legacy v0.4 vault (no mythos.json) reports the implicit 1/1 pair', () => {
    const story = path.join(tmpRoot, 'Story Vault');
    fs.mkdirSync(story, { recursive: true });
    const stats = collectProjectStats([{ vaultRoot: story }]);
    expect(stats[0].notesVaultCount).toBe(1);
    expect(stats[0].storyVaultCount).toBe(1);
  });
});
