import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertSidecarGuardRegionExact,
  assertSidecarGuardVmBehaviourTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  mutantMB1_neutralizeBackslashDotBackslashReject,
  mutantN1_forwardSlashCheckPipe,
  mutantSidecarGuardRegionSweepLine,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
} from './sidecarTraversalScan.test-helpers.js';
import { sidecarGuardModeTwoCaught } from './sidecarOracleMutants.test-helpers.js';
import { ORACLE_CLASS_ALL_EQUIVALENT_LINES } from './sidecarOracleClassSweep.test-helpers.js';

/**
 * Behaviour-equivalent mode-2 primaries (the `Nop` fallback on each of these lines). A sibling check
 * already rejects every path the line rejects, so the mutant deletes exactly what canonical deletes;
 * Forge's oracle agrees (`N:nop` is behaviour-non-changing on its full corpus). Every other surviving
 * mutant class on a listed line is equivalent too, enforced per line by the oracle-class sweep; the
 * stricter swaps on :97–:99 / :103–:105 / :123–:125 / :129–:131 are killed by
 * TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS (`.` / space / TAB), TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS
 * (`"x"`) and the trailing-separator rows (`$4`→`$2`).
 *
 * The list must be exact: a listed line that the VM tables catch fails mode 2, an unlisted line they
 * miss fails mode 2. Strength shards re-check identity on Forge's full oracle corpus for the
 * Ivy/extended/RF-4/5/6/walk subset. GFPN/GLP lines Forge proved non-equivalent are not listed.
 * Each reason names the line it had before RF-4/5/6 moved the region (`old :N`).
 */
export const SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS: Readonly<Record<number, string>> = {
  56: 'StrCmp $1 "" uninstall_vault_read → Nop (old :52). The RF-6 loop head :47 already skipped an empty line; an empty path matches no allowlist root anyway (mythos_al_deny).',
  97: 'StrCmp $4 "" uninstall_vault_read → Nop (old :71, backslash `\\.`+EOF). Sibling: :137 trav_ok tail rejects a path ending in `.`.',
  98: 'StrCmp $4 "\\" uninstall_vault_read → Nop (old :72, `\\.\\`). Sibling: :87 rejects the next `\\` whose preceding char is `.`.',
  109: 'StrCmp $7 "0" +5 → Nop (old :83, forward pos-0 skip). A `/` at pos 0 then reads $8=-1 (the last char); every path that read can reject already fails the :137–:139 tail check.',
  218: 'StrCmp $3 $5 uninstall_vault_read → Nop (old :159, APPDATA root self-match). Sibling: the exact root has no `\\` at $8 length, so it falls to not_appdata and is denied.',
};

/**
 * The other 12 proven-equivalent primaries beyond Ivy's locked 5 (reported as a per-line table in
 * PROOF). Every entry is a post-S16 redundant `.`/`..` reject or the backslash pos-0 skip, covered
 * by a sibling S16 prev-char check (:87 before `\\`, :112 before `/`) or the trav_ok tail (:137).
 */
export const SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS: Readonly<Record<number, string>> = {
  84: 'StrCmp $7 "0" +5 → Nop (old :58, backslash pos-0 skip). A `\\` at pos 0 then reads $8=-1 (the last char); every path that read can reject already fails the :137–:139 tail check.',
  99: 'StrCmp $4 "/" uninstall_vault_read → Nop (old :73, `\\./`). Sibling: :112 rejects the `/` whose preceding char is `.`.',
  103: 'StrCmp $4 "" uninstall_vault_read → Nop (old :77, `\\..`+EOF). Sibling: :137 trav_ok tail rejects a trailing `.`.',
  104: 'StrCmp $4 "\\" uninstall_vault_read → Nop (old :78, `\\..\\`). Sibling: :87 rejects the next `\\` preceded by `.`.',
  105: 'StrCmp $4 "/" uninstall_vault_read → Nop (old :79, `\\../`). Sibling: :112 rejects the `/` preceded by `.`.',
  106: 'Goto mythos_trav_inc → Nop (old :80). Falls into mythos_trav_fwd:, whose `StrCmp $4 "/" 0 mythos_trav_inc` takes inc: $4 (char after `\\..`) is never `/` here, :105 already rejected it.',
  123: 'StrCmp $4 "" uninstall_vault_read → Nop (old :97, `/.`+EOF). Sibling: :137 trav_ok tail rejects a trailing `.`.',
  124: 'StrCmp $4 "/" uninstall_vault_read → Nop (old :98, `/./`). Sibling: :112 rejects the `/` preceded by `.`.',
  125: 'StrCmp $4 "\\" uninstall_vault_read → Nop (old :99, `/.\\`). Sibling: :87 rejects the `\\` preceded by `.`.',
  129: 'StrCmp $4 "" uninstall_vault_read → Nop (old :103, `/..`+EOF). Sibling: :137 trav_ok tail rejects a trailing `.`.',
  130: 'StrCmp $4 "/" uninstall_vault_read → Nop (old :104, `/../`). Sibling: :112 rejects the `/` preceded by `.`.',
  131: 'StrCmp $4 "\\" uninstall_vault_read → Nop (old :105, `/..\\`). Sibling: :87 rejects the `\\` preceded by `.`.',
};

