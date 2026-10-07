// Canonical list of app-private paths under Electron userData.
// Used by uninstallHelper (in-app Delete Everything) and pinned against
// build/uninstall-vaults.nsh (Windows NSIS uninstaller).
//
// User manuscript/notes vault trees live under `vaults/` and are only removed
// when the user opts into delete-vaults / Remove all — not on default uninstall.

import path from 'node:path';

import { THUMB_CACHE_DIR_NAME } from './noteThumbnails.js';

/** Sidecar the Windows NSIS uninstaller FileReads when delete-vaults is selected. */
export const UNINSTALL_DELETE_PATHS_FILENAME = 'uninstall-delete-paths.txt';

/** Subdirectory holding default + user-created vault bundles (user content). */
export const USER_VAULTS_SUBDIR = 'vaults';

/** App-private files at the userData root (never user vault markdown). */
export const APP_USER_DATA_FILES = [
  'app-settings.json',
  'vault-settings.json',
  'brainstorm-settings.json',
  'window-state.json',
  'secrets.json',
  UNINSTALL_DELETE_PATHS_FILENAME,
] as const;

/** App-private directories at the userData root (never `vaults/`). */
export const APP_USER_DATA_DIRS = [
  'vault-index-cache',
  THUMB_CACHE_DIR_NAME,
  'templates',
  'agent-personas',
] as const;

/** Absolute paths for machine-local state removed on every uninstall (vaults kept). */
export function resolveAppPrivateDeletePaths(userDataPath: string): string[] {
  const out: string[] = [];
  for (const name of APP_USER_DATA_FILES) {
    out.push(path.join(userDataPath, name));
  }
  for (const name of APP_USER_DATA_DIRS) {
    out.push(path.join(userDataPath, name));
  }
  return out;
}
