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
  354: 'StrLen $8 $3 (strip) → Nop. $8 is only read when the last char is `\\`.',
  355: 'IntCmp $8 3 (keep C:\\) → Nop. An allowlisted vault is `<root>\\<child>` after GFPN, so StrLen $8 is never 3 (`C:\\` is the exact volume root and fails the leftover-child allow check). Equal/less already share mythos_nr_appdata; Nop is unused on the live greater path.',
  357: 'Goto mythos_nr_strip → Nop. GFPN leaves at most one trailing `\\`.',
  407: 'Documents ancestor StrCmp $6 $3 Nop is identity on the HARD-C fixtures (HARD-E kills $3→$1). Restored 12k corpus walk (S-8).',
  464: 'Goto mythos_reparse_walk → Nop. The next line is the walk label (then StrLen).',
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
  327: 'H3 ct2 Goto Nop is identity: ct1 already scanned the expanded line (EVIL~1 → evil[space]); later 9* scans do not re-admit it.',
  338: 'H3 9c Goto Nop is identity: allowlist 5* already scanned the same expanded matched root unless that allowlist GLP was errno-5 (those rows kill :376/:402/:454).',
  // :541 unlisted — Nop replaces END_FOLLOW; locator / fallthrough into fb_5a is mode-2 red. Barrier :542 still blocks the unknown-tag two-mutation.
  // :453 unlisted — :540 fail-closed: leftover $2 no longer returns through ret9l.
  144: 'Line GLP 0-check Nop is identity: fail empties scratch; the empty $3 check still fail-closes.',
  147: 'Line GLP empty-$3 Nop is identity: a successful GLP never writes empty.',
  156: 'WINDIR GLP 0-check Nop is identity: fail empties scratch; the empty $5 check still fail-closes.',
  158: 'WINDIR StrCpy $5 $2 Nop is identity: GFPN of WINDIR is already the long form.',
  159: 'WINDIR empty-$5 Nop is identity: a successful deny GLP never writes empty.',
  171: 'PROGRAMFILES GLP 0-check Nop is identity: fail empties scratch; the empty $5 check still fail-closes.',
  174: 'PROGRAMFILES empty-$5 Nop is identity: a successful deny GLP never writes empty.',
  186: 'PROGRAMFILES64 GLP 0-check Nop is identity: fail empties scratch; the empty $5 check still fail-closes.',
  188: 'PROGRAMFILES64 StrCpy $5 $2 Nop is identity: GFPN is already the long form.',
  189: 'PROGRAMFILES64 empty-$5 Nop is identity: a successful deny GLP never writes empty.',
  205: 'APPDATA empty-$5 (success) Nop is identity: GFPN/GLP of APPDATA is never empty.',
  // :208 unlisted — PATH_NOT_FOUND (3) + helper GFA fail still deletes; Nop errno-3 deny-skips.
  209: 'APPDATA other-error Goto Nop is identity: APPDATA GLP succeeds so the fail block is unused.',
  // :201 / :202 / :207 unlisted — S-19 AppData leftover errno-2 rows (Documents vault still
  // deletes; INVALID-GFA descendant still deletes) read $8 / take the +5 fail block / take errno-2.
  // :210 unlisted — S-19 existence helper Nop falls into H3 with GFPN on a spurious errno-2 vault.
  // :233 unlisted — Documents allow GLP oversize (required size > NSIS_MAX_STRLEN) keep + tgt3/Nop red.
  235: 'Documents empty-$5 (success) Nop is identity: Documents GLP is never empty.',
  // :238 unlisted — PATH_NOT_FOUND (3) + helper GFA fail still deletes; Nop errno-3 deny-skips.
  239: 'Documents other-error Goto Nop is identity: Documents GLP succeeds so the fail block is unused.',
  // :232 / :237 unlisted — Documents allow GLP 1st-call fault still deletes; Nop 0-check / errno-2 skips that vault.
  // :240 unlisted — S-19 existence helper Nop falls into H3 with GFPN on a spurious errno-2 vault.
  // :263 unlisted — Desktop allow GLP oversize (required size > NSIS_MAX_STRLEN) keep + tgt3/Nop red.
  265: 'Desktop empty-$5 (success) Nop is identity: Desktop GLP is never empty on success.',
  // :268 unlisted — PATH_NOT_FOUND (3) + helper GFA fail still deletes; Nop errno-3 deny-skips.
  269: 'Desktop other-error Goto Nop is identity: access-denied rows skip before this Nop changes the set.',
  // :262 / :267 unlisted — Desktop allow GLP 1st-call fault still deletes; Nop 0-check / errno-2 skips that vault.
  // :270 unlisted — S-19 existence helper Nop falls into H3 with GFPN on a spurious errno-2 vault.
  // :293 unlisted — Downloads allow GLP oversize (required size > NSIS_MAX_STRLEN) keep + tgt3/Nop red.
  295: 'Downloads empty-$5 (success) Nop is identity: Downloads GLP is never empty on success.',
  // :298 unlisted — errno-3 + helper GFA fail still-deletes; Nop errno-3 deny-skips.
  299: 'Downloads other-error Goto Nop is identity when Downloads GLP succeeds.',
  // :300 unlisted — S-19 Downloads existence helper Nop falls into H3 with GFPN.
  322: 'Canon $3 GLP 0-check Nop is identity: fail empties scratch; the empty $3 check still fail-closes.',
  325: 'Canon $3 empty Nop is identity: a successful GLP never writes empty.',
  333: 'Canon $9 GLP 0-check Nop is identity: fail empties scratch; the empty $9 check still fail-closes.',
  // :334 unlisted — canon $9 GLP oversize (required size > NSIS_MAX_STRLEN) keep + tgt3/Nop red.
  335: 'Canon $9 StrCpy $9 $2 Nop is identity: GFPN of the matched root is already the long form.',
  336: 'Canon $9 empty Nop is identity: a successful GLP never writes empty.',
  368: 'Nested AppData empty $9 Nop is identity: AppData nested GLP is never empty.',
  371: 'Nested AppData errno-3 Nop is identity: AppData nested GLP does not miss with 3.',
  // :373 unlisted — S-19 existence helper Nop falls into H3 with GFPN on a spurious errno-2 vault.
  394: 'Nested Documents empty $9 Nop is identity.',
  // :397 unlisted — nested Documents PATH_NOT_FOUND (3) + helper GFA fail still deletes; Nop errno-3 deny-skips.
  // :399 unlisted — S-19 nested Documents existence helper Nop falls into H3 with GFPN.
  420: 'Nested Desktop empty $9 Nop is identity.',
  // :423 unlisted — nested Desktop PATH_NOT_FOUND (3) + helper GFA fail still deletes; Nop errno-3 deny-skips.
  // :425 unlisted — S-19 nested Desktop existence helper Nop falls into H3 with GFPN.
  446: 'Nested Downloads empty $9 Nop is identity.',
  // :451 unlisted — S-19 nested Downloads existence helper Nop falls into H3 with GFPN.
  504: 'Scan default StrCpy $6 $3 Nop is identity: allowlist leftover $6 is the suffix that still carries the dangerous tail.',
  506: 'StrCpy $6 $5 Nop is identity: nested 9* hooks still scan $9.',
  513: 'IntCmp $7 0 Nop is identity: fixtures never have `\\` at index 0.',
};

