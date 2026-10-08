import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  CANONICAL_READ_TRIM_BLOCK,
  runSidecarReadTrimWithReset,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
  SIDECAR_READ_TRIM_STEP_LIMIT_ERROR,
} from './sidecarTraversalScan.test-helpers.js';
import {
  generateOracleClassMutants,
  sidecarGuardCaseOutcome,
  sidecarGuardModeTwoCaught,
  sidecarGuardOracleCorpus,
  type OracleClassMutant,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Forge freeze bar in CI: every oracle-class mutant (gen.py port) of :43–:213 is either caught by the
 * pin-free mode-2 VM tables or behaves exactly like canonical on Forge's full oracle corpus. A mutant
 * that changes behaviour and survives the tables is a non-equivalent survivor and fails its line.
 */
describe('oracle-class mutant sweep :43-:213 (Forge gen.py classes, pin-free VM tables)', () => {
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
    const block = CANONICAL_READ_TRIM_BLOCK;
    const indexOf = (text: string, from = 0): number =>
      block.findIndex((l, i) => i >= from && l.trim() === text);
    const LF_CHOP_INDEX = indexOf('StrCmp $2 "$\\n" mythos_trim_chop');
    const EMPTY_CHECK_INDEX = indexOf('StrCmp $1 "" uninstall_vault_read', indexOf('mythos_trim_done:'));
    const CTRL_OK_INDEX = indexOf('StrCmp $4 0 mythos_ctrl_ok');
    const withLine = (index: number, line: string): string[] => block.map((l, i) => (i === index ? line : l));

    it('the RF-6 loop block has the lines these controls mutate', () => {
      expect(LF_CHOP_INDEX).toBeGreaterThanOrEqual(0);
      expect(EMPTY_CHECK_INDEX).toBeGreaterThan(0);
      expect(CTRL_OK_INDEX).toBeGreaterThan(EMPTY_CHECK_INDEX);
    });

    it('only an exit past the :65 reset skips it (canonical, :62 +2 / +4 / mythos_trav_scan, :56 Nop)', () => {
      expect(runSidecarReadTrimWithReset(block, 'C:\\x\n').resetSkipped).toBe(false);
      expect(runSidecarReadTrimWithReset(block, 'C:\\x\r\n').resetSkipped).toBe(false);
      expect(
        runSidecarReadTrimWithReset(withLine(CTRL_OK_INDEX, '        StrCmp $4 0 +2'), 'C:\\x\r\n').resetSkipped,
      ).toBe(false);
      const pastReset = runSidecarReadTrimWithReset(withLine(CTRL_OK_INDEX, '        StrCmp $4 0 +4'), 'C:\\x\r\n');
      expect(pastReset.resetSkipped).toBe(true);
      expect(pastReset.exit).toEqual({ instr: 2 });
      const toScan = runSidecarReadTrimWithReset(withLine(CTRL_OK_INDEX, '        StrCmp $4 0 mythos_trav_scan'), 'C:\\x\n');
      expect(toScan.resetSkipped).toBe(true);
      expect(toScan.exit).toEqual({ label: 'mythos_trav_scan' });
      expect(
        runSidecarReadTrimWithReset(withLine(EMPTY_CHECK_INDEX, '        Nop'), 'C:\\x\n').resetSkipped,
      ).toBe(false);
    });

    it('relative jumps count instructions, not label lines (:49 +4 lands on `Goto mythos_trim_loop` and hangs)', () => {
      expect(() =>
        runSidecarReadTrimWithReset(withLine(LF_CHOP_INDEX, '          StrCmp $2 "$\\n" +4'), 'C:\\x\n'),
      ).toThrow(SIDECAR_READ_TRIM_STEP_LIMIT_ERROR);
    });

    it('the :62 +4 / +6 / mythos_trav_scan overshoot mutants are caught (after a long line they delete a scan-only reject, or lose every delete)', () => {
      const keys = [
        '62:tgt3:mythos_ctrl_ok->+4',
        '62:tgt3:mythos_ctrl_ok->+6',
        '62:tgt3:mythos_ctrl_ok->mythos_trav_scan',
      ];
      const mutants = (byLine.get(62) ?? []).filter((m) => keys.includes(m.key));
      expect(mutants.map((m) => m.key).sort()).toEqual([...keys].sort());
      for (const mutant of mutants) {
        expect(sidecarGuardModeTwoCaught(mutant.nsh, nsh), mutant.key).toBe(true);
      }
    });
  });

  describe('read-trim $2 model (live during the scan, Forge nsis.py ground truth)', () => {
    it('the RF-6 loop leaves $2 = the path’s last char on every terminator (CRLF, CR, LF, LF-then-CR, none)', () => {
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\r\n').$2).toBe('\\');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\r').$2).toBe('\\');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\n').$2).toBe('\\');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v\\\n\r').$2).toBe('\\');
      expect(runSidecarReadTrimWithReset(CANONICAL_READ_TRIM_BLOCK, 'C:\\v/').$2).toBe('/');
    });

    it('the $4→$2 swaps on :98/:99/:104/:105/:124/:125/:130/:131 are caught (each refuses its `.a` / `..a` segment before a trailing separator)', () => {
      const keys = ['98', '99', '104', '105', '124', '125', '130', '131'].map((n) => `${n}:$4->$2`);
      const mutants = [...byLine.values()].flat().filter((m) => keys.includes(m.key));
      expect(mutants.map((m) => m.key).sort()).toEqual([...keys].sort());
      for (const mutant of mutants) {
        expect(sidecarGuardModeTwoCaught(mutant.nsh, nsh), mutant.key).toBe(true);
      }
    });
  });
});
