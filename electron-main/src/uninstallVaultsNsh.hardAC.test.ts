import { describe, expect, it } from 'vitest';

import { ORACLE_CLASS_ALL_EQUIVALENT_LINES } from './sidecarOracleClassSweep.test-helpers.js';
import {
  generateOracleClassMutants,
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
  SIDECAR_HARD2_NESTED_ROWS,
  SIDECAR_H3_H4_COMBINED_ROWS,
  SIDECAR_RF7_REPARSE_ROWS,
  assertSidecarH3H4CombinedTables,
  sidecarHardADeleted,
  sidecarRf7Deleted,
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
  { name: ':388 IntOp +2', line: 388, text: 'IntOp $7 $7 + 2' },
  { name: ':388 dup +1', line: 388, text: 'DUP' },
  { name: ':389 Goto +2', line: 389, text: 'Goto +2' },
  { name: ':389 Goto +3', line: 389, text: 'Goto +3' },
  { name: ':389 Goto +4', line: 389, text: 'Goto +4' },
  { name: ':389 Goto +6', line: 389, text: 'Goto +6' },
];

const HARD_C_EIGHTEEN: readonly { name: string; line: number; text: string }[] = [
  340, 342, 343, 357, 359, 360, 374, 376, 377,
].flatMap((line) => [
  { name: `:${line} Nop`, line, text: 'Nop' },
  { name: `:${line} del`, line, text: '' },
]);

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
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 166);
    expect(row, 'PROGRA~1 inside-allowlist row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const mutant = withFileLine(166, 'Nop');
    expect(sidecarHardADeleted(mutant, row!).length, 'Nop :166 must delete Shared Docs\\v').toBeGreaterThan(0);
  });

  it('missing-root rows pin every allow/deny root, not only WINDIR', () => {
    for (const root of ['WINDIR', 'PROGRAMFILES', 'PROGRAMFILES64', 'APPDATA', 'DOCUMENTS', 'DESKTOP', 'PROFILE']) {
      const rows = SIDECAR_HARD_A_ROWS.filter((r) => r.name.startsWith(`missing ${root} root`));
      expect(rows.length, root).toBeGreaterThanOrEqual(4);
    }
  });

  it('$1 revert on :173 (StrCpy $4 $1 $8) deletes Program Files\\Shared Docs\\v', () => {
    expect(fileLines[172]!.trim()).toBe('StrCpy $4 $3 $8');
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.includes('$1 revert'));
    expect(row).toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const mutant = withFileLine(173, 'StrCpy $4 $1 $8');
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Program Files\\Shared Docs\\v']);
  });

  it('failed canon-root GFPN writes $9, so Nop :284 is a real kill', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 284);
    expect(row, 'fail-write row for :284').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 284), row!);
    expect(got.length, 'Nop :284 must delete because the failed GFPN wrote $9').toBeGreaterThan(0);
  });

  it('truncated canon-root GFPN writes $9, so Nop :285 is a real kill', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 285);
    expect(row, 'trunc-write row for :285').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 285), row!);
    expect(got.length, 'Nop :285 must delete because the truncated GFPN wrote $9').toBeGreaterThan(0);
  });

  it('canon-root GLP fault at :286 skips a legit vault; Nop :286 deletes it', () => {
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.killsFileLine === 286);
    expect(row, 'GLP-fault row for :286').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    const got = sidecarHardADeleted(mutantSidecarGuardRegionSweepLine(nsh, 286), row!);
    expect(got, 'Nop :286 must delete the legit vault the GLP fault skipped').toEqual([
      'C:\\Users\\me\\Documents\\MyVault',
    ]);
    expect(sidecarGuardModeTwoCaught(mutantSidecarGuardRegionSweepLine(nsh, 286), nsh)).toBe(true);
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
  for (let line = 361; line <= 377; line += 1) {
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
 * Shield 112: pick mutants from the region map / oracle-class sweep on :361–:377,
 * not by the N7/N8 rows. Red is mode-2 (full pin-free tables).
 */
function nestedDownloadsRegionMutants(): { key: string; nsh: string }[] {
  const seen = new Set<string>();
  const out: { key: string; nsh: string }[] = [];
  const candidates = [
    ...generateOracleClassMutants(nsh).filter((m) => m.fileLine >= 361 && m.fileLine <= 377),
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

  it('Downloads ancestor sep Nop (:377) deletes Documents\\prof', () => {
    expect(fileLines[376]!.trim()).toBe('StrCmp $6 "\\" uninstall_vault_read');
    const mutant = withFileLine(377, 'Nop');
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
      // $9→$5 leftover copies stay equivalent — they are not the 112.
      if (mutant.key.includes(':tgt')) {
        return false;
      }
      if (
        mutant.key.includes(':extra: 0 ->') ||
        mutant.key.includes(':extra:$9->$5') ||
        mutant.key.includes(':extra:mythos_nr_ok->')
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
    expect(fileLines[418]!.trim()).toBe('mythos_comp_tail_scan: StrCpy $4 $2 1');
    const next = [...fileLines];
    next[418] = '        mythos_comp_tail_scan: Goto mythos_comp_tail_ret';
    const mutant = next.join('\n');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('H3a EVIL~1'));
    expect(row, 'H3a EVIL~1 row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Users\\me\\Documents\\evil']);
  });

  it('line GLP +2 fallback is mode-2 red and deletes the 1st-call GLP-fault vault', () => {
    expect(fileLines[143]!.trim()).toBe('IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0');
    const mutant = withFileLine(144, 'IntCmp $4 0 +2 0 0');
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(true);
    const row = SIDECAR_HARD_A_ROWS.find((r) => r.name.startsWith('path GLP 1st-call fault'));
    expect(row, 'path GLP 1st-call fault row').toBeDefined();
    expect(sidecarHardADeleted(nsh, row!)).toEqual([]);
    expect(sidecarHardADeleted(mutant, row!)).toEqual(['C:\\Users\\me\\Documents\\MyVault']);
  });

  it('walk $3→$1 at :385/:391 is red on / and RF7PAR~1 parent-junction rows', () => {
    expect(fileLines[384]!.trim()).toBe('StrCpy $6 $3 1 $7');
    expect(fileLines[390]!.trim()).toBe('StrCpy $6 $3 $7');
    const slash = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('parent junction via /'));
    const short = SIDECAR_RF7_REPARSE_ROWS.find((r) => r.name.includes('RF7PAR~1'));
    expect(slash, 'parent junction via /').toBeDefined();
    expect(short, 'parent junction via RF7PAR~1').toBeDefined();
    expect(sidecarRf7Deleted(nsh, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);
    expect(sidecarRf7Deleted(nsh, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([]);

    const charMutant = withFileLine(385, 'StrCpy $6 $1 1 $7');
    const prefixMutant = withFileLine(391, 'StrCpy $6 $1 $7');
    expect(sidecarGuardModeTwoCaught(charMutant, nsh)).toBe(true);
    expect(sidecarGuardModeTwoCaught(prefixMutant, nsh)).toBe(true);

    const expandedParentVault = 'C:\\Users\\me\\Documents\\rf7-parent\\vault';
    expect(sidecarRf7Deleted(charMutant, slash!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
    expect(sidecarRf7Deleted(charMutant, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
    expect(sidecarRf7Deleted(prefixMutant, short!, DEFAULT_SIDECAR_NSIS_VAR_ENV)).toEqual([expandedParentVault]);
  });
});