/**
 * 12 equivalents that hold by Win32 / NSIS System-plugin contract, not by fixture length.
 * GLP failure copies an empty dest (so a later empty-check still fail-closes); a successful
 * GLP never writes empty (so the empty-check Nop is unused on the success path).
 */
export const SIDECAR_GUARD_SWEEP_API_CONTRACT_EQUIVALENTS: Readonly<Record<number, string>> = {
  144: 'API: GetLongPathNameW failure empties $2; Nop of the 0-check still hits the empty-$3 fail-close.',
  147: 'API: successful GetLongPathNameW never writes empty; Nop of empty-$3 is unused on the success path.',
  156: 'API: WINDIR GLP failure empties scratch; empty-$5 still fail-closes.',
  159: 'API: successful WINDIR GLP never writes empty.',
  171: 'API: PROGRAMFILES GLP failure empties scratch; empty-$5 still fail-closes.',
  174: 'API: successful PROGRAMFILES GLP never writes empty.',
  186: 'API: PROGRAMFILES64 GLP failure empties scratch; empty-$5 still fail-closes.',
  189: 'API: successful PROGRAMFILES64 GLP never writes empty.',
  322: 'API: canon $3 GLP failure empties scratch; empty-$3 still fail-closes.',
  325: 'API: successful canon $3 GLP never writes empty.',
  333: 'API: canon $9 GLP failure empties scratch; empty-$9 still fail-closes.',
  336: 'API: successful canon $9 GLP never writes empty.',
};

