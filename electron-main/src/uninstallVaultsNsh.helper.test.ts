import { describe, expect, it } from 'vitest';

import {
  assertMythosRmdirHelperRegionExact,
  assertMythosRmdirHelperTables,
  DEFAULT_HELPER_NSIS_VAR_ENV,
  HELPER_CRITIC_MUTANTS,
  HELPER_GFPN_FAIL_LINES,
  HELPER_H1_SLASH_SITE,
  HELPER_H1_SLASH_SITES,
  HELPER_HARD_B_MUTANTS,
  HARD_D_LEFTOVER_7,
  HARD_D_LONG_SIDECAR_LINE,
  HELPER_RF7_ATTR_A_ROWS,
  HELPER_RF7_ATTR_B_ROWS,
  HELPER_RF7_ROWS,
  HELPER_REGION_FILE_LINE_FIRST,
  HELPER_REGION_FILE_LINE_LAST,
  helperGuardModeTwoCaught,
  helperGuardModeTwoFailure,
  helperRf7Deleted,
  helperResolvedPath,
  nshWithFileLine,
} from './sidecarHelperVm.test-helpers.js';
import {
  expandMythosRmdirUnlessReparse,
  extractSidecarNsisProgramLines,
  MYTHOS_RMDIR_HELPER_KEEP_SITES,
  MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES,
  nsisValidateFilename,
  runMythosRmdirHelper,
  runMythosRmdirHelpers,
} from './sidecarNsisVm.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  assertMythosRmdirUnlessReparseHelper,
  MYTHOS_RMDIR_UNLESS_REPARSE_INSERTS,
} from './uninstallVaultsNsh.test-helpers.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

describe('H2 mythos_rmdir_unless_reparse helper', () => {
  it(`pins helper region :${HELPER_REGION_FILE_LINE_FIRST}–:${HELPER_REGION_FILE_LINE_LAST}`, () => {
    expect(() => assertMythosRmdirHelperRegionExact(nsh)).not.toThrow();
    expect(() => assertMythosRmdirUnlessReparseHelper(nsh)).not.toThrow();
    expect(fileLines[HELPER_REGION_FILE_LINE_FIRST - 1]).toBe(
      '!macro mythos_rmdir_unless_reparse _root _path _uid',
    );
    expect(fileLines[HELPER_REGION_FILE_LINE_LAST - 1]).toBe('!macroend');
  });

  it('does not expand helpers into the sidecar FileOpen…fallback program', () => {
    const sidecar = extractSidecarNsisProgramLines(nsh).join('\n');
    expect(sidecar).not.toContain('mythos_rmdir_unless_reparse');
    expect(sidecar).not.toContain('vault-index-cache');
    expect(sidecar).toContain('FileOpen $0');
    expect(sidecar).toContain('uninstall_vault_fallback:');
  });

  it(`canonical passes ${HELPER_RF7_ROWS.length} helper RF-7 rows including (a)(b)`, () => {
    expect(HELPER_RF7_ATTR_A_ROWS.length).toBe(18);
    expect(HELPER_RF7_ATTR_B_ROWS.length).toBe(12);
    expect(() => assertMythosRmdirHelperTables(nsh)).not.toThrow();
  });

  for (const row of HELPER_RF7_ROWS) {
    it(row.name, () => {
      const deleted = helperRf7Deleted(nsh, row, DEFAULT_HELPER_NSIS_VAR_ENV);
      if (row.expect === 'skip') {
        expect(deleted, row.name).toEqual([]);
      } else {
        expect(deleted, row.name).toEqual([row.leaf]);
      }
    });
  }

  it('KEEP mode expands both cache sites; Remove-all expands the four user-data sites', () => {
    const keep = runMythosRmdirHelpers(nsh, 'keep', { env: DEFAULT_HELPER_NSIS_VAR_ENV });
    expect(keep.hung).toBe(false);
    expect(keep.deleted).toEqual(MYTHOS_RMDIR_HELPER_KEEP_SITES.map((site) => helperResolvedPath(site)));
    const remove = runMythosRmdirHelpers(nsh, 'remove-all', { env: DEFAULT_HELPER_NSIS_VAR_ENV });
    expect(remove.hung).toBe(false);
    expect(remove.deleted).toEqual(MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES.map((site) => helperResolvedPath(site)));
  });
});

