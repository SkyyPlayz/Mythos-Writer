import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  CANONICAL_READ_TRIM_BLOCK,
  runSidecarReadTrimWithReset,
  SIDECAR_READ_TRIM_STEP_LIMIT_ERROR,
} from './sidecarTraversalScan.test-helpers.js';
import {
  generateOracleClassMutants,
  sidecarGuardModeTwoCaught,
} from './sidecarOracleMutants.test-helpers.js';

/**
 * Model pins for the oracle-class sweep. The per-line mutant tables live in the
 * `uninstallVaultsNsh.oracleClassSweep.*.test.ts` shards so vitest file workers
 * parallelize the restored-corpus scans.
 */
describe('oracle-class mutant sweep :43-:376 (Forge gen.py classes, pin-free VM tables)', () => {
  const nsh = loadUninstallVaultsNsh();
  const byLine = new Map<number, ReturnType<typeof generateOracleClassMutants>>();
  for (const mutant of generateOracleClassMutants(nsh)) {
    byLine.set(mutant.fileLine, [...(byLine.get(mutant.fileLine) ?? []), mutant]);
  }

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
