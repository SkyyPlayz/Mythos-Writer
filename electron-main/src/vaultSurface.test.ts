// SKY-11153: Unit tests for vaultSurface.ts — Recycle Bin delete + hide/show.
//
// Key invariants verified:
//   1. trashVaultFolder calls shell.trashItem and nothing else that mutates disk.
//   2. shell.trashItem failure leaves files untouched and surfaces an error.
//   3. getBlastRadius counts registered notes+story vaults correctly (SKY-11322:
//      matches projectStats.ts's countInnerVaults, not a raw directory listing).
//   4. VAULT_SURFACE_COPY strings say "Recycle Bin", never imply permanent delete.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock is hoisted — factory must not reference outer variables.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(),
  },
}));

// Imports come AFTER vi.mock declarations so the hoisted mocks apply.
import { shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  trashVaultFolder,
  getBlastRadius,
  VAULT_SURFACE_COPY,
  pruneRecentProjectsForTrash,
} from './vaultSurface.js';
import { createMythosFile, writeMythosFile } from './mythosFormat/mythosJson.js';
import { ensureNotesVaultRegistry, createBlankNotesVault } from './mythosFormat/notesVaultRegistry.js';
import { ensureStoryVaultRegistry, createBlankStoryVault } from './mythosFormat/storyVaultRegistry.js';
import type { ProjectEntry } from './ipc.js';

const mockTrashItem = vi.mocked(shell.trashItem);

// ─── trashVaultFolder ─────────────────────────────────────────────────────────

describe('trashVaultFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls shell.trashItem and returns { trashed: true } on success', async () => {
    mockTrashItem.mockResolvedValueOnce(undefined);
    const result = await trashVaultFolder('/some/vault');
    expect(mockTrashItem).toHaveBeenCalledWith('/some/vault');
    expect(result).toEqual({ trashed: true });
  });

  it('returns { trashed: false, error } when shell.trashItem rejects', async () => {
    mockTrashItem.mockRejectedValueOnce(new Error('trash disabled on this volume'));
    const result = await trashVaultFolder('/some/vault');
    expect(result.trashed).toBe(false);
    expect(result.error).toContain('trash disabled');
  });

  it('calls shell.trashItem exactly once on success', async () => {
    mockTrashItem.mockResolvedValueOnce(undefined);
    await trashVaultFolder('/vault/path');
    expect(mockTrashItem).toHaveBeenCalledTimes(1);
  });

  it('calls shell.trashItem exactly once on failure — no retry or fallback', async () => {
    mockTrashItem.mockRejectedValueOnce(new Error('EPERM'));
    await trashVaultFolder('/vault/path');
    expect(mockTrashItem).toHaveBeenCalledTimes(1);
  });

  it('surfaces a string error when trashItem throws a non-Error', async () => {
    mockTrashItem.mockRejectedValueOnce('EACCES');
    const result = await trashVaultFolder('/vault');
    expect(result.trashed).toBe(false);
    expect(result.error).toBe('EACCES');
  });
});

// ─── getBlastRadius ───────────────────────────────────────────────────────────

