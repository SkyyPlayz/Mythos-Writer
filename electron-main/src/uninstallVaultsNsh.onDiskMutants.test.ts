import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';

import {
  mutantMB1_neutralizeBackslashDotBackslashReject,
  mutantMB2_neutralizeBackslashDotDotBackslashReject,
  mutantMB3_deleteBackslashDotDotRejectPair,
  mutantMB4_neutralizeAllBackslashTravRejects,
  mutantMB5_neutralizeBackslashDotCheck,
  mutantMB6_neutralizeForwardSlashTravRejects,
  mutantWindirDenyDrop,
  mutantProgramFilesDenyDrop,
  mutantProgramFiles64DenyDrop,
  mutantXF2_gotoIncLine80,
  mutantXF4_gotoIncLine86,
  mutantXF5_gotoIncLine75,
  mutantXF6_gotoIncLine81,
  mutantXB7_gotoIncLine65,
  mutantMB5a_neutralizeLine78,
  mutantMB6a_neutralizeLine84,
  mutantN1_forwardSlashCheckPipe,
  mutantN2_intOpLine58Plus2,
  mutantN3_intOpLine73Plus2,
  mutantE59_strcpyUse7,
  mutantF11_strcpy4Windir,
} from './sidecarTraversalScan.test-helpers.js';
import { mutantM5_dropAppDataRootSelfMatch } from './uninstallVaultsNsh.test-helpers.js';
import {
  defaultUninstallVaultsNshPath,
  MYTHOS_UNINSTALL_VAULTS_NSH_PATH_ENV,
} from './uninstallVaultsNsh.path.js';
import { nshMacroBody } from './uninstallVaultsNsh.test-helpers.js';

const REPO_ROOT = resolve(process.cwd(), '..');
const CANONICAL_NSH_PATH = defaultUninstallVaultsNshPath();
const tempMutantDirs: string[] = [];

