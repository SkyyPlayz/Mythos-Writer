import { describe, expect, it } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import { mutantSidecarGuardRegionSweepLine } from './sidecarTraversalScan.test-helpers.js';
import {
  generateOracleClassMutants,
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
  type OracleClassMutant,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Restored-corpus EQ scans were 20–33s against the 30s default (same class as the 9802a5c3
 * unit timeout; :99 / :174 / :189 / :204 later hit 25–28s). One mutant per test and a raised
 * timeout on every slice — never drop a case. File shards give the oracle-sweeps job
 * wall-clock room; `it.concurrent` does not help synchronous work.
 */
export const ORACLE_CLASS_SWEEP_TEST_TIMEOUT_MS = 60_000;
const SWEEP_CHUNK = 1;

/**
 * Strength-equivalent primaries, partitioned for the oracle-sweeps file workers.
 * Union must equal SIDECAR_GUARD_SWEEP_STRENGTH_EQUIVALENT_FILE_LINES.
 */
export const SIDECAR_GUARD_STRENGTH_SHARDS: readonly (readonly number[])[] = [
  [47, 56, 61, 84, 97, 98, 99],
  [103, 104, 105, 106, 109, 117, 123, 124],
  [125, 129, 130, 131, 218, 308],
  [354, 355, 357, 407],
  [464, 467, 473, 480, 487, 489, 491, 493, 494, 495],
];

/**
 * HARD-2 ancestor-separator lines after each equal-check (8b2fa528: 267/268, 278/279,
 * 295/296 → :382/:383 Documents, :408/:409 Desktop, :434/:435 Downloads). No allowlisted
 * parent of Documents/Desktop/Downloads can reach them without the earlier exact-root
 * guard, so every oracle-class mutant on these six lines stays equivalent. Every other
 * line — including documented primary-Nop equivalents — must have at least one caught
 * oracle-class mutant. Do not derive this set from the behaviour-equivalent list.
 */
export const ORACLE_CLASS_ALL_EQUIVALENT_LINES: ReadonlySet<number> = new Set([
  382, 383, 408, 409, 434, 435,
]);

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
        const chunks = chunkMutants(mutants, SWEEP_CHUNK);
        const timeout = ORACLE_CLASS_SWEEP_TEST_TIMEOUT_MS;
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
        if (!ORACLE_CLASS_ALL_EQUIVALENT_LINES.has(fileLine)) {
          it(
            `line :${fileLine} — at least one oracle-class mutant is caught`,
            () => {
              expect(mutants.length).toBeGreaterThan(0);
              expect(mutants.some((mutant) => sidecarGuardModeTwoCaught(mutant.nsh, nsh))).toBe(true);
            },
            timeout,
          );
        }
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