describe('getBlastRadius', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-blastradius-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('SKY-11322: counts registered notes+story vaults, not raw directory entries', () => {
    const mythosRoot = path.join(tmpRoot, 'MyStory');
    fs.mkdirSync(mythosRoot, { recursive: true });
    writeMythosFile(mythosRoot, createMythosFile('MyStory'));
    ensureStoryVaultRegistry(mythosRoot);
    ensureNotesVaultRegistry(mythosRoot);
    // A non-vault directory alongside Story/Notes Vault (e.g. scaffold-written
    // icons/cache folder) must NOT inflate the count — this is the SKY-11322 bug.
    fs.mkdirSync(path.join(mythosRoot, 'some-other-dir'), { recursive: true });

    const result = getBlastRadius(mythosRoot);
    expect(result.vaultName).toBe('MyStory');
    expect(result.innerCount).toBe(2);
  });

  it('SKY-11322: matches the card count for >1 paired vaults (rules out off-by-N)', () => {
    const mythosRoot = path.join(tmpRoot, 'BigMythos');
    fs.mkdirSync(mythosRoot, { recursive: true });
    writeMythosFile(mythosRoot, createMythosFile('BigMythos'));
    ensureStoryVaultRegistry(mythosRoot);
    createBlankStoryVault(mythosRoot, 'Second Story');
    ensureNotesVaultRegistry(mythosRoot);
    createBlankNotesVault(mythosRoot, 'Second Notes');
    createBlankNotesVault(mythosRoot, 'Third Notes');

    // 2 story vaults + 3 notes vaults = 5, matching notesVaultCount/storyVaultCount
    // as shown on the card (projectStats.ts's countInnerVaults).
    const result = getBlastRadius(mythosRoot);
    expect(result.innerCount).toBe(5);
  });

  it('SKY-11322: a v2 root registry write failure falls back to the implicit 1/1 pair, not 0 (matches countInnerVaults)', () => {
    const mythosRoot = path.join(tmpRoot, 'FlakyMythos');
    fs.mkdirSync(mythosRoot, { recursive: true });
    writeMythosFile(mythosRoot, createMythosFile('FlakyMythos'));
    // No registry file exists yet, so the first ensure*VaultRegistry call
    // must lazily WRITE one (writeFileAtomic -> fs.openSync) — simulate that
    // write failing (e.g. ENOSPC/EACCES/network-share hiccup).
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    try {
      const result = getBlastRadius(mythosRoot);
      expect(result.innerCount).toBe(2);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('SKY-11322: a legacy (pre-v2, no mythos.json) root reports the implicit 1/1 pair', () => {
    const legacyRoot = path.join(tmpRoot, 'LegacyVault');
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'scene1.md'), '# scene');

    const result = getBlastRadius(legacyRoot);
    expect(result.innerCount).toBe(2);
  });

  it('SKY-11322: never writes a v2 registry into a legacy root just to compute the count', () => {
    // ensure*VaultRegistry auto-create a registry file on first read — calling
    // them on a legacy vault would plant v2 metadata inside a folder that was
    // never migrated, just from opening the delete menu. Guard: isMythosV2Root
    // must gate the write, not just the read.
    const legacyRoot = path.join(tmpRoot, 'LegacyVault2');
    fs.mkdirSync(legacyRoot, { recursive: true });

    getBlastRadius(legacyRoot);

    expect(fs.readdirSync(legacyRoot)).toEqual([]);
  });

  it('returns innerCount 0 for a root that does not exist', () => {
    const result = getBlastRadius(path.join(tmpRoot, 'Missing'));
    expect(result.innerCount).toBe(0);
    expect(result.vaultName).toBe('Missing');
  });

  it('derives vaultName from the final path segment', () => {
    const mythosRoot = path.join(tmpRoot, 'My Great Novel');
    fs.mkdirSync(mythosRoot, { recursive: true });
    const result = getBlastRadius(mythosRoot);
    expect(result.vaultName).toBe('My Great Novel');
  });
});

// ─── pruneRecentProjectsForTrash (SKY-11202) ─────────────────────────────────

