// SKY-320 — Mythos Vault helpers (one-click default setup + multi-vault).
//
// A "Mythos Vault" is a parent directory that contains both `Story Vault/`
// and `Notes Vault/` subfolders. The helpers in this module operate on the
// Mythos Vault layer specifically — naming, uniqueness, and the
// derived-display-name rule the switcher uses. Keeping them in their own
// pure-Node module (no Electron imports) lets the gate logic stay testable
// without spinning up `app.getPath`.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_MYTHOS_VAULT_NAME = 'Mythos Vault';

/**
 * Reject names that would let a renderer escape the chosen parent. Anything
 * containing a path separator, NUL byte, or parent-traversal is unsafe and
 * we refuse to scaffold under it. The caller surfaces a typed error.
 */
export function isSafeVaultName(name: string): boolean {
  if (!name) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  return true;
}

/**
 * Pick `<base>`, `<base> 2`, `<base> 3`, … so re-clicking "Default Setup"
 * lands a fresh Mythos Vault instead of colliding with an existing one. The
 * loop is bounded at 999 candidates; once exhausted we fall back to a
 * timestamp suffix so the caller can still make progress.
 */
export function pickUniqueMythosVaultName(
  parentPath: string,
  baseName: string,
  exists: (p: string) => boolean = fs.existsSync,
  nowMs: () => number = Date.now,
): string {
  if (!exists(path.join(parentPath, baseName))) return baseName;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseName} ${i}`;
    if (!exists(path.join(parentPath, candidate))) return candidate;
  }
  return `${baseName} ${nowMs()}`;
}

/**
 * Prefer the parent Mythos Vault folder name over the Story Vault basename
 * for display. A bundled layout is `<MythosVault>/Story Vault/` and
 * `<MythosVault>/Notes Vault/`, so when both paths share a parent directory
 * the parent's basename is what the user typed (or what the wizard picked)
 * as the Mythos Vault name. For legacy single-folder vaults the parents
 * differ — fall back to the Story Vault basename so the display stays sane.
 */
export function deriveProjectName(vaultRoot: string, notesVaultRoot?: string): string {
  if (notesVaultRoot) {
    const parent = path.dirname(vaultRoot);
    if (parent === path.dirname(notesVaultRoot)) {
      const base = path.basename(parent);
      if (base) return base;
    }
  }
  return path.basename(vaultRoot);
}
