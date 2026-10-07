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
 * Probe re-baseline sweep: primary mutants on these lines do not change VM table outcomes
 * (pin mode still red). One-line justification each.
 */
export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<
  Record<number, string>
> = {
  52: 'StrCmp $1 "" Nop; read-trim VM still yields empty for blank-line fixtures via final $1 check.',
  53: 'StrCpy $7 0 Nop; scan loop still starts at index 0 when $7 unset in the VM.',
  65: 'Inner backslash second-dot StrCmp Nop; reject table paths hit :63/:68 without this disambiguation.',
  70: 'Goto mythos_trav_inc Nop; fall-through still reaches increment for table paths.',
  72: 'Forward `/` entry StrCmp Nop; C:/ reject rows hit deeper `/.` and `/..` checks.',
  81: 'Forward inner second-dot StrCmp Nop; redundant with :75/:78/:85 on table paths.',
  90: 'uninstall_vault_trav_ok: label rename; rebaselined VM rebinds the label at the same PC.',
  103: 'StrCmp $4 $5 Nop; APPDATA rows unchanged (prefix mismatch still falls through to :104).',
};

describe('sidecar guard region sweep :43-:104 (buildIntegrity excluded)', () => {
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
      const equiv = SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine];
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
