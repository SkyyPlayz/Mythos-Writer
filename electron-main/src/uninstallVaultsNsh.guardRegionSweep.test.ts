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
import {
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Behaviour-equivalent mode-2 primaries (the `Nop` fallback on each of these lines). A sibling check
 * already rejects every path the line rejects, so the mutant deletes exactly what canonical deletes;
 * Forge's oracle agrees (`N:nop` is behaviour-non-changing on its full corpus). Every other surviving
 * mutant class on a listed line is equivalent too, enforced per line by the oracle-class sweep; the
 * stricter literal swaps on :71–:73 / :77–:79 / :97–:99 / :103–:105 are killed by
 * TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS.
 *
 * The list must be exact: a listed line that the VM tables catch fails mode 2, an unlisted line they
 * miss fails mode 2, and the strength block re-checks identity on Forge's full oracle corpus.
 */
export const SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS: Readonly<Record<number, string>> = {
  52: 'StrCmp $1 "" uninstall_vault_read → Nop. Empty trimmed line: skipped either way; an empty path matches no allowlist root (mythos_al_deny).',
  71: 'StrCmp $4 "" uninstall_vault_read → Nop (backslash `\\.`+EOF). Sibling: :111 trav_ok tail rejects a path ending in `.`.',
  72: 'StrCmp $4 "\\" uninstall_vault_read → Nop (`\\.\\`). Sibling: :61 rejects the next `\\` whose preceding char is `.`.',
  83: 'StrCmp $7 "0" +5 → Nop (forward pos-0 skip). A `/` at pos 0 then reads $8=-1; every path that read can reject already fails the :111–:113 tail check.',
  127: 'StrCmp $1 $5 uninstall_vault_read → Nop (APPDATA root self-match). Sibling: :128–:129 — the exact root has no `\\` at $5 length, so it falls to not_appdata and is denied.',
};

/**
 * Additional proven-equivalent primaries beyond Ivy's locked 5 (reported as a per-line table in
 * PROOF). Every entry is a post-S16 redundant `.`/`..` reject or the backslash pos-0 skip, covered
 * by a sibling S16 prev-char check (:61 before `\\`, :86 before `/`) or the trav_ok tail (:111).
 */
export const SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS: Readonly<Record<number, string>> = {
  58: 'StrCmp $7 "0" +5 → Nop (backslash pos-0 skip). A `\\` at pos 0 then reads $8=-1; every path that read can reject already fails the :111–:113 tail check.',
  73: 'StrCmp $4 "/" uninstall_vault_read → Nop (`\\./`). Sibling: :86 rejects the `/` whose preceding char is `.`.',
  77: 'StrCmp $4 "" uninstall_vault_read → Nop (`\\..`+EOF). Sibling: :111 trav_ok tail rejects a trailing `.`.',
  78: 'StrCmp $4 "\\" uninstall_vault_read → Nop (`\\..\\`). Sibling: :61 rejects the next `\\` preceded by `.`.',
  79: 'StrCmp $4 "/" uninstall_vault_read → Nop (`\\../`). Sibling: :86 rejects the `/` preceded by `.`.',
  80: 'Goto mythos_trav_inc → Nop. Falls into mythos_trav_fwd:, whose `StrCmp $4 "/" 0 mythos_trav_inc` takes inc: $4 (char after `\\..`) is never `/` here, :79 already rejected it.',
  97: 'StrCmp $4 "" uninstall_vault_read → Nop (`/.`+EOF). Sibling: :111 trav_ok tail rejects a trailing `.`.',
  98: 'StrCmp $4 "/" uninstall_vault_read → Nop (`/./`). Sibling: :86 rejects the `/` preceded by `.`.',
  99: 'StrCmp $4 "\\" uninstall_vault_read → Nop (`/.\\`). Sibling: :61 rejects the `\\` preceded by `.`.',
  103: 'StrCmp $4 "" uninstall_vault_read → Nop (`/..`+EOF). Sibling: :111 trav_ok tail rejects a trailing `.`.',
  104: 'StrCmp $4 "/" uninstall_vault_read → Nop (`/../`). Sibling: :86 rejects the `/` preceded by `.`.',
  105: 'StrCmp $4 "\\" uninstall_vault_read → Nop (`/..\\`). Sibling: :61 rejects the `\\` preceded by `.`.',
};

export const SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES: Readonly<Record<number, string>> = {
  ...SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS,
  ...SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS,
};

const ORACLE_CORPUS = sidecarGuardOracleCorpus();

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

    it('equivalence control — MB1 retargets the Ivy-locked :72 reject to inc; :61 masks it, so it stays uncaught', () => {
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
          Object.keys(SIDECAR_GUARD_SWEEP_EXTENDED_EQUIVALENTS).length,
      );
    });
  });

  describe('mode (2) equivalence strength — identical outcome on the full oracle corpus', () => {
    const canonicalOutcomes = ORACLE_CORPUS.map((c) => sidecarGuardCaseOutcome(nsh, c));

    for (const fileLineStr of Object.keys(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES)) {
      const fileLine = Number(fileLineStr);
      const locked = SIDECAR_GUARD_SWEEP_IVY_LOCKED_EQUIVALENTS[fileLine] ? 'Ivy-locked' : 'extended';
      it(`line :${fileLine} (${locked}) primary matches canonical on every oracle corpus case`, () => {
        const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
        ORACLE_CORPUS.forEach((c, i) => {
          expect(sidecarGuardCaseOutcome(mutant, c), `outcome diverged at ${JSON.stringify(c.reads)}`).toBe(
            canonicalOutcomes[i],
          );
        });
      });
    }
  });
});
