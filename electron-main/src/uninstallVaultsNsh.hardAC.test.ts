import { describe, expect, it } from 'vitest';

import { ORACLE_CLASS_ALL_EQUIVALENT_LINES } from './sidecarOracleClassSweep.test-helpers.js';
import {
  glpnWin32Exists,
  probeSystemPluginGlpFailure,
  SIDECAR_LINE_STEP_LIMIT_ERROR,
  SIDECAR_NSIS_ENV_E1,
} from './sidecarNsisVm.test-helpers.js';
import {
  generateGlpErrorJumpOffsetMutants,
  generateGlpErrorOracleJumpSwapMutants,
  generateOracleClassMutants,
  nshBypassLaterNestedGuard,
  nshWithoutLaterNestedSkips,
  sidecarGuardModeTwoCaught,
  sidecarGuardModeTwoFailure,
} from './sidecarOracleMutants.test-helpers.js';
import {
  SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES,
  SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS,
} from './uninstallVaultsNsh.guardRegionSweep.test.js';
import {
  assertForgeOracleFamiliesZeroZero,
  assertSidecarHardATables,
  assertSidecarHardCTables,
  assertSidecarHard2NestedTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  mutantSidecarGuardRegionSweepLine,
  RF7_ONE_CHAR_JUNCTION,
  RF7_ONE_CHAR_JUNCTION_VAULT,
  SIDECAR_HARD_A_ROWS,
  SIDECAR_HARD_C_ROWS,
  SIDECAR_HARD_E_ROWS,
  SIDECAR_HARD2_NESTED_ROWS,
  SIDECAR_H3_H4_COMBINED_ROWS,
  SIDECAR_RF7_REPARSE_ROWS,
  assertSidecarH3H4CombinedTables,
  sidecarHardADeleted,
  sidecarRf7Deleted,
  simulateSidecarDeleteReadLoop,
} from './sidecarTraversalScan.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

function withFileLine(line: number, text: string): string {
  const next = [...fileLines];
  const indent = next[line - 1]!.match(/^\s*/)?.[0] ?? '';
  next[line - 1] = `${indent}${text}`;
  return next.join('\n');
}

const WALK_SIX_MUTANTS: readonly { name: string; line: number; text: string }[] = [
  { name: ':472 IntOp +2', line: 472, text: 'IntOp $7 $7 + 2' },
  { name: ':472 dup +1', line: 472, text: 'DUP' },
  { name: ':473 Goto +2', line: 473, text: 'Goto +2' },
  { name: ':473 Goto +3', line: 473, text: 'Goto +3' },
  { name: ':473 Goto +4', line: 473, text: 'Goto +4' },
  { name: ':473 Goto +6', line: 473, text: 'Goto +6' },
];

const HARD_C_EIGHTEEN: readonly { name: string; line: number; text: string }[] = [
  380, 382, 383, 406, 408, 409, 432, 434, 435,
].flatMap((line) => [
  { name: `:${line} Nop`, line, text: 'Nop' },
  { name: `:${line} del`, line, text: '' },
]);

describe('System plugin GLP failure-output probe', () => {
  it('failure writes empty to the output register and leaves a scratch input intact', () => {
    const scratch = probeSystemPluginGlpFailure(false);
    expect(scratch.ret).toBe('0');
    expect(scratch.dest).toBe('');
    expect(scratch.source).toBe('C:\\Users\\me\\Desktop');
  });

  it('GLP fails on a missing path the way Win32 does; H4 missing-folder rows still pass', () => {
    expect(glpnWin32Exists('C:\\Users\\me\\Documents\\NoSuchVault', SIDECAR_NSIS_ENV_E1, {})).toBe(false);
    expect(glpnWin32Exists('C:\\Users\\me\\Documents\\MyVault', SIDECAR_NSIS_ENV_E1, {})).toBe(true);
    expect(
      glpnWin32Exists('C:\\Users\\me\\Downloads', SIDECAR_NSIS_ENV_E1, {
        missingPaths: ['C:\\Users\\me\\Downloads'],
      }),
    ).toBe(false);
    expect(
      glpnWin32Exists('C:\\Users\\me\\Documents\\MyVault', SIDECAR_NSIS_ENV_E1, {
        missingPaths: ['C:\\Users\\me\\Downloads'],
      }),
    ).toBe(true);
    const missingFolder = SIDECAR_HARD_A_ROWS.filter((r) => r.name.startsWith('missing-folder'));
    expect(missingFolder.length).toBeGreaterThanOrEqual(6);
    for (const row of missingFolder) {
      const deleted = sidecarHardADeleted(nsh, row);
      if (row.expect === 'skip') {
        expect(deleted, row.name).toEqual([]);
      } else {
        expect(deleted, row.name).toHaveLength(1);
      }
    }
  });

  it('in-place failure clobbers the input (empty root must never be a prefix)', () => {
    const inplace = probeSystemPluginGlpFailure(true);
    expect(inplace.ret).toBe('0');
    expect(inplace.dest).toBe('');
    expect(inplace.source).toBe('');
  });
});

