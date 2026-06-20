// Uninstall helper — computes vault delete paths and removes them from disk.
// No Electron dependency; fully testable in Node.
//
// "Delete everything" removes:
//   - The <userData>/vaults/ parent when both vaults live under it (default layout)
//   - Or each vault root individually when the user chose custom locations
//   - vault-settings.json and app-settings.json from userData
//
// Custom vault paths outside the default location are reported in `customPathsWarning`
// so callers can surface a note to the user.

import fs from 'node:fs';
import path from 'node:path';

export interface UninstallCleanOptions {
  storyVaultRoot: string;
  notesVaultRoot: string;
  userDataPath: string;
}

export interface UninstallCleanResult {
  deleted: string[];
  errors: string[];
  /** Paths not under the default vault parent that could not be auto-deleted. */
  customPathsWarning: string[];
}

const VAULTS_SUBDIR = 'vaults';
const SETTINGS_FILES = ['vault-settings.json', 'app-settings.json'];

/** Returns the default vault parent dir for the given userData path. */
export function defaultVaultsParent(userDataPath: string): string {
  return path.join(userDataPath, VAULTS_SUBDIR);
}

/**
 * Resolve which filesystem paths should be deleted.
 * Returns a tuple: [pathsToDelete, customPathsWarning].
 * `pathsToDelete` includes directories and settings files.
 * `customPathsWarning` lists vaults stored outside the default location.
 */
export function resolveDeletePaths(options: UninstallCleanOptions): {
  toDelete: string[];
  customPathsWarning: string[];
} {
  const { storyVaultRoot, notesVaultRoot, userDataPath } = options;
  const vaultsParent = defaultVaultsParent(userDataPath);
  // Normalize to avoid trailing-sep mismatches on comparison
  const parentWithSep = vaultsParent.endsWith(path.sep) ? vaultsParent : vaultsParent + path.sep;

  const storyUnderDefault = storyVaultRoot.startsWith(parentWithSep);
  const notesUnderDefault = notesVaultRoot.startsWith(parentWithSep);

  const toDelete: string[] = [];
  const customPathsWarning: string[] = [];

  if (storyUnderDefault && notesUnderDefault) {
    // Both vaults are under the default parent — delete the whole bundle at once.
    toDelete.push(vaultsParent);
  } else {
    // One or both vaults are in custom locations.
    if (storyUnderDefault) {
      toDelete.push(vaultsParent);
    } else {
      toDelete.push(storyVaultRoot);
      customPathsWarning.push(storyVaultRoot);
    }

    if (!notesUnderDefault && notesVaultRoot !== storyVaultRoot) {
      toDelete.push(notesVaultRoot);
      customPathsWarning.push(notesVaultRoot);
    } else if (notesUnderDefault && !toDelete.includes(vaultsParent)) {
      toDelete.push(vaultsParent);
    }
  }

  // Always remove settings files from userData.
  for (const f of SETTINGS_FILES) {
    toDelete.push(path.join(userDataPath, f));
  }

  // Deduplicate while preserving order.
  return { toDelete: [...new Set(toDelete)], customPathsWarning: [...new Set(customPathsWarning)] };
}

function removeEntry(p: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(p)) return { ok: true };
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    } else {
      fs.unlinkSync(p);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Delete the resolved paths and return a result summary. */
export function cleanUninstall(options: UninstallCleanOptions): UninstallCleanResult {
  const { toDelete, customPathsWarning } = resolveDeletePaths(options);
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const p of toDelete) {
    const result = removeEntry(p);
    if (result.ok) {
      deleted.push(p);
    } else {
      errors.push(`${p}: ${result.error}`);
    }
  }

  return { deleted, errors, customPathsWarning };
}
