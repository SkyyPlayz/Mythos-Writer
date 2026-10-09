/**
 * Vitest-only: mythos_rmdir_unless_reparse helper pin, RF-7 rows, and pin-free mode-2.
 * Do not expand this helper into the sidecar FileOpen…fallback program.
 */

import { createHash } from 'node:crypto';

import {
  FILE_ATTRIBUTE_DIRECTORY,
  FILE_ATTRIBUTE_HIDDEN,
  FILE_ATTRIBUTE_READONLY,
  FILE_ATTRIBUTE_SYSTEM,
  MYTHOS_RMDIR_HELPER_SITES,
  nsisValidateFilename,
  runMythosRmdirHelper,
  SIDECAR_NSIS_ENV_E1,
  type MythosRmdirHelperSite,
  type SidecarNsisRunOptions,
  type SidecarNsisVarEnv,
} from './sidecarNsisVm.test-helpers.js';

export const HELPER_REGION_FILE_LINE_FIRST = 398;
export const HELPER_REGION_FILE_LINE_LAST = 446;
export const HELPER_REGION_START_LINE = '!macro mythos_rmdir_unless_reparse _root _path _uid';
export const HELPER_REGION_END_LINE = '!macroend';

export const CANONICAL_HELPER_REGION: readonly string[] = [
  '!macro mythos_rmdir_unless_reparse _root _path _uid',
  '  Push $3',
  '  Push $4',
  '  Push $6',
  '  Push $7',
  '  Push $8',
  '  Push $9',
  '  StrCpy $3 "${_path}"',
  '  StrCpy $9 "${_root}"',
  '  System::Call "kernel32::GetFullPathNameW(w r3, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"',
  '  IntCmp $4 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid} 0',
  '  IntCmp $4 ${NSIS_MAX_STRLEN} mythos_rpr_done_${_uid} 0 mythos_rpr_done_${_uid}',
  '  System::Call "kernel32::GetFullPathNameW(w r9, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"',
  '  IntCmp $4 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid} 0',
  '  IntCmp $4 ${NSIS_MAX_STRLEN} mythos_rpr_done_${_uid} 0 mythos_rpr_done_${_uid}',
  '  StrLen $8 $9',
  '  StrCpy $6 $3 $8',
  '  StrCmp $6 $9 0 mythos_rpr_done_${_uid}',
  '  StrCpy $6 $3 1 $8',
  '  StrCmp $6 "\\" 0 mythos_rpr_done_${_uid}',
  '  IntOp $7 $8 + 1',
  '  mythos_rpr_walk_${_uid}:',
  '    StrCpy $6 $3 1 $7',
  '    StrCmp $6 "" mythos_rpr_leaf_${_uid}',
  '    StrCmp $6 "\\" mythos_rpr_hit_${_uid}',
  '    IntOp $7 $7 + 1',
  '    Goto mythos_rpr_walk_${_uid}',
  '  mythos_rpr_hit_${_uid}:',
  '    StrCpy $6 $3 $7',
  '    System::Call "kernel32::GetFileAttributesW(w r6) i .r4"',
  '    StrCmp $4 "error" mythos_rpr_done_${_uid}',
  '    IntOp $4 $4 & 0x400',
  '    IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}',
  '    IntOp $7 $7 + 1',
  '    Goto mythos_rpr_walk_${_uid}',
  '  mythos_rpr_leaf_${_uid}:',
  '    System::Call "kernel32::GetFileAttributesW(w r3) i .r4"',
  '    StrCmp $4 "error" mythos_rpr_done_${_uid}',
  '    IntOp $4 $4 & 0x400',
  '    IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}',
  '    RMDir /r "$3"',
  '  mythos_rpr_done_${_uid}:',
  '  Pop $9',
  '  Pop $8',
  '  Pop $7',
  '  Pop $6',
  '  Pop $4',
  '  Pop $3',
  '!macroend',
];

export const CANONICAL_HELPER_REGION_SHA256 = createHash('sha256')
  .update(CANONICAL_HELPER_REGION.join('\n'))
  .digest('hex');

