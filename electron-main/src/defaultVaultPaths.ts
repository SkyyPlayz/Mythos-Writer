import path from 'path';

const DEFAULT_MYTHOS_VAULT_NAME = 'Mythos Vault';

export function defaultMythosVaultsParentPath(userDataPath: string): string {
  return path.join(userDataPath, 'vaults');
}

export function defaultVaultRootPath(userDataPath: string): string {
  return path.join(defaultMythosVaultsParentPath(userDataPath), DEFAULT_MYTHOS_VAULT_NAME, 'Story Vault');
}

export function defaultNotesVaultRootPath(userDataPath: string): string {
  return path.join(defaultMythosVaultsParentPath(userDataPath), DEFAULT_MYTHOS_VAULT_NAME, 'Notes Vault');
}
