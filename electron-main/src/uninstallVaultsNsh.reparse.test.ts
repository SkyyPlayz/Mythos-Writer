import { describe, expect, it } from 'vitest';

import {
  assertSidecarUnifiedVmStepLimitIsFatal,
  sidecarDeleteOpForPath,
  sidecarIfFileExistsStarStar,
  sidecarPathHasFindFirstWildcard,
} from './sidecarNsisVm.test-helpers.js';
import { sidecarGuardModeTwoCaught, sidecarGuardModeTwoFailure } from './sidecarOracleMutants.test-helpers.js';
import {
  assertSidecarHard1WildcardTables,
  assertSidecarHard2NestedTables,
  assertSidecarReparseTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  RF7_NESTED_PLAIN_VAULT,
  RF7_PARENT_JUNCTION_VAULT,
  SIDECAR_HARD1_WILDCARD_ROWS,
  SIDECAR_HARD2_NESTED_ROWS,
  SIDECAR_RF7_REPARSE_ROWS,
  sidecarRf7Deleted,
} from './sidecarTraversalScan.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertMythosRmdirUnlessReparseHelper,
  assertShellVarContextCurrentThenRestorePrevious,
  assertSidecarReparseWalkBeforeDelete,
  assertWildcardAndControlCharReject,
} from './uninstallVaultsNsh.test-helpers.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

/** Pin mutant list this RF-7 / HARD-1 / HARD-2 pin was checked against. */
export const RF7_PIN_CHECKED_MUTANTS: readonly string[] = [
  'drop-restore (remove installMode If)',
  'always-all (SetShellVarContext all without installMode)',
  'drop-walk (Goto do_delete, keep context)',
  'leaf-only (Nop hit-backslash :276)',
  'bottom-up (Goto leaf at walk start :272)',
  'wider mask (0x400 → 0x407)',
  'skip-on-any-nonzero (Nop leaf 0x400 mask :290)',
  'drop wildcard charset (Alloc 80 / &i2 42)',
  'Nop nested AppData equal :228',
  'Nop nested Documents equal :239',
  'Nop nested Desktop equal :250',
];

function withFileLine(line: number, text: string): string {
  const next = [...fileLines];
  const indent = next[line - 1]!.match(/^\s*/)?.[0] ?? '';
  next[line - 1] = `${indent}${text}`;
  return next.join('\n');
}

