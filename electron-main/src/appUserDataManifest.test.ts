import { describe, it, expect } from 'vitest';
import path from 'node:path';

import {
  APP_USER_DATA_DIRS,
  APP_USER_DATA_FILES,
  resolveAppPrivateDeletePaths,
} from './appUserDataManifest.js';

describe('appUserDataManifest (PLAN-058 L8 app-private uninstall)', () => {
  const userData = 'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer';

  it('lists every app-private file and dir under userData (not vaults/)', () => {
    const paths = resolveAppPrivateDeletePaths(userData);
    for (const name of APP_USER_DATA_FILES) {
      expect(paths).toContain(path.join(userData, name));
    }
    for (const name of APP_USER_DATA_DIRS) {
      expect(paths).toContain(path.join(userData, name));
    }
    expect(paths.some((p) => p.endsWith(`${path.sep}vaults`))).toBe(false);
  });
});
