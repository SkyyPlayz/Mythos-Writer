/** PLAN-058 L1b — group PROJECT_LIST rows by resolved Mythos root (48:50 / 51:01 / 54:31). */

export interface MythosVaultGroupEntry {
  vaultRoot: string;
  mythosVaultRoot: string | null;
  notesVaultRoot?: string;
  name: string;
}

export interface MythosVaultGroup {
  mythosRoot: string;
  entries: MythosVaultGroupEntry[];
  /** Representative row for switch/rename/theme — active story vault when possible. */
  primary: MythosVaultGroupEntry;
}

export function mythosRootKey(v: MythosVaultGroupEntry): string {
  return v.mythosVaultRoot ?? v.vaultRoot;
}

const STORY_VAULT_DIR_SUFFIXES = ['/Story Vault', '\\Story Vault'] as const;

/** PLAN-058 L1b (46:36): Settings path row shows the Mythos root, not the active Story Vault subpath. */
export function mythosRootForDisplay(v: MythosVaultGroupEntry): string {
  if (v.mythosVaultRoot !== null && v.mythosVaultRoot !== v.vaultRoot) {
    return v.mythosVaultRoot;
  }
  for (const suffix of STORY_VAULT_DIR_SUFFIXES) {
    if (v.vaultRoot.endsWith(suffix)) {
      return v.vaultRoot.slice(0, -suffix.length);
    }
  }
  return mythosRootKey(v);
}

export function groupVaultsByMythos(
  vaults: MythosVaultGroupEntry[],
  activeVaultRoot: string,
): MythosVaultGroup[] {
  const byRoot = new Map<string, MythosVaultGroupEntry[]>();
  for (const v of vaults) {
    const key = mythosRootKey(v);
    const list = byRoot.get(key);
    if (list) list.push(v);
    else byRoot.set(key, [v]);
  }
  return [...byRoot.entries()].map(([mythosRoot, entries]) => {
    const primary = entries.find((e) => e.vaultRoot === activeVaultRoot) ?? entries[0];
    return { mythosRoot, entries, primary };
  });
}
