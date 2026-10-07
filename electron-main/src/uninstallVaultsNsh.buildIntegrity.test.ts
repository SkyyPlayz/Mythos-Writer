import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import {
  defaultUninstallVaultsNshPath,
  sha256UninstallVaultsNshBuildFile,
  UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE,
} from './uninstallVaultsNsh.path.js';

/** Pin updates only when `build/uninstall-vaults.nsh` changes on this branch. */
const EXPECTED_BUILD_UNINSTALL_VAULTS_NSH_SHA256 =
  'bbb1aa144657d7d9a2999b01eb3abbcdc20f45378b5ef35a4c4b754a23324f72';

function assertCanonicalBuildHashMatchesSuiteStartSnapshot(): void {
  expect(existsSync(UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE)).toBe(true);
  const atStart = readFileSync(UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE, 'utf-8').trim();
  const now = sha256UninstallVaultsNshBuildFile(defaultUninstallVaultsNshPath());
  expect(now, 'build/uninstall-vaults.nsh must match hash captured at vitest globalSetup').toBe(atStart);
}

describe('build/uninstall-vaults.nsh on-disk integrity (suite-start snapshot)', () => {
  it('canonical build file hash matches committed pin (detects pre-run tamper)', () => {
    const now = sha256UninstallVaultsNshBuildFile(defaultUninstallVaultsNshPath());
    expect(now).toBe(EXPECTED_BUILD_UNINSTALL_VAULTS_NSH_SHA256);
  });

  it('canonical build file hash matches vitest globalSetup snapshot', () => {
    assertCanonicalBuildHashMatchesSuiteStartSnapshot();
  });

  afterAll(() => {
    assertCanonicalBuildHashMatchesSuiteStartSnapshot();
  });
});
