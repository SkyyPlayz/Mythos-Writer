import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertSidecarGuardRegionExact,
  assertSidecarGuardVmBehaviourTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  mutantMB1_neutralizeBackslashDotBackslashReject,
  mutantN1_forwardSlashCheckPipe,
  mutantSidecarGuardRegionSweepLine,
  mutantSidecarFallbackSweepLine,
  SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST,
  SIDECAR_FALLBACK_REGION_FILE_LINE_LAST,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
} from './sidecarTraversalScan.test-helpers.js';
import { sidecarGuardModeTwoCaught } from './sidecarOracleMutants.test-helpers.js';
import {
  ORACLE_CLASS_ALL_EQUIVALENT_LINES,
  SIDECAR_FALLBACK_ORACLE_UNREACHABLE_LINES,
  SIDECAR_GUARD_STRENGTH_SHARDS,
} from './sidecarOracleClassSweep.test-helpers.js';

import {
  SIDECAR_FALLBACK_SWEEP_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_API_CONTRACT_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES,
  SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES,
} from './uninstallVaultsNsh.guardRegionSweep.equivalents.js';

export {
  SIDECAR_FALLBACK_SWEEP_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_API_CONTRACT_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES,
  SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS,
  SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES,
};

describe('sidecar guard region sweep :43-:541 (buildIntegrity excluded)', () => {
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
      const equivReason = SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine];
      if (equivReason) {
        it(`line :${fileLine} behaviour-equivalent primary is NOT caught (documented): ${equivReason}`, () => {
          const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
          // Bidirectional: fails if a listed equivalent is actually caught by the VM tables.
          expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(false);
        });
        continue;
      }
      it(`line :${fileLine} primary sweep mutant is caught by VM behaviour tables`, () => {
        const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
        expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
      });
    }
  });

  describe('mode (2) non-vacuity guard', () => {
    it('negative control — canonical nsh passes the VM tables (detector is not always-throwing)', () => {
      expect(() =>
        assertSidecarGuardVmBehaviourTables(nsh, DEFAULT_SIDECAR_NSIS_VAR_ENV, {
          sweepRebaseline: true,
          canonicalNsh: nsh,
        }),
      ).not.toThrow();
    });

    it('positive control — N1 forward `/` branch bypass is caught (detector is not always-passing)', () => {
      expect(sidecarGuardModeTwoCaught(mutantN1_forwardSlashCheckPipe(nsh), nsh)).toBe(true);
    });

    it('equivalence control — MB1 retargets the Ivy-locked :98 reject to inc; :87 masks it, so it stays uncaught', () => {
      expect(sidecarGuardModeTwoCaught(mutantMB1_neutralizeBackslashDotBackslashReject(nsh), nsh)).toBe(false);
    });

    it('sweep discriminates — both caught and equivalent lines exist and partition the region', () => {
      let caughtCount = 0;
      let equivCount = 0;
      for (
        let fileLine = SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
        fileLine <= SIDECAR_GUARD_REGION_FILE_LINE_LAST;
        fileLine += 1
      ) {
        if (SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine]) {
          equivCount += 1;
        } else {
          caughtCount += 1;
        }
      }
      expect(equivCount).toBeGreaterThan(0);
      expect(caughtCount).toBeGreaterThan(0);
      expect(equivCount + caughtCount).toBe(
        SIDECAR_GUARD_REGION_FILE_LINE_LAST - SIDECAR_GUARD_REGION_FILE_LINE_FIRST + 1,
      );
      expect(equivCount).toBe(
        Object.keys(SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS).length +
          Object.keys(SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS).length +
          Object.keys(SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS).length +
          Object.keys(SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS).length,
      );
    });

    it('equivalence-strength shards cover every strength-checked equivalent line', () => {
      const sharded = SIDECAR_GUARD_STRENGTH_SHARDS.flat().sort((a, b) => a - b);
      expect(sharded).toEqual(
        Object.keys(SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES)
          .map(Number)
          .sort((a, b) => a - b),
      );
    });

    it('Forge\'s 29 false GFPN/GLP equivalents are not listed as behaviour-equivalent', () => {
      for (const fileLine of SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeUndefined();
      }
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[329]).toBeUndefined();
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[330]).toBeUndefined();
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[331]).toBeUndefined();
    });

    it('Forge\'s 74 false GFPN/GLP equivalents plus :332 GLP are not listed as behaviour-equivalent', () => {
      expect(SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS).toHaveLength(74);
      for (const fileLine of SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeUndefined();
      }
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[329]).toBeUndefined();
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[330]).toBeUndefined();
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[331]).toBeUndefined();
      expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[332]).toBeUndefined();
    });

    it('oracle-class at-least-one-caught skip set is the 6 ancestor-separator lines from 8b2f', () => {
      expect([...ORACLE_CLASS_ALL_EQUIVALENT_LINES].sort((a, b) => a - b)).toEqual([
        382, 383, 408, 409, 434, 435,
      ]);
    });

    it('fallback :542 is the only unreachable oracle-class line (barrier after :541)', () => {
      expect([...SIDECAR_FALLBACK_ORACLE_UNREACHABLE_LINES]).toEqual([542]);
    });

    it('API-contract equivalents are exactly these 12 and stay listed', () => {
      const keys = Object.keys(SIDECAR_GUARD_SWEEP_API_CONTRACT_EQUIVALENTS)
        .map(Number)
        .sort((a, b) => a - b);
      expect(keys).toEqual([144, 147, 156, 159, 171, 174, 186, 189, 322, 325, 333, 336]);
      for (const fileLine of keys) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeDefined();
      }
    });

    it('Ivy-8 MAX IntCmp Nops stay unlisted (caught without long-path sweep rows)', () => {
      for (const fileLine of [320, 331, 362, 388, 414, 418, 440, 444]) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeUndefined();
      }
    });

    it('MAX / errno-3 Nops that need long-path or injected-3 rows are written proofs, not fixtures', () => {
      for (const fileLine of [145, 208, 233, 238, 263, 268, 293, 323, 334, 355, 397, 423]) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeDefined();
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).not.toMatch(
          /fixtures/i,
        );
      }
    });
  });

  describe('mode (1)+(2) S-19 fallback helpers :542-:582', () => {
    for (
      let fileLine = SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST;
      fileLine <= SIDECAR_FALLBACK_REGION_FILE_LINE_LAST;
      fileLine += 1
    ) {
      it(`line :${fileLine} fallback primary differs from canonical`, () => {
        const mutant = mutantSidecarFallbackSweepLine(nsh, fileLine);
        expect(mutant).not.toBe(nsh);
      });
      const equivReason = SIDECAR_FALLBACK_SWEEP_EQUIVALENTS[fileLine];
      if (equivReason) {
        it(`line :${fileLine} behaviour-equivalent primary is NOT caught (documented): ${equivReason}`, () => {
          const mutant = mutantSidecarFallbackSweepLine(nsh, fileLine);
          expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(false);
        });
      } else {
        it(`line :${fileLine} fallback primary sweep mutant is caught by VM behaviour tables`, () => {
          const mutant = mutantSidecarFallbackSweepLine(nsh, fileLine);
          expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
        });
      }
    }

    it('fallback sweep discriminates — caught and equivalent partition :542-:582', () => {
      let caughtCount = 0;
      let equivCount = 0;
      for (
        let fileLine = SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST;
        fileLine <= SIDECAR_FALLBACK_REGION_FILE_LINE_LAST;
        fileLine += 1
      ) {
        if (SIDECAR_FALLBACK_SWEEP_EQUIVALENTS[fileLine]) {
          equivCount += 1;
        } else {
          caughtCount += 1;
        }
      }
      expect(equivCount + caughtCount).toBe(
        SIDECAR_FALLBACK_REGION_FILE_LINE_LAST - SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST + 1,
      );
      expect(caughtCount).toBeGreaterThan(0);
      expect(
        Object.keys(SIDECAR_FALLBACK_SWEEP_EQUIVALENTS)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([542, 544, 549, 554, 559, 562, 564, 569, 572, 574, 577, 579, 582]);
    });
  });
});
