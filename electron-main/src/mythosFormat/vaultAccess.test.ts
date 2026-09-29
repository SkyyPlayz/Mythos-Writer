import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMythosVault } from './createVault.js';
import {
  addCrossVaultLink,
  getVaultAccess,
  loadVaultLinkingState,
  setVaultAccess,
} from './vaultAccess.js';

describe('vaultAccess (Slice D)', () => {
  let tmp: string;
  let root: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-access-'));
    const created = createMythosVault(tmp, { name: 'A', seedDemo: false, exactName: true });
    if (!created.ok) throw new Error(created.error);
    root = created.mythosRoot;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to rw and persists ro toggle', () => {
    expect(getVaultAccess(root, 'mid', 'notes', 'nid')).toBe('rw');
    setVaultAccess(root, 'mid', 'notes', 'nid', 'ro');
    expect(getVaultAccess(root, 'mid', 'notes', 'nid')).toBe('ro');
    expect(loadVaultLinkingState(root).vaultAccess['mid:notes:nid']).toBe('ro');
  });

  it('persists cross-Mythos link pairs with both vault ids', () => {
    const state = addCrossVaultLink(root, {
      homeMythosId: 'home',
      notes: { mythosId: 'other', vaultId: 'n1', label: 'Notes', mythosName: 'Shared Worlds' },
      story: { mythosId: 'home', vaultId: 's1', label: 'Story', mythosName: 'Mythos Vault' },
    });
    expect(state.crossLinks).toHaveLength(1);
    expect(state.crossLinks[0].notes.mythosId).toBe('other');
    expect(state.crossLinks[0].story.vaultId).toBe('s1');
  });
});