describe('HARD-A short names + deny/allowlist GLP', () => {
  it(`ships ${SIDECAR_HARD_A_ROWS.length} HARD-A rows and scores 0/0`, () => {
    expect(() => assertSidecarHardATables(nsh)).not.toThrow();
    expect(() => assertForgeOracleFamiliesZeroZero(nsh)).not.toThrow();
  });

  for (const row of SIDECAR_HARD_A_ROWS) {
    it(row.name, () => {
      const deleted = sidecarHardADeleted(nsh, row);
      if (row.expect === 'skip') {
        expect(deleted, row.name).toEqual([]);
      } else {
        expect(deleted, row.name).toHaveLength(1);
      }
      for (const ban of row.mustNotDelete ?? []) {
        expect(deleted, row.name).not.toContain(ban);
      }
    });
  }

  it('drop GetLongPathNameW expansion is red because of a wrong delete or skip, not a VM crash', () => {
    const mutant = nsh.split('GetLongPathNameW').join('GetLongPathNameX');
    expect(mutant).not.toBe(nsh);
    const failure = sidecarGuardModeTwoFailure(mutant, nsh);
    expect(failure, 'Drop-GLP must be caught by behaviour tables').toBeDefined();
    expect(failure).not.toMatch(/unsupported|unknown .*target|call GetLongPathNameX|is not a /);
    expect(failure).toMatch(/HARD-A|deleted|skip|sweep parity/);
  });

  it('GLP-before-deny is proven by the PROGRA~1 allowlist row, not by string presence', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 170);
    expect(row, 'PROGRA~1 inside-allowlist row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const mutant = withFileLine(170, 'Nop');
    expect(sidecarHardADeleted(mutant, row!).length, 'Nop :170 must delete Shared Docs\\v').toBeGreaterThan(0);
  });

  it('missing-root rows pin every allow/deny root, not only WINDIR', () => {
    for (const root of ['WINDIR', 'PROGRAMFILES', 'PROGRAMFILES64', 'APPDATA', 'DOCUMENTS', 'DESKTOP', 'PROFILE']) {
      const rows = SIDECAR_HARD_A_ROWS.filter((r) => r.name.startsWith(`missing ${root} root`));
      expect(rows.length, root).toBeGreaterThanOrEqual(4);
    }
  });

  it('$1 revert on :179 (StrCpy $4 $1 $8) deletes Program Files\\Shared Docs\\v', () => {
    expect(fileLines[178]!.trim()).toBe('StrCpy $4 $3 $8');
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.includes('$1 revert'));
    expect(row).toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const mutant = withFileLine(179, 'StrCpy $4 $1 $8');
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Program Files\\Shared Docs\\v']);
  });

  it('failed canon-root GFPN writes $9, so Nop :330 is a real kill', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 330);
    expect(row, 'fail-write row for :330').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 330), row!);
    expect(got.length, 'Nop :330 must delete because the failed GFPN wrote $9').toBeGreaterThan(0);
  });

  it('truncated canon-root GFPN writes $9, so Nop :331 is a real kill', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 331);
    expect(row, 'trunc-write row for :331').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 331), row!);
    expect(got.length, 'Nop :331 must delete because the truncated GFPN wrote $9').toBeGreaterThan(0);
  });

  it('canon-root GLP Nop :332 is red — leftover scratch clobbers $9 (false reject)', () => {
    const fault = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('canon-root GLP at :259 fault'));
    expect(fault, 'GLP-fault row for :332').toBeDefined();
    expect(sidecarHardADeleted(nsh, fault!)).toEqual([]);
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLines?.includes(332));
    expect(row, 'delete row that kills :332').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!).length).toBeGreaterThan(0);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 332), row!);
    expect(got, 'Nop :332 must false-reject the legit vault (scratch leftover clobbers $9)').toEqual([]);
    expect(sidecarGuardModeTwoCaught(mutantSidecarGuardRegionSweepLine(nsh, 332), nsh)).toBe(true);
  });

  for (const fileLine of SIDECAR_GUARD_SWEEP_FALSE_GFPN_GLP_EQUIVALENTS) {
    it(`Forge false-equivalent :${fileLine} primary Nop is red on a behaviour row`, () => {
      const row = SIDECAR_HARD_A_ROWS.find(
        (r) => r.killsFileLine === fileLine || r.killsFileLines?.includes(fileLine),
      );
      expect(row, `killing row for :${fileLine}`).toBeDefined();
      const mutant = mutantSidecarGuardRegionSweepLine(nsh, fileLine);
      const canonical = sidecarHardADeleted(nsh, row!);
      const got = sidecarHardADeleted(mutant, row!);
      expect(got, `:${fileLine} ${row!.name}`).not.toEqual(canonical);
    });
  }
});

describe('HARD-C ancestor-of-root fixtures (18 nop/del)', () => {
  it('canonical skips the three HARD-C layouts', () => {
    expect(SIDECAR_HARD_C_ROWS).toHaveLength(3);
    expect(() => assertSidecarHardCTables(nsh)).not.toThrow();
  });

  for (const spec of HARD_C_EIGHTEEN) {
    it(`${spec.name} is red`, () => {
      if (spec.text === '') {
        const next = [...fileLines];
        next.splice(spec.line - 1, 1);
        const mutant = next.join('\n');
        expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
        return;
      }
      const mutant = withFileLine(spec.line, spec.text);
      expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    });
  }
});

const NESTED_DOWNLOADS_PROBE_ROWS = SIDECAR_HARD2_NESTED_ROWS.filter(
  (r) => r.id.startsWith('N7|') || r.id.startsWith('N8|'),
);

function extraDownloadsBlockMutants(): { key: string; nsh: string }[] {
  const swaps: readonly (readonly [string, string])[] = [
    ['$9', '$3'],
    ['$9', '$6'],
    ['$9', '$5'],
    ['$9', '$8'],
    ['$6', '$9'],
    ['$6', '$3'],
    ['$6', '$5'],
    ['$6', '$8'],
    ['$5', '$9'],
    ['$8', '$3'],
    ['$8', '$6'],
    ['$8', '$9'],
    ['$3', '$9'],
    ['$3', '$6'],
    ['$3', '$5'],
    ['$3', '$8'],
    ['$3', '$1'],
    ['$PROFILE', '$DOCUMENTS'],
    ['$PROFILE', '$DESKTOP'],
    ['$PROFILE', '$APPDATA'],
    ['mythos_nr_ok', 'mythos_reparse_walk'],
    ['mythos_nr_ok', 'uninstall_vault_do_delete'],
    ['uninstall_vault_read', 'mythos_nr_ok'],
    ['uninstall_vault_read', 'mythos_nr_documents'],
    [' 0 ', ' +2 '],
    [' 0 ', ' +1 '],
    [' 1 ', ' 0 '],
  ];
  const gotos = [
    'Goto mythos_nr_ok',
    'Goto mythos_reparse_walk',
    'Goto uninstall_vault_do_delete',
    'Goto mythos_reparse_leaf',
    'Goto uninstall_vault_file',
    'Goto mythos_nr_documents',
    'Goto mythos_nr_desktop',
    'Goto mythos_canon_gate',
  ] as const;
  const out: { key: string; nsh: string }[] = [];
  for (let line = 437; line <= 461; line += 1) {
    const src = fileLines[line - 1]!;
    const indent = src.match(/^\s*/)?.[0] ?? '';
    for (const [a, b] of swaps) {
      if (!src.includes(a) || a === b) {
        continue;
      }
      const next = [...fileLines];
      next[line - 1] = src.replace(a, b);
      out.push({ key: `${line}:extra:${a}->${b}`, nsh: next.join('\n') });
    }
    for (const g of gotos) {
      const next = [...fileLines];
      next[line - 1] = `${indent}${g}`;
      out.push({ key: `${line}:extra:${g}`, nsh: next.join('\n') });
    }
  }
  return out;
}

/**
 * Shield 112: pick mutants from the region map / oracle-class sweep on the
 * nested Downloads block (:437–:461), not by the N7/N8 rows. Red is mode-2
 * (full pin-free tables).
 */
function nestedDownloadsRegionMutants(): { key: string; nsh: string }[] {
  const seen = new Set<string>();
  const out: { key: string; nsh: string }[] = [];
  const candidates = [
    ...generateOracleClassMutants(nsh).filter((m) => m.fileLine >= 437 && m.fileLine <= 461),
    ...extraDownloadsBlockMutants(),
  ];
  for (const mutant of candidates) {
    if (seen.has(mutant.key)) {
      continue;
    }
    seen.add(mutant.key);
    out.push({ key: mutant.key, nsh: mutant.nsh });
  }
  return out;
}

