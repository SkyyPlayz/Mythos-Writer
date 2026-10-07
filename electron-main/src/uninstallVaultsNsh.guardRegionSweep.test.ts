import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertSidecarGuardRegionExact,
  assertSidecarGuardVmBehaviourTables,
  mutantSidecarGuardRegionSweepLine,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
} from './sidecarTraversalScan.test-helpers.js';

/**
 * Re-baseline sweep: primary mutant does not change VM tables (pin mode still red).
 */
export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<
  Record<number, string>
> = {};

/**
 * NSIS guard is stricter than the behavioural VM tables on these lines (honest blind spot).
 */
export const SIDECAR_GUARD_SWEEP_STRONGER_THAN_VM_TABLES: Readonly<Record<number, string>> = {
  52: 'StrCmp $1 "" Nop: read-trim VM still returns empty via post-loop $1 check; delete-set loop unchanged.',
  72: 'Goto mythos_trav_inc Nop after `\\..`+`/` reject; traversal reject table already vault_read at :71.',
  106:
    'StrCmp $1 $5 Nop: Mythos APPDATA root self-skip; table paths use non-root Mythos subtree or other allowlists.',
};

describe('sidecar guard region sweep :43-:106 (buildIntegrity excluded)', () => {
  const nsh = loadUninstallVaultsNsh();

  describe('mode (1) normal — exact region pin', () => {
    for (
      let fileLine = SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
      fileLine <= SIDECAR_GUARD_REGION_FILE_LINE_LAST;
      fileLine += 1
    ) {
      it(`line :${fileLine} primary sweep mutant fails exact region pin`, () => {
        const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
        expect(() => assertSidecarGuardRegionExact(mutant)).toThrow();
      });
    }
  });

  describe('mode (2) re-baseline — VM tables only (pin rebaselined onto mutant)', () => {
    for (
      let fileLine = SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
      fileLine <= SIDECAR_GUARD_REGION_FILE_LINE_LAST;
      fileLine += 1
    ) {
      const stronger = SIDECAR_GUARD_SWEEP_STRONGER_THAN_VM_TABLES[fileLine];
      const equiv = SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine];
      if (fileLine === 90) {
        it(`line :${fileLine} primary sweep mutant fails VM (label rename; non-behavioural, pin-only)`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          expect(() => assertSidecarGuardVmBehaviourTables(mutant)).toThrow();
        });
        continue;
      }
      if (stronger) {
        it(`line :${fileLine} NSIS stricter than VM tables (documented): ${stronger}`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          expect(() => assertSidecarGuardVmBehaviourTables(mutant)).not.toThrow();
        });
        continue;
      }
      if (equiv) {
        it(`line :${fileLine} behaviour-equivalent mutant (documented): ${equiv}`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          expect(() => assertSidecarGuardVmBehaviourTables(mutant)).not.toThrow();
        });
        continue;
      }
      it(`line :${fileLine} primary sweep mutant fails VM behaviour tables`, () => {
        const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
        expect(() => assertSidecarGuardVmBehaviourTables(mutant)).toThrow();
      });
    }
  });
});
