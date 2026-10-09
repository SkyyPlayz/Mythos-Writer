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
  479: 'Push $3 → Nop. Site expansion writes $3 before any read.',
  480: 'Push $4 → Nop. $4 is overwritten by GFPN.',
  481: 'Push $6 → Nop. $6 is overwritten before Pop.',
  482: 'Push $7 → Nop.',
  483: 'Push $8 → Nop.',
  484: 'Push $9 → Nop. Site expansion writes $9 before any read.',
  495: 'prefix StrCmp → Nop. Every helper site is under $APPDATA.',
  497: 'separator StrCmp → Nop. Every helper site has \\ after $APPDATA.',
  498: 'IntOp $7 $8 + 1 → Nop. Walk from 0 still GetFileAttributesW every prefix and the leaf.',
  504: 'Goto walk → Nop. Falls into the hit path; extra prefix checks still see DIRECTORY and continue.',
  512: 'Goto walk after hit → Nop. Two-level Mythos Writer\\child paths fall into the leaf and still GFA it.',
  520: 'Pop $9 → Nop. End of program.',
  521: 'Pop $8 → Nop.',
  522: 'Pop $7 → Nop.',
  523: 'Pop $6 → Nop.',
  524: 'Pop $4 → Nop.',
  525: 'Pop $3 → Nop.',
};

describe('H2 helper region sweep :478-:526 (pin + helper mode-2)', () => {
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

  it('all 8 Critic helper mutants are in the helper region and distinct from :495', () => {
    expect(HELPER_CRITIC_MUTANTS).toHaveLength(8);
    expect(HELPER_CRITIC_MUTANTS.every((m) => m.line !== 495)).toBe(true);
    expect(
      HELPER_CRITIC_MUTANTS.every(
        (m) => m.line >= HELPER_REGION_FILE_LINE_FIRST && m.line <= HELPER_REGION_FILE_LINE_LAST,
      ),
    ).toBe(true);
  });
});
