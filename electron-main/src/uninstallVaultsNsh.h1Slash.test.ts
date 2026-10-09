import { describe, expect, it } from 'vitest';

import { sidecarGuardModeTwoCaught } from './sidecarOracleMutants.test-helpers.js';
import {
  assertSidecarH1DeleteSlashTables,
  assertSidecarH1SlashTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  SIDECAR_H1_DELETE_SLASH_ROWS,
  SIDECAR_H1_SLASH_ROWS,
  simulateSidecarDeleteReadLoop,
} from './sidecarTraversalScan.test-helpers.js';
import { nsisMyDeletePath, nsisValidateFilename } from './sidecarNsisVm.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import { assertSidecarReparseWalkBeforeDelete } from './uninstallVaultsNsh.test-helpers.js';

const nsh = loadUninstallVaultsNsh();

const H1_REVERT_BLOCK = `        IfFileExists "$3\\*.*" 0 uninstall_vault_file
          RMDir /r "$3"
          Goto uninstall_vault_read
        uninstall_vault_file:
          Delete "$3"`;

const H1_REVERT_ON_RAW = `        IfFileExists "$1\\*.*" 0 uninstall_vault_file
          RMDir /r "$1"
          Goto uninstall_vault_read
        uninstall_vault_file:
          Delete "$1"`;

describe('H1 leftover / on $3 — validate_filename and delete-on-$3', () => {
  it('nsisValidateFilename preserves X: and strips / from the rest', () => {
    expect(nsisValidateFilename('C:\\Users\\me\\Documents\\a/b')).toBe('C:\\Users\\me\\Documents\\ab');
    expect(nsisValidateFilename('C:\\Users\\me\\Documents\\D/esktop')).toBe('C:\\Users\\me\\Documents\\Desktop');
    expect(nsisValidateFilename('C:\\Users\\me\\Documents\\MyVault')).toBe('C:\\Users\\me\\Documents\\MyVault');
    expect(nsisValidateFilename('c:\\a/b')).toBe('c:\\ab');
  });

  it('nsisMyDeletePath splits on backslash only (Documents\\a/b.txt → Documents\\b.txt)', () => {
    expect(nsisMyDeletePath('C:\\Users\\me\\Documents\\a/b.txt')).toBe('C:\\Users\\me\\Documents\\b.txt');
    expect(nsisMyDeletePath('C:\\Users\\me\\Documents\\a\\b/f.txt')).toBe('C:\\Users\\me\\Documents\\a\\f.txt');
    expect(nsisMyDeletePath('C:\\Users\\me\\Documents\\x/f.txt')).toBe('C:\\Users\\me\\Documents\\f.txt');
    expect(nsisMyDeletePath('C:\\Users\\me\\Documents\\note.txt')).toBe('C:\\Users\\me\\Documents\\note.txt');
  });

  it(`ships ${SIDECAR_H1_SLASH_ROWS.length} a/b and D/esktop must-skip rows under all 4 roots`, () => {
    expect(SIDECAR_H1_SLASH_ROWS).toHaveLength(12);
    expect(SIDECAR_H1_DELETE_SLASH_ROWS).toHaveLength(12);
    expect(() => assertSidecarH1SlashTables(nsh)).not.toThrow();
    expect(() => assertSidecarH1DeleteSlashTables(nsh)).not.toThrow();
    expect(() => assertSidecarReparseWalkBeforeDelete(nsh)).not.toThrow();
    expect(nsh).not.toMatch(/IfFileExists "\$1\\/);
    expect(nsh).not.toContain('RMDir /r "$1"');
    expect(nsh).not.toContain('Delete "$1"');
  });

  for (const row of SIDECAR_H1_SLASH_ROWS) {
    it(row.name, () => {
      const deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env, row.options ?? {}).deleted;
      expect(deleted, row.name).toEqual([...row.expectDeleted]);
      for (const ban of row.mustNotDelete) {
        expect(deleted, row.name).not.toContain(ban);
      }
    });
  }

  it('$3→$1 revert on IfFileExists/RMDir/Delete is red (validate_filename a/b → ab)', () => {
    const mutant = nsh.replace(H1_REVERT_BLOCK, H1_REVERT_ON_RAW);
    expect(mutant).not.toBe(nsh);
    expect(mutant).toContain('RMDir /r "$1"');
    expect(mutant).toContain('RMDir /r "$3"');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_H1_SLASH_ROWS.find((r) => r.name === 'H1 Documents a/b must not delete ab')!;
    const deleted = simulateSidecarDeleteReadLoop(mutant, [`${row.path}\r\n`], DEFAULT_SIDECAR_NSIS_VAR_ENV).deleted;
    expect(deleted).toEqual(['C:\\Users\\me\\Documents\\ab']);
    expect(() => assertSidecarReparseWalkBeforeDelete(mutant)).toThrow(/RF-7b|H1|\$3/);
  });

  it('Delete-only $1 revert is red (Documents\\a/b.txt → Documents\\b.txt)', () => {
    const mutant = nsh.replace('          Delete "$3"', '          Delete "$1"');
    expect(mutant).not.toBe(nsh);
    expect(mutant).toContain('Delete "$1"');
    expect(mutant).toContain('RMDir /r "$3"');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const deleted = simulateSidecarDeleteReadLoop(
      mutant,
      ['C:\\Users\\me\\Documents\\a/b.txt\r\n'],
      DEFAULT_SIDECAR_NSIS_VAR_ENV,
    ).deleted;
    expect(deleted).toEqual(['C:\\Users\\me\\Documents\\b.txt']);
    expect(() => assertSidecarH1DeleteSlashTables(mutant)).toThrow(/b\.txt/);
  });

  for (const row of SIDECAR_H1_DELETE_SLASH_ROWS) {
    it(row.name, () => {
      const deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted;
      expect(deleted, row.name).toEqual([...row.expectDeleted]);
      for (const ban of row.mustNotDelete) {
        expect(deleted, row.name).not.toContain(ban);
      }
    });
  }
});
