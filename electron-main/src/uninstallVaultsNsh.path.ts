import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Vitest globalSetup writes the suite-start hash here (unique mkdtemp dir per run). */
export const MYTHOS_UNINSTALL_VAULTS_NSH_SNAPSHOT_ENV = 'MYTHOS_UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT';

export function resolveUninstallVaultsNshBuildHashSnapshotFile(): string {
  const fromEnv = process.env[MYTHOS_UNINSTALL_VAULTS_NSH_SNAPSHOT_ENV]?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return join(tmpdir(), 'mythos-uninstall-vaults-nsh-sha256-at-start');
}

/** Vitest / nested-suite override: read NSH from a temp copy instead of build/. */
export const MYTHOS_UNINSTALL_VAULTS_NSH_PATH_ENV = 'MYTHOS_UNINSTALL_VAULTS_NSH_PATH';

export function defaultUninstallVaultsNshPath(): string {
  return resolve(process.cwd(), '../build/uninstall-vaults.nsh');
}

export function resolveUninstallVaultsNshPath(): string {
  const override = process.env[MYTHOS_UNINSTALL_VAULTS_NSH_PATH_ENV]?.trim();
  if (override) {
    return resolve(override);
  }
  return defaultUninstallVaultsNshPath();
}

export function loadUninstallVaultsNsh(): string {
  return readFileSync(resolveUninstallVaultsNshPath(), 'utf-8');
}

export function sha256UninstallVaultsNshBuildFile(filePath = defaultUninstallVaultsNshPath()): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
