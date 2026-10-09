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
 * miss fails mode 2, and the strength block re-checks identity on Forge's full oracle corpus.
 * Each reason names the line it had before RF-4/5/6 moved the region (`old :N`).
 */
export const SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS: Readonly<Record<number, string>> = {
  56: 'StrCmp $1 "" uninstall_vault_read → Nop (old :52). The RF-6 loop head :47 already skipped an empty line; an empty path matches no allowlist root anyway (mythos_al_deny).',
  97: 'StrCmp $4 "" uninstall_vault_read → Nop (old :71, backslash `\\.`+EOF). Sibling: :137 trav_ok tail rejects a path ending in `.`.',
  98: 'StrCmp $4 "\\" uninstall_vault_read → Nop (old :72, `\\.\\`). Sibling: :87 rejects the next `\\` whose preceding char is `.`.',
  109: 'StrCmp $7 "0" +5 → Nop (old :83, forward pos-0 skip). A `/` at pos 0 then reads $8=-1 (the last char); every path that read can reject already fails the :137–:139 tail check.',
  186: 'StrCmp $3 $5 uninstall_vault_read → Nop (old :153, APPDATA root self-match). Sibling: the exact root has no `\\` at $8 length, so it falls to not_appdata and is denied.',
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
  240: 'StrCmp $3 $5 uninstall_vault_read → Nop (Downloads root self-match). Sibling: the exact root has no `\\` at $8 length, so it falls to mythos_al_deny.',
};

/**
 * RF-7 walk / leftover-`/` primaries that the 12,617-case strength shards still scan.
 * GFPN/GLP no-ops stay in {@link SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS}: the model
 * never returns 0 or truncates on the corpus, and ~50 extra lines × 7 slices blew the
 * 20-minute unit job.
 */
export const SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS: Readonly<Record<number, string>> = {
  272: 'StrCpy $7 $9 → Nop. Restore then uses leftover $7; walk still hits every `\\`.',
  276: 'StrLen $8 $3 (strip) → Nop. $8 is only read when the last char is `\\`.',
  277: 'IntCmp $8 3 (keep C:\\) → Nop. Fixture trailing-`\\` paths are longer than 3.',
  279: 'Goto mythos_nr_strip → Nop. GFPN leaves at most one trailing `\\`.',
  337: 'StrCpy $9 $7 → Nop. $9 stays the last GFPN; walk start is a few chars in and still hits every `\\`.',
  338: 'Goto mythos_reparse_walk → Nop. The next line is the walk label.',
  341: 'IntOp $7 $8 + 1 → Nop. Walk from 0 still GetFileAttributesW every prefix and the leaf.',
  347: 'Goto mythos_reparse_next → Nop. Falls into hit and still GetFileAttributesW the current prefix.',
  354: 'IntOp $7 $7 + 1 → +2 (after a hit). The next `\\` is still found.',
  361: 'Goto uninstall_vault_do_delete → Nop. Falls through to the leftover-/ scan and IfFileExists.',
  363: 'StrCpy $7 0 (leftover-/ scan) → Nop. Walk left $7 at end-of-$3.',
  365: 'StrCpy $6 $3 1 $7 → Nop. Leftover $6 from the walk leaf is "".',
  367: 'StrCmp $6 "/" uninstall_vault_read → Nop. GFPN has already folded / to \\.',
  368: 'IntOp $7 $7 + 1 → +2 (leftover-/ scan). GFPN left no / to reject.',
  369: 'Goto mythos_canon_slash → Nop. Falls into slash_ok; GFPN left no / to reject.',
};

/**
 * GFPN/GLP / nested exact-root / ancestor-copy Nops. Mode 2 still requires them uncaught
 * (already-canonical roots, model-never-fails, allowlist already skipped). Not strength-sharded.
 */
