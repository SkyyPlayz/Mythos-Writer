// Canonical uninstall path lists under Electron userData.
// Sync with build/uninstall-vaults.nsh — uninstallVaultsNsh.test.ts pins both.
//
// KEEP (default uninstall, not Remove all): machine-local caches only.
// Remove all: user settings/content + vault sidecar + full userData tree (NSIS RMDir).

import path from 'node:path';

import { THUMB_CACHE_DIR_NAME } from './noteThumbnails.js';

/** Sidecar the Windows NSIS uninstaller FileReads when delete-vaults is selected. */
export const UNINSTALL_DELETE_PATHS_FILENAME = 'uninstall-delete-paths.txt';

/** Subdirectory holding default + user-created vault bundles (user content). */
export const USER_VAULTS_SUBDIR = 'vaults';

/** Removed on KEEP uninstall (not Remove all). */
export const APP_CACHE_FILES = ['window-state.json'] as const;

export const APP_CACHE_DIRS = ['vault-index-cache', THUMB_CACHE_DIR_NAME] as const;

/** Removed only on Remove all / Delete Everything (never on KEEP). */
export const APP_USER_FILES = [
  'app-settings.json',
  'vault-settings.json',
  'brainstorm-settings.json',
  'secrets.json',
] as const;

export const APP_USER_DIRS = ['templates', 'agent-personas'] as const;

export function appCacheAndUserListsDoNotOverlap(): boolean {
  const cache = new Set<string>([...APP_CACHE_FILES, ...APP_CACHE_DIRS]);
  const user = new Set<string>([...APP_USER_FILES, ...APP_USER_DIRS, UNINSTALL_DELETE_PATHS_FILENAME]);
  for (const name of cache) {
    if (user.has(name)) return false;
  }
  return true;
}

function joinAll(userDataPath: string, files: readonly string[], dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of files) out.push(path.join(userDataPath, name));
  for (const name of dirs) out.push(path.join(userDataPath, name));
  return out;
}

/** KEEP uninstall — caches only (vaults/ and user lists stay). */
export function resolveCacheDeletePathsOnKeepUninstall(userDataPath: string): string[] {
  return joinAll(userDataPath, APP_CACHE_FILES, APP_CACHE_DIRS);
}

/** Remove all — user settings/content + sidecar (not caches; those are included via resolveRemoveAllDeletePaths). */
export function resolveUserDeletePathsOnRemoveAll(userDataPath: string): string[] {
  return joinAll(
    userDataPath,
    [...APP_USER_FILES, UNINSTALL_DELETE_PATHS_FILENAME],
    APP_USER_DIRS,
  );
}

/** In-app Delete Everything + NSIS Remove all target set (caches + user + sidecar). */
export function resolveRemoveAllDeletePaths(userDataPath: string): string[] {
  return [
    ...resolveCacheDeletePathsOnKeepUninstall(userDataPath),
    ...resolveUserDeletePathsOnRemoveAll(userDataPath),
  ];
}
