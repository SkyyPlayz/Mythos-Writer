import { describe, expect, it } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import { mutantSidecarGuardRegionSweepLine } from './sidecarTraversalScan.test-helpers.js';
import { SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES } from './uninstallVaultsNsh.guardRegionSweep.test.js';
import {
  generateOracleClassMutants,
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
  type OracleClassMutant,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Strength-shard slices were 20–33s against the 30s default (same class as the 9802a5c3
 * unit timeout). One mutant per test and a raised timeout on every slice — never drop a
 * case. File shards give the 20-minute unit job wall-clock room.
 */
export const ORACLE_CLASS_SWEEP_TEST_TIMEOUT_MS = 60_000;

/**
 * Documented mode-2 equivalents. The primary Nop is checked by mode 2 (and, for the
 * strength-sharded subset, by the 12k corpus shards). Oracle-class does not walk the
 * 12k corpus: each uncaught mutant × 12,617 cases on the longer H1/HARD-A program
 * cancelled the unit job at 20 minutes (run 37878884585).
 */
const ORACLE_CLASS_ALL_EQUIVALENT_LINES: ReadonlySet<number> = new Set(
  Object.keys(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES).map((n) => Number(n)),
);

/** Register the per-line oracle-class sweep for `[lineFirst, lineLast]` inclusive. */
export function registerOracleClassLineSweep(lineFirst: number, lineLast: number): void {
  describe(
    `oracle-class mutant sweep :${lineFirst}-:${lineLast} (Forge gen.py classes, pin-free VM tables)`,
    () => {
      const nsh = loadUninstallVaultsNsh();
      const byLine = new Map<number, OracleClassMutant[]>();
      for (const mutant of generateOracleClassMutants(nsh)) {
        if (mutant.fileLine < lineFirst || mutant.fileLine > lineLast) {
          continue;
        }
        byLine.set(mutant.fileLine, [...(byLine.get(mutant.fileLine) ?? []), mutant]);
      }

      it('negative control — canonical is not caught, so a caught verdict carries information', () => {
        expect(sidecarGuardModeTwoCaught(nsh, nsh)).toBe(false);
      });

      for (let fileLine = lineFirst; fileLine <= lineLast; fileLine += 1) {
        if (ORACLE_CLASS_ALL_EQUIVALENT_LINES.has(fileLine)) {
          continue;
        }
        const mutants = byLine.get(fileLine) ?? [];
        it(
          `line :${fileLine} — at least one oracle-class mutant is caught`,
          () => {
            expect(mutants.length).toBeGreaterThan(0);
            expect(mutants.some((mutant) => sidecarGuardModeTwoCaught(mutant.nsh, nsh))).toBe(true);
          },
          ORACLE_CLASS_SWEEP_TEST_TIMEOUT_MS,
        );
      }
    },
  );
}

/**
 * Equivalence-strength corpus check for documented mode-2 primaries. Split across files so
 * vitest workers share the restored 12,617-case scans. Each line still sees every case.
 */
export function registerGuardRegionEquivSweep(lines: readonly number[]): void {
  describe(
    `mode (2) equivalence strength :${lines[0]}-:${lines[lines.length - 1]} — identical outcome on the full oracle corpus`,
    () => {
      const nsh = loadUninstallVaultsNsh();
      const corpus = sidecarGuardOracleCorpus();
      const canonicalOutcomes = corpus.map((c) => sidecarGuardCaseOutcome(nsh, c));
      /** Slice the restored full corpus so each test stays under the 30s default with ~50% headroom. */
      const CORPUS_SLICE = 2000;

      for (const fileLine of lines) {
        for (let start = 0; start < corpus.length; start += CORPUS_SLICE) {
          const slice = corpus.slice(start, start + CORPUS_SLICE);
          const end = start + slice.length;
          const suffix = corpus.length <= CORPUS_SLICE ? '' : ` corpus [${start}..${end})`;
          it(
            `line :${fileLine} primary matches canonical on every oracle corpus case${suffix}`,
            () => {
              const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
              slice.forEach((c, j) => {
                const i = start + j;
                expect(sidecarGuardCaseOutcome(mutant, c), `outcome diverged at ${JSON.stringify(c.reads)}`).toBe(
                  canonicalOutcomes[i],
                );
              });
            },
            ORACLE_CLASS_SWEEP_TEST_TIMEOUT_MS,
          );
        }
      }
    },
  );
}
