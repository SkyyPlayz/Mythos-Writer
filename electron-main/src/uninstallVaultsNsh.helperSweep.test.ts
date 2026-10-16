import { describe, expect, it } from 'vitest';

import {
  assertMythosRmdirHelperRegionExact,
  HELPER_CRITIC_MUTANTS,
  HELPER_REGION_FILE_LINE_FIRST,
  HELPER_REGION_FILE_LINE_LAST,
  helperGuardModeTwoCaught,
  nshWithFileLine,
} from './sidecarHelperVm.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

const nsh = loadUninstallVaultsNsh();

/**
 * Helper-region Nops that do not change the helper VM tables (Push/Pop, GFPN
 * success on these fixtures, prefix match, fall-through labels).
 */
export const HELPER_SWEEP_EQUIVALENT_FILE_LINES: Readonly<Record<number, string>> = {
  605: 'Push $3 → Nop. Site expansion writes $3 before any read.',
  606: 'Push $4 → Nop. $4 is overwritten by GFPN.',
  607: 'Push $6 → Nop. $6 is overwritten before Pop.',
  608: 'Push $7 → Nop.',
  609: 'Push $8 → Nop.',
  610: 'Push $9 → Nop. Site expansion writes $9 before any read.',
  621: 'prefix StrCmp → Nop. Every helper site is under $APPDATA.',
  623: 'separator StrCmp → Nop. Every helper site has \\ after $APPDATA.',
  630: 'Goto walk → Nop. Falls into the hit path; extra prefix checks still see DIRECTORY and continue.',
  638: 'Goto walk after hit → Nop. Falls into leaf; helper sites have no further `\\` after the first post-root hit.',
  646: 'Pop $9 → Nop. End of program.',
  647: 'Pop $8 → Nop.',
  648: 'Pop $7 → Nop.',
  649: 'Pop $6 → Nop.',
  650: 'Pop $4 → Nop.',
  651: 'Pop $3 → Nop.',
};

describe('H2 helper region sweep :604-:652 (pin + helper mode-2)', () => {
  it('mutation sweep fully covers .nsh :604-:652', () => {
    expect(HELPER_REGION_FILE_LINE_FIRST).toBe(604);
    expect(HELPER_REGION_FILE_LINE_LAST).toBe(652);
    for (let fileLine = 604; fileLine <= 652; fileLine += 1) {
      const mutant = nshWithFileLine(nsh, fileLine, 'Nop');
      expect(mutant, `:${fileLine} Nop`).not.toBe(nsh);
      expect(() => assertMythosRmdirHelperRegionExact(mutant), `:${fileLine} pin`).toThrow();
    }
  });

  it('canonical helper region pin holds', () => {
    expect(() => assertMythosRmdirHelperRegionExact(nsh)).not.toThrow();
  });

  describe('mode (1) exact pin', () => {
    for (let fileLine = HELPER_REGION_FILE_LINE_FIRST; fileLine <= HELPER_REGION_FILE_LINE_LAST; fileLine += 1) {
      it(`line :${fileLine} primary Nop fails the helper pin`, () => {
        const mutant = nshWithFileLine(nsh, fileLine, 'Nop');
        expect(() => assertMythosRmdirHelperRegionExact(mutant)).toThrow();
      });
    }
  });

  describe('mode (2) helper VM tables', () => {
    it('negative control — canonical is not caught', () => {
      expect(helperGuardModeTwoCaught(nsh, nsh)).toBe(false);
    });

    for (let fileLine = HELPER_REGION_FILE_LINE_FIRST; fileLine <= HELPER_REGION_FILE_LINE_LAST; fileLine += 1) {
      const equiv = HELPER_SWEEP_EQUIVALENT_FILE_LINES[fileLine];
      if (equiv) {
        it(`line :${fileLine} behaviour-equivalent primary is NOT caught: ${equiv}`, () => {
          const mutant = nshWithFileLine(nsh, fileLine, 'Nop');
          expect(helperGuardModeTwoCaught(mutant, nsh)).toBe(false);
        });
      } else {
        it(`line :${fileLine} primary Nop is caught`, () => {
          const mutant = nshWithFileLine(nsh, fileLine, 'Nop');
          expect(helperGuardModeTwoCaught(mutant, nsh)).toBe(true);
        });
      }
    }
  });

  it('all 8 Critic helper mutants are in the helper region and distinct from :621', () => {
    expect(HELPER_CRITIC_MUTANTS).toHaveLength(8);
    expect(HELPER_CRITIC_MUTANTS.every((m) => m.line !== 621)).toBe(true);
    expect(
      HELPER_CRITIC_MUTANTS.every(
        (m) => m.line >= HELPER_REGION_FILE_LINE_FIRST && m.line <= HELPER_REGION_FILE_LINE_LAST,
      ),
    ).toBe(true);
  });
});
