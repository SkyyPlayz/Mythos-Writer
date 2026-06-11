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

// ─── SKY-906: one-click default bundle scaffold ─────────────────────────────

export interface MythosVaultBundle {
  /** `<parentDir>/<vaultName>` — the wrapping folder that holds both halves. */
  mythosVaultRoot: string;
  /** `<mythosVaultRoot>/Story Vault` */
  storyVaultPath: string;
  /** `<mythosVaultRoot>/Notes Vault` */
  notesVaultPath: string;
  /** Resolved name after collision suffixing. */
  vaultName: string;
}

export type ScaffoldDefaultMythosVaultOk = { ok: true } & MythosVaultBundle;
export type ScaffoldDefaultMythosVaultErr = { ok: false; error: string };
export type ScaffoldDefaultMythosVaultResult =
  | ScaffoldDefaultMythosVaultOk
  | ScaffoldDefaultMythosVaultErr;

/**
 * Materialise a Mythos Vault bundle on disk under `parentDir` with a
 * collision-free name. Used by the one-click onboarding flow (SKY-906) and
 * the multi-vault "+ Create new" switcher action (SKY-320). Pure Node — no
 * Electron deps so unit tests can drive it with a real tmpdir.
 *
 *  - Refuses non-absolute parents (renderer-relative-path escape vector).
 *  - Refuses path separators / NUL bytes / `..` in `baseName` via isSafeVaultName.
 *  - Refuses a pre-existing Mythos Vault folder unless it is fully empty —
 *    we never overwrite user data, even on re-click.
 *  - Creates `Story Vault/` and `Notes Vault/` subdirs but does NOT seed
 *    SKY-15 scaffolding here; the caller chains `ensure*VaultDir` to do that.
 */
export function scaffoldDefaultMythosVault(
  parentDir: string,
  opts: { baseName?: string } = {},
): ScaffoldDefaultMythosVaultResult {
  if (!path.isAbsolute(parentDir)) {
    return { ok: false, error: 'parentDir: must be an absolute path' };
  }
  const rawName = (opts.baseName ?? '').trim();
  if (rawName && !isSafeVaultName(rawName)) {
    return { ok: false, error: 'vaultName: must not contain path separators or parent references' };
  }
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Could not create parent directory: ${(e as Error).message}` };
  }
  const baseName = rawName || DEFAULT_MYTHOS_VAULT_NAME;
  const vaultName = pickUniqueMythosVaultName(parentDir, baseName);
  const mythosVaultRoot = path.join(parentDir, vaultName);
  const storyVaultPath = path.join(mythosVaultRoot, 'Story Vault');
  const notesVaultPath = path.join(mythosVaultRoot, 'Notes Vault');
  if (fs.existsSync(mythosVaultRoot)) {
    const entries = fs.readdirSync(mythosVaultRoot);
    if (entries.length > 0) {
      return { ok: false, error: 'Mythos Vault folder is not empty' };
    }
  }
  try {
    fs.mkdirSync(storyVaultPath, { recursive: true });
    fs.mkdirSync(notesVaultPath, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Could not create vault bundle: ${(e as Error).message}` };
  }
  return { ok: true, mythosVaultRoot, storyVaultPath, notesVaultPath, vaultName };
}
