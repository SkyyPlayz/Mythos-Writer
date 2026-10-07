import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Written by vitest globalSetup; read by uninstallVaultsNsh.buildIntegrity.test.ts */
export const UNINSTALL_VAULTS_NSH_BUILD_HASH_SNAPSHOT_FILE = join(
  tmpdir(),
  'mythos-uninstall-vaults-nsh-sha256-at-start',
);

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
