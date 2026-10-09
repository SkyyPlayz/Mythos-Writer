import { describe, expect, it } from 'vitest';

import { generateOracleClassMutants, sidecarGuardModeTwoCaught } from './sidecarOracleMutants.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

/**
 * Generic `$3→$1` / `r3→r1` oracle-class mutants that still survive pin-free mode-2.
 * Each reason names the later check that covers the swapped register. Walk/leaf/HARD-E/H1
 * swaps are not listed — those are killed (and the leaf GFA has a red run in hardAC).
 */
export const SIDECAR_DOLLAR3_TO_DOLLAR1_EQUIVALENTS: Readonly<Record<string, string>> = {
  '143:r3->r1':
    'Line GLP w r3→w r1. :147 empty-$3 still fail-closes a failed GLP; :146 StrCpy $3 $2 then the allowlist prefix copies (:216/:246/…) still read leftover $3. :140 GFPN + glpnModel already folded / and 8.3 on every raw $1 that reaches :143.',
  '218:$3->$1':
    'AppData exact-root StrCmp $3 $5. Sibling :219/:221 prefix-\\ check: the exact root has no \\ at $8, so it falls to not_appdata and is denied.',
  '248:$3->$1':
    'Documents exact-root StrCmp $3 $5. Sibling :249/:251 prefix-\\ check: the exact root has no \\ at $8, so it falls to not_documents and is denied.',
  '278:$3->$1':
    'Desktop exact-root StrCmp $3 $5. Sibling :279/:281 prefix-\\ check: the exact root has no \\ at $8, so it falls to not_desktop and is denied.',
  '308:$3->$1':
    'Downloads exact-root StrCmp $3 $5. Sibling :309/:311 prefix-\\ check: the exact root has no \\ at $8, so it falls to not_downloads and is denied.',
  '325:$3->$1':
    'Canon empty-$3 StrCmp. :322 0-check already fail-closes a failed canon GLP; :325 only runs on success, when leftover $1 is the non-empty raw line.',
  '354:$3->$1':
    'Nested-strip StrLen $8 $3. :352 last-char \\ check still reads $3; $8 is only consumed when that char is \\, and :355 keeps C:\\.',
  '378:$3->$1':
    'AppData nested exact-root StrCmp $3 $9. Sibling :383 ancestor-\\ check: exact AppData has no \\ at $8, so it falls to mythos_nr_documents. Allowlist already skipped the exact AppData root.',
  '404:$3->$1':
    'Documents nested exact-root StrCmp $3 $9. Sibling :409 ancestor-\\ check: exact Documents has no \\ at $8, so it falls to mythos_nr_desktop. Allowlist already skipped the exact Documents root.',
  '491:$3->$1':
    'Leftover-/ char copy. :462 already replaced $1 with the last nested root (no /); :493 leftover-/ reject therefore matches the $3 scan that GFPN already folded.',
};

describe('generic $3→$1 / r3→r1 oracle-class mutants', () => {
  const nsh = loadUninstallVaultsNsh();
  const mutants = generateOracleClassMutants(nsh).filter(
    (m) => m.key.endsWith(':$3->$1') || m.key.endsWith(':r3->r1'),
  );

  it('leaf GFA r3→r1 is among the generated mutants and is mode-2 caught', () => {
    const leaf = mutants.find((m) => m.key === '483:r3->r1');
    expect(leaf, '483:r3->r1 must be generated').toBeDefined();
    expect(sidecarGuardModeTwoCaught(leaf!.nsh, nsh)).toBe(true);
  });

  it('every $3→$1 / r3→r1 mutant is either documented-equivalent or mode-2 caught', () => {
    const unexpectedSurvivors: string[] = [];
    const listedButCaught: string[] = [];
    for (const mutant of mutants) {
      const documented = SIDECAR_DOLLAR3_TO_DOLLAR1_EQUIVALENTS[mutant.key];
      const caught = sidecarGuardModeTwoCaught(mutant.nsh, nsh);
      if (documented) {
        if (caught) {
          listedButCaught.push(mutant.key);
        }
      } else if (!caught) {
        unexpectedSurvivors.push(mutant.key);
      }
    }
    expect(listedButCaught, 'documented equivalent was actually caught').toEqual([]);
    expect(unexpectedSurvivors, 'undocumented survivor').toEqual([]);
    expect(Object.keys(SIDECAR_DOLLAR3_TO_DOLLAR1_EQUIVALENTS).sort()).toEqual(
      mutants.filter((m) => SIDECAR_DOLLAR3_TO_DOLLAR1_EQUIVALENTS[m.key]).map((m) => m.key).sort(),
    );
  }, 120_000);
});
