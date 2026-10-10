import { describe, it, expect } from 'vitest';
import path from 'node:path';

import {
  APP_CACHE_DIRS,
  APP_CACHE_FILES,
  APP_USER_DIRS,
  APP_USER_FILES,
  UNINSTALL_DELETE_PATHS_FILENAME,
  appCacheAndUserListsDoNotOverlap,
  resolveCacheDeletePathsOnKeepUninstall,
  resolveRemoveAllDeletePaths,
  resolveUserDeletePathsOnRemoveAll,
} from './appUserDataManifest.js';

describe('appUserDataManifest', () => {
  const userData = 'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer';

  it('cache and user lists do not overlap', () => {
    expect(appCacheAndUserListsDoNotOverlap()).toBe(true);
    const cache = new Set<string>([...APP_CACHE_FILES, ...APP_CACHE_DIRS]);
    const user = new Set<string>([...APP_USER_FILES, ...APP_USER_DIRS, UNINSTALL_DELETE_PATHS_FILENAME]);
    for (const name of cache) {
      expect(user.has(name)).toBe(false);
    }
  });

  it('KEEP resolves caches only', () => {
    const paths = resolveCacheDeletePathsOnKeepUninstall(userData);
    for (const name of APP_CACHE_FILES) {
      expect(paths).toContain(path.join(userData, name));
    }
    for (const name of APP_CACHE_DIRS) {
      expect(paths).toContain(path.join(userData, name));
    }
    for (const name of APP_USER_FILES) {
      expect(paths).not.toContain(path.join(userData, name));
    }
    for (const name of APP_USER_DIRS) {
      expect(paths).not.toContain(path.join(userData, name));
    }
  });

  it('Remove all includes user paths and sidecar', () => {
    const userPaths = resolveUserDeletePathsOnRemoveAll(userData);
    for (const name of APP_USER_FILES) {
      expect(userPaths).toContain(path.join(userData, name));
    }
    expect(userPaths).toContain(path.join(userData, UNINSTALL_DELETE_PATHS_FILENAME));
    for (const name of APP_USER_DIRS) {
      expect(userPaths).toContain(path.join(userData, name));
    }
    const all = resolveRemoveAllDeletePaths(userData);
    expect(all.length).toBeGreaterThan(userPaths.length);
  });
});
