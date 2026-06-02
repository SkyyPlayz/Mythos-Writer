// SKY-320 — Mythos Vault helper tests.
//
// Lock in the rules the one-click-default IPC depends on so a regression
// can't silently let a renderer-supplied vault name escape the parent or
// let `pickUniqueMythosVaultName` quietly clobber an existing bundle.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  DEFAULT_MYTHOS_VAULT_NAME,
  deriveProjectName,
  isSafeVaultName,
  pickUniqueMythosVaultName,
} from './mythosVault.js';

describe('isSafeVaultName', () => {
  it('accepts plain folder-safe names', () => {
    expect(isSafeVaultName('Mythos Vault')).toBe(true);
    expect(isSafeVaultName('Drafts 2026')).toBe(true);
    expect(isSafeVaultName('é')).toBe(true);
  });

  it('rejects empty / parent-traversal / separators', () => {
    expect(isSafeVaultName('')).toBe(false);
    expect(isSafeVaultName('.')).toBe(false);
    expect(isSafeVaultName('..')).toBe(false);
    expect(isSafeVaultName('foo/bar')).toBe(false);
    expect(isSafeVaultName('foo\\bar')).toBe(false);
  });

  it('rejects NUL bytes (filesystem-layer escape)', () => {
    const nulName = 'foo' + String.fromCharCode(0) + 'bar';
    expect(isSafeVaultName(nulName)).toBe(false);
  });
});

describe('pickUniqueMythosVaultName', () => {
  it('returns the base name when no collision', () => {
    const exists = () => false;
    expect(pickUniqueMythosVaultName('/parent', 'Mythos Vault', exists)).toBe('Mythos Vault');
  });

  it('appends " 2", " 3", … in order on collisions', () => {
    const taken = new Set([
      path.join('/parent', 'Mythos Vault'),
      path.join('/parent', 'Mythos Vault 2'),
      path.join('/parent', 'Mythos Vault 3'),
    ]);
    const exists = (p: string) => taken.has(p);
    expect(pickUniqueMythosVaultName('/parent', 'Mythos Vault', exists)).toBe('Mythos Vault 4');
  });

  it('falls back to a timestamp suffix after exhausting 999 candidates', () => {
    let calls = 0;
    const exists = () => { calls++; return true; };
    const result = pickUniqueMythosVaultName('/parent', 'Mythos Vault', exists, () => 1234567);
    expect(result).toBe('Mythos Vault 1234567');
    expect(calls).toBeLessThan(1100);
  });
});

describe('deriveProjectName', () => {
  it('uses the shared parent folder name when story + notes are bundled', () => {
    expect(
      deriveProjectName(
        '/home/alice/Mythos/Vaults/Mythos Vault/Story Vault',
        '/home/alice/Mythos/Vaults/Mythos Vault/Notes Vault',
      ),
    ).toBe('Mythos Vault');
  });

  it('falls back to the Story Vault basename for legacy (un-paired) entries', () => {
    expect(deriveProjectName('/home/alice/Mythos/Story Vault')).toBe('Story Vault');
  });

  it('falls back when story + notes are in different parents (legacy split)', () => {
    expect(
      deriveProjectName(
        '/home/alice/Story Vault',
        '/elsewhere/Notes Vault',
      ),
    ).toBe('Story Vault');
  });
});

describe('default name constant', () => {
  it('keeps the user-facing default stable so onboarding copy and tests agree', () => {
    expect(DEFAULT_MYTHOS_VAULT_NAME).toBe('Mythos Vault');
  });
});
