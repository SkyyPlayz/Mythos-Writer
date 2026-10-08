import { describe, expect, it } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  generateOracleClassMutants,
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
  type OracleClassMutant,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * :47 / :56 / :117 were 20–33s against the 30s default (same class as the 9802a5c3 unit timeout).
 * One mutant per test and a raised timeout on those lines only. Other lines are sliced so each
 * test stays well under the limit (~50% headroom). Checks are unchanged.
 *
 * The line range is split across test files so vitest file workers actually parallelize the
 * CPU-bound corpus scans (`it.concurrent` does not help synchronous work).
 */
export const ORACLE_CLASS_HEAVY_SWEEP_LINES = new Set([47, 56, 117]);
export const ORACLE_CLASS_HEAVY_SWEEP_TEST_TIMEOUT_MS = 60_000;
const HEAVY_SWEEP_CHUNK = 1;
const DEFAULT_SWEEP_CHUNK = 2;

const chunkMutants = (mutants: OracleClassMutant[], size: number): OracleClassMutant[][] => {
  const chunks: OracleClassMutant[][] = [];
  for (let i = 0; i < mutants.length; i += size) {
    chunks.push(mutants.slice(i, i + size));
  }
  return chunks;
};

/** Register the per-line oracle-class sweep for `[lineFirst, lineLast]` inclusive. */
export function registerOracleClassLineSweep(lineFirst: number, lineLast: number): void {
  describe(
    `oracle-class mutant sweep :${lineFirst}-:${lineLast} (Forge gen.py classes, pin-free VM tables)`,
    () => {
      const nsh = loadUninstallVaultsNsh();
      const corpus = sidecarGuardOracleCorpus();
      const canonicalOutcomes = corpus.map((c) => sidecarGuardCaseOutcome(nsh, c));
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
        const mutants = byLine.get(fileLine) ?? [];
        const heavy = ORACLE_CLASS_HEAVY_SWEEP_LINES.has(fileLine);
        const chunks = chunkMutants(mutants, heavy ? HEAVY_SWEEP_CHUNK : DEFAULT_SWEEP_CHUNK);
        const timeout = heavy ? ORACLE_CLASS_HEAVY_SWEEP_TEST_TIMEOUT_MS : undefined;
        chunks.forEach((chunk, idx) => {
          const label =
            chunks.length === 1
              ? `line :${fileLine} — no non-equivalent survivor among its oracle-class mutants`
              : `line :${fileLine} [${idx + 1}/${chunks.length}] — no non-equivalent survivor among this mutant slice`;
          it(
            label,
            () => {
              expect(mutants.length).toBeGreaterThan(0);
              const nonEquivalentSurvivors: string[] = [];
              for (const mutant of chunk) {
                if (sidecarGuardModeTwoCaught(mutant.nsh, nsh)) {
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
            },
            timeout,
          );
        });
        it(
          `line :${fileLine} — at least one oracle-class mutant is caught`,
          () => {
            expect(mutants.length).toBeGreaterThan(0);
            expect(mutants.some((mutant) => sidecarGuardModeTwoCaught(mutant.nsh, nsh))).toBe(true);
          },
          timeout,
        );
      }
    },
  );
}
