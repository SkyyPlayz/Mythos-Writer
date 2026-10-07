import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

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
} from './sidecarTraversalScan.harness.js';
import { UNINSTALL_VAULTS_NSH_PATH } from './uninstallVaultsNsh.traversal.behavior.test.js';

const REPO_ROOT = resolve(process.cwd(), '..');

function runTraversalBehaviorSuite(): { status: number; stdout: string } {
  try {
    const stdout = execSync(
      'npm run test -w electron-main -- src/uninstallVaultsNsh.traversal.behavior.test.ts --reporter=verbose',
      { cwd: REPO_ROOT, encoding: 'utf-8', stdio: 'pipe' },
    );
    return { status: 0, stdout };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: `${err.stdout ?? ''}\n${err.stderr ?? ''}`,
    };
  }
}

function runMainNshContractSuite(): { status: number; stdout: string } {
  try {
    const stdout = execSync(
      'npm run test -w electron-main -- src/uninstallVaultsNsh.test.ts --reporter=verbose',
      { cwd: REPO_ROOT, encoding: 'utf-8', stdio: 'pipe' },
    );
    return { status: 0, stdout };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: `${err.stdout ?? ''}\n${err.stderr ?? ''}`,
    };
  }
}

function withOnDiskMutant(
  label: string,
  apply: (source: string) => string,
  runSuite: () => { status: number; stdout: string },
  expectFailName: RegExp,
): void {
  it(label, () => {
    const original = readFileSync(UNINSTALL_VAULTS_NSH_PATH, 'utf-8');
    writeFileSync(UNINSTALL_VAULTS_NSH_PATH, apply(original));
    try {
      const result = runSuite();
      expect(result.status, `expected red suite for ${label}:\n${result.stdout.slice(-2000)}`).not.toBe(0);
      expect(result.stdout).toMatch(expectFailName);
    } finally {
      writeFileSync(UNINSTALL_VAULTS_NSH_PATH, original);
    }
  });
}

describe('on-disk nsh mutants (write build/uninstall-vaults.nsh, run vitest, restore)', () => {
  const trav = runTraversalBehaviorSuite;
  const main = runMainNshContractSuite;

  withOnDiskMutant(
    'M-B1 on-disk: neutralize .\\ reject reds traversal behaviour suite',
    mutantMB1_neutralizeBackslashDotBackslashReject,
    trav,
    /M-B1|branch pins|traversal branch/,
  );
  withOnDiskMutant(
    'M-B2 on-disk: neutralize ..\\ reject reds traversal behaviour suite',
    mutantMB2_neutralizeBackslashDotDotBackslashReject,
    trav,
    /M-B2|branch pins/,
  );
  withOnDiskMutant(
    'M-B3 on-disk: delete .. reject pair reds traversal behaviour suite',
    mutantMB3_deleteBackslashDotDotRejectPair,
    trav,
    /M-B3|branch pins/,
  );
  withOnDiskMutant(
    'M-B4 on-disk: all backslash rejects reds traversal behaviour suite',
    mutantMB4_neutralizeAllBackslashTravRejects,
    trav,
    /M-B4|branch pins/,
  );
  withOnDiskMutant(
    'M-B5 on-disk: dot check reds traversal behaviour suite',
    mutantMB5_neutralizeBackslashDotCheck,
    trav,
    /M-B5|branch pins/,
  );
  withOnDiskMutant(
    'M-B6 on-disk: forward rejects reds traversal behaviour suite',
    mutantMB6_neutralizeForwardSlashTravRejects,
    trav,
    /M-B6|branch pins/,
  );
  withOnDiskMutant(
    'M-B-WINDIR on-disk: drop WINDIR deny reds traversal behaviour suite',
    mutantWindirDenyDrop,
    trav,
    /WINDIR|allowlist deny/,
  );
  withOnDiskMutant(
    'M-B-PROGRAMFILES on-disk: drop PROGRAMFILES deny reds traversal behaviour suite',
    mutantProgramFilesDenyDrop,
    trav,
    /PROGRAMFILES/,
  );
  withOnDiskMutant(
    'M-B-PROGRAMFILES64 on-disk: drop PROGRAMFILES64 deny reds traversal behaviour suite',
    mutantProgramFiles64DenyDrop,
    trav,
    /PROGRAMFILES64/,
  );

  withOnDiskMutant(
    'M-A on-disk: remove Section /o reds main contract suite',
    (nsh) =>
      nsh.replace(
        /Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/,
        'Section "un.Also delete my Mythos vaults / writing data"',
      ),
    main,
    /M-A|Section \/o/,
  );
  withOnDiskMutant(
    'M-C on-disk: MessageBox reds main contract suite',
    (nsh) => nsh.replace('!macro customUnInstall', '!macro customUnInstall\n  MessageBox MB_OK "mutant"'),
    main,
    /M-C|MessageBox/,
  );
  withOnDiskMutant(
    'M19 on-disk: exact Section /o line reds main contract suite',
    (nsh) =>
      nsh.replace(
        'Section /o "un.Also delete my Mythos vaults / writing data"',
        'Section "un.Also delete my Mythos vaults / writing data"',
      ),
    main,
    /M19|Section \/o/,
  );
  withOnDiskMutant(
    'M23 on-disk: drop vaults fallback reds main contract suite',
    (nsh) => nsh.replace('RMDir /r "$APPDATA\\Mythos Writer\\vaults"', ''),
    main,
    /M23|vaults/,
  );
  withOnDiskMutant(
    'M24 on-disk: gate always-true reds main contract suite',
    (nsh) => {
      const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
      return nsh.replace(gate, '${If} 1 == 1');
    },
    main,
    /M24|SectionIsSelected/,
  );
  withOnDiskMutant(
    'M-D on-disk: allowlist deny->allow reds main contract suite',
    (nsh) =>
      nsh.replace(
        /mythos_al_deny:\s*\r?\n\s*Goto uninstall_vault_read/,
        'mythos_al_deny:\n        Goto uninstall_vault_do_delete',
      ),
    main,
    /M-D|allowlist deny/,
  );
  withOnDiskMutant(
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
