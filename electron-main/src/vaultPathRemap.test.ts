// SKY-11154 — "Vaults folder" move flow: pure path-remap helpers.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { remapPathUnderPrefix, remapVaultSettingsPaths } from './vaultPathRemap.js';

describe('remapPathUnderPrefix', () => {
  it('remaps the prefix itself', () => {
    expect(remapPathUnderPrefix('/old/parent', '/old/parent', '/new/parent'))
      .toBe(path.resolve('/new/parent'));
  });

  it('remaps a nested path', () => {
    expect(remapPathUnderPrefix('/old/parent/Vault A/Story Vault', '/old/parent', '/new/parent'))
      .toBe(path.resolve('/new/parent/Vault A/Story Vault'));
  });

  it('leaves paths outside the prefix untouched', () => {
    expect(remapPathUnderPrefix('/elsewhere/Vault B', '/old/parent', '/new/parent'))
      .toBe('/elsewhere/Vault B');
  });

  it('does not false-positive on a sibling with a shared string prefix', () => {
    // "/old/parent2" is NOT inside "/old/parent" even though the string starts the same.
    expect(remapPathUnderPrefix('/old/parent2/Vault', '/old/parent', '/new/parent'))
      .toBe('/old/parent2/Vault');
  });
});

describe('remapVaultSettingsPaths', () => {
  const oldParent = '/old/parent';
  const newParent = '/new/parent';

  it('remaps vaultRoot, notesVaultRoot, recentProjects and hiddenVaultRoots under the old prefix', () => {
    const settings = {
      vaultRoot: '/old/parent/Vault A/Story Vault',
      notesVaultRoot: '/old/parent/Vault A/Notes Vault',
      recentProjects: [
        { vaultRoot: '/old/parent/Vault A/Story Vault', notesVaultRoot: '/old/parent/Vault A/Notes Vault', name: 'A' },
        { vaultRoot: '/elsewhere/Vault B/Story Vault', name: 'B' },
      ],
      hiddenVaultRoots: ['/old/parent/Vault C', '/elsewhere/Vault D'],
    };

    const result = remapVaultSettingsPaths(settings, oldParent, newParent);

    expect(result.vaultRoot).toBe(path.resolve('/new/parent/Vault A/Story Vault'));
    expect(result.notesVaultRoot).toBe(path.resolve('/new/parent/Vault A/Notes Vault'));
    expect(result.vaultsParentPath).toBe(newParent);
    expect(result.recentProjects).toEqual([
      { vaultRoot: path.resolve('/new/parent/Vault A/Story Vault'), notesVaultRoot: path.resolve('/new/parent/Vault A/Notes Vault'), name: 'A' },
      { vaultRoot: '/elsewhere/Vault B/Story Vault', name: 'B' },
    ]);
    expect(result.hiddenVaultRoots).toEqual([path.resolve('/new/parent/Vault C'), '/elsewhere/Vault D']);
  });

  it('does not mutate the input object', () => {
    const settings = { vaultRoot: '/old/parent/Story Vault' };
    const clone = { ...settings };
    remapVaultSettingsPaths(settings, oldParent, newParent);
    expect(settings).toEqual(clone);
  });
});
