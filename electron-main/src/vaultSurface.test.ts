// SKY-11153: Unit tests for vaultSurface.ts — Recycle Bin delete + hide/show.
//
// Key invariants verified:
//   1. trashVaultFolder calls shell.trashItem and nothing else that mutates disk.
//   2. shell.trashItem failure leaves files untouched and surfaces an error.
//   3. getBlastRadius counts inner vault dirs correctly.
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
import { trashVaultFolder, getBlastRadius, VAULT_SURFACE_COPY } from './vaultSurface.js';

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
  let readdirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readdirSpy = vi.spyOn(fs, 'readdirSync');
  });

  afterEach(() => {
    readdirSpy.mockRestore();
  });

  it('counts directory entries inside the mythos vault root', () => {
    readdirSpy.mockReturnValueOnce([
      { isDirectory: () => true },   // Story Vault
      { isDirectory: () => true },   // Notes Vault
      { isDirectory: () => false },  // some file — must not be counted
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    const result = getBlastRadius('/vaults/MyStory');
    expect(result.vaultName).toBe('MyStory');
    expect(result.innerCount).toBe(2);
  });

  it('returns innerCount 0 when readdirSync throws', () => {
    readdirSpy.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const result = getBlastRadius('/vaults/Missing');
    expect(result.innerCount).toBe(0);
    expect(result.vaultName).toBe('Missing');
  });

  it('derives vaultName from the final path segment', () => {
    readdirSpy.mockReturnValueOnce([] as unknown as ReturnType<typeof fs.readdirSync>);
    const result = getBlastRadius('/home/user/vaults/My Great Novel');
    expect(result.vaultName).toBe('My Great Novel');
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
