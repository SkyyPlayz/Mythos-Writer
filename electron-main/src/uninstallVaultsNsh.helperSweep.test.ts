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
  399: 'Push $3 → Nop. Site expansion writes $3 before any read.',
  400: 'Push $4 → Nop. $4 is overwritten by GFPN.',
  401: 'Push $6 → Nop. $6 is overwritten before Pop.',
  402: 'Push $7 → Nop.',
  403: 'Push $8 → Nop.',
  404: 'Push $9 → Nop. Site expansion writes $9 before any read.',
  415: 'prefix StrCmp → Nop. Every helper site is under $APPDATA.',
  417: 'separator StrCmp → Nop. Every helper site has \\ after $APPDATA.',
  418: 'IntOp $7 $8 + 1 → Nop. Walk from 0 still GetFileAttributesW every prefix and the leaf.',
  424: 'Goto walk → Nop. Falls into the hit path; extra prefix checks still see DIRECTORY and continue.',
  432: 'Goto walk after hit → Nop. Two-level Mythos Writer\\child paths fall into the leaf and still GFA it.',
  440: 'Pop $9 → Nop. End of program.',
  441: 'Pop $8 → Nop.',
  442: 'Pop $7 → Nop.',
  443: 'Pop $6 → Nop.',
  444: 'Pop $4 → Nop.',
  445: 'Pop $3 → Nop.',
};

describe('H2 helper region sweep :398-:446 (pin + helper mode-2)', () => {
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

  it('all 8 Critic helper mutants are in the helper region and distinct from :415', () => {
    expect(HELPER_CRITIC_MUTANTS).toHaveLength(8);
    expect(HELPER_CRITIC_MUTANTS.every((m) => m.line !== 415)).toBe(true);
    expect(
      HELPER_CRITIC_MUTANTS.every(
        (m) => m.line >= HELPER_REGION_FILE_LINE_FIRST && m.line <= HELPER_REGION_FILE_LINE_LAST,
      ),
    ).toBe(true);
  });
});