afterAll(() => {
  for (const dir of tempMutantDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ON_DISK_MUTANT_SUITES =
  'src/uninstallVaultsNsh.traversal.behavior.test.ts src/uninstallVaultsNsh.test.ts src/uninstallHelper.test.ts src/appUserDataManifest.test.ts';

function runNestedVitest(args: string, mutantPath: string): { status: number; stdout: string } {
  const env = {
    ...process.env,
    [MYTHOS_UNINSTALL_VAULTS_NSH_PATH_ENV]: mutantPath,
  };
  try {
    const stdout = execSync(`npm run test -w electron-main -- ${args}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      env,
    });
    return { status: 0, stdout };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: `${err.stdout ?? ''}\n${err.stderr ?? ''}`,
    };
  }
}

function runTraversalBehaviorSuite(mutantPath: string): { status: number; stdout: string } {
  return runNestedVitest(
    'src/uninstallVaultsNsh.traversal.behavior.test.ts --reporter=verbose',
    mutantPath,
  );
}

function runMainNshContractSuite(mutantPath: string): { status: number; stdout: string } {
  return runNestedVitest('src/uninstallVaultsNsh.test.ts --reporter=verbose', mutantPath);
}

function runNoIntegrityL8Suite(mutantPath: string): { status: number; stdout: string } {
  return runNestedVitest(`${ON_DISK_MUTANT_SUITES} --reporter=verbose`, mutantPath);
}

function withTempOnDiskMutant(
  label: string,
  apply: (source: string) => string,
  runSuite: (mutantPath: string) => { status: number; stdout: string },
  expectFailName: RegExp,
): void {
  it(label, () => {
    const original = readFileSync(CANONICAL_NSH_PATH, 'utf-8');
    const dir = mkdtempSync(join(tmpdir(), 'mythos-uninstall-nsh-mutant-'));
    tempMutantDirs.push(dir);
    const mutantPath = join(dir, 'uninstall-vaults.nsh');
    writeFileSync(mutantPath, apply(original), 'utf-8');

    try {
      const result = runSuite(mutantPath);
      expect(result.status, `expected red suite for ${label}:\n${result.stdout.slice(-2000)}`).not.toBe(0);
      expect(result.stdout).toMatch(expectFailName);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      const idx = tempMutantDirs.indexOf(dir);
      if (idx >= 0) {
        tempMutantDirs.splice(idx, 1);
      }
    }
  });
}

describe('on-disk nsh mutants (temp copy + MYTHOS_UNINSTALL_VAULTS_NSH_PATH, never build/)', () => {
  const trav = runTraversalBehaviorSuite;
  const main = runMainNshContractSuite;

  withTempOnDiskMutant(
    'M-B1 on-disk: neutralize .\\ reject reds traversal behaviour suite',
    mutantMB1_neutralizeBackslashDotBackslashReject,
    trav,
    /M-B1|branch pins|traversal branch/,
  );
  withTempOnDiskMutant(
    'M-B2 on-disk: neutralize ..\\ reject reds traversal behaviour suite',
    mutantMB2_neutralizeBackslashDotDotBackslashReject,
    trav,
    /M-B2|branch pins/,
  );
  withTempOnDiskMutant(
    'M-B3 on-disk: delete .. reject pair reds traversal behaviour suite',
    mutantMB3_deleteBackslashDotDotRejectPair,
    trav,
    /M-B3|branch pins/,
  );
  withTempOnDiskMutant(
    'M-B4 on-disk: all backslash rejects reds traversal behaviour suite',
    mutantMB4_neutralizeAllBackslashTravRejects,
    trav,
    /M-B4|branch pins/,
  );
  withTempOnDiskMutant(
    'M-B5 on-disk: dot check reds traversal behaviour suite',
    mutantMB5_neutralizeBackslashDotCheck,
    trav,
    /M-B5|branch pins/,
  );
  withTempOnDiskMutant(
    'M-B6 on-disk: forward rejects reds traversal behaviour suite',
    mutantMB6_neutralizeForwardSlashTravRejects,
    trav,
    /M-B6|branch pins/,
  );
  withTempOnDiskMutant(
    'M-B-WINDIR on-disk: drop WINDIR deny reds traversal behaviour suite',
    mutantWindirDenyDrop,
    trav,
    /WINDIR|allowlist deny/,
  );
  withTempOnDiskMutant(
    'M-B-PROGRAMFILES on-disk: drop PROGRAMFILES deny reds traversal behaviour suite',
    mutantProgramFilesDenyDrop,
    trav,
    /PROGRAMFILES/,
  );
  withTempOnDiskMutant(
    'M-B-PROGRAMFILES64 on-disk: drop PROGRAMFILES64 deny reds traversal behaviour suite',
    mutantProgramFiles64DenyDrop,
    trav,
    /PROGRAMFILES64/,
  );

  withTempOnDiskMutant(
    'M-A on-disk: remove Section /o reds main contract suite',
    (nsh) =>
      nsh.replace(
        /Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/,
        'Section "un.Also delete my Mythos vaults / writing data"',
      ),
    main,
    /M-A|Section \/o/,
  );
  withTempOnDiskMutant(
    'M-C on-disk: MessageBox reds main contract suite',
    (nsh) => nsh.replace('!macro customUnInstall', '!macro customUnInstall\n  MessageBox MB_OK "mutant"'),
    main,
    /M-C|MessageBox/,
  );
  withTempOnDiskMutant(
    'M19 on-disk: exact Section /o line reds main contract suite',
    (nsh) =>
      nsh.replace(
        'Section /o "un.Also delete my Mythos vaults / writing data"',
        'Section "un.Also delete my Mythos vaults / writing data"',
      ),
    main,
    /M19|Section \/o/,
  );
  withTempOnDiskMutant(
    'M22 on-disk: sidecar Delete before FileOpen reds main contract suite',
    (nsh) => {
      const body = nshMacroBody(nsh, 'customUnInstall');
      const fileOpenNeedle = 'FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"';
      const mutantBody = body.replace(
        fileOpenNeedle,
        `Delete "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"\n    ${fileOpenNeedle}`,
      );
      return nsh.replace(body, mutantBody);
    },
    main,
    /before FileOpen|sidecar Delete/,
  );
  withTempOnDiskMutant(
    'M23 on-disk: drop vaults fallback reds main contract suite',
    (nsh) => nsh.replace('RMDir /r "$APPDATA\\Mythos Writer\\vaults"', ''),
    main,
    /M23|vaults/,
  );
  withTempOnDiskMutant(
    'M24 on-disk: gate always-true reds main contract suite',
    (nsh) => {
      const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
      return nsh.replace(gate, '${If} 1 == 1');
    },
    main,
    /M24|SectionIsSelected/,
  );
  withTempOnDiskMutant(
    'M-D on-disk: allowlist deny->allow reds main contract suite',
    (nsh) =>
      nsh.replace(
        /mythos_al_deny:\s*\r?\n\s*Goto uninstall_vault_read/,
        'mythos_al_deny:\n        Goto uninstall_vault_do_delete',
      ),
    main,
    /M-D|allowlist deny/,
  );
  withTempOnDiskMutant(
    'X-F2 on-disk: line 80 reds L8 suite (no integrity)',
    mutantXF2_gotoIncLine80,
    runNoIntegrityL8Suite,
    /X-F2|line 80/,
  );
  withTempOnDiskMutant(
    'X-F4 on-disk: line 86 reds L8 suite (no integrity)',
    mutantXF4_gotoIncLine86,
    runNoIntegrityL8Suite,
    /X-F4|line 86/,
  );
  withTempOnDiskMutant(
    'X-F5 on-disk: line 75 reds L8 suite (no integrity)',
    mutantXF5_gotoIncLine75,
    runNoIntegrityL8Suite,
    /X-F5|line 75/,
  );
  withTempOnDiskMutant(
    'X-F6 on-disk: line 81 reds L8 suite (no integrity)',
    mutantXF6_gotoIncLine81,
    runNoIntegrityL8Suite,
    /X-F6|line 81/,
  );
  withTempOnDiskMutant(
    'X-B7 on-disk: line 65 reds L8 suite (no integrity)',
    mutantXB7_gotoIncLine65,
    runNoIntegrityL8Suite,
    /X-B7|line 65/,
  );
  withTempOnDiskMutant(
    'MB5a on-disk: line 78 reds L8 suite (no integrity)',
    mutantMB5a_neutralizeLine78,
    runNoIntegrityL8Suite,
    /MB5a|line 78/,
  );
  withTempOnDiskMutant(
    'MB6a on-disk: line 84 reds L8 suite (no integrity)',
    mutantMB6a_neutralizeLine84,
    runNoIntegrityL8Suite,
    /MB6a|line 84/,
  );
  withTempOnDiskMutant(
    'N1 on-disk: line 72 pipe check reds L8 suite (no integrity)',
    mutantN1_forwardSlashCheckPipe,
    runNoIntegrityL8Suite,
    /N1|line 72|traversal scan block|simulator/,
  );
  withTempOnDiskMutant(
    'N2 on-disk: line 58 IntOp +2 reds L8 suite (no integrity)',
    mutantN2_intOpLine58Plus2,
    runNoIntegrityL8Suite,
    /N2|line 58|traversal scan block/,
  );
  withTempOnDiskMutant(
    'N3 on-disk: line 73 IntOp +2 reds L8 suite (no integrity)',
    mutantN3_intOpLine73Plus2,
    runNoIntegrityL8Suite,
    /N3|line 73|traversal scan block/,
  );
  withTempOnDiskMutant(
    'E-59 on-disk: StrCpy $7 reds L8 suite (no integrity)',
    mutantE59_strcpyUse7,
    runNoIntegrityL8Suite,
    /E-59|traversal scan block|C:\\\\a\\\\/,
  );
  withTempOnDiskMutant(
    'M5 on-disk: APPDATA root self-match drop reds main contract suite',
    mutantM5_dropAppDataRootSelfMatch,
    main,
    /M5|StrCmp \$1 \$5/,
  );
  withTempOnDiskMutant(
    'F11 on-disk: WINDIR StrCpy $1 1 reds L8 suite (no integrity)',
    mutantF11_strcpy4Windir,
    runNoIntegrityL8Suite,
    /F11|deny-prefix|WINDIR/,
  );

  withTempOnDiskMutant(
    'M-E/M13 on-disk: KEEP Remove-all macro reds main contract suite',
    (nsh) => {
      const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
      const elseMarker = '${Else}';
      const ifAt = nsh.indexOf(gate);
      const elseAt = nsh.indexOf(elseMarker, ifAt);
      const before = nsh.slice(0, elseAt);
      const after = nsh
        .slice(elseAt)
        .replace(
          '!insertmacro mythos_delete_app_caches',
          '!insertmacro mythos_delete_remove_all_user_data\n      !insertmacro mythos_delete_app_caches',
        );
      return before + after;
    },
    main,
    /M-E|M13|mythos_delete_remove_all_user_data/,
  );
});
