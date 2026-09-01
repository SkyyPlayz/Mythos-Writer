// SKY-11163 — QA independent acceptance tests for vault delete/hide (SKY-11153 / PR#1376).
//
// Written from the SPEC (SKY-11141), NOT from the implementation.
// Invariants:
//   A. trashVaultFolder MUST use shell.trashItem — NEVER fs.rm/rmSync/unlink.
//   B. On trash success: { trashed: true }, no disk mutation beyond the OS call.
//   C. On trash failure: { trashed: false, error } — folder left untouched.
//   D. Hide = settings persistence only; NO filesystem mutation.
//   F. VAULT_SURFACE_COPY strings must mention "Recycle Bin", never "permanent delete".
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn() },
}));

import { shell } from 'electron';
import { trashVaultFolder, getBlastRadius, VAULT_SURFACE_COPY } from './vaultSurface.js';

const trash = vi.mocked(shell.trashItem);

beforeEach(() => vi.clearAllMocks());

// ─── Invariant A+B: trash uses shell.trashItem exclusively ───────────────────

describe('[QA] trashVaultFolder — Recycle Bin contract', () => {
  it('resolves { trashed: true } on success', async () => {
    trash.mockResolvedValueOnce(undefined);
    const result = await trashVaultFolder('/vaults/MyStory');
    expect(result).toEqual({ trashed: true });
  });

  it('calls shell.trashItem with the exact vault path', async () => {
    trash.mockResolvedValueOnce(undefined);
    await trashVaultFolder('/vaults/My Story');
    expect(trash).toHaveBeenCalledWith('/vaults/My Story');
  });

  it('does NOT call fs.rmSync as a fallback when trashItem rejects', async () => {
    trash.mockRejectedValueOnce(new Error('EPERM'));
    const fsSpy = vi.spyOn(
      await import('node:fs'),
      'rmSync',
    ).mockImplementation(() => undefined as never);
    await trashVaultFolder('/vaults/Protected');
    expect(fsSpy).not.toHaveBeenCalled();
    fsSpy.mockRestore();
  });
});

// ─── Invariant C: failure path ────────────────────────────────────────────────

describe('[QA] trashVaultFolder — failure semantics', () => {
  it('returns { trashed: false, error } when OS rejects', async () => {
    trash.mockRejectedValueOnce(new Error('Trash is full'));
    const result = await trashVaultFolder('/vaults/AStory');
    expect(result.trashed).toBe(false);
    expect(result.error).toContain('Trash is full');
  });

  it('returns { trashed: false } for a non-Error rejection', async () => {
    trash.mockRejectedValueOnce('EACCES');
    const result = await trashVaultFolder('/vaults/Locked');
    expect(result.trashed).toBe(false);
    expect(result.error).toBe('EACCES');
  });

  it('calls shell.trashItem exactly once — no retry', async () => {
    trash.mockRejectedValueOnce(new Error('OS trash unavailable'));
    await trashVaultFolder('/vaults/Retry');
    expect(trash).toHaveBeenCalledTimes(1);
  });
});

// ─── Invariant F: copy strings must say Recycle Bin ──────────────────────────

describe('[QA] VAULT_SURFACE_COPY — language spec', () => {
  it('innerVaultTrashConfirm says "Recycle Bin"', () => {
    expect(VAULT_SURFACE_COPY.innerVaultTrashConfirm).toMatch(/Recycle Bin/i);
    expect(VAULT_SURFACE_COPY.innerVaultTrashConfirm).not.toMatch(/\bdelete\b/i);
  });

  it('mythosTrashConfirm2 says "Recycle Bin"', () => {
    expect(VAULT_SURFACE_COPY.mythosTrashConfirm2).toMatch(/Recycle Bin/i);
  });

  it('trashFailedBody conveys file was NOT modified', () => {
    const body = VAULT_SURFACE_COPY.trashFailedBody('MyVault', 'disk full');
    expect(body).toMatch(/not been modified|not modified|untouched/i);
  });

  it('hideBody does NOT imply deletion or permanent removal', () => {
    const body = VAULT_SURFACE_COPY.hideBody('MyVault');
    expect(body).not.toMatch(/deleted|permanent/i);
    // Must clarify folder stays on disk
    expect(body).toMatch(/folder|stays|where it is/i);
  });
});

// ─── getBlastRadius edge cases ────────────────────────────────────────────────

describe('[QA] getBlastRadius — spec invariants', () => {
  it('vaultName equals basename of path', () => {
    const r = getBlastRadius('/Users/alice/Vaults/MyBook');
    expect(r.vaultName).toBe('MyBook');
  });

  it('returns innerCount = 0 for a non-existent path — does not throw', () => {
    const r = getBlastRadius('/absolutely/does/not/exist/XYZQA');
    expect(r.innerCount).toBe(0);
    expect(r.vaultName).toBe('XYZQA');
  });
});