describe('pruneRecentProjectsForTrash', () => {
  const storyEntry = (over: Partial<ProjectEntry> = {}): ProjectEntry => ({
    name: 'My Story',
    vaultRoot: '/vaults/MyStory',
    notesVaultRoot: '/vaults/MyStory/Notes Vault',
    openedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('notes level clears the dangling notesVaultRoot but KEEPS the story entry', () => {
    const entries = [storyEntry()];
    const result = pruneRecentProjectsForTrash(entries, '/vaults/MyStory/Notes Vault', 'notes');
    expect(result).toHaveLength(1);
    expect(result[0].vaultRoot).toBe('/vaults/MyStory');
    expect(result[0].notesVaultRoot).toBeUndefined();
    expect(result[0].name).toBe('My Story');
  });

  it('notes level leaves unrelated entries untouched', () => {
    const other = storyEntry({ vaultRoot: '/vaults/Other', notesVaultRoot: '/vaults/Other/Notes Vault' });
    const result = pruneRecentProjectsForTrash([other], '/vaults/MyStory/Notes Vault', 'notes');
    expect(result).toEqual([other]);
  });

  it('story level drops the entry whose vaultRoot was trashed', () => {
    const entries = [storyEntry(), storyEntry({ vaultRoot: '/vaults/Other' })];
    const result = pruneRecentProjectsForTrash(entries, '/vaults/MyStory', 'story');
    expect(result).toHaveLength(1);
    expect(result[0].vaultRoot).toBe('/vaults/Other');
  });

  it('mythos level drops entries nested under the trashed root', () => {
    const entries = [
      storyEntry({ vaultRoot: '/vaults/MyMythos/Story Vault', notesVaultRoot: '/vaults/MyMythos/Notes Vault' }),
      storyEntry({ vaultRoot: '/vaults/Other' }),
    ];
    const result = pruneRecentProjectsForTrash(entries, '/vaults/MyMythos', 'mythos');
    expect(result).toHaveLength(1);
    expect(result[0].vaultRoot).toBe('/vaults/Other');
  });

  it('resolves paths before comparing so trailing slashes/relative segments still match', () => {
    const entries = [storyEntry()];
    const result = pruneRecentProjectsForTrash(entries, '/vaults/MyStory/./Notes Vault/', 'notes');
    expect(result[0].notesVaultRoot).toBeUndefined();
  });
});

// ─── Copy strings ─────────────────────────────────────────────────────────────

describe('VAULT_SURFACE_COPY — confirm strings say Recycle Bin, not permanent delete', () => {
  it('innerVaultTrashBody contains "Recycle Bin" and not "permanently"', () => {
    const body = VAULT_SURFACE_COPY.innerVaultTrashBody('My Story');
    expect(body).toContain('Recycle Bin');
    expect(body.toLowerCase()).not.toContain('permanently');
  });

  it('innerVaultTrashConfirm says "Move to Recycle Bin"', () => {
    expect(VAULT_SURFACE_COPY.innerVaultTrashConfirm).toBe('Move to Recycle Bin');
  });

  it('mythosTrashBody1 names the vault and blast radius', () => {
    const body = VAULT_SURFACE_COPY.mythosTrashBody1('My Vault', 2);
    expect(body).toContain('My Vault');
    expect(body).toContain('2');
    expect(body).toContain('inner vault');
  });

  it('mythosTrashConfirm2 says "Move to Recycle Bin" — not "delete"', () => {
    expect(VAULT_SURFACE_COPY.mythosTrashConfirm2).toBe('Move to Recycle Bin');
    expect(VAULT_SURFACE_COPY.mythosTrashConfirm2.toLowerCase()).not.toMatch(/\bdelete\b/);
  });

  it('hideBody mentions folder stays in place and not deleted', () => {
    const body = VAULT_SURFACE_COPY.hideBody('My Vault');
    expect(body.toLowerCase()).toContain("won't be moved or deleted");
    expect(body.toLowerCase()).toContain('folder stays exactly where it is');
  });

  it('hideBodyPairedNotes names both vaults and reassures the link survives', () => {
    const body = VAULT_SURFACE_COPY.hideBodyPairedNotes('My Notes', 'My Story');
    expect(body).toContain('My Notes');
    expect(body).toContain('My Story');
    // Must say the link is NOT broken (not that "break" is absent — the correct
    // form is "won't break" which IS present and is the reassurance we want).
    expect(body.toLowerCase()).toContain("won't break");
  });

  it('mythosTrashBody2 (final confirm) says Recycle Bin and names the vault', () => {
    const body = VAULT_SURFACE_COPY.mythosTrashBody2('Epic Saga', 2);
    expect(body).toContain('Recycle Bin');
    expect(body).toContain('Epic Saga');
  });
});
