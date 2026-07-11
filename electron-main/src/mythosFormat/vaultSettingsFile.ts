// Beta 4 M5 — MythosVault v2 `settings.json`: per-vault user settings.
//
// App-GLOBAL prefs (window size, last vault, API keys) stay in AppData;
// everything scoped to one vault belongs here so it travels with the folder.
// M5 establishes the envelope + codec; M28 (Settings workspace) grows the
// payload. Unknown keys are preserved verbatim so newer builds' settings
// survive being opened by this one.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../vault.js';

export const VAULT_SETTINGS_FILENAME = 'settings.json';
export const VAULT_SETTINGS_VERSION = 1 as const;

export interface VaultSettingsFile {
  version: number;
  /** Theme preset key applied when this vault opens (mirrors mythos.json defaultTheme). */
  defaultTheme?: string;
  /** Layout decision carried over from the v0.4 vault-settings (default | blank). */
  layoutMode?: 'default' | 'blank';
  /** Forward-compat: keys written by newer builds are preserved on rewrite. */
  [key: string]: unknown;
}

export function vaultSettingsPath(mythosRoot: string): string {
  return path.join(mythosRoot, VAULT_SETTINGS_FILENAME);
}

export function defaultVaultSettingsFile(
  opts: { defaultTheme?: string; layoutMode?: 'default' | 'blank' } = {},
): VaultSettingsFile {
  return {
    version: VAULT_SETTINGS_VERSION,
    ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
    ...(opts.layoutMode ? { layoutMode: opts.layoutMode } : {}),
  };
}

/** Tolerant read — a corrupt or missing settings file degrades to defaults. */
export function readVaultSettingsFile(mythosRoot: string): VaultSettingsFile {
  try {
    const raw = fs.readFileSync(vaultSettingsPath(mythosRoot), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaultVaultSettingsFile();
    }
    const r = parsed as Record<string, unknown>;
    return {
      ...r,
      version: typeof r.version === 'number' ? r.version : VAULT_SETTINGS_VERSION,
    } as VaultSettingsFile;
  } catch {
    return defaultVaultSettingsFile();
  }
}

export function writeVaultSettingsFile(mythosRoot: string, settings: VaultSettingsFile): void {
  writeFileAtomic(vaultSettingsPath(mythosRoot), `${JSON.stringify(settings, null, 2)}\n`);
}
