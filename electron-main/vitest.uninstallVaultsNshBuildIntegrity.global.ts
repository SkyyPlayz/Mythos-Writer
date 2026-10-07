import { existsSync, writeFileSync } from 'node:fs';

import {
  defaultUninstallVaultsNshPath,
  sha256UninstallVaultsNshBuildFile,
  UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE,
} from './src/uninstallVaultsNsh.path.js';

export default function setup(): () => void {
  const buildPath = defaultUninstallVaultsNshPath();
  if (!existsSync(buildPath)) {
    return () => {};
  }

  const before = sha256UninstallVaultsNshBuildFile(buildPath);
  writeFileSync(UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE, before, 'utf-8');

  return () => {
    const after = sha256UninstallVaultsNshBuildFile(buildPath);
    if (after !== before) {
      process.exitCode = 1;
      throw new Error(
        'build/uninstall-vaults.nsh was mutated during the electron-main test run (integrity guard). ' +
          'On-disk mutant tests must use MYTHOS_UNINSTALL_VAULTS_NSH_PATH with a temp copy only.',
      );
    }
  };
}
