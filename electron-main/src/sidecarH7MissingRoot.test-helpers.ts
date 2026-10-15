/**
 * H7: S-19 missing-root fallback IntCmp less-branch must still run later checks.
 * Rows and less-branch retargets live here so oracle-sweeps / HARD-A do not grow.
 */

import type { SidecarHardARow, SidecarNsisVarEnv } from './sidecarTraversalScan.test-helpers.js';
import { nshReplaceFileLine, sidecarHardADeleted } from './sidecarTraversalScan.test-helpers.js';
import type { SidecarNsisRunOptions } from './sidecarNsisVm.test-helpers.js';

/** Same E1 as HARD-A nested/S-19 rows (PROGRAMFILES not swapped). */
export const H7_ENV_E1: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files',
  PROGRAMFILES64: 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};

const MYTHOS_WRITER_ROOT = `${H7_ENV_E1.APPDATA}\\Mythos Writer`;
const DOCUMENTS_ROOT = H7_ENV_E1.DOCUMENTS;
const DESKTOP_ROOT = H7_ENV_E1.DESKTOP;
const DOWNLOADS_ROOT = `${H7_ENV_E1.PROFILE}\\Downloads`;

/** Downloads nested under Documents so the 9l check is a later nested-root skip. */
export const H7_ENV_DOWNLOADS_UNDER_DOCS: SidecarNsisVarEnv = {
  ...H7_ENV_E1,
  PROFILE: `${DOCUMENTS_ROOT}\\prof`,
};

const NESTED_DOWNLOADS_ROOT = `${DOCUMENTS_ROOT}\\prof\\Downloads`;

export const H7_JUNCTION_VAULT = `${DOCUMENTS_ROOT}\\j`;
export const H7_PARENT_JUNCTION = `${DOCUMENTS_ROOT}\\p`;
export const H7_PARENT_JUNCTION_VAULT = `${DOCUMENTS_ROOT}\\p\\v`;
export const H7_DOCS_ORDINARY_VAULT = `${DOCUMENTS_ROOT}\\MyVault`;

const H7_DESK_JUNCTION_VAULT = `${DESKTOP_ROOT}\\j`;
const H7_DESK_PARENT_JUNCTION = `${DESKTOP_ROOT}\\p`;
const H7_DESK_PARENT_JUNCTION_VAULT = `${DESKTOP_ROOT}\\p\\v`;
const H7_DESK_ORDINARY_VAULT = `${DESKTOP_ROOT}\\MyVault`;

const H7_DL_JUNCTION_VAULT = `${DOWNLOADS_ROOT}\\j`;
const H7_DL_PARENT_JUNCTION = `${DOWNLOADS_ROOT}\\p`;
const H7_DL_PARENT_JUNCTION_VAULT = `${DOWNLOADS_ROOT}\\p\\v`;
const H7_DL_ORDINARY_VAULT = `${DOWNLOADS_ROOT}\\v`;

const ONEDRIVE_ROOT = `${H7_ENV_E1.PROFILE}\\OneDrive`;
const ONEDRIVE_DOCUMENTS = `${ONEDRIVE_ROOT}\\Documents`;
const H7_ENV_ONEDRIVE_ANCESTOR: SidecarNsisVarEnv = {
  ...H7_ENV_E1,
  DOCUMENTS: ONEDRIVE_DOCUMENTS,
  DESKTOP: H7_ENV_E1.PROFILE,
};

const NESTED_DESKTOP_FAMILY = `${DOCUMENTS_ROOT}\\family`;
const H7_ENV_NESTED_DESKTOP: SidecarNsisVarEnv = {
  ...H7_ENV_E1,
  DESKTOP: `${NESTED_DESKTOP_FAMILY}\\Desktop`,
};

/** Allowlist (5*) and nested (9*) GLP System::Call file lines. */
const GLP_5A = 200;
const GLP_5D = 230;
const GLP_5K = 260;
const GLP_5L = 290;
const GLP_9A = 363;
const GLP_9D = 389;
const GLP_9K = 415;
const GLP_9L = 441;

