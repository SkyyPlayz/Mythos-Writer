import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultUninstallVaultsNshPath,
  MYTHOS_UNINSTALL_VAULTS_NSH_SNAPSHOT_ENV,
  sha256UninstallVaultsNshBuildFile,
} from './src/uninstallVaultsNsh.path.js';

export default function setup(): () => void {
  const buildPath = defaultUninstallVaultsNshPath();
  if (!existsSync(buildPath)) {
    return () => {};
  }

  const snapshotDir = mkdtempSync(join(tmpdir(), 'mythos-uninstall-nsh-integrity-'));
  const snapshotFile = join(snapshotDir, 'sha256-at-start');
  const before = sha256UninstallVaultsNshBuildFile(buildPath);
  writeFileSync(snapshotFile, before, 'utf-8');
  process.env[MYTHOS_UNINSTALL_VAULTS_NSH_SNAPSHOT_ENV] = snapshotFile;

  return () => {
    const after = sha256UninstallVaultsNshBuildFile(buildPath);
    if (after !== before) {
      process.exitCode = 1;
      throw new Error(
        'build/uninstall-vaults.nsh was mutated during the electron-main test run (integrity guard). ' +
          'On-disk mutant tests must use MYTHOS_UNINSTALL_VAULTS_NSH_PATH with a temp copy only.',
      );
    }
    rmSync(snapshotDir, { recursive: true, force: true });
    delete process.env[MYTHOS_UNINSTALL_VAULTS_NSH_SNAPSHOT_ENV];
  };
};