/** Equivalents on lines RF-4/5/6 added or newly reached by the sweep (no old line). */
export const SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS: Readonly<Record<number, string>> = {
  47: 'StrCmp $1 "" uninstall_vault_read → Nop (RF-6 loop head). An empty line reads $2 = "", which is neither LF nor CR, so the loop exits and the :56 check skips it.',
  61: 'System::Free $6 → Nop. The 64-byte set buffer leaks once per line; nothing reads it after StrPBrkW, so the delete set is unchanged.',
  117: 'StrCmp $4 "/" uninstall_vault_read → Nop (forward `//`). Sibling: the :79–:80 sepcheck already rejects any separator followed by `/`.',
  308: 'StrCmp $3 $5 uninstall_vault_read → Nop (Downloads root self-match). Sibling: the exact root has no `\\` at $8 length, so it falls to mythos_al_deny.',
};

/**
 * RF-7 walk / leftover-`/` primaries plus the restored :341 ancestor prefix-compare
 * that the 12,617-case strength shards still scan. H3 clobbers $8, so the ancestor
 * StrLen lines are unlisted (HARD-C / HARD-2 catch a Nop).
 */
export const SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS: Readonly<Record<number, string>> = {
  350: 'StrCpy $7 $9 → Nop. Restore then uses leftover $7; walk still hits every `\\`.',
  354: 'StrLen $8 $3 (strip) → Nop. $8 is only read when the last char is `\\`.',
  355: 'IntCmp $8 3 (keep C:\\) → Nop. Fixture trailing-`\\` paths are longer than 3.',
  357: 'Goto mythos_nr_strip → Nop. GFPN leaves at most one trailing `\\`.',
  406: 'Documents ancestor prefix compare → Nop. $6 is not the path prefix on the HARD-C fixtures.',
  463: 'StrCpy $9 $7 → Nop. $9 stays the last GFPN; walk start is a few chars in and still hits every `\\`.',
  464: 'Goto mythos_reparse_walk → Nop. The next line is the walk label.',
  467: 'IntOp $7 $8 + 1 → Nop. Walk from 0 still GetFileAttributesW every prefix and the leaf.',
  473: 'Goto mythos_reparse_next → Nop. Falls into hit and still GetFileAttributesW the current prefix.',
  480: 'IntOp $7 $7 + 1 → +2 (after a hit). The next `\\` is still found.',
  487: 'Goto uninstall_vault_do_delete → Nop. Falls through to the leftover-/ scan and IfFileExists.',
  489: 'StrCpy $7 0 (leftover-/ scan) → Nop. Walk left $7 at end-of-$3.',
  491: 'StrCpy $6 $3 1 $7 → Nop. Leftover $6 from the walk leaf is "".',
  493: 'StrCmp $6 "/" uninstall_vault_read → Nop. GFPN has already folded / to \\.',
  494: 'IntOp $7 $7 + 1 → +2 (leftover-/ scan). GFPN left no / to reject.',
  495: 'Goto mythos_canon_slash → Nop. Falls into slash_ok; GFPN left no / to reject.',
};

/**
 * Remaining mode-2-only equivalents (primary Nop is identity on the VM tables).
 * Forge RESULT_36d2 unlisted 33 GFPN/GLP 0/trunc lines that a fault row kills.
 * RESULT_8329 unlisted :286: a GLP fault on that Call skips a legit vault;
 * Nop of the Call skips the fault and the vault deletes.
 */
