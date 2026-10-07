import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
