import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultFor,
  rememberFrom,
  resetDialogDefaultsForTests,
  vaultOpenDefaultPath,
} from './dialogDefaults.js';

describe('dialogDefaults', () => {
  beforeEach(() => {
    resetDialogDefaultsForTests();
  });

  it('is unset until a folder is picked', () => {
    expect(defaultFor('vault')).toBeUndefined();
    expect(defaultFor('import')).toBeUndefined();
  });

  it('remembers the parent directory of a pick', () => {
    const picked = path.join('imports', 'images', 'bg.png');
    rememberFrom('import', { canceled: false, filePaths: [picked] });
    expect(defaultFor('import')).toBe(path.dirname(picked));
  });

  it('leaves the bucket unchanged when the dialog is cancelled', () => {
    const first = path.join('vaults', 'one');
    const second = path.join('vaults', 'two', 'elsewhere');
    rememberFrom('vault', { canceled: false, filePaths: [first] });
    rememberFrom('vault', { canceled: true, filePaths: [second] });
    rememberFrom('vault', { canceled: false, filePaths: [] });
    expect(defaultFor('vault')).toBe(path.dirname(first));
  });

  it('keeps an import pick from moving the vault bucket, and the reverse', () => {
    const vaultPick = path.join('vaults', 'story');
    const importPick = path.join('images', 'bg.png');
    rememberFrom('vault', { canceled: false, filePaths: [vaultPick] });
    rememberFrom('import', { canceled: false, filePaths: [importPick] });
    expect(defaultFor('vault')).toBe(path.dirname(vaultPick));
    expect(defaultFor('import')).toBe(path.dirname(importPick));

    const laterImport = path.join('other', 'a.txt');
    rememberFrom('import', { canceled: false, filePaths: [laterImport] });
    expect(defaultFor('vault')).toBe(path.dirname(vaultPick));
    expect(defaultFor('import')).toBe(path.dirname(laterImport));

    const laterVault = path.join('vaults', 'b', 'root');
    rememberFrom('vault', { canceled: false, filePaths: [laterVault] });
    expect(defaultFor('import')).toBe(path.dirname(laterImport));
    expect(defaultFor('vault')).toBe(path.dirname(laterVault));
  });

  it('uses the vault-root parent when one is set, otherwise the last vault folder', () => {
    const root = path.join('home', 'writer', 'Stories', 'Novel');
    expect(vaultOpenDefaultPath(root)).toBe(path.dirname(root));
    expect(vaultOpenDefaultPath(undefined)).toBeUndefined();
    expect(vaultOpenDefaultPath(null)).toBeUndefined();
    expect(vaultOpenDefaultPath('')).toBeUndefined();

    const last = path.join('last', 'used', 'folder');
    rememberFrom('vault', { canceled: false, filePaths: [last] });
    expect(vaultOpenDefaultPath(undefined)).toBe(path.dirname(last));
    expect(vaultOpenDefaultPath(root)).toBe(path.dirname(root));
  });
});