export type H7FallbackId = '5a' | '5d' | '5k' | '5l' | '9a' | '9d' | '9k' | '9l';

export type H7LessSite = Readonly<{
  id: H7FallbackId;
  fileLine: number;
  h3: string;
  missingRoot: string;
}>;

/** Every missing-root fallback GFA IntCmp $4 0 h3 h3 0 (less = missing-root). */
export const H7_LESS_SITES: readonly H7LessSite[] = [
  { id: '5a', fileLine: 546, h3: 'mythos_glp_h3_5a', missingRoot: MYTHOS_WRITER_ROOT },
  { id: '5d', fileLine: 551, h3: 'mythos_glp_h3_5d', missingRoot: DOCUMENTS_ROOT },
  { id: '5k', fileLine: 556, h3: 'mythos_glp_h3_5k', missingRoot: DESKTOP_ROOT },
  { id: '9a', fileLine: 561, h3: 'mythos_glp_h3_9a', missingRoot: MYTHOS_WRITER_ROOT },
  { id: '5l', fileLine: 566, h3: 'mythos_glp_h3_5l', missingRoot: DOWNLOADS_ROOT },
  { id: '9d', fileLine: 571, h3: 'mythos_glp_h3_9d', missingRoot: DOCUMENTS_ROOT },
  { id: '9k', fileLine: 576, h3: 'mythos_glp_h3_9k', missingRoot: DESKTOP_ROOT },
  { id: '9l', fileLine: 581, h3: 'mythos_glp_h3_9l', missingRoot: NESTED_DOWNLOADS_ROOT },
];

/** Named less dests Shield listed, plus the oracle +N set that skips remaining checks. */
export const H7_LESS_DESTS: readonly string[] = [
  'uninstall_vault_do_delete',
  'mythos_reparse_walk',
  'mythos_nr_ok',
  '+2',
  '+4',
  '+6',
];

export type H7LessMutant = Readonly<{
  key: string;
  fileLine: number;
  dest: string;
  nsh: string;
}>;

export function h7RetargetLessBranch(nsh: string, fileLine: number, dest: string): string {
  const line = nsh.split('\n')[fileLine - 1];
  if (line === undefined) {
    throw new Error(`H7 :${fileLine} missing`);
  }
  const trimmed = line.trim();
  const match = trimmed.match(/^IntCmp \$4 0 (\S+) \1 0$/);
  if (match === null) {
    throw new Error(`H7 :${fileLine} is not IntCmp $4 0 h3 h3 0: ${trimmed}`);
  }
  return nshReplaceFileLine(nsh, fileLine, `IntCmp $4 0 ${match[1]} ${dest} 0`);
}

export function h7LessMutants(nsh: string): readonly H7LessMutant[] {
  const out: H7LessMutant[] = [];
  for (const site of H7_LESS_SITES) {
    for (const dest of H7_LESS_DESTS) {
      out.push({
        key: `:${site.fileLine} less→${dest}`,
        fileLine: site.fileLine,
        dest,
        nsh: h7RetargetLessBranch(nsh, site.fileLine, dest),
      });
    }
  }
  return out;
}

function targetedMissing(root: string, glpLines: readonly number[]): Pick<SidecarNsisRunOptions, 'glpnErrnoFileLines' | 'invalidAttrPaths'> {
  const glpnErrnoFileLines: Record<number, number> = {};
  for (const line of glpLines) {
    glpnErrnoFileLines[line] = 2;
  }
  return { glpnErrnoFileLines, invalidAttrPaths: [root] };
}

function h7Row(
  name: string,
  path: string,
  expect: 'skip' | 'delete',
  env: SidecarNsisVarEnv,
  options: SidecarNsisRunOptions,
  mustNotDelete?: readonly string[],
): SidecarHardARow {
  return {
    name,
    path,
    env,
    expect,
    mustNotDelete: mustNotDelete ?? (expect === 'skip' ? [path] : undefined),
    options,
  };
}