export const SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS: Readonly<Record<number, string>> = {
  143: 'line GLP Call → Nop. The canon-gate GLP expands 8.3 again.',
  144: 'line GLP 0-return → Nop. The model never returns 0 on these paths.',
  145: 'line GLP trunc → Nop. The model never truncates these paths.',
  147: 'WINDIR GFPN Call → Nop. $5 is already the expanded $WINDIR.',
  150: 'WINDIR GLP Call → Nop. $WINDIR is already long form.',
  151: 'WINDIR GLP 0-return → Nop.',
  152: 'WINDIR GLP trunc → Nop.',
  158: 'PROGRAMFILES GFPN 0-return → Nop.',
  159: 'PROGRAMFILES GFPN trunc → Nop.',
  160: 'PROGRAMFILES GLP Call → Nop. $PROGRAMFILES is already long form.',
  161: 'PROGRAMFILES GLP 0-return → Nop.',
  162: 'PROGRAMFILES GLP trunc → Nop.',
  168: 'PROGRAMFILES64 GFPN 0-return → Nop.',
  169: 'PROGRAMFILES64 GFPN trunc → Nop.',
  170: 'PROGRAMFILES64 GLP Call → Nop. $PROGRAMFILES64 is already long form.',
  171: 'PROGRAMFILES64 GLP 0-return → Nop.',
  172: 'PROGRAMFILES64 GLP trunc → Nop.',
  178: 'APPDATA allow GFPN 0-return → Nop.',
  179: 'APPDATA allow GFPN trunc → Nop.',
  181: 'APPDATA allow GLP 0-return → Nop.',
  182: 'APPDATA allow GLP trunc → Nop.',
  196: 'Documents allow GFPN 0-return → Nop.',
  197: 'Documents allow GFPN trunc → Nop.',
  199: 'Documents allow GLP 0-return → Nop.',
  200: 'Documents allow GLP trunc → Nop.',
  204: 'Documents prefix StrCmp → Nop. No oracle path becomes a false Documents child.',
  214: 'Desktop allow GFPN 0-return → Nop.',
  215: 'Desktop allow GFPN trunc → Nop.',
  216: 'Desktop allow GFPN Call → Nop. $DESKTOP is already canonical.',
  217: 'Desktop allow GLP 0-return → Nop.',
  218: 'Desktop allow GLP trunc → Nop.',
  222: 'Desktop prefix StrCmp → Nop. No oracle path becomes a false Desktop child.',
  232: 'Downloads allow GFPN 0-return → Nop.',
  233: 'Downloads allow GFPN trunc → Nop.',
  234: 'Downloads allow GFPN Call → Nop. $PROFILE\\Downloads already matches GFPN.',
  235: 'Downloads allow GLP 0-return → Nop.',
  236: 'Downloads allow GLP trunc → Nop.',
  251: 'canon path GFPN 0-return → Nop.',
  252: 'canon path GFPN trunc → Nop.',
  254: 'canon path GLP 0-return → Nop.',
  255: 'canon path GLP trunc → Nop.',
  257: 'canon root GFPN 0-return → Nop.',
  258: 'canon root GFPN trunc → Nop.',
  259: 'canon root GLP Call → Nop. The allowlist already long-expanded $5.',
  260: 'canon root GLP 0-return → Nop.',
  261: 'canon root GLP trunc → Nop.',
  283: 'AppData nested GFPN 0-return → Nop.',
  284: 'AppData nested GFPN trunc → Nop.',
  285: 'AppData nested GLP Call → Nop. $APPDATA\\Mythos Writer is already long form.',
  286: 'AppData nested GLP 0-return → Nop.',
  287: 'AppData nested GLP trunc → Nop.',
  288: 'AppData nested exact-root StrCmp → Nop. Allowlist already skipped the exact AppData root.',
  297: 'Documents nested GFPN 0-return → Nop.',
  298: 'Documents nested GFPN trunc → Nop.',
  299: 'Documents nested GLP Call → Nop. $DOCUMENTS is already long form.',
  300: 'Documents nested GLP 0-return → Nop.',
  301: 'Documents nested GLP trunc → Nop.',
  302: 'Documents nested exact-root StrCmp → Nop. Allowlist already skipped the exact Documents root.',
  303: 'Documents ancestor StrLen → Nop. $8 already holds StrLen $3.',
  305: 'Documents ancestor sep-char copy → Nop. $6 is not `\\` on the HARD-C fixtures.',
  311: 'Desktop nested GFPN 0-return → Nop.',
  312: 'Desktop nested GFPN trunc → Nop.',
  313: 'Desktop nested GLP Call → Nop. $DESKTOP is already long form.',
  314: 'Desktop nested GLP 0-return → Nop.',
  315: 'Desktop nested GLP trunc → Nop.',
  317: 'Desktop ancestor StrLen → Nop.',
  319: 'Desktop ancestor sep-char copy → Nop. $6 is not `\\` on the HARD-C fixtures.',
  325: 'Downloads nested GFPN 0-return → Nop.',
  326: 'Downloads nested GFPN trunc → Nop.',
  327: 'Downloads nested GLP Call → Nop. $PROFILE\\Downloads is already long form.',
  328: 'Downloads nested GLP 0-return → Nop.',
  329: 'Downloads nested GLP trunc → Nop.',
  331: 'Downloads ancestor StrLen → Nop.',
  333: 'Downloads ancestor sep-char copy → Nop. $6 is not `\\` on the HARD-C fixtures.',
};

/** RF-7 walk / HARD-2 / HARD-A fail-closed lines whose primary Nop does not change the delete set. */
export const SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_RF7_STRENGTH_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF7_MODE2_ONLY_EQUIVALENTS,
};

/** Lines the equivalence-strength shards must cover (Ivy + extended + RF-4/5/6 + RF-7 walk). */
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

describe('sidecar guard region sweep :43-:376 (buildIntegrity excluded)', () => {
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
        47, 56, 61, 84, 97, 98, 99, 103, 104, 105, 106, 109, 117, 123, 124, 125, 129, 130, 131, 186, 240, 272, 276,
        277, 279, 337, 338, 341, 347, 354, 361, 363, 365, 367, 368, 369,
      ];
      expect(sharded).toEqual(
        Object.keys(SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES)
          .map(Number)
          .sort((a, b) => a - b),
      );
    });
  });
});