export function locateHelperRegion(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nsh.split(/\r?\n/);
  const start = fileLines.findIndex((l) => l === HELPER_REGION_START_LINE);
  if (start < 0) {
    throw new Error('helper region start missing');
  }
  const end = fileLines.findIndex((l, i) => i > start && l === HELPER_REGION_END_LINE);
  if (end < 0) {
    throw new Error('helper region end missing');
  }
  return { start, end, lines: fileLines.slice(start, end + 1) };
}

export function assertMythosRmdirHelperRegionExact(nsh: string): void {
  const { start, end, lines } = locateHelperRegion(nsh);
  if (start + 1 !== HELPER_REGION_FILE_LINE_FIRST || end + 1 !== HELPER_REGION_FILE_LINE_LAST) {
    throw new Error(
      `helper region map: expected :${HELPER_REGION_FILE_LINE_FIRST}–:${HELPER_REGION_FILE_LINE_LAST}, got :${start + 1}–:${end + 1}`,
    );
  }
  if (lines.length !== CANONICAL_HELPER_REGION.length) {
    throw new Error(
      `helper region line count: expected ${CANONICAL_HELPER_REGION.length}, got ${lines.length}`,
    );
  }
  for (let i = 0; i < CANONICAL_HELPER_REGION.length; i += 1) {
    if (lines[i] !== CANONICAL_HELPER_REGION[i]) {
      throw new Error(
        `helper region line ${i} (file :${HELPER_REGION_FILE_LINE_FIRST + i}): expected ${JSON.stringify(CANONICAL_HELPER_REGION[i])}, got ${JSON.stringify(lines[i])}`,
      );
    }
  }
  const hash = createHash('sha256').update(lines.join('\n')).digest('hex');
  if (hash !== CANONICAL_HELPER_REGION_SHA256) {
    throw new Error(`helper region sha256 mismatch: ${hash}`);
  }
}

export const DEFAULT_HELPER_NSIS_VAR_ENV: SidecarNsisVarEnv = SIDECAR_NSIS_ENV_E1;

export function helperResolvedPath(site: MythosRmdirHelperSite, env: SidecarNsisVarEnv = DEFAULT_HELPER_NSIS_VAR_ENV): string {
  return site.path.split('$APPDATA').join(env.APPDATA);
}

export function helperParentPath(env: SidecarNsisVarEnv = DEFAULT_HELPER_NSIS_VAR_ENV): string {
  return `${env.APPDATA}\\Mythos Writer`;
}

export type HelperRf7Row = Readonly<{
  name: string;
  site: MythosRmdirHelperSite;
  expect: 'delete' | 'skip';
  options: Omit<SidecarNsisRunOptions, 'env'>;
  leaf: string;
}>;