/** Forge RESULT_97be (29) + RESULT_36d2 (33) + RESULT_8329 (:286). Mode 2 must catch each primary Nop. */
export const SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS: readonly number[] = [
  143, 152, 153, 155, 157, 168, 169, 170, 172, 183, 184, 185, 187, 198, 199, 201, 202, 203, 207, 210, 228, 229, 240, 258, 259, 260, 270, 288, 289,
  290, 298, 319, 320, 330, 331, 332, 361, 362, 363, 364, 366, 370, 373, 387, 388, 390, 391, 392, 396, 398, 413, 414, 415, 416,
  417, 418, 422, 424, 439, 440, 442, 443, 444, 448, 449, 450,
  300, 376, 378, 399, 402, 425, 451, 454,
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

/**
 * S-19 fallback helpers :542–:582. Primary Nop / label_rename. Listed lines are
 * identity on the VM tables; unlisted lines are killed by a named HARD-A / S-19 row.
 */
export const SIDECAR_FALLBACK_SWEEP_EQUIVALENTS: Readonly<Record<number, string>> = {
  542: 'Barrier Goto Nop is unreachable: :541 already Goto uninstall_vault_read. Two-mutation (smash $2 + Nop :541) is still blocked by this line remaining.',
  544: 'API: allow-list GFPN writes $5 even on failure, and GFPN-zero already fail-closed, so fb_5a is reached only with non-empty $5. StrCmp-empty Nop is unused.',
  549: 'API: Documents leftover GFPN writes $5 even on failure; GFPN-zero already fail-closed. fb_5d StrCmp-empty Nop is unused.',
  554: 'API: Desktop leftover GFPN writes $5 even on failure; GFPN-zero already fail-closed. fb_5k StrCmp-empty Nop is unused.',
  559: 'API: nested AppData GFPN writes $9 even on failure; GFPN-zero already fail-closed. fb_9a StrCmp-empty Nop is unused.',
  564: 'API: Downloads leftover GFPN writes $5 even on failure; GFPN-zero already fail-closed. fb_5l StrCmp-empty Nop is unused.',
  569: 'API: nested Documents GFPN writes $9 even on failure; GFPN-zero already fail-closed. fb_9d StrCmp-empty Nop is unused.',
  574: 'API: nested Desktop GFPN writes $9 even on failure; GFPN-zero already fail-closed. fb_9k StrCmp-empty Nop is unused.',
  579: 'API: nested Downloads GFPN writes $9 even on failure; GFPN-zero already fail-closed. fb_9l StrCmp-empty Nop is unused.',
  562: 'fb_9a valid-leftover Goto uninstall_vault_read Nop is identity: fall-through enters fb_5l with $5 still the existing AppData leftover, which Goto al_deny — same keep.',
  572: 'fb_9d valid-leftover Goto uninstall_vault_read Nop is identity: fall-through enters fb_9k with $9 still the existing Documents leftover, which Goto uninstall_vault_read — same keep.',
  577: 'fb_9k valid-leftover Goto uninstall_vault_read Nop is identity: fall-through enters fb_9l with $9 still the existing Desktop leftover, which Goto uninstall_vault_read — same keep.',
  582: 'fb_9l valid-leftover Goto uninstall_vault_read Nop is identity: fall-through is uninstall_vault_close. The sidecar delete set is unchanged — the vault was already fail-closed, and FileClose does not RMDir it.',
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

    it('fixture-claim MAX / errno-3 Nops are now killed (oversize or PATH_NOT_FOUND rows)', () => {
      for (const fileLine of [145, 208, 233, 238, 263, 268, 293, 323, 334, 397, 423]) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeUndefined();
      }
      for (const fileLine of [320, 331, 362, 388, 414, 418, 440, 444]) {
        expect(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES[fileLine], `:${fileLine}`).toBeUndefined();
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
