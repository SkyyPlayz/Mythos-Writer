/**
 * Vitest globalSetup for electron-main: the leak guard from
 * tmp-guard-only.setup.mjs plus the uninstall-nsh integrity setup. The nsh
 * teardown runs even when the leak check throws; a leak is raised after it.
 */
import { failOnLeak, startTmpGuard } from './tmp-guard-only.setup.mjs';

export default async function setup() {
  const leakError = startTmpGuard();
  const nsh = await import('../vitest.uninstallVaultsNshBuildIntegrity.global.ts');
  const nshTeardown = nsh.default();
  return async () => {
    let leakErr = null;
    try {
      leakErr = leakError();
    } finally {
      if (typeof nshTeardown === 'function') {
        await nshTeardown();
      }
    }
    if (leakErr) failOnLeak(leakErr);
  };
}
