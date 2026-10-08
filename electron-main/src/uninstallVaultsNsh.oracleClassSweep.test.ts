import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  CANONICAL_READ_TRIM_BLOCK,
  runSidecarReadTrimWithReset,
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

  // The behaviour oracle above is the same TS VM as the catch, so a VM that stops modelling the
  // read-trim overshoot or the live $2 would weaken both sides at once and stay green. These pin
  // the model itself.
  describe('read-trim overshoot model (multi-line $7 carry, Forge nsis.py ground truth)', () => {
    const CR_TRIM_INDEX = CANONICAL_READ_TRIM_BLOCK.findIndex((l) => l.trim() === 'StrCmp $2 "$\\r" 0 +2');
    const EMPTY_CHECK_INDEX = CANONICAL_READ_TRIM_BLOCK.findIndex(
      (l) => l.trim() === 'StrCmp $1 "" uninstall_vault_read',
    );
    const withLine = (index: number, line: string): string[] =>
      CANONICAL_READ_TRIM_BLOCK.map((l, i) => (i === index ? line : l));

    it('only a jump landing past the :53 reset skips it (canonical, +2→+4 on LF / CRLF, :52 Nop)', () => {
      const overshoot = withLine(CR_TRIM_INDEX, '        StrCmp $2 "$\\r" 0 +4');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\x\n').resetSkipped).toBe(false);
      expect(runSidecarReadTrimWithReset(overshoot, 'C:\\x\n').resetSkipped).toBe(true);
      expect(runSidecarReadTrimWithReset(overshoot, 'C:\\x\r\n').resetSkipped).toBe(false);
      expect(
        runSidecarReadTrimWithReset(withLine(EMPTY_CHECK_INDEX, '        Nop'), 'C:\\x\n').resetSkipped,
      ).toBe(false);
    });

    it('the :50 +2→+4 / +2→+6 overshoot mutants are caught (they delete `..\\..\\..\\Windows` after a long line)', () => {
      const keys = ['50:tgt4:+2->+4', '50:tgt4:+2->+6'];
      const mutants = (byLine.get(50) ?? []).filter((m) => keys.includes(m.key));
      expect(mutants.map((m) => m.key).sort()).toEqual([...keys].sort());
      for (const mutant of mutants) {
        expect(sidecarGuardModeTwoCaught(mutant.nsh, nsh), mutant.key).toBe(true);
      }
    });
  });

  describe('read-trim $2 model (live during the scan, Forge nsis.py ground truth)', () => {
    it('the trim leaves $2 = `\\r` on CRLF / CR lines and the path’s last char on LF-only / unterminated lines', () => {
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\r\n').$2).toBe('\r');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\r').$2).toBe('\r');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\n').$2).toBe('\\');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v/').$2).toBe('/');
    });

    it('the $4→$2 swaps on :72/:73/:78/:79/:98/:99/:104/:105 are caught (they refuse `v\\.a\\` on an LF-only line)', () => {
      const keys = ['72', '73', '78', '79', '98', '99', '104', '105'].map((n) => `${n}:$4->$2`);
      const mutants = [...byLine.values()].flat().filter((m) => keys.includes(m.key));
      expect(mutants.map((m) => m.key).sort()).toEqual([...keys].sort());
      for (const mutant of mutants) {
        expect(sidecarGuardModeTwoCaught(mutant.nsh, nsh), mutant.key).toBe(true);
      }
    });
  });
});
