// SKY-12.2 / SKY-69: Pure filesystem helpers for vault path validation.
// No Electron dependency — fully testable in Node.
import fs from 'fs';
import path from 'path';

export interface ValidatePathResult {
  exists: boolean;
  isEmpty: boolean;
  writable: boolean;
  error?: string;
}

/**
 * Check whether a candidate path is usable as a vault root.
 *
 * - Expands a leading `~` using the provided homeDir (caller supplies it so
 *   this module stays Electron-free).
 * - Does NOT create or modify anything on disk.
 */
export function validatePathForVault(p: string, homeDir: string): ValidatePathResult {
  if (!p || typeof p !== 'string') {
    return { exists: false, isEmpty: true, writable: false, error: 'path must be a non-empty string' };
  }

  const resolved =
    p === '~' ? homeDir
    : p.startsWith('~/') ? path.join(homeDir, p.slice(2))
    : p;

  if (!path.isAbsolute(resolved)) {
    return { exists: false, isEmpty: true, writable: false, error: 'path must be absolute' };
  }

  const exists = fs.existsSync(resolved);

  if (!exists) {
    // Walk up to the nearest existing ancestor and check write permission.
    let ancestor = path.dirname(resolved);
    while (ancestor !== path.dirname(ancestor)) {
      if (fs.existsSync(ancestor)) {
        try {
          fs.accessSync(ancestor, fs.constants.W_OK);
          return { exists: false, isEmpty: true, writable: true };
        } catch {
          return { exists: false, isEmpty: true, writable: false };
        }
      }
      ancestor = path.dirname(ancestor);
    }
    return { exists: false, isEmpty: true, writable: false };
  }

  let isDir = false;
  try {
    isDir = fs.statSync(resolved).isDirectory();
  } catch {
    return { exists: true, isEmpty: false, writable: false, error: 'could not stat path' };
  }

  if (!isDir) {
    return { exists: true, isEmpty: false, writable: false, error: 'path exists but is not a directory' };
  }

  let writable = false;
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    writable = true;
  } catch { /* not writable */ }

  const entries = fs.readdirSync(resolved);
  return { exists: true, isEmpty: entries.length === 0, writable };
}

/**
 * SKY-69: Classify the vault-root state at startup so callers can distinguish
 * a fresh install (no settings yet) from a previously-configured vault that
 * has since been deleted/moved.
 *
 * - 'present'       — vault root exists; normal operation.
 * - 'fresh-install' — vault root missing AND no settings file; first run.
 * - 'deleted'       — vault root missing AND settings file exists; the vault
 *                     was configured before and is no longer there.
 */
export function vaultPresentState(
  vaultRoot: string,
  settingsPath: string,
): 'present' | 'fresh-install' | 'deleted' {
  if (fs.existsSync(vaultRoot)) return 'present';
  return fs.existsSync(settingsPath) ? 'deleted' : 'fresh-install';
}