describe('H2 Critic helper mutants are red on helper mode-2', () => {
  it('negative control — canonical is not caught', () => {
    expect(helperGuardModeTwoCaught(nsh, nsh)).toBe(false);
  });

  for (const spec of HELPER_CRITIC_MUTANTS) {
    it(`${spec.name} (:${spec.line}) is red`, () => {
      expect(fileLines[spec.line - 1]!.trim().length).toBeGreaterThan(0);
      const mutant = nshWithFileLine(nsh, spec.line, spec.text);
      expect(mutant).not.toBe(nsh);
      expect(helperGuardModeTwoFailure(mutant, nsh), spec.name).toBeDefined();
    });
  }

  it('skip-on-any-nonzero (Nop leaf 0x400 mask :600) skips a plain KEEP cache', () => {
    expect(fileLines[599]!.trim()).toBe('IntOp $4 $4 & 0x400');
    const mutant = nshWithFileLine(nsh, 600, 'Nop');
    const row = HELPER_RF7_ROWS.find((r) => r.name === 'keep vault-index-cache plain deletes')!;
    expect(helperRf7Deleted(nsh, row)).toEqual([row.leaf]);
    expect(helperRf7Deleted(mutant, row)).toEqual([]);
    expect(helperGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('HARD-D :582 $7 init Nop and $7→$1/$5/$6/$9 are red on leftover + Mythos Writer junction', () => {
    expect(fileLines[581]!.trim()).toBe('StrCpy $7 0');
    expect(HARD_D_LEFTOVER_7).toBe(String(HARD_D_LONG_SIDECAR_LINE.length));
    const row = HELPER_RF7_ROWS.find((r) => r.name.startsWith('HARD-D keep vault-index-cache long sidecar leftover + Mythos Writer junction'))!;
    expect(row, 'HARD-D leftover junction row').toBeDefined();
    expect(helperRf7Deleted(nsh, row)).toEqual([]);
    const nop = nshWithFileLine(nsh, 582, 'Nop');
    expect(helperGuardModeTwoCaught(nop, nsh)).toBe(true);
    expect(helperRf7Deleted(nop, row).length, 'Nop :582 must delete through the junction').toBeGreaterThan(0);
    for (const dest of ['$1', '$5', '$6', '$9'] as const) {
      const mutant = nshWithFileLine(nsh, 582, `StrCpy ${dest} 0`);
      expect(helperGuardModeTwoCaught(mutant, nsh), `${dest} swap`).toBe(true);
      expect(helperRf7Deleted(mutant, row).length, `${dest} swap must delete`).toBeGreaterThan(0);
    }
  });

  it('HARD-D leftover + unreadable Mythos Writer skips; :582 Nop deletes', () => {
    const row = HELPER_RF7_ROWS.find((r) => r.name.startsWith('HARD-D keep vault-index-cache long sidecar leftover + Mythos Writer unreadable'))!;
    expect(row, 'HARD-D leftover unreadable row').toBeDefined();
    expect(helperRf7Deleted(nsh, row)).toEqual([]);
    const nop = nshWithFileLine(nsh, 582, 'Nop');
    expect(helperRf7Deleted(nop, row).length).toBeGreaterThan(0);
  });

  it(':579 prefix Nop is equivalent on the helper sites (not one of the 8)', () => {
    expect(fileLines[578]!.trim()).toBe('StrCmp $6 $9 0 mythos_rpr_done_${_uid}');
    const mutant = nshWithFileLine(nsh, 579, 'Nop');
    expect(helperGuardModeTwoCaught(mutant, nsh)).toBe(false);
  });
});

const HELPER_GFPN_FAIL_MUTANTS: readonly { name: string; line: number; text: string }[] = [
  { name: ':571 Nop path GFPN', line: 571, text: 'Nop' },
  { name: ':572 Nop path GFPN 0', line: 572, text: 'Nop' },
  { name: ':572 path 0 always-continue', line: 572, text: 'IntCmp $4 0 0 0 0' },
  { name: ':572 path 0 invert', line: 572, text: 'IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}' },
  { name: ':573 Nop path GFPN trunc', line: 573, text: 'Nop' },
  { name: ':573 path trunc invert', line: 573, text: 'IntCmp $4 ${NSIS_MAX_STRLEN} 0 mythos_rpr_done_${_uid} 0' },
  { name: ':573 path trunc always-continue', line: 573, text: 'IntCmp $4 ${NSIS_MAX_STRLEN} 0 0 0' },
  { name: ':574 Nop root GFPN', line: 574, text: 'Nop' },
  { name: ':575 Nop root GFPN 0', line: 575, text: 'Nop' },
  { name: ':575 root 0 invert', line: 575, text: 'IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}' },
  { name: ':575 root 0 always-continue', line: 575, text: 'IntCmp $4 0 0 0 0' },
  { name: ':576 Nop root GFPN trunc', line: 576, text: 'Nop' },
  { name: ':576 root trunc invert', line: 576, text: 'IntCmp $4 ${NSIS_MAX_STRLEN} 0 mythos_rpr_done_${_uid} 0' },
];

describe('HARD-B helper mutants + H1 helper slash + GFPN-fail', () => {
  it('helper tables include slash and GFPN-fault rows', () => {
    expect(HELPER_GFPN_FAIL_LINES).toEqual([571, 572, 573, 574, 575, 576]);
    expect(HELPER_H1_SLASH_SITES).toHaveLength(3);
    expect(() => assertMythosRmdirHelperTables(nsh)).not.toThrow();
    const slash = runMythosRmdirHelper(nsh, HELPER_H1_SLASH_SITE, { env: DEFAULT_HELPER_NSIS_VAR_ENV });
    expect(slash.deleted).toEqual([`${DEFAULT_HELPER_NSIS_VAR_ENV.APPDATA}\\Mythos Writer\\a\\b`]);
    expect(slash.deleted).not.toContain(`${DEFAULT_HELPER_NSIS_VAR_ENV.APPDATA}\\Mythos Writer\\ab`);
  });

  it('helper ${_path} revert is red on a/b (validate_filename → ab)', () => {
    const mutant = nshWithFileLine(nsh, 602, 'RMDir /r "${_path}"');
    expect(mutant).not.toBe(nsh);
    const expanded = expandMythosRmdirUnlessReparse(mutant, HELPER_H1_SLASH_SITE);
    const rmdir = expanded.find((l) => l.includes('RMDir'));
    expect(rmdir, 'expanded RMDir').toContain('a/b');
    expect(() => assertMythosRmdirUnlessReparseHelper(mutant)).toThrow(/checked \$3|not \$\{_path\}|helper must RMDir/);
    const deleted = runMythosRmdirHelper(mutant, HELPER_H1_SLASH_SITE, { env: DEFAULT_HELPER_NSIS_VAR_ENV }).deleted;
    expect(deleted).toEqual([
      nsisValidateFilename(`${DEFAULT_HELPER_NSIS_VAR_ENV.APPDATA}\\Mythos Writer\\a/b`),
    ]);
    expect(helperGuardModeTwoFailure(mutant, nsh)).toBeDefined();
  });

  for (const spec of HELPER_HARD_B_MUTANTS) {
    it(`HARD-B ${spec.name} (:${spec.line}) is red`, () => {
      const mutant = nshWithFileLine(nsh, spec.line, spec.text);
      expect(mutant).not.toBe(nsh);
      expect(helperGuardModeTwoFailure(mutant, nsh), spec.name).toBeDefined();
    });
  }

  for (const spec of HELPER_GFPN_FAIL_MUTANTS) {
    it(`HARD-B GFPN-fail ${spec.name} is red`, () => {
      const mutant = nshWithFileLine(nsh, spec.line, spec.text);
      expect(mutant).not.toBe(nsh);
      expect(helperGuardModeTwoFailure(mutant, nsh), spec.name).toBeDefined();
    });
  }

  it(`lists ${HELPER_GFPN_FAIL_MUTANTS.length} GFPN-fail mutants`, () => {
    expect(HELPER_GFPN_FAIL_MUTANTS).toHaveLength(13);
  });

  for (const insert of MYTHOS_RMDIR_UNLESS_REPARSE_INSERTS) {
    it(`composite bare RMDir for ${insert} is red`, () => {
      const leaf = insert.match(/"(\$APPDATA\\Mythos Writer[^"]*)"/)?.[1] ?? '$APPDATA\\Mythos Writer';
      const mutant = nsh.replace(insert, `RMDir /r "${leaf}"`);
      expect(mutant).not.toBe(nsh);
      expect(() => assertMythosRmdirUnlessReparseHelper(mutant)).toThrow(
        /bare RMDir|missing reparse-guarded/,
      );
    });
  }
});