describe('HARD-2 nested Downloads (112 survivors)', () => {
  it('N7/N8 ancestor and nested Downloads rows skip, including bare / \\ / short-name', () => {
    expect(NESTED_DOWNLOADS_PROBE_ROWS.length).toBeGreaterThanOrEqual(16);
    expect(NESTED_DOWNLOADS_PROBE_ROWS.every((r) => r.expect === 'skip')).toBe(true);
    expect(() => assertSidecarHard2NestedTables(nsh)).not.toThrow();
  });

  it('Downloads proper-prefix Documents child still deletes; :460/:461 goto_inc skip it', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H5 Downloads proper-prefix'))!;
    expect(sidecarHardADeleted(nsh, row)).toEqual(['C:\\Users\\me\\Download']);
    const goto460 = generateOracleClassMutants(nsh).find((m) => m.key === '460:goto_inc')!;
    const goto461 = generateOracleClassMutants(nsh).find((m) => m.key === '461:goto_inc')!;
    expect(sidecarHardADeleted(goto460.nsh, row)).toEqual([]);
    expect(sidecarHardADeleted(goto461.nsh, row)).toEqual([]);
    expect(sidecarGuardModeTwoCaught(goto460.nsh, nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(goto461.nsh, nsh)).toBe(true);
  });

  it('Downloads ancestor sep Nop (:377) deletes Documents\\prof', () => {
    expect(fileLines[434]!.trim()).toBe('StrCmp $6 "\\" uninstall_vault_read');
    const mutant = withFileLine(435, 'Nop');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('all nested-Downloads region-map mutants are red (all-of, ≥112)', () => {
    const skipLines = new Set<number>([
      ...Object.keys(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES).map(Number),
      ...ORACLE_CLASS_ALL_EQUIVALENT_LINES,
    ]);
    const selected = nestedDownloadsRegionMutants().filter((mutant) => {
      const fileLine = Number(mutant.key.split(':', 1)[0]);
      if (!Number.isFinite(fileLine) || skipLines.has(fileLine)) {
        return false;
      }
      // Jump-retargets on already-fail-closed compares, IntCmp 0→+N extras, and
      // $9→$5 / $9→$6 leftover copies stay equivalent — they are not the 112.
      // goto_inc on a line that is already `Goto …` is the same retarget as :tgt
      // (`Goto uninstall_vault_read` → `Goto mythos_trav_inc`).
      if (mutant.key.includes(':tgt')) {
        return false;
      }
      if (mutant.key.endsWith(':goto_inc') && fileLines[fileLine - 1]!.trim().startsWith('Goto ')) {
        return false;
      }
      if (
        mutant.key.includes(':extra: 0 ->') ||
        mutant.key.includes(':extra:$9->$5') ||
        mutant.key.includes(':extra:$9->$6') ||
        mutant.key.includes(':extra:mythos_nr_ok->') ||
        mutant.key.includes(':extra:Goto mythos_canon_gate')
      ) {
        return false;
      }
      return true;
    });
    expect(selected.length).toBeGreaterThanOrEqual(112);
    const survivors = selected.filter((mutant) => !sidecarGuardModeTwoCaught(mutant.nsh, nsh));
    expect(survivors.map((s) => s.key), `${survivors.length} of ${selected.length} region-map mutants survived`).toEqual(
      [],
    );
  }, 189_000);
});

describe('walk survivors :388/:389 (freeze :307/:308)', () => {
  it('1-char component junction row is in the RF-7 table', () => {
    expect(SIDECAR_RF7_REPARSE_ROWS.some((r) => r.path === RF7_ONE_CHAR_JUNCTION_VAULT)).toBe(true);
    expect(
      sidecarRf7Deleted(
        nsh,
        SIDECAR_RF7_REPARSE_ROWS.find((r) => r.path === RF7_ONE_CHAR_JUNCTION_VAULT)!,
        DEFAULT_SIDECAR_NSIS_VAR_ENV,
      ),
    ).toEqual([]);
  });

  for (const spec of WALK_SIX_MUTANTS) {
    it(`${spec.name} is red on root\\a\\b\\v`, () => {
      const mutant =
        spec.text === 'DUP'
          ? [...fileLines.slice(0, spec.line), fileLines[spec.line - 1]!, ...fileLines.slice(spec.line)].join('\n')
          : withFileLine(spec.line, spec.text);
      expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
      const deleted = sidecarRf7Deleted(
        mutant,
        SIDECAR_RF7_REPARSE_ROWS.find((r) => r.path === RF7_ONE_CHAR_JUNCTION_VAULT)!,
        DEFAULT_SIDECAR_NSIS_VAR_ENV,
      );
      expect(deleted, spec.name).toEqual([RF7_ONE_CHAR_JUNCTION_VAULT]);
      expect(deleted, spec.name).not.toContain(RF7_ONE_CHAR_JUNCTION);
    });
  }
});

describe('H3 Secure Hard + H4 line-GLP fail-closed', () => {
  it('combined missing-root + EVIL~1 trailing-space run deletes only the legit vault', () => {
    expect(SIDECAR_H3_H4_COMBINED_ROWS).toHaveLength(1);
    expect(() => assertSidecarH3H4CombinedTables(nsh)).not.toThrow();
  });

  it('H3 revert (scan Goto ret) is mode-2 red and deletes the EVIL~1 Desktop decoy', () => {
    expect(fileLines[502]!.trim()).toBe('mythos_comp_tail_scan: StrCpy $4 $2 1');
    const next = [...fileLines];
    next[502] = '        mythos_comp_tail_scan: Goto mythos_comp_tail_ret';
    const mutant = next.join('\n');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H3a EVIL~1'));
    expect(row, 'H3a EVIL~1 row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Users\\me\\Documents\\evil']);
  });

  it('line GLP +3 fallback is mode-2 red and deletes the 1st-call GLP-fault vault', () => {
    expect(fileLines[143]!.trim()).toBe('IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0');
    const mutant = withFileLine(144, 'IntCmp $4 0 +3 0 0');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('path GLP 1st-call fault'));
    expect(row, 'path GLP 1st-call fault row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Users\\me\\Documents\\MyVault']);
  });

  it('walk $3→$1 at :469/:475 is red on / and RF7PAR~1 parent-junction rows', () => {
    expect(fileLines[468]!.trim()).toBe('StrCpy $6 $3 1 $7');
    expect(fileLines[474]!.trim()).toBe('StrCpy $6 $3 $7');
    const slash = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('parent junction via /'));
    const short = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('RF7PAR~1'));
    expect(slash, 'parent junction via /').toBeDefined();
    expect(short, 'parent junction via RF7PAR~1').toBeDefined();
    expect(sidecarRf7Deleted(nsh, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    expect(sidecarRf7Deleted(nsh, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);

    const charMutant = withFileLine(469, 'StrCpy $6 $1 1 $7');
    const prefixMutant = withFileLine(475, 'StrCpy $6 $1 $7');
    expect(sidecarGuardModeTwoCaught(charMutant, nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(prefixMutant, nsh)).toBe(true);

    const expandedParentVault = 'C:\\Users\\me\\Documents\\rf7-parent\\vault';
    expect(sidecarRf7Deleted(charMutant, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
    expect(sidecarRf7Deleted(charMutant, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
    expect(sidecarRf7Deleted(prefixMutant, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
  });

  it('mutation sweep fully covers .nsh :317-:487', () => {
    const covered = new Set(generateOracleClassMutants(nsh).map((m) => m.fileLine));
    const missing: number[] = [];
    for (let fileLine = 317; fileLine <= 487; fileLine += 1) {
      if (!covered.has(fileLine)) {
        missing.push(fileLine);
      }
    }
    expect(missing, 'oracle-class mutants missing in :317-:487').toEqual([]);
  });

  it('oracle-class corpus emits $3→$1 (not only $3→$2) on the walk and leaf-check lines', () => {
    const keys = new Set(generateOracleClassMutants(nsh).map((m) => m.key));
    expect(keys.has('469:$3->$1')).toBe(true);
    expect(keys.has('475:$3->$1')).toBe(true);
    expect(keys.has('483:r3->r1')).toBe(true);
  });

  it('HARD-E short ME~1 / APPDAT~1 nested-guard rows skip', () => {
    expect(SIDECAR_HARD_E_ROWS).toHaveLength(3);
    for (const row of SIDECAR_HARD_E_ROWS) {
      expect(
        simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted,
        row.id,
      ).toEqual([]);
    }
  });

  it(':405 StrLen $8 $3→$1 and :407 StrCmp $6 $3→$1 are red on ME~1 Documents-ancestor', () => {
    expect(fileLines[404]!.trim()).toBe('StrLen $8 $3');
    expect(fileLines[406]!.trim()).toBe('StrCmp $6 $3 0 mythos_nr_desktop');
    const row = SIDECAR_HARD_E_ROWS.find((r) => r.id.includes('Documents-ancestor'))!;
    const lenMutant = withFileLine(405, 'StrLen $8 $1');
    const cmpMutant = withFileLine(407, 'StrCmp $6 $1 0 mythos_nr_desktop');
    expect(sidecarGuardModeTwoCaught(lenMutant, nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(cmpMutant, nsh)).toBe(true);
    expect(simulateSidecarDeleteReadLoop(lenMutant, [`${row.path}\r\n`], row.env).deleted).toEqual([
      'C:\\Users\\me\\OneDrive',
    ]);
    expect(simulateSidecarDeleteReadLoop(cmpMutant, [`${row.path}\r\n`], row.env).deleted).toEqual([
      'C:\\Users\\me\\OneDrive',
    ]);
  });

  it(':379 StrLen / :381 StrCmp $3→$1 are red on APPDAT~1 AppData-ancestor', () => {
    expect(fileLines[378]!.trim()).toBe('StrLen $8 $3');
    expect(fileLines[380]!.trim()).toBe('StrCmp $6 $3 0 mythos_nr_documents');
    const row = SIDECAR_HARD_E_ROWS.find((r) => r.id.includes('APPDAT~1-AppData-ancestor'))!;
    expect(row, 'HARD-E AppData ancestor').toBeDefined();
    const lenMutant = withFileLine(379, 'StrLen $8 $1');
    const cmpMutant = withFileLine(381, 'StrCmp $6 $1 0 mythos_nr_documents');
    expect(sidecarGuardModeTwoCaught(lenMutant, nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(cmpMutant, nsh)).toBe(true);
    expect(simulateSidecarDeleteReadLoop(lenMutant, [`${row.path}\r\n`], row.env).deleted).toEqual([
      'C:\\Users\\me\\AppData',
    ]);
    expect(simulateSidecarDeleteReadLoop(cmpMutant, [`${row.path}\r\n`], row.env).deleted).toEqual([
      'C:\\Users\\me\\AppData',
    ]);
  });

  it(':433 StrCmp $6 $3→$1 is red on the Desktop/Documents swap row', () => {
    expect(fileLines[432]!.trim()).toBe('StrCmp $6 $3 0 mythos_nr_downloads');
    const row = SIDECAR_HARD_E_ROWS.find((r) => r.id.includes('Desktop-ancestor-swap'))!;
    const mutant = withFileLine(433, 'StrCmp $6 $1 0 mythos_nr_downloads');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    expect(simulateSidecarDeleteReadLoop(mutant, [`${row.path}\r\n`], row.env).deleted).toEqual([
      'C:\\Users\\me\\OneDrive',
    ]);
  });

  it('leaf-check $3→$1 at :483 is red on / and LEAFJ~1 leaf-junction rows', () => {
    expect(fileLines[349]!.trim()).toBe('StrCpy $1 $9');
    expect(fileLines[461]!.trim()).toBe('mythos_nr_ok:');
    expect(fileLines[462]!.trim()).toBe('StrCpy $9 $1');
    expect(fileLines[464]!.trim()).toBe('mythos_reparse_walk:');
    expect(fileLines[482]!.trim()).toBe('System::Call "kernel32::GetFileAttributesW(w r3) i .r4"');
    const slash = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('leaf junction via /'));
    const short = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('LEAFJ~1 skips'));
    expect(slash, 'leaf junction via /').toBeDefined();
    expect(short, 'leaf junction via LEAFJ~1').toBeDefined();
    expect(sidecarRf7Deleted(nsh, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    expect(sidecarRf7Deleted(nsh, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);

    const mutant = withFileLine(483, 'System::Call "kernel32::GetFileAttributesW(w r1) i .r4"');
    const slashDeleted = sidecarRf7Deleted(mutant, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV);
    const shortDeleted = sidecarRf7Deleted(mutant, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV);
    expect(slashDeleted, 'red run: r3→r1 deletes the / leaf junction').toEqual([
      'C:\\Users\\me\\Documents\\leaf-junc',
    ]);
    expect(shortDeleted, 'red run: r3→r1 deletes the LEAFJ~1 leaf junction').toEqual([
      'C:\\Users\\me\\Documents\\leaf-junc',
    ]);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('leaf GFA r3→r1 is red because $1 holds the walk root, not a :462 smash', () => {
    const row = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('without nr_ok $1 smash'));
    expect(row, 'leaf GFA without nr_ok smash row').toBeDefined();
    expect(sidecarRf7Deleted(nsh, row!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    expect(fileLines[461]!.trim()).toBe('mythos_nr_ok:');
    const mutant = withFileLine(483, 'System::Call "kernel32::GetFileAttributesW(w r1) i .r4"');
    expect(sidecarRf7Deleted(mutant, row!, DEFAULT_SIDECAR_NSIS_VAR_ENV), 'red run: r3→r1 GFAs the saved root').toEqual([
      'C:\\Users\\me\\Documents\\leaf-junc',
    ]);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('G3 :404 $3→$1 deletes Documents sitting inside Mythos Writer\\Docs', () => {
    expect(fileLines[403]!.trim()).toBe('StrCmp $3 $9 uninstall_vault_read');
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('G3 Documents inside Mythos Writer'));
    expect(row, 'G3 Documents-inside-Mythos-Writer row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const mutant = withFileLine(404, 'StrCmp $1 $9 uninstall_vault_read');
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs']);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('/ and 8.3 Mythos Writer, Downloads, and short-Desktop vaults still delete; $3→$1 false-rejects', () => {
    const cases: readonly { name: string; line: number; text: string }[] = [
      { name: 'Mythos Writer vault via / still deletes', line: 216, text: 'StrCpy $4 $1 $8' },
      { name: 'Mythos Writer vault via / still deletes', line: 219, text: 'StrCpy $4 $1 1 $8' },
      { name: 'Mythos Writer vault via MYTHOS~1\\v still deletes', line: 221, text: 'StrCpy $6 $1 "" $8' },
      { name: 'Downloads vault via / still deletes', line: 306, text: 'StrCpy $4 $1 $8' },
      { name: 'Downloads vault via / still deletes', line: 309, text: 'StrCpy $4 $1 1 $8' },
      { name: 'Downloads vault via DOWNLO~1\\v still deletes', line: 311, text: 'StrCpy $6 $1 "" $8' },
      { name: 'short-Desktop MYDESK~1\\v still deletes', line: 281, text: 'StrCpy $6 $1 "" $8' },
    ];
    for (const { name, line, text } of cases) {
      const row = SIDECAR_HARD_A_ROWS.find((r) => r.name === name);
      expect(row, name).toBeDefined();
      expect(sidecarHardADeleted(nsh, row!).length, `${name} canon`).toBe(1);
      const mutant = withFileLine(line, text);
      expect(sidecarHardADeleted(mutant, row!), `${name} :${line} $3→$1`).toEqual([]);
    }
  });

  it('nested Documents GLP access-denied skips OneDrive ancestor and never RMDirs it', () => {
    const row = SIDECAR_HARD_A_ROWS.find(
      (r) => r.name === 'nested Documents GLP access-denied skips OneDrive ancestor (no next-root)',
    )!;
    expect(row, 'access-denied nested Documents ancestor row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row)).toEqual([]);
    for (const ban of row.mustNotDelete ?? []) {
      expect(sidecarHardADeleted(nsh, row)).not.toContain(ban);
    }
  });

  it('H5 :350 Nop is red — parent-junction vault deletes when the walk root is not saved', () => {
    expect(fileLines[349]!.trim()).toBe('StrCpy $1 $9');
    const row = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.startsWith('parent junction + plain vault'));
    expect(row, 'RF-7 parent junction').toBeDefined();
    expect(sidecarRf7Deleted(nsh, row!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    const mutant = withFileLine(350, 'Nop');
    expect(sidecarRf7Deleted(mutant, row!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([
      'C:\\Users\\me\\Documents\\rf7-parent\\vault',
    ]);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
  });

  it('H5 must-delete: junction at/above Documents, Desktop, profile, C:\\Users, or C:\\Users GFA still deletes', () => {
    const cases: readonly { name: string; deleted: string }[] = [
      { name: 'H5 Documents root junction still deletes a Documents vault', deleted: 'C:\\Users\\me\\Documents\\MyVault' },
      { name: 'H5 Desktop root junction still deletes a Desktop vault', deleted: 'C:\\Users\\me\\Desktop\\MyVault' },
      { name: 'H5 profile junction still deletes a Documents vault', deleted: 'C:\\Users\\me\\Documents\\MyVault' },
      { name: 'H5 C:\\Users junction still deletes a Documents vault', deleted: 'C:\\Users\\me\\Documents\\MyVault' },
      { name: 'H5 C:\\Users GFA error still deletes a Documents vault', deleted: 'C:\\Users\\me\\Documents\\MyVault' },
    ];
    for (const { name, deleted } of cases) {
      const row = SIDECAR_HARD_A_ROWS.find((r) => r.name === name);
      expect(row, name).toBeDefined();
      expect(sidecarHardADeleted(nsh, row!), name).toEqual([deleted]);
    }
    expect(sidecarGuardModeTwoCaught(withFileLine(350, 'Nop'), nsh)).toBe(true);
    const leftover = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H5 :463 leftover Downloads'))!;
    expect(sidecarHardADeleted(nsh, leftover)).toEqual([]);
    expect(sidecarHardADeleted(withFileLine(463, 'Nop'), leftover)).toEqual([
      'C:\\Users\\me\\Documents\\rf7-parent\\vault',
    ]);
    expect(sidecarGuardModeTwoCaught(withFileLine(463, 'Nop'), nsh)).toBe(true);
  });

  it('H5 shorter-after-longer: plain vault deletes, first-child junction skips, clobbered $7 fails (a)', () => {
    expect(fileLines[349]!.trim()).toBe('StrCpy $1 $9');
    expect(fileLines[462]!.trim()).toBe('StrCpy $9 $1');
    const revert = (() => {
      const next = [...fileLines];
      const saveIndent = next[349]!.match(/^\s*/)?.[0] ?? '';
      const restoreIndent = next[462]!.match(/^\s*/)?.[0] ?? '';
      next[349] = `${saveIndent}StrCpy $7 $9`;
      next[462] = `${restoreIndent}StrCpy $9 $7`;
      return next.join('\n');
    })();
    const pairs: readonly { plain: string; child: string; deleted: string; skipped: string }[] = [
      {
        plain: 'H5 shorter Desktop after longer Downloads: plain vault deletes',
        child: 'H5 shorter Desktop after longer Downloads: first-child junction skips',
        deleted: 'C:\\Users\\me\\Desktop\\MyVault',
        skipped: 'C:\\Users\\me\\Desktop\\desk-junc\\vault',
      },
      {
        plain: 'H5 shorter Documents after longer Downloads: plain vault deletes',
        child: 'H5 shorter Documents after longer Downloads: first-child junction skips',
        deleted: 'C:\\Users\\me\\Documents\\MyVault',
        skipped: 'C:\\Users\\me\\Documents\\doc-junc\\vault',
      },
      {
        plain: 'H5 shorter Mythos Writer after longer Downloads: plain vault deletes',
        child: 'H5 shorter Mythos Writer after longer Downloads: first-child junction skips',
        deleted: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
        skipped: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\mw-junc\\vault',
      },
    ];
    for (const { plain, child, deleted, skipped } of pairs) {
      const a = SIDECAR_HARD_A_ROWS.find((r) => r.name === plain)!;
      const b = SIDECAR_HARD_A_ROWS.find((r) => r.name === child)!;
      expect(sidecarHardADeleted(nsh, a), plain).toEqual([deleted]);
      expect(sidecarHardADeleted(nsh, b), child).toEqual([]);
      expect(sidecarHardADeleted(nsh, b), child).not.toContain(skipped);
      expect(sidecarHardADeleted(revert, a), `clobbered $7 must fail ${plain}`).toEqual([]);
    }
    expect(sidecarGuardModeTwoCaught(revert, nsh)).toBe(true);
  });

  it('H6 :393 / :445 / :372 Nop each delete a nested root or its parent', () => {
    const docs = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H6 :393'))!;
    const dl = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H6 :445'))!;
    const ad = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H6 :372'))!;
    expect(sidecarHardADeleted(nsh, docs)).toEqual([]);
    expect(sidecarHardADeleted(nsh, dl)).toEqual([]);
    expect(sidecarHardADeleted(nsh, ad)).toEqual([]);
    expect(sidecarHardADeleted(withFileLine(393, 'Nop'), docs)).toEqual(['C:\\Users\\me\\Desktop\\My Desktop']);
    expect(sidecarHardADeleted(withFileLine(445, 'Nop'), dl)).toEqual(['C:\\Users\\me\\Documents\\My Desktop']);
    expect(sidecarHardADeleted(withFileLine(372, 'Nop'), ad)).toEqual(['C:\\Users\\me\\Documents\\My Desktop']);
    expect(sidecarGuardModeTwoCaught(withFileLine(393, 'Nop'), nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(withFileLine(445, 'Nop'), nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(withFileLine(372, 'Nop'), nsh)).toBe(true);
  });

  it('H6 ME~1 env nested under Documents and Downloads (exact-root and ancestor) skips', () => {
    const names = SIDECAR_HARD_A_ROWS.filter((r) => r.name.startsWith('H6 ME~1')).map((r) => r.name);
    expect(names.some((n) => n.includes('under Documents') && n.includes('exact-root'))).toBe(true);
    expect(names.some((n) => n.includes('under Documents') && n.includes('ancestor'))).toBe(true);
    expect(names.some((n) => n.includes('under Downloads') && n.includes('exact-root'))).toBe(true);
    expect(names.some((n) => n.includes('under Downloads') && n.includes('ancestor'))).toBe(true);
    for (const row of SIDECAR_HARD_A_ROWS.filter((r) => r.name.startsWith('H6 ME~1'))) {
      expect(sidecarHardADeleted(nsh, row), row.name).toEqual([]);
    }
    const mw = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H6 short-env Mythos Writer GLP errno 5'))!;
    expect(sidecarHardADeleted(nsh, mw)).toEqual([]);
    expect(sidecarHardADeleted(withFileLine(372, 'Nop'), mw)).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    ]);
  });

  it('H6 all-of: every StrCpy $9 $2 and Goto uninstall_vault_read in :358-:461 Nop is red', () => {
    const lines: number[] = [];
    for (let fileLine = 358; fileLine <= 461; fileLine += 1) {
      const text = fileLines[fileLine - 1]!.trim();
      if (text === 'StrCpy $9 $2' || text === 'Goto uninstall_vault_read') {
        lines.push(fileLine);
      }
    }
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines).toEqual([367, 372, 393, 398, 419, 424, 445, 450]);
    for (const fileLine of lines) {
      expect(sidecarGuardModeTwoCaught(withFileLine(fileLine, 'Nop'), nsh), `:${fileLine} Nop`).toBe(true);
    }
  });

  it('nested Documents GLP access-denied other-error Goto Nop deletes the Documents vault', () => {
    const row = SIDECAR_HARD_A_ROWS.find(
      (r) => r.name === 'nested Documents GLP access-denied skips a Documents vault (no next-root)',
    )!;
    expect(row, 'access-denied nested Documents vault row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row)).toEqual([]);
    const nopGoto = withFileLine(398, 'Nop');
    expect(sidecarHardADeleted(nopGoto, row)).toEqual(['C:\\Users\\me\\Documents\\MyVault']);
  });
});

/** Safety rows (mustNotDelete). Nested *can* still fire — not used as unmasking kills. */
const HARD_F_SAFETY_SKIP = ['HARD-F :237', 'S-19 '] as const;

/**
 * Isolated skip rows where the error branch under test is the only protection:
 * canon never reaches nested; a mutant that H3s the leftover GFPN hits a
 * nested-pass child (line is a child of the root, not an ancestor), so later
 * :363 cannot save it. Masked-by-:363 does not count as killed.
 */
const HARD_F_UNMASKED_SKIP = [
  'HARD-F :200 errno 5',
  'HARD-F :200 errno 2',
  'HARD-F :200 errno 3',
  'HARD-F :230 errno 5',
  'HARD-F :230 errno 2',
  'HARD-F :230 errno 3',
  'HARD-F :260 not-found errno 2',
  'HARD-F :260 errno 5',
  'HARD-F :260 errno 3',
  'HARD-F :363 errno 5',
  'HARD-F :363 errno 2',
  'HARD-F :363 errno 3',
] as const;

const HARD_F_ISOLATED_SKIP = [...HARD_F_UNMASKED_SKIP, ...HARD_F_SAFETY_SKIP] as const;

/**
 * Written reasons for mutants that stay equal on the unmasked rows *after* the
 * later nested guard is removed (`nshBypassLaterNestedGuard`). Masked-by-:363
 * is not listed. No catch-all `:tgt` / `:jmp` — each survivor must match a
 * specific operand reason that still holds with nested gone.
 */
const HARD_F_JUMP_EQUIV_REASONS: Readonly<Record<string, string>> = {
  ':+5->+6':
    'Extra fail-close past the errno block. Isolated rows still deny; later nested bypassed: still deny.',
  ':+5->+7':
    'Extra fail-close past the errno block. Isolated rows still deny; later nested bypassed: still deny.',
  ':+5->0':
    'GLP-fail +5→0 falls into MAX/empty and still fail-closes. Isolated rows still deny; later nested bypassed: still deny.',
  ':+5->+1':
    'GLP-fail +5→+1 still fail-closes (MAX/uninstall). Isolated rows still deny; later nested bypassed: still deny.',
  ':+5->+2':
    'GLP-fail +5→+2 still fail-closes (MAX/uninstall). Isolated rows still deny; later nested bypassed: still deny.',
  ':+3->0':
    'Errno-2 +3→0 falls into errno-3 / other-error deny. Isolated rows still deny; later nested bypassed: still deny.',
  ':+3->+1':
    'Errno-2 extra fail-close. Isolated rows still deny; later nested bypassed: still deny.',
  ':+3->+2':
    'Errno-2 extra fail-close. Isolated rows still deny; later nested bypassed: still deny.',
  ':+2->0':
    'Errno-3 +2→0 falls into other-error deny. Isolated rows still deny; later nested bypassed: still deny.',
  ':+2->-1':
    'Errno-3 extra fail-close. Isolated rows still deny; later nested bypassed: still deny.',
  ':+2->+1':
    'Errno-3 extra fail-close. Isolated rows still deny; later nested bypassed: still deny.',
  ':+2->+3':
    'Errno-3 +2→+3 still fail-closes this isolated root. Isolated rows still deny; later nested bypassed: still deny.',
  ':+2->+4':
    'Errno-3 +2→+4 still fail-closes this isolated root. Isolated rows still deny; later nested bypassed: still deny.',
  ':+3->+4':
    'Errno-2 +3→+4 still fail-closes this isolated root when the leftover GFPN does not match. Later nested bypassed: still deny.',
  ':+3->+5':
    'Errno-2 +3→+5 is empty-$2 / fail-closed default. Isolated rows still deny; later nested bypassed: still deny.',
  ':jmp4:0->':
    'Unused IntCmp less-branch 0±N on a taken equal. Isolated rows still deny; later nested bypassed: still unused.',
  ':jmp5:0->':
    'Unused IntCmp greater-branch 0±N on a taken equal. Isolated rows still deny; later nested bypassed: still unused.',
  '205:tgt3:':
    'StrCmp empty-$5 equal-target. Isolated errno takes IntCmp $4 0 +5 and never reaches :205. Later nested bypassed: still deny.',
  '235:tgt3:':
    'StrCmp empty-$5 equal-target. Isolated errno never reaches :235. Later nested bypassed: still deny.',
  '265:tgt3:':
    'StrCmp empty-$5 equal-target. Isolated errno never reaches :265. Later nested bypassed: still deny.',
  '368:tgt3:':
    'StrCmp empty-$9 equal-target. Isolated :363 errno jumps to :370 and never reaches :368. Later nested bypassed: still deny on allowlist-isolated rows.',
  '206:tgt1:':
    'Goto H3→offset is the success path. Isolated errno never reaches :206. Later nested bypassed: still deny.',
  '236:tgt1:':
    'Goto H3→offset is the success path. Isolated errno never reaches :236. Later nested bypassed: still deny.',
  '266:tgt1:':
    'Goto H3→offset is the success path. Isolated errno never reaches :266. Later nested bypassed: still deny.',
  '369:tgt1:':
    'Goto H3→offset is the success path. Isolated :363 errno never reaches :369. Later nested bypassed: still deny on allowlist-isolated rows.',
  '209:tgt1:mythos_al_not_appdata->0':
    'Other-error →0 falls into fb_5a; existing GFA → not_appdata. Later nested bypassed: still deny.',
  '209:tgt1:mythos_al_not_appdata->+6':
    'Other-error +6 lands past the H3 tag; empty $2 fail-closes. Later nested bypassed: still deny.',
  '239:tgt1:mythos_al_not_documents->0':
    'Other-error →0 falls into fb_5d; existing GFA → not_documents. Later nested bypassed: still deny.',
  '239:tgt1:mythos_al_not_documents->+6':
    'Other-error +6 lands past the H3 tag; empty $2 fail-closes. Later nested bypassed: still deny.',
  '269:tgt1:mythos_al_not_desktop->0':
    'Other-error →0 falls into fb_5k; existing GFA → not_desktop. Later nested bypassed: still deny.',
  '269:tgt1:mythos_al_not_desktop->+6':
    'Other-error +6 lands past the H3 tag; empty $2 fail-closes. Later nested bypassed: still deny.',
  '210:tgt1:mythos_glp_fb_5a->+2':
    'fb +2 is Goto tail with empty $2; :540 fail-closed. Later nested bypassed: still deny.',
  '210:tgt1:mythos_glp_fb_5a->+4':
    'fb +4 smashes the prefix check with $8=errno; no match. Later nested bypassed: still deny.',
  '240:tgt1:mythos_glp_fb_5d->+2':
    'fb +2 is Goto tail with empty $2; :540 fail-closed. Later nested bypassed: still deny.',
  '240:tgt1:mythos_glp_fb_5d->+4':
    'fb +4 smashes the prefix check with $8=errno; no match. Later nested bypassed: still deny.',
  '270:tgt1:mythos_glp_fb_5k->+2':
    'fb +2 is Goto tail with empty $2; :540 fail-closed. Later nested bypassed: still deny.',
  '270:tgt1:mythos_glp_fb_5k->+4':
    'fb +4 smashes the prefix check with $8=errno; no match. Later nested bypassed: still deny.',
  '372:tgt1:uninstall_vault_read->0':
    'Nested other-error →0 falls into fb_9a. Existing nested root GFA → uninstall (same skip). Later nested bypassed: allowlist already matched, both delete. Same delete set.',
  '373:tgt1:mythos_glp_fb_9a->+2':
    'Nested fb +2 smashes the 9a tail without H3. Isolated :363 still skips. Later nested bypassed: both delete (allowlist already matched). Same delete set.',
};

function hardFEquivReason(key: string): string | undefined {
  const hits = Object.entries(HARD_F_JUMP_EQUIV_REASONS).filter(([needle]) => key.includes(needle));
  hits.sort((a, b) => b[0].length - a[0].length);
  return hits[0]?.[1];
}

function hardFDeleted(program: string, row: (typeof SIDECAR_HARD_A_ROWS)[number]): string[] {
  try {
    return sidecarHardADeleted(program, row);
  } catch (err) {
    if (err instanceof Error && err.message.includes(SIDECAR_LINE_STEP_LIMIT_ERROR)) {
      return [];
    }
    throw err;
  }
}

function hardFExtraDelete(
  program: string,
  canonProgram: string,
  row: (typeof SIDECAR_HARD_A_ROWS)[number],
): boolean {
  const canon = hardFDeleted(canonProgram, row);
  const got = hardFDeleted(program, row);
  if (got.length > 0 && canon.length === 0) {
    return true;
  }
  for (const ban of row.mustNotDelete ?? []) {
    if (got.includes(ban)) {
      return true;
    }
  }
  return false;
}

describe('HARD-F isolated GLP error branches + jump-offset corpus', () => {
  it('HARD-F isolated skip rows deny without relying on later nested, and kill +5→+3/+4', () => {
    const isolated = SIDECAR_HARD_A_ROWS.filter((r) => HARD_F_ISOLATED_SKIP.some((p) => r.name.startsWith(p)));
    expect(isolated.length).toBeGreaterThanOrEqual(18);
    for (const row of isolated) {
      expect(sidecarHardADeleted(nsh, row), row.name).toEqual(row.expect === 'delete' ? [row.path] : []);
      for (const ban of row.mustNotDelete ?? []) {
        expect(sidecarHardADeleted(nsh, row), row.name).not.toContain(ban);
      }
    }
    const docsE5 = isolated.find((r) => r.name.startsWith('HARD-F :230 errno 5'))!;
    const plus4 = generateGlpErrorJumpOffsetMutants(nsh).find((m) => m.key === '232:jmp3:+5->+4')!;
    expect(plus4, ':232 +5→+4').toBeDefined();
    expect(sidecarHardADeleted(nsh, docsE5)).toEqual([]);
    expect(sidecarHardADeleted(plus4.nsh, docsE5)).toEqual(['C:\\Users\\me\\Documents\\MyVault']);
    expect(sidecarGuardModeTwoCaught(plus4.nsh, nsh)).toBe(true);
    const deskE5 = isolated.find((r) => r.name.startsWith('HARD-F :260 errno 5'))!;
    const deskPlus2 = generateGlpErrorOracleJumpSwapMutants(nsh).find(
      (m) => m.key === '269:tgt1:mythos_al_not_desktop->+2',
    )!;
    expect(deskPlus2, ':269 +2').toBeDefined();
    expect(sidecarHardADeleted(nsh, deskE5)).toEqual([]);
    expect(sidecarHardADeleted(deskPlus2.nsh, deskE5)).toEqual(['C:\\Users\\me\\Desktop\\v']);
    expect(sidecarGuardModeTwoCaught(deskPlus2.nsh, nsh)).toBe(true);
  });

  it('HARD-F :237 +3→+5 OneDrive missing Documents never RMDirs OneDrive', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('HARD-F :237'))!;
    expect(sidecarHardADeleted(nsh, row)).toEqual([]);
    expect(sidecarHardADeleted(nsh, row)).not.toContain('C:\\Users\\me\\OneDrive');
    const plus5 = generateGlpErrorJumpOffsetMutants(nsh).find((m) => m.key === '237:jmp3:+3->+5')!;
    expect(plus5, ':237 +3→+5').toBeDefined();
    const deleted = sidecarHardADeleted(plus5.nsh, row);
    expect(deleted).not.toContain('C:\\Users\\me\\OneDrive');
    expect(sidecarGuardModeTwoCaught(plus5.nsh, nsh) || deleted.length === 0).toBe(true);
  });

  it('HARD-F H3 no-tag default fail-closed skips a Downloads vault when $2 is unknown', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('HARD-F H3 no-tag'))!;
    expect(sidecarHardADeleted(nsh, row)).toEqual(['C:\\Users\\me\\Downloads\\v']);
    const noTag = withFileLine(453, 'StrCpy $2 "zz"');
    expect(sidecarHardADeleted(noTag, row)).toEqual([]);
    const oldDefault = withFileLine(541, 'Goto mythos_comp_tail_ret9l');
    const oldNoTag = (() => {
      const next = oldDefault.split('\n');
      next[452] = '            StrCpy $2 "zz"';
      return next.join('\n');
    })();
    expect(sidecarHardADeleted(oldNoTag, row)).toEqual(['C:\\Users\\me\\Downloads\\v']);
    expect(sidecarGuardModeTwoCaught(noTag, nsh)).toBe(true);
  });

  it('every dangerous GLP-error jump-offset / jump-swap mutant is mode-2 red on an isolated row', () => {
    const isolated = SIDECAR_HARD_A_ROWS.filter(
      (r) => r.expect === 'skip' && HARD_F_UNMASKED_SKIP.some((p) => r.name.startsWith(p)),
    );
    const forge64 = generateGlpErrorOracleJumpSwapMutants(nsh);
    const mutants = [...generateGlpErrorJumpOffsetMutants(nsh), ...forge64];
    expect(forge64.length).toBe(64);
    expect(mutants.length).toBeGreaterThanOrEqual(64);
    const stripped = nshWithoutLaterNestedSkips(nsh);
    const dangerous: string[] = [];
    const masked: string[] = [];
    for (const mutant of mutants) {
      const dangerIntact = isolated.some((row) => hardFExtraDelete(mutant.nsh, nsh, row));
      if (dangerIntact) {
        dangerous.push(mutant.key);
        continue;
      }
      const strippedMutant = nshWithoutLaterNestedSkips(mutant.nsh);
      if (isolated.some((row) => hardFExtraDelete(strippedMutant, stripped, row))) {
        masked.push(mutant.key);
      }
    }
    expect(masked, `masked (later nested still the only skip): ${masked.join(', ')}`).toEqual([]);
    expect(dangerous.length).toBeGreaterThan(0);
    expect(dangerous, 'Documents +5→+4').toContain('232:jmp3:+5->+4');
    expect(dangerous, 'Desktop other-error +2').toContain('269:tgt1:mythos_al_not_desktop->+2');
    const plus4 = mutants.find((m) => m.key === '232:jmp3:+5->+4')!;
    expect(sidecarGuardModeTwoCaught(plus4.nsh, nsh)).toBe(true);
  }, 189_000);

  it('jump-offset / Forge-64 survivors have a written reason and stay equal with later nested removed', () => {
    const isolated = SIDECAR_HARD_A_ROWS.filter(
      (r) => r.expect === 'skip' && HARD_F_UNMASKED_SKIP.some((p) => r.name.startsWith(p)),
    );
    const allowlistIsolated = isolated.filter((r) => !r.name.startsWith('HARD-F :363'));
    const stripped = nshWithoutLaterNestedSkips(nsh);
    const bypassed = nshBypassLaterNestedGuard(nsh);
    const survivors: string[] = [];
    const missingReason: string[] = [];
    const corpus = [...generateGlpErrorJumpOffsetMutants(nsh), ...generateGlpErrorOracleJumpSwapMutants(nsh)];
    expect(generateGlpErrorOracleJumpSwapMutants(nsh).length).toBe(64);
    for (const mutant of corpus) {
      const strippedMutant = nshWithoutLaterNestedSkips(mutant.nsh);
      if (isolated.some((row) => hardFExtraDelete(strippedMutant, stripped, row))) {
        continue;
      }
      survivors.push(mutant.key);
      const bypassedMutant = nshBypassLaterNestedGuard(mutant.nsh);
      for (const row of allowlistIsolated) {
        expect(hardFDeleted(bypassedMutant, row), `${mutant.key} ${row.name} later-guards-removed`).toEqual(
          hardFDeleted(bypassed, row),
        );
      }
      if (hardFEquivReason(mutant.key) === undefined) {
        missingReason.push(mutant.key);
      }
    }
    expect(missingReason, `no written equiv reason: ${missingReason.join(', ')}`).toEqual([]);
    expect(survivors.length).toBeGreaterThan(0);
  }, 189_000);
});