function missingRootOpts(missingRoot: string): SidecarNsisRunOptions {
  return { missingPaths: [missingRoot] };
}

/** 9a/9k: missingPaths on a root that does not contain the Documents vault. */
function nestedLaterCheckRows(id: '9a' | '9k', missingRoot: string): SidecarHardARow[] {
  const env = H7_ENV_DOWNLOADS_UNDER_DOCS;
  const downloadsRoot = `${env.PROFILE}\\Downloads`;
  const opts = missingRootOpts(missingRoot);
  return [
    h7Row(`H7 ${id} missing-root + junction vault Documents\\j`, H7_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_JUNCTION_VAULT],
    }),
    h7Row(`H7 ${id} missing-root + parent junction Documents\\p\\v`, H7_PARENT_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_PARENT_JUNCTION],
    }),
    h7Row(`H7 ${id} missing-root + nested Downloads exact`, downloadsRoot, 'skip', env, opts, [
      downloadsRoot,
      env.PROFILE,
    ]),
    h7Row(`H7 ${id} missing-root + nested Downloads ancestor`, env.PROFILE, 'skip', env, opts, [
      env.PROFILE,
      downloadsRoot,
    ]),
    h7Row(`H7 ${id} missing-root + ordinary Documents vault still deletes`, H7_DOCS_ORDINARY_VAULT, 'delete', env, opts),
  ];
}

function oneDriveDocumentsAncestorRow(id: '5a' | '9a'): SidecarHardARow {
  return h7Row(
    `H7 ${id} missing-root + OneDrive Documents ancestor keep`,
    ONEDRIVE_ROOT,
    'skip',
    H7_ENV_ONEDRIVE_ANCESTOR,
    missingRootOpts(MYTHOS_WRITER_ROOT),
    [ONEDRIVE_ROOT, ONEDRIVE_DOCUMENTS],
  );
}

/**
 * 9d: vaults sit under Documents, so missingPaths would fail line GLP.
 * Fail only the Documents GLP lines and GFA the root (not descendants).
 */
function documentsNestedRows(): SidecarHardARow[] {
  const env = H7_ENV_DOWNLOADS_UNDER_DOCS;
  const downloadsRoot = `${env.PROFILE}\\Downloads`;
  const opts = targetedMissing(DOCUMENTS_ROOT, [GLP_5D, GLP_9D]);
  return [
    h7Row(`H7 9d missing-root + junction vault Documents\\j`, H7_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_JUNCTION_VAULT],
    }),
    h7Row(`H7 9d missing-root + parent junction Documents\\p\\v`, H7_PARENT_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_PARENT_JUNCTION],
    }),
    h7Row(`H7 9d missing-root + nested Downloads exact`, downloadsRoot, 'skip', env, opts, [
      downloadsRoot,
      env.PROFILE,
    ]),
    h7Row(`H7 9d missing-root + nested Downloads ancestor`, env.PROFILE, 'skip', env, opts, [
      env.PROFILE,
      downloadsRoot,
    ]),
    h7Row(
      `H7 9d missing-root + ordinary Documents vault still deletes`,
      H7_DOCS_ORDINARY_VAULT,
      'delete',
      env,
      opts,
    ),
    h7Row(
      `H7 9d missing-root + Desktop vault later Desktop check`,
      H7_DESK_ORDINARY_VAULT,
      'delete',
      H7_ENV_E1,
      targetedMissing(DOCUMENTS_ROOT, [GLP_5D, GLP_9D]),
    ),
    h7Row(
      `H7 9d missing-root + nested Desktop ancestor keep`,
      NESTED_DESKTOP_FAMILY,
      'skip',
      H7_ENV_NESTED_DESKTOP,
      targetedMissing(DOCUMENTS_ROOT, [GLP_5D, GLP_9D]),
      [NESTED_DESKTOP_FAMILY, H7_ENV_NESTED_DESKTOP.DESKTOP],
    ),
  ];
}

