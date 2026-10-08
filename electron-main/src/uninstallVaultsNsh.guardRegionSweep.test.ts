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
  153: 'StrCmp $1 $5 uninstall_vault_read → Nop (old :127, APPDATA root self-match). Sibling: :154–:155 — the exact root has no `\\` at $5 length, so it falls to not_appdata and is denied.',
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
  165: 'StrCmp $1 $5 uninstall_vault_read → Nop (Documents root self-match). Sibling: :166–:167 — the exact root has no `\\` at $5 length, so it falls to not_documents and is denied.',
  177: 'StrCmp $1 $5 uninstall_vault_read → Nop (Desktop root self-match). Sibling: :178–:179 — the exact root has no `\\` at $5 length, so it falls to not_desktop and is denied.',
  189: 'StrCmp $1 $5 uninstall_vault_read → Nop (Downloads root self-match). Sibling: :190–:191 — the exact root has no `\\` at $5 length, so it falls to mythos_al_deny.',
};

/** RF-7 walk / HARD-2 lines whose primary mutant does not change the delete set. */
export const SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS: Readonly<Record<number, string>> = {
  215: 'StrCpy $7 $9 → Nop. Restore then uses leftover $7 (trav end index); walk starts a few chars in and still hits every `\\`.',
  219: 'StrLen $8 $3 (strip) → Nop. $8 is only read when the last char is `\\`; the gate leftover is long enough for those rows.',
  220: 'IntCmp $8 3 (keep C:\\) → Nop. Fixture trailing-`\\` paths are longer than 3, so one strip still lands on the root.',
  222: 'Goto mythos_nr_strip → Nop. GFPN leaves at most one trailing `\\`; one strip is enough.',
  226: 'AppData GFPN 0-return → Nop. The model never returns 0 on these roots.',
  227: 'AppData GFPN trunc → Nop. The model never truncates these roots.',
  237: 'Documents GFPN 0-return → Nop. The model never returns 0 on these roots.',
  238: 'Documents GFPN trunc → Nop. The model never truncates these roots.',
  240: 'Documents ancestor StrLen → Nop. $8 already holds StrLen $3 from the AppData ancestor check.',
  241: 'Documents ancestor prefix copy → Nop. No fixture path is a proper ancestor of $DOCUMENTS after the equal check.',
  242: 'Documents ancestor prefix cmp → Nop. Same: the equal check already covers the Documents root.',
  243: 'Documents ancestor sep copy → Nop. Dead with :241/:242.',
  244: 'Documents ancestor sep cmp → Nop. Dead with :241/:242.',
  248: 'Desktop GFPN 0-return → Nop. The model never returns 0 on these roots.',
  249: 'Desktop GFPN trunc → Nop. The model never truncates these roots.',
  251: 'Desktop ancestor StrLen → Nop. $8 already holds StrLen $3.',
  252: 'Desktop ancestor prefix copy → Nop. No fixture path is a proper ancestor of $DESKTOP after the equal check.',
  253: 'Desktop ancestor prefix cmp → Nop. Same: the equal check already covers the Desktop root.',
  254: 'Desktop ancestor sep copy → Nop. Dead with :252/:253.',
  255: 'Desktop ancestor sep cmp → Nop. Dead with :252/:253.',
  259: 'Downloads GFPN 0-return → Nop. The model never returns 0 on these roots.',
  260: 'Downloads GFPN trunc → Nop. The model never truncates these roots.',
  262: 'Downloads ancestor StrLen → Nop. $8 already holds StrLen $3.',
  263: 'Downloads ancestor prefix copy → Nop. No fixture path is a proper ancestor of Downloads after the equal check.',
  264: 'Downloads ancestor prefix cmp → Nop. Same: the equal check already covers the Downloads root.',
  265: 'Downloads ancestor sep copy → Nop. Dead with :263/:264.',
  266: 'Downloads ancestor sep cmp → Nop. Dead with :263/:264.',
  268: 'StrCpy $9 $7 → Nop. $9 stays the Downloads GFPN; walk start is a few chars in and still hits every `\\`.',
  269: 'Goto mythos_reparse_walk → Nop. The next line is the walk label.',
  272: 'IntOp $7 $8 + 1 → +2. The walk still hits every `\\` after the root; only the first letter of the first child is skipped.',
  277: 'IntOp $7 $7 + 1 → +2 (scan increment). A skipped letter inside a component still finds the same next `\\`.',
  278: 'Goto mythos_reparse_next → Nop. Falls into the hit path and GetFileAttributesW every prefix; extra checks still see 0x10 and continue.',
  285: 'IntOp $7 $7 + 1 → +2 (after a hit). The next `\\` is still found; every ancestor prefix is still checked.',
  292: 'Goto uninstall_vault_do_delete → Nop. The next line is the do_delete label, so control falls through to the same IfFileExists.',
};

export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF456_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_RF7_EQUIVALENTS,
};

describe('sidecar guard region sweep :43-:299 (buildIntegrity excluded)', () => {
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

    it('equivalence-strength shards cover every documented equivalent line', () => {
      const sharded = [
        47, 56, 61, 84, 97, 98, 99, 103, 104, 105, 106, 109, 117, 123, 124, 125, 129, 130, 131, 153, 165, 177, 189,
        215, 219, 220, 222, 226, 227, 237, 238, 240, 241, 242, 243, 244, 248, 249, 251, 252, 253, 254, 255, 259, 260,
        262, 263, 264, 265, 266, 268, 269, 272, 277, 278, 285, 292,
      ];
      expect(sharded).toEqual(
        Object.keys(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES)
          .map(Number)
          .sort((a, b) => a - b),
      );
    });
  });
});
