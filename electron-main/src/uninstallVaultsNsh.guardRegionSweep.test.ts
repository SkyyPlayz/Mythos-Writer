import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertSidecarGuardRegionExact,
  assertSidecarGuardVmBehaviourTables,
  assertSidecarGuardVmSweepParity,
  assertSidecarH7DeleteLoopSweepParity,
  mutantSidecarGuardRegionSweepLine,
  TRAVERSAL_HARD_H7_STRCPY7_RESET_FILE_LINE,
  TRAVERSAL_REJECT_S16_CANONICAL_ONLY_PATHS,
  runTraversalVmFromNsh,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
} from './sidecarTraversalScan.test-helpers.js';

/**
 * Re-baseline sweep: primary mutant does not change VM tables (pin mode still red).
 * Probe d5c5339f expected equivalents only — other lines must go red on behaviour.
 */
export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<
  Record<number, string>
> = {
  47: 'StrCpy $2 $1 1 -1 Nop; trim chain blind spot on current VM rows.',
  50: 'StrCpy $1 $1 -1 Nop; \\r trim blind spot on current VM rows.',
  52: 'StrCmp $1 "" Nop; empty trimmed line matches no allowed root (same skip as empty read).',
  60: 'StrCpy $4 $1 1 $8 register swap; fwd-target swap equivalent on traversal tables.',
  65: 'IntOp $8 $7 + 1 Nop; fwd-target swap equivalent on traversal tables.',
  66: 'StrCmp $4 " " uninstall_vault_read Nop; fwd-target swap equivalent on traversal tables.',
  71: 'StrCmp $4 "" uninstall_vault_read Nop; fwd-target swap equivalent on traversal tables.',
  62: 'StrCmp $4 " " uninstall_vault_read Nop; sibling space/tab/dot checks on rebaseline rows.',
  63: 'StrCmp $4 "$\\t" uninstall_vault_read Nop; sibling space/tab/dot checks on rebaseline rows.',
  72: 'StrCmp $4 "\\" uninstall_vault_read Nop; mixed-separator rows still reject via sibling checks.',
  83: 'StrCmp $7 "0" +5 Nop; fwd-target swap equivalent on traversal tables.',
  91: 'StrCmp $4 "/" uninstall_vault_read Nop; duplicate // reject at :98 on rebaseline rows.',
  107: 'IntOp $7 $7 + 1 +2; increment blind spot on current traversal table rows.',
  127:
    'StrCmp $1 $5 Nop; exact Mythos APPDATA root fails :128 backslash check and falls through to deny.',
};

/**
 * NSIS guard is stricter than the behavioural VM tables on these lines (honest blind spot).
 */
export const SIDECAR_GUARD_SWEEP_STRONGER_THAN_VM_TABLES: Readonly<Record<number, string>> = {};

const SWEEP_LABEL_RENAME_ONLY_FILE_LINE = 109;

describe('sidecar guard region sweep :43-:127 (buildIntegrity excluded)', () => {
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
          expect(() =>
          assertSidecarGuardVmBehaviourTables(mutant, undefined, {
            sweepRebaseline: true,
            canonicalNsh: nsh,
          }),
        ).toThrow();
        });
        continue;
      }
      if (stronger) {
        it(`line :${fileLine} NSIS stricter than VM tables (documented): ${stronger}`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          expect(() =>
            assertSidecarGuardVmBehaviourTables(mutant, undefined, {
              sweepRebaseline: true,
              canonicalNsh: nsh,
            }),
          ).not.toThrow();
        });
        continue;
      }
      if (equiv) {
        it(`line :${fileLine} behaviour-equivalent mutant (documented): ${equiv}`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          expect(() =>
            assertSidecarGuardVmBehaviourTables(mutant, undefined, {
              sweepRebaseline: true,
              canonicalNsh: nsh,
            }),
          ).not.toThrow();
        });
        continue;
      }
      it(`line :${fileLine} primary sweep mutant fails VM behaviour tables`, () => {
        const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
        if (fileLine === TRAVERSAL_HARD_H7_STRCPY7_RESET_FILE_LINE) {
          expect(() => assertSidecarH7DeleteLoopSweepParity(mutant, nsh)).toThrow();
          return;
        }
        expect(() => {
          assertSidecarGuardVmSweepParity(mutant, nsh);
          for (const path of TRAVERSAL_REJECT_S16_CANONICAL_ONLY_PATHS) {
            const canonicalOutcome = runTraversalVmFromNsh(path, nsh);
            const mutantOutcome = runTraversalVmFromNsh(path, mutant);
            if (mutantOutcome !== canonicalOutcome) {
              return;
            }
          }
          throw new Error('sweep primary matches canonical on rebaseline + canonical-only tables');
        }).toThrow();
      });
    }
  });
});
