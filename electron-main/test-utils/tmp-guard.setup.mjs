/**
 * Vitest globalSetup wrapper: leak guard plus the uninstall-nsh integrity setup.
 * A tmpdir that cannot be read logs a skip and does not fail the run.
 */
import { ensureRunId } from './tmpdir.mjs';
import { snapshot, verify } from './tmp-guard.mjs';

export default async function setup() {
  console.log('mythos-test globalSetup guard');
  ensureRunId();
  snapshot();
  const nsh = await import('../vitest.uninstallVaultsNshBuildIntegrity.global.ts');
  const nshTeardown = nsh.default();
  return async () => {
    let leakErr = null;
    try {
      const result = verify();
      if (!result.skipped && result.leaks.length > 0) {
        leakErr = new Error(`mythos-test guard leak: ${result.leaks.join(', ')}`);
      }
    } finally {
      if (typeof nshTeardown === 'function') {
        await nshTeardown();
      }
    }
    if (leakErr) throw leakErr;
  };
}
