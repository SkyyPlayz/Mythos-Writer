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
const S16_VM_TABLE_BLIND_SPOT =
  'S16 Win32 segment guard; rebaseline Nop does not change traversal/deny/allowlist VM table outcomes on current rows.';

export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<
  Record<number, string>
> = {
  52: 'StrCmp $1 "" Nop; empty trimmed line matches no allowed root (same skip as empty read).',
  58: `StrCmp $7 "0" +5 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  59: `IntOp $8 $7 - 1 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  61: `StrCmp $4 "." uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  63: `StrCmp $4 " " uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  64: `StrCmp $4 "$\\t" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  65: `IntOp $8 $7 + 1 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  66: `StrCmp $4 " " uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  67: `StrCmp $4 "$\\t" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  71: `StrCmp $4 "" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  72: `StrCmp $4 "\\" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  73: `StrCmp $4 "/" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  77: `StrCmp $4 "" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  78: `StrCmp $4 "\\" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  79: `StrCmp $4 "/" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  80: 'Goto mythos_trav_inc Nop; falls through to mythos_trav_fwd and still reaches increment.',
  83: `StrCmp $7 "0" +5 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  84: `IntOp $8 $7 - 1 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  85: `StrCmp $4 "." uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  86: `StrCmp $4 " " uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  87: `StrCmp $4 "$\\t" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  88: `IntOp $8 $7 + 1 Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  90: `StrCmp $4 " " uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  91: `StrCmp $4 "$\\t" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  92: `StrCmp $4 "." 0 mythos_trav_inc Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  96: `StrCmp $4 "" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  97: `StrCmp $4 "/" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  98: `StrCmp $4 "\\" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  102: `StrCmp $4 "/" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  103: `StrCmp $4 "\\" uninstall_vault_read Nop; ${S16_VM_TABLE_BLIND_SPOT}`,
  104: 'Goto mythos_trav_inc Nop; falls through to forward-branch increment (same as :80).',
  126:
    'StrCmp $1 $5 Nop; exact Mythos APPDATA root fails :128 backslash check and falls through to deny.',
};

/**
 * NSIS guard is stricter than the behavioural VM tables on these lines (honest blind spot).
 */
export const SIDECAR_GUARD_SWEEP_STRONGER_THAN_VM_TABLES: Readonly<Record<number, string>> = {};

const SWEEP_LABEL_RENAME_ONLY_FILE_LINE = 108;

describe('sidecar guard region sweep :43-:126 (buildIntegrity excluded)', () => {
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
      if (fileLine === SWEEP_LABEL_RENAME_ONLY_FILE_LINE) {
        it(`line :${fileLine} primary sweep mutant fails VM (uninstall_vault_trav_ok label rename; pin-only)`, () => {
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