function buildHelperRf7Rows(env: SidecarNsisVarEnv): HelperRf7Row[] {
  const parent = helperParentPath(env);
  const rows: HelperRf7Row[] = [];
  for (const site of MYTHOS_RMDIR_HELPER_SITES) {
    const leaf = helperResolvedPath(site, env);
    const isChild = leaf !== parent;
    rows.push({
      name: `${site.mode} ${site.name} plain deletes`,
      site,
      expect: 'delete',
      options: {},
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} junction skips`,
      site,
      expect: 'skip',
      options: { reparsePaths: [leaf] },
      leaf,
    });
    if (isChild) {
      rows.push({
        name: `${site.mode} ${site.name} Mythos Writer junction parent skips`,
        site,
        expect: 'skip',
        options: { reparsePaths: [parent] },
        leaf,
      });
      rows.push({
        name: `${site.mode} ${site.name} Mythos Writer GFA error parent skips`,
        site,
        expect: 'skip',
        options: { attrErrorPaths: [parent] },
        leaf,
      });
    }
    rows.push({
      name: `${site.mode} ${site.name} GFA error skips`,
      site,
      expect: 'skip',
      options: { attrErrorPaths: [leaf] },
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} INVALID_FILE_ATTRIBUTES skips`,
      site,
      expect: 'skip',
      options: { invalidAttrPaths: [leaf] },
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} missing path (INVALID) skips`,
      site,
      expect: 'skip',
      options: { fs: {} },
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} readonly deletes`,
      site,
      expect: 'delete',
      options: { fileAttributes: { [leaf]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_READONLY } },
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} hidden deletes`,
      site,
      expect: 'delete',
      options: { fileAttributes: { [leaf]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_HIDDEN } },
      leaf,
    });
    rows.push({
      name: `${site.mode} ${site.name} system deletes`,
      site,
      expect: 'delete',
      options: { fileAttributes: { [leaf]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_SYSTEM } },
      leaf,
    });
  }
  return rows;
}

export const HELPER_RF7_ROWS: readonly HelperRf7Row[] = buildHelperRf7Rows(DEFAULT_HELPER_NSIS_VAR_ENV);

/** Walk (a)(b) helper equivalents: readonly/hidden/system delete; INVALID + missing skip. */
export const HELPER_RF7_ATTR_A_ROWS: readonly HelperRf7Row[] = HELPER_RF7_ROWS.filter((row) =>
  / readonly deletes$| hidden deletes$| system deletes$/.test(row.name),
);

export const HELPER_RF7_ATTR_B_ROWS: readonly HelperRf7Row[] = HELPER_RF7_ROWS.filter((row) =>
  / INVALID_FILE_ATTRIBUTES skips$| missing path \(INVALID\) skips$/.test(row.name),
);

export function helperRf7Deleted(
  nsh: string,
  row: HelperRf7Row,
  env: SidecarNsisVarEnv = DEFAULT_HELPER_NSIS_VAR_ENV,
): string[] {
  const run = runMythosRmdirHelper(nsh, row.site, { ...row.options, env });
  if (run.hung) {
    throw new Error(`helper ${row.name}: hung`);
  }
  return run.deleted;
}

export const HELPER_H1_SLASH_SITE: MythosRmdirHelperSite = {
  root: '$APPDATA',
  path: '$APPDATA\\Mythos Writer\\a/b',
  uid: 'h1sl',
  mode: 'keep',
  name: 'slash-a-b',
};

/** H1 helper `/` rows: RMDir the GFPN `$3`, never validate_filename of raw `${_path}`. */
export const HELPER_H1_SLASH_SITES: readonly MythosRmdirHelperSite[] = [
  HELPER_H1_SLASH_SITE,
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\D/esktop',
    uid: 'h1desk',
    mode: 'keep',
    name: 'slash-D-esktop',
  },
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\x/f',
    uid: 'h1xf',
    mode: 'keep',
    name: 'slash-x-f',
  },
];

export const HELPER_GFPN_FAULT_SPECS = ['g1zero', 'g1trunc', 'g2zero', 'g2trunc'] as const;

export function assertMythosRmdirHelperTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_HELPER_NSIS_VAR_ENV,
): void {
  for (const site of HELPER_H1_SLASH_SITES) {
    const raw = helperResolvedPath(site, env);
    const slashLeaf = raw.replace(/\//g, '\\');
    const slashRaw = nsisValidateFilename(raw);
    const slashRun = runMythosRmdirHelper(nsh, site, { env });
    if (slashRun.hung) {
      throw new Error(`H1 helper slash ${site.name}: hung`);
    }
    if (slashRun.deleted.length !== 1 || slashRun.deleted[0] !== slashLeaf) {
      throw new Error(
        `H1 helper slash ${site.name}: expected delete ${JSON.stringify(slashLeaf)}, deleted ${JSON.stringify(slashRun.deleted)}`,
      );
    }
    if (slashRaw !== slashLeaf && slashRun.deleted.includes(slashRaw)) {
      throw new Error(`H1 helper slash ${site.name}: must not delete ${JSON.stringify(slashRaw)}`);
    }
  }
  const faultSite = MYTHOS_RMDIR_HELPER_SITES[0]!;
  for (const spec of HELPER_GFPN_FAULT_SPECS) {
    const run = runMythosRmdirHelper(nsh, faultSite, { env, fault: spec });
    if (run.hung) {
      throw new Error(`HARD-B helper GFPN ${spec}: hung`);
    }
    if (run.deleted.length !== 0) {
      throw new Error(`HARD-B helper GFPN ${spec}: expected skip, deleted ${JSON.stringify(run.deleted)}`);
    }
  }
  for (const row of HELPER_RF7_ROWS) {
    let deleted: string[];
    try {
      deleted = helperRf7Deleted(nsh, row, env);
    } catch (err) {
      throw new Error(
        `H2 ${row.name}: expected ${row.expect} with no error, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (row.expect === 'skip') {
      if (deleted.length !== 0) {
        throw new Error(`H2 ${row.name}: expected skip, deleted ${JSON.stringify(deleted)}`);
      }
    } else if (deleted.length !== 1 || deleted[0] !== row.leaf) {
      throw new Error(`H2 ${row.name}: expected delete ${JSON.stringify(row.leaf)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
}

export function assertMythosRmdirHelperSweepParity(
  mutantNsh: string,
  canonicalNsh: string,
  env: SidecarNsisVarEnv = DEFAULT_HELPER_NSIS_VAR_ENV,
): void {
  for (const row of HELPER_RF7_ROWS) {
    const canonical = helperRf7Deleted(canonicalNsh, row, env).join('\0');
    const mutant = helperRf7Deleted(mutantNsh, row, env).join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `H2 sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
  for (const site of HELPER_H1_SLASH_SITES) {
    const canonical = runMythosRmdirHelper(canonicalNsh, site, { env }).deleted.join('\0');
    const mutant = runMythosRmdirHelper(mutantNsh, site, { env }).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `H1 helper slash sweep ${site.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

export function helperGuardModeTwoFailure(mutant: string, canonical: string): string | undefined {
  try {
    assertMythosRmdirHelperTables(mutant);
    assertMythosRmdirHelperSweepParity(mutant, canonical);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function helperGuardModeTwoCaught(mutant: string, canonical: string): boolean {
  return helperGuardModeTwoFailure(mutant, canonical) !== undefined;
}

/** Critic 8 real helper mutants (instruction text; lines are post-HARD-A :398–:446). */
export const HELPER_CRITIC_MUTANTS: readonly { name: string; line: number; text: string }[] = [
  { name: 'hit mask & 0', line: 429, text: 'IntOp $4 $4 & 0' },
  { name: 'leaf mask & 0', line: 436, text: 'IntOp $4 $4 & 0' },
  { name: 'leaf mask & 0x4000', line: 436, text: 'IntOp $4 $4 & 0x4000' },
  { name: 'hit skip-on-any-nonzero (Nop IntCmp)', line: 430, text: 'Nop' },
  { name: 'leaf skip-on-any-nonzero (Nop IntCmp)', line: 437, text: 'Nop' },
  { name: 'Goto leaf at walk start', line: 418, text: 'Goto mythos_rpr_leaf_${_uid}' },
  { name: 'hit GFA error Nop', line: 428, text: 'Nop' },
  { name: 'leaf GFA error Nop', line: 435, text: 'Nop' },
];

/** Probe HARD-B 11 helper mutants that must stay red. */
export const HELPER_HARD_B_MUTANTS: readonly { name: string; line: number; text: string }[] = [
  { name: 'drop ancestor (Nop hit backslash)', line: 422, text: 'Nop' },
  { name: 'drop leaf (Nop leaf GFA)', line: 434, text: 'Nop' },
  { name: 'hit mask & 0', line: 429, text: 'IntOp $4 $4 & 0' },
  { name: 'leaf mask & 0', line: 436, text: 'IntOp $4 $4 & 0' },
  { name: 'leaf mask & 0x407', line: 436, text: 'IntOp $4 $4 & 0x407' },
  { name: 'invert hit IntCmp', line: 430, text: 'IntCmp $4 0 mythos_rpr_done_${_uid} 0 0' },
  { name: 'invert leaf IntCmp', line: 437, text: 'IntCmp $4 0 mythos_rpr_done_${_uid} 0 0' },
  { name: 'hit error fall-through Nop', line: 428, text: 'Nop' },
  { name: 'leaf error fall-through Nop', line: 435, text: 'Nop' },
  { name: 'leaf-only (Nop hit-backslash)', line: 422, text: 'Nop' },
  { name: 'drop walk (Goto done at walk start)', line: 418, text: 'Goto mythos_rpr_done_${_uid}' },
];

/** Forge HARD-B: GFPN-failure branches :408–:412 (freeze :331–:335). */
export const HELPER_GFPN_FAIL_LINES = [407, 408, 409, 410, 411, 412] as const;

export function nshWithFileLine(nsh: string, line: number, text: string): string {
  const next = nsh.split('\n');
  const indent = next[line - 1]!.match(/^\s*/)?.[0] ?? '';
  next[line - 1] = `${indent}${text}`;
  return next.join('\n');
}