export const SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS: Readonly<Record<number, string>> = {
  149: 'H3 ct1 Goto Nop is identity: ct2 still scans $3 (allowlist leftover suffix also carries the tail).',
  161: 'H3 5w Goto Nop is identity: a later 9* scan still reads the deny/allow root.',
  176: 'H3 5p Goto Nop is identity: a later 9* scan still reads the deny/allow root.',
  191: 'H3 5x Goto Nop is identity: a later 9* scan still reads the deny/allow root.',
  213: 'H3 5a Goto Nop is identity: nested 9a still scans AppData.',
  243: 'H3 5d Goto Nop is identity: nested 9d still scans Documents.',
  248: 'StrCmp $3 $5 uninstall_vault_read → Nop (Documents exact root). Sibling: no `\\` at $8, so it falls to not_documents.',
  273: 'H3 5k Goto Nop is identity: Documents vaults never reach 5k; nested 9k still scans Desktop.',
  278: 'StrCmp $3 $5 uninstall_vault_read → Nop (Desktop exact root). Sibling: no `\\` at $8, so it falls to not_desktop.',
  303: 'H3 5l Goto Nop is identity: nested 9l still scans Downloads.',
  327: 'H3 ct2 Goto Nop is identity: ct1 already scanned $3 (or leftover suffix still carries the tail).',
  338: 'H3 9c Goto Nop is identity: the matching 5* hook already scanned that root.',
  376: 'H3 9a Goto Nop is identity: 5a already scanned AppData.',
  378: 'AppData nested exact-root StrCmp → Nop. Allowlist already skipped the exact AppData root.',
  402: 'H3 9d Goto Nop is identity: 5d already scanned Documents.',
  404: 'Documents nested exact-root StrCmp → Nop. Allowlist already skipped the exact Documents root.',
  454: 'H3 9l Goto Nop is identity: 5l already scanned Downloads. 9k Goto stays unlisted (only scan of a dirty Desktop).',
  504: 'Scan default StrCpy $6 $3 Nop is identity: allowlist leftover $6 is the suffix that still carries the dangerous tail.',
  506: 'StrCpy $6 $5 Nop is identity: nested 9* hooks still scan $9.',
  513: 'IntCmp $7 0 Nop is identity: fixtures never have `\\` at index 0.',
};

/** Forge RESULT_97be (29) + RESULT_36d2 (33) + RESULT_8329 (:286). Mode 2 must catch each primary Nop. */
export const SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS: readonly number[] = [
  140, 141, 142, 143, 144, 145, 152, 153, 154, 155, 156, 157, 167, 168, 169, 170, 171, 172, 182, 183, 184, 185, 186, 187, 197, 198, 199, 200, 203, 227, 228, 229, 230, 233, 257, 258, 259, 260, 263, 287, 288, 289, 290, 293, 318, 319, 320, 321, 322, 323, 329, 330, 331, 332, 333, 334, 360, 361, 362, 363, 366, 386, 387, 388, 389, 392, 412, 413, 414, 415, 418, 438, 439, 440, 441, 444,
];

/** RF-7 walk / HARD-2 / HARD-A fail-closed lines whose primary Nop does not change the delete set. */
export const SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS,
};

/**
 * 12k-corpus strength shards: Ivy's locked 5, the other 12 proven primaries, RF-4/5/6,
 * the RF-7 walk / leftover-`/` primaries, and the restored :341 ancestor
 * compare. Heavy files run in the `oracle-sweeps` job, not inside `unit`.
 */
export const SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS,
};

export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS,
};

describe('sidecar guard region sweep :43-:540 (buildIntegrity excluded)', () => {
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
      const sharded = [
        47, 56, 61, 84, 97, 98, 99, 103, 104, 105, 106, 109, 117, 123, 124, 125, 129, 130, 131, 218, 308, 350, 354,
        355, 357, 406, 463, 464, 467, 473, 480, 487, 489, 491, 493, 494, 495,
      ];
      expect(sharded).toEqual(
        Object.keys(SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES)
          .map(Number)
          .sort((a, b) => a - b),
      );
    });

    it('Forge\'s false GFPN/GLP equivalents are not listed as behaviour-equivalent', () => {
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
  });
});
