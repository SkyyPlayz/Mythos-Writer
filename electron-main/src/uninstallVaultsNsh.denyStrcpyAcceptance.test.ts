import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertDenyPrefixVmBehaviourTables,
  DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES,
  DENY_PREFIX_STRCPY_ACCEPTANCE_VARIANTS,
  mutantDenyPrefixStrcpyAcceptance,
} from './sidecarTraversalScan.test-helpers.js';

describe('Critic H6 — deny StrCpy acceptance (:141/:144/:147, re-baseline deny VM only)', () => {
  const nsh = loadUninstallVaultsNsh();

  for (const fileLine of DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES) {
    for (const variant of DENY_PREFIX_STRCPY_ACCEPTANCE_VARIANTS) {
      it(`:${fileLine} variant ${variant} fails deny-prefix VM behaviour tables`, () => {
        const mutant = mutantDenyPrefixStrcpyAcceptance(nsh, fileLine, variant);
        expect(() => assertDenyPrefixVmBehaviourTables(mutant)).toThrow();
      });
    }
  }
});
