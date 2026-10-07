import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
} from './sidecarTraversalScan.test-helpers.js';
import {
  generateOracleClassMutants,
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
  type OracleClassMutant,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Forge freeze bar in CI: every oracle-class mutant (gen.py port) of :43–:127 is either caught by the
 * pin-free mode-2 VM tables or behaves exactly like canonical on Forge's full oracle corpus. A mutant
 * that changes behaviour and survives the tables is a non-equivalent survivor and fails its line.
 */
describe('oracle-class mutant sweep :43-:127 (Forge gen.py classes, pin-free VM tables)', () => {
  const nsh = loadUninstallVaultsNsh();
  const corpus = sidecarGuardOracleCorpus();
  const canonicalOutcomes = corpus.map((c) => sidecarGuardCaseOutcome(nsh, c));
  const byLine = new Map<number, OracleClassMutant[]>();
  for (const mutant of generateOracleClassMutants(nsh)) {
    byLine.set(mutant.fileLine, [...(byLine.get(mutant.fileLine) ?? []), mutant]);
  }

  it('negative control — canonical is not caught, so a caught verdict carries information', () => {
    expect(sidecarGuardModeTwoCaught(nsh, nsh)).toBe(false);
  });

  for (
    let fileLine = SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
    fileLine <= SIDECAR_GUARD_REGION_FILE_LINE_LAST;
    fileLine += 1
  ) {
    it(`line :${fileLine} — no non-equivalent survivor among its oracle-class mutants`, () => {
      const mutants = byLine.get(fileLine) ?? [];
      expect(mutants.length).toBeGreaterThan(0);
      let caught = 0;
      const nonEquivalentSurvivors: string[] = [];
      for (const mutant of mutants) {
        if (sidecarGuardModeTwoCaught(mutant.nsh, nsh)) {
          caught += 1;
          continue;
        }
        const diverged = corpus.findIndex(
          (c, i) => sidecarGuardCaseOutcome(mutant.nsh, c) !== canonicalOutcomes[i],
        );
        if (diverged >= 0) {
          nonEquivalentSurvivors.push(`${mutant.key} @ ${JSON.stringify(corpus[diverged]!.reads)}`);
        }
      }
      expect(nonEquivalentSurvivors).toEqual([]);
      // Every guard line has at least one behaviour-changing mutant, so an always-false detector fails here.
      expect(caught).toBeGreaterThan(0);
    });
  }
});
