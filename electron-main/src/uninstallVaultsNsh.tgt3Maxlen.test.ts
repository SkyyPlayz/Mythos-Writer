import { describe, expect, it } from 'vitest';

import {
  glpnModel,
  mutantSidecar567GotoRead,
  mutantSidecarFallbackIntCmpTgt1To0,
  mutantSidecarIntCmpMaxTgt1To0,
  mutantSidecarIntCmpMaxTgt3To0,
  SIDECAR_NSIS_LONG_8_3,
  SIDECAR_NSIS_LONG_DOCUMENTS_ROOT,
  SIDECAR_NSIS_LONG_UNDER_DOCUMENTS,
  SIDECAR_TGT3_EIGHT_SPECS,
  SIDECAR_TGT3_MAXLEN_SPECS,
  sidecarHardADeleted,
  simulateSidecarDeleteReadLoop,
  type SidecarTgt3MaxlenSpec,
} from './sidecarTraversalScan.test-helpers.js';
import { sidecarGuardModeTwoCaught } from './sidecarOracleMutants.test-helpers.js';
import {
  nsisTruncatedPrefix,
  SIDECAR_NSIS_MAX_STRLEN,
} from './sidecarNsisVm.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

function assertNoOversizeFake(spec: SidecarTgt3MaxlenSpec): void {
  const o = spec.options;
  expect(o.gfpnOversizeFileLines, spec.name).toBeUndefined();
  expect(o.gfpnOversizeNth, spec.name).toBeUndefined();
  expect(o.gfpnOversizePaths, spec.name).toBeUndefined();
  expect(o.glpnOversizeFileLines, spec.name).toBeUndefined();
  expect(o.glpnOversizeNth, spec.name).toBeUndefined();
  expect(o.glpnOversizePaths, spec.name).toBeUndefined();
}

function specModelPath(spec: SidecarTgt3MaxlenSpec): string {
  const resolved =
    spec.options.gfpnResolvedPathFileLines?.[spec.callLine] ??
    spec.options.glpnResolvedPathFileLines?.[spec.callLine];
  if (resolved !== undefined) {
    return resolved;
  }
  if (spec.callApi === 'GetLongPathNameW') {
    if (spec.env.WINDIR === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.WINDIR;
    }
    if (spec.env.PROGRAMFILES === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.PROGRAMFILES;
    }
    if (spec.env.PROGRAMFILES64 === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.PROGRAMFILES64;
    }
    if (spec.env.DOCUMENTS === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.DOCUMENTS;
    }
    if (spec.env.DESKTOP === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.DESKTOP;
    }
    if (spec.env.PROFILE === SIDECAR_NSIS_LONG_8_3) {
      return spec.env.PROFILE;
    }
  }
  if (spec.env.DOCUMENTS === SIDECAR_NSIS_LONG_DOCUMENTS_ROOT) {
    return spec.env.DOCUMENTS;
  }
  if (spec.env.DESKTOP === SIDECAR_NSIS_LONG_DOCUMENTS_ROOT) {
    return spec.env.DESKTOP;
  }
  if (spec.env.PROFILE === SIDECAR_NSIS_LONG_DOCUMENTS_ROOT) {
    return spec.env.PROFILE;
  }
  throw new Error(`${spec.name}: no real long path on the Call`);
}

function assertSpecLive(spec: SidecarTgt3MaxlenSpec): void {
  expect(fileLines[spec.intCmpLine - 1]!.trim()).toMatch(
    /^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} uninstall_vault_read 0 uninstall_vault_read$/,
  );
  expect(fileLines[spec.callLine - 1]!).toContain(spec.callApi);
  assertNoOversizeFake(spec);
  const model = specModelPath(spec);
  const required =
    spec.callApi === 'GetLongPathNameW' ? glpnModel(model).length + 1 : model.length + 1;
  expect(required, spec.name).toBeGreaterThan(SIDECAR_NSIS_MAX_STRLEN);
}

function assertKeepAndTgt3Red(spec: SidecarTgt3MaxlenSpec): void {
  const truncated = nsisTruncatedPrefix(spec.path);
  const deleted = simulateSidecarDeleteReadLoop(nsh, [`${spec.path}\r\n`], spec.env, spec.options)
    .deleted;
  expect(deleted, spec.name).toEqual([]);
  expect(deleted, spec.name).not.toContain(truncated);
  expect(deleted, spec.name).not.toContain(spec.path);

  const mutant = mutantSidecarIntCmpMaxTgt3To0(nsh, spec.intCmpLine);
  expect(mutant).not.toBe(nsh);
  const row = {
    name: spec.name,
    path: spec.path,
    env: spec.env,
    expect: 'skip' as const,
    options: spec.options,
    mustNotDelete: [spec.path, truncated],
  };
  expect(sidecarHardADeleted(nsh, row)).toEqual([]);
  let mutantDeleted: string[] = [];
  let mutantThrew = false;
  try {
    mutantDeleted = sidecarHardADeleted(mutant, row);
  } catch {
    mutantThrew = true;
  }
  expect(
    mutantThrew || mutantDeleted.join('\0') !== '',
    `${spec.name} tgt3->0 must not stay identity`,
  ).toBe(true);
}

