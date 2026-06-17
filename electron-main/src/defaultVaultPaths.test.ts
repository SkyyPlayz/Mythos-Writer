import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  defaultMythosVaultsParentPath,
  defaultNotesVaultRootPath,
  defaultVaultRootPath,
} from './defaultVaultPaths.js';

describe('default vault paths', () => {
  it('uses the recommended Mythos Vault bundle as the fallback story and notes roots', () => {
    const userData = path.join('C:\\Users\\Skyy\\AppData\\Roaming', 'Mythos Writer');

    expect(defaultMythosVaultsParentPath(userData)).toBe(path.join(userData, 'vaults'));
    expect(defaultVaultRootPath(userData)).toBe(path.join(userData, 'vaults', 'Mythos Vault', 'Story Vault'));
    expect(defaultNotesVaultRootPath(userData)).toBe(path.join(userData, 'vaults', 'Mythos Vault', 'Notes Vault'));
  });
});