describe('RF-7b reparse walk — modelled attribute table', () => {
  it('canonical passes every RF-7 row with no error', () => {
    expect(() => assertSidecarReparseTables(nsh, DEFAULT_SIDECAR_NSIS_VAR_ENV)).not.toThrow();
  });

  for (const row of SIDECAR_RF7_REPARSE_ROWS) {
    it(`${row.name}`, () => {
      const deleted = sidecarRf7Deleted(nsh, row, DEFAULT_SIDECAR_NSIS_VAR_ENV);
      if (row.expect === 'skip') {
        expect(deleted, row.name).toEqual([]);
      } else {
        expect(deleted, row.name).toEqual([row.path]);
      }
    });
  }

  it('leaf-only mutant (Nop :276) deletes the parent-junction + plain vault row', () => {
    expect(fileLines[275]!.trim()).toBe('StrCmp $6 "\\" mythos_reparse_hit');
    const mutant = withFileLine(276, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.path === RF7_PARENT_JUNCTION_VAULT)!;
    expect(sidecarRf7Deleted(nsh, row, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    expect(sidecarRf7Deleted(mutant, row, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([RF7_PARENT_JUNCTION_VAULT]);
  });

  it('bottom-up / stop-early mutant (Goto leaf at walk start) is red', () => {
    const mutant = withFileLine(272, 'Goto mythos_reparse_leaf');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.path === RF7_PARENT_JUNCTION_VAULT)!;
    expect(sidecarRf7Deleted(mutant, row, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([RF7_PARENT_JUNCTION_VAULT]);
  });

  it('skip-on-any-nonzero (Nop the leaf 0x400 mask) is red', () => {
    expect(fileLines[289]!.trim()).toBe('IntOp $4 $4 & 0x400');
    const mutant = withFileLine(290, 'Nop');
    expect(sidecarGuardModeTwoFailure(mutant, nsh)).toBeDefined();
    expect(sidecarRf7Deleted(mutant, SIDECAR_RF7_REPARSE_ROWS[0]!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
  });

  it('ancestor-mask Nop skips a nested plain vault that must delete', () => {
    expect(fileLines[282]!.trim()).toBe('IntOp $4 $4 & 0x400');
    const mutant = withFileLine(283, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.path === RF7_NESTED_PLAIN_VAULT)!;
    expect(sidecarRf7Deleted(nsh, row, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([RF7_NESTED_PLAIN_VAULT]);
    expect(sidecarRf7Deleted(mutant, row, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
  });

  it('drop-walk (nr_ok Goto do_delete) is red and keeps the context switch', () => {
    const mutant = nsh.replace('Goto mythos_reparse_walk', 'Goto uninstall_vault_do_delete');
    expect(mutant).toContain('SetShellVarContext current');
    expect(mutant).toContain('${If} $installMode == "all"');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    expect(() => assertSidecarReparseWalkBeforeDelete(mutant)).toThrow(/walk/);
  });
});

describe('HARD-1 wildcard reject', () => {
  it(`ships ${SIDECAR_HARD1_WILDCARD_ROWS.length} ≥77 wildcard skip rows`, () => {
    expect(SIDECAR_HARD1_WILDCARD_ROWS.length).toBeGreaterThanOrEqual(77);
    expect(() => assertSidecarHard1WildcardTables(nsh)).not.toThrow();
  });

  it('IfFileExists glob is honest: Documents\\* is Delete, not RMDir', () => {
    expect(sidecarPathHasFindFirstWildcard('C:\\Users\\me\\Documents\\*')).toBe(true);
    expect(sidecarIfFileExistsStarStar('C:\\Users\\me\\Documents\\*\\*.*')).toBe(false);
    expect(sidecarDeleteOpForPath('C:\\Users\\me\\Documents\\*')).toBe('Delete');
    expect(sidecarDeleteOpForPath('C:\\Users\\me\\Documents\\vault')).toBe('RMDir');
    expect(sidecarDeleteOpForPath('C:\\Users\\me\\Documents\\note.txt')).toBe('Delete');
  });

  it('drop-charset mutant lets Documents\\* delete (mode-2 red)', () => {
    const mutant = nsh.replace('&i2 42,&i2 63,&i2 60,&i2 62,&i2 34,&i2 124,', '');
    expect(mutant).not.toBe(nsh);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });
});

describe('HARD-2 nested roots', () => {
  it(`ships ${SIDECAR_HARD2_NESTED_ROWS.filter((r) => r.expect === 'skip').length} skip + ${SIDECAR_HARD2_NESTED_ROWS.filter((r) => r.expect === 'delete').length} delete rows`, () => {
    expect(() => assertSidecarHard2NestedTables(nsh)).not.toThrow();
  });

  it('Nop AppData equal (:228) RMDirs the nested AppData root (successor of :153)', () => {
    expect(fileLines[227]!.trim()).toBe('StrCmp $3 $9 uninstall_vault_read');
    const mutant = withFileLine(228, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('Nop Documents equal (:239) RMDirs a nested Documents root (successor of :165)', () => {
    expect(fileLines[238]!.trim()).toBe('StrCmp $3 $9 uninstall_vault_read');
    const mutant = withFileLine(239, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('Nop Desktop equal (:250) RMDirs a nested Desktop root (successor of :177)', () => {
    expect(fileLines[249]!.trim()).toBe('StrCmp $3 $9 uninstall_vault_read');
    const mutant = withFileLine(250, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });
});

describe('S-1 unified VM step cap fail-closed', () => {
  it('a self-Goto program reports hung (break instead of return hung() is red)', () => {
    expect(() => assertSidecarUnifiedVmStepLimitIsFatal()).not.toThrow();
  });
});

describe('RF-7a context pin mutants', () => {
  it('canonical passes', () => {
    expect(() => assertShellVarContextCurrentThenRestorePrevious(nsh)).not.toThrow();
    expect(() => assertMythosRmdirUnlessReparseHelper(nsh)).not.toThrow();
    expect(() => assertWildcardAndControlCharReject(nsh)).not.toThrow();
    expect(RF7_PIN_CHECKED_MUTANTS.length).toBeGreaterThan(0);
  });

  it('drop-restore is red', () => {
    const mutant = nsh.replace(
      /\$\{If\} \$installMode == "all"\s*\r?\n\s*SetShellVarContext all\s*\r?\n\s*\$\{EndIf\}/,
      '',
    );
    expect(() => assertShellVarContextCurrentThenRestorePrevious(mutant)).toThrow(/RF-7a/);
  });

  it('always-all restore is red', () => {
    const mutant = nsh.replace(
      '${If} $installMode == "all"\n    SetShellVarContext all\n  ${EndIf}',
      'SetShellVarContext all',
    );
    expect(() => assertShellVarContextCurrentThenRestorePrevious(mutant)).toThrow(/RF-7a/);
  });
});
