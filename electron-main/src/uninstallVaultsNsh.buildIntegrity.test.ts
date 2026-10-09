import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import {
  defaultUninstallVaultsNshPath,
  resolveUninstallVaultsNshBuildHashSnapshotFile,
  sha256UninstallVaultsNshBuildFile,
} from './uninstallVaultsNsh.path.js';

/** Pin updates only when `build/uninstall-vaults.nsh` changes on this branch. */
const EXPECTED_BUILD_UNINSTALL_VAULTS_NSH_SHA256 =
  '3f538b5f1aef73c12651fcc2cd95acde87a5fdc6e6af831b5ff6142ff6dc80ab';

function assertCanonicalBuildHashMatchesSuiteStartSnapshot(): void {
  const snapshotFile = resolveUninstallVaultsNshBuildHashSnapshotFile();
  expect(existsSync(snapshotFile)).toBe(true);
  const atStart = readFileSync(snapshotFile, 'utf-8').trim();
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
