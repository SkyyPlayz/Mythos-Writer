// Test-only hook installer. Production code must not import this module.
// ESLint no-restricted-imports and writeGuard.test.ts both ban that import
// outside *.test.ts.

import {
  installNoFollowTestHooks,
  type NoFollowHooks,
} from './noFollowWrite.js';

export function setNoFollowHooksForTests(hooks: NoFollowHooks | null): void {
  installNoFollowTestHooks(hooks);
}

export function resetNoFollowHooksForTests(): void {
  installNoFollowTestHooks(null);
}