/** 9l: junction/parent/ancestor use missing Downloads; exact uses targeted so line GLP still runs. */
function downloadsNestedRows(): SidecarHardARow[] {
  const env = H7_ENV_DOWNLOADS_UNDER_DOCS;
  const downloadsRoot = NESTED_DOWNLOADS_ROOT;
  const missing = missingRootOpts(downloadsRoot);
  const exact = targetedMissing(downloadsRoot, [GLP_5L, GLP_9L]);
  return [
    h7Row(`H7 9l missing-root + junction vault Documents\\j`, H7_JUNCTION_VAULT, 'skip', env, {
      ...missing,
      reparsePaths: [H7_JUNCTION_VAULT],
    }),
    h7Row(`H7 9l missing-root + parent junction Documents\\p\\v`, H7_PARENT_JUNCTION_VAULT, 'skip', env, {
      ...missing,
      reparsePaths: [H7_PARENT_JUNCTION],
    }),
    h7Row(`H7 9l missing-root + nested Downloads exact`, downloadsRoot, 'skip', env, exact, [
      downloadsRoot,
      env.PROFILE,
    ]),
    h7Row(`H7 9l missing-root + nested Downloads ancestor`, env.PROFILE, 'skip', env, missing, [
      env.PROFILE,
      downloadsRoot,
    ]),
    h7Row(
      `H7 9l missing-root + ordinary Documents vault still deletes`,
      H7_DOCS_ORDINARY_VAULT,
      'delete',
      env,
      missing,
    ),
  ];
}

/** 5a shares the MW-missing Documents later-check fixtures (allowlist fires first). */
function allowlistMythosRows(): SidecarHardARow[] {
  return nestedLaterCheckRows('9a', MYTHOS_WRITER_ROOT).map((row) => ({
    ...row,
    name: row.name.replace('H7 9a ', 'H7 5a '),
  }));
}

/** 5d shares the targeted-Documents fixtures (allowlist :551 fires before nested :571). */
function allowlistDocumentsRows(): SidecarHardARow[] {
  return documentsNestedRows().map((row) => ({
    ...row,
    name: row.name.replace('H7 9d ', 'H7 5d '),
  }));
}

/**
 * 5k: Documents\j matches 5d first. Use a Desktop-side vault so :556 still runs,
 * plus default-env Downloads exact/ancestor (not under Documents).
 */
function allowlistDesktopRows(): SidecarHardARow[] {
  const env = H7_ENV_E1;
  const opts = targetedMissing(DESKTOP_ROOT, [GLP_5K, GLP_9K]);
  const deskMissing = missingRootOpts(DESKTOP_ROOT);
  return [
    h7Row(`H7 5k missing-root + junction vault Desktop\\j`, H7_DESK_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_DESK_JUNCTION_VAULT],
    }),
    h7Row(`H7 5k missing-root + parent junction Desktop\\p\\v`, H7_DESK_PARENT_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_DESK_PARENT_JUNCTION],
    }),
    h7Row(`H7 5k missing-root + nested Downloads exact`, DOWNLOADS_ROOT, 'skip', env, deskMissing, [
      DOWNLOADS_ROOT,
      env.PROFILE,
    ]),
    h7Row(`H7 5k missing-root + nested Downloads ancestor`, env.PROFILE, 'skip', env, deskMissing, [
      env.PROFILE,
      DOWNLOADS_ROOT,
    ]),
    h7Row(
      `H7 5k missing-root + ordinary Desktop vault still deletes`,
      H7_DESK_ORDINARY_VAULT,
      'delete',
      env,
      opts,
    ),
    h7Row(
      `H7 5k missing-root + ordinary Downloads vault still deletes`,
      H7_DL_ORDINARY_VAULT,
      'delete',
      env,
      deskMissing,
    ),
  ];
}

/**
 * 5l: Documents\j matches 5d first. Use a Downloads-side vault so :566 still runs.
 */