describe('tgt3->0 MAX-length checks (required size > NSIS_MAX_STRLEN)', () => {
  it('pins the long-path constant and 8.3 alias', () => {
    expect(SIDECAR_NSIS_MAX_STRLEN).toBe(1024);
    expect(SIDECAR_NSIS_LONG_DOCUMENTS_ROOT.length).toBeGreaterThan(SIDECAR_NSIS_MAX_STRLEN);
    expect(SIDECAR_NSIS_LONG_UNDER_DOCUMENTS.length).toBeGreaterThan(SIDECAR_NSIS_MAX_STRLEN);
    expect(SIDECAR_NSIS_LONG_8_3.length).toBeLessThan(SIDECAR_NSIS_MAX_STRLEN);
    expect(glpnModel(SIDECAR_NSIS_LONG_8_3).length).toBeGreaterThan(SIDECAR_NSIS_MAX_STRLEN);
  });

  it(`pins ${SIDECAR_TGT3_EIGHT_SPECS.length} Ivy-8 MAX IntCmp sites`, () => {
    expect(SIDECAR_TGT3_EIGHT_SPECS).toHaveLength(8);
    expect(SIDECAR_TGT3_EIGHT_SPECS.map((s) => s.intCmpLine)).toEqual([
      320, 331, 362, 388, 414, 418, 440, 444,
    ]);
    for (const spec of SIDECAR_TGT3_EIGHT_SPECS) {
      assertSpecLive(spec);
    }
  });

  it(`pins ${SIDECAR_TGT3_MAXLEN_SPECS.length} GLP MAX IntCmp sites`, () => {
    expect(SIDECAR_TGT3_MAXLEN_SPECS).toHaveLength(12);
    for (const spec of SIDECAR_TGT3_MAXLEN_SPECS) {
      assertSpecLive(spec);
    }
  });

  for (const spec of SIDECAR_TGT3_EIGHT_SPECS) {
    it(`Ivy-8 :${spec.intCmpLine} ${spec.name} oversize keeps folder and tgt3->0 is live`, () => {
      assertKeepAndTgt3Red(spec);
    });
  }

  for (const spec of SIDECAR_TGT3_MAXLEN_SPECS) {
    it(`:${spec.intCmpLine} ${spec.name} oversize keeps folder and never deletes truncated path`, () => {
      const truncated = nsisTruncatedPrefix(spec.path);
      const deleted = simulateSidecarDeleteReadLoop(nsh, [`${spec.path}\r\n`], spec.env, spec.options)
        .deleted;
      expect(deleted, spec.name).toEqual([]);
      expect(deleted, spec.name).not.toContain(truncated);
      expect(deleted, spec.name).not.toContain(spec.path);
    });

    it(`:${spec.intCmpLine} ${spec.name} tgt3->0 is live on oversize (mutant deletes or differs)`, () => {
      assertKeepAndTgt3Red(spec);
    });
  }
});

/** 12 GLP MAX IntCmp sites: less dest is already `0`, so tgt2->0 is a no-op. */
const MAXLEN_TGT2_ALREADY_ZERO_LINES = [145, 157, 172, 187, 203, 233, 263, 293, 323, 334, 366, 392] as const;
const FALLBACK_TGT1_TO_0_LINES = [546, 551, 556, 561, 566, 571, 576, 581] as const;

describe('MAX / fallback jump-swap written proofs', () => {
  it('12 tgt2->0 variants are no-ops: less dest is already 0', () => {
    for (const fileLine of MAXLEN_TGT2_ALREADY_ZERO_LINES) {
      expect(fileLines[fileLine - 1]!.trim()).toMatch(
        /^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} uninstall_vault_read 0 uninstall_vault_read$/,
      );
    }
  });

  it(':323 tgt1->0 is equivalent: equal is dead after :320, trunc keep-equals-keep', () => {
    expect(fileLines[322]!.trim()).toMatch(
      /^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} uninstall_vault_read 0 uninstall_vault_read$/,
    );
    expect(fileLines[319]!.trim()).toMatch(
      /^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} uninstall_vault_read 0 uninstall_vault_read$/,
    );
    const path = 'C:\\Users\\me\\Documents\\MyVault';
    const options = { glpnTruncNth: { [path]: 2 } };
    const row = {
      name: ':323 tgt1->0 trunc',
      path,
      env: SIDECAR_TGT3_MAXLEN_SPECS[0]!.env,
      expect: 'skip' as const,
      options,
    };
    expect(sidecarHardADeleted(nsh, row)).toEqual([]);
    const mutant = mutantSidecarIntCmpMaxTgt1To0(nsh, 323);
    expect(sidecarHardADeleted(mutant, row)).toEqual([]);
  });

  it('fallback tgt1->0 equal is unreachable: leftover GFA is DIRECTORY or INVALID', () => {
    for (const fileLine of FALLBACK_TGT1_TO_0_LINES) {
      expect(fileLines[fileLine - 1]!.trim()).toMatch(/^IntCmp \$4 0 (\S+) \1 0$/);
      const mutant = mutantSidecarFallbackIntCmpTgt1To0(nsh, fileLine);
      expect(mutant).not.toBe(nsh);
      expect(sidecarGuardModeTwoCaught(mutant, nsh), `:${fileLine} tgt1->0`).toBe(false);
    }
  });

  it(':567 Goto->read is equivalent: mythos_al_deny is Goto uninstall_vault_read', () => {
    expect(fileLines[566]!.trim()).toBe('Goto mythos_al_deny');
    expect(fileLines[315]!.trim()).toBe('Goto uninstall_vault_read');
    expect(fileLines[314]!.trim()).toBe('mythos_al_deny:');
    const mutant = mutantSidecar567GotoRead(nsh);
    expect(mutant).not.toBe(nsh);
    expect(sidecarGuardModeTwoCaught(mutant, nsh)).toBe(false);
  });
});