function allowlistDownloadsRows(): SidecarHardARow[] {
  const env = H7_ENV_E1;
  const opts = targetedMissing(DOWNLOADS_ROOT, [GLP_5L, GLP_9L]);
  const dlMissing = missingRootOpts(DOWNLOADS_ROOT);
  return [
    h7Row(`H7 5l missing-root + junction vault Downloads\\j`, H7_DL_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_DL_JUNCTION_VAULT],
    }),
    h7Row(`H7 5l missing-root + parent junction Downloads\\p\\v`, H7_DL_PARENT_JUNCTION_VAULT, 'skip', env, {
      ...opts,
      reparsePaths: [H7_DL_PARENT_JUNCTION],
    }),
    h7Row(`H7 5l missing-root + nested Downloads exact`, DOWNLOADS_ROOT, 'skip', env, opts, [
      DOWNLOADS_ROOT,
      env.PROFILE,
    ]),
    h7Row(`H7 5l missing-root + nested Downloads ancestor`, env.PROFILE, 'skip', env, dlMissing, [
      env.PROFILE,
      DOWNLOADS_ROOT,
    ]),
    h7Row(
      `H7 5l missing-root + ordinary Downloads vault still deletes`,
      H7_DL_ORDINARY_VAULT,
      'delete',
      env,
      opts,
    ),
  ];
}

/**
 * Per-site later-check rows. 9a/9d/9k/9l use Documents\\j / Documents\\p\\v /
 * nested Downloads exact+ancestor. 5a/5d share those fixtures; 5k/5l use the
 * analog that still reaches that allowlist fallback.
 */
export const SIDECAR_H7_MISSING_ROOT_ROWS: readonly SidecarHardARow[] = [
  ...allowlistMythosRows(),
  oneDriveDocumentsAncestorRow('5a'),
  ...allowlistDocumentsRows(),
  ...allowlistDesktopRows(),
  ...allowlistDownloadsRows(),
  ...nestedLaterCheckRows('9a', MYTHOS_WRITER_ROOT),
  oneDriveDocumentsAncestorRow('9a'),
  ...documentsNestedRows(),
  ...nestedLaterCheckRows('9k', DESKTOP_ROOT),
  ...downloadsNestedRows(),
];

export type H7KillHit = Readonly<{
  row: string;
  canonical: readonly string[];
  mutant: readonly string[];
  via: 'diff' | 'throw';
}>;

export function h7MutantKillHits(mutantNsh: string, canonicalNsh: string): readonly H7KillHit[] {
  const hits: H7KillHit[] = [];
  for (const row of SIDECAR_H7_MISSING_ROOT_ROWS) {
    let canonical: readonly string[];
    try {
      canonical = sidecarHardADeleted(canonicalNsh, row);
    } catch (err) {
      hits.push({
        row: row.name,
        canonical: [],
        mutant: [],
        via: 'throw',
      });
      continue;
    }
    try {
      const mutant = sidecarHardADeleted(mutantNsh, row);
      if (mutant.join('\0') !== canonical.join('\0')) {
        hits.push({ row: row.name, canonical, mutant, via: 'diff' });
      }
    } catch {
      hits.push({ row: row.name, canonical, mutant: [], via: 'throw' });
    }
  }
  return hits;
}

/** True when the mutant deletes a path the canonical keep-set still holds. */
export function h7MutantLooserRows(
  mutantNsh: string,
  canonicalNsh: string,
): readonly { row: string; canonical: readonly string[]; mutant: readonly string[] }[] {
  const looser: { row: string; canonical: readonly string[]; mutant: readonly string[] }[] = [];
  for (const hit of h7MutantKillHits(mutantNsh, canonicalNsh)) {
    if (hit.via !== 'diff') {
      continue;
    }
    const extra = hit.mutant.filter((p) => !hit.canonical.includes(p));
    if (extra.length > 0 || hit.mutant.length > hit.canonical.length) {
      looser.push({ row: hit.row, canonical: hit.canonical, mutant: hit.mutant });
    }
  }
  return looser;
}
