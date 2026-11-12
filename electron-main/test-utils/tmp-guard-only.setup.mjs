/**
 * Vitest globalSetup: the temp-dir leak guard on its own. The frontend config
 * uses this file, so its run does not load electron-main's uninstall-nsh
 * integrity guard. tmp-guard.setup.mjs composes the two for electron-main.
 * A tmpdir that cannot be read logs a skip and does not fail the run.
 */
import { ensureRunId } from './tmpdir.mjs';
import { snapshot, verify } from './tmp-guard.mjs';

/**
 * Snapshots this run's mythos-test-<run>-* directories.
 * @returns {() => Error | null} reports a leak as an Error without throwing it
 */
export function startTmpGuard() {
  console.log('mythos-test globalSetup guard');
  ensureRunId();
  snapshot();
  return () => {
    const result = verify();
    if (result.skipped || result.leaks.length === 0) return null;
    return new Error(`mythos-test guard leak: ${result.leaks.join(', ')}`);
  };
}

/**
 * @param {Error} leakErr
 * @returns {never}
 */
export function failOnLeak(leakErr) {
  // Vitest logs a globalSetup teardown throw as "error during close" and
  // still exits 0. The main process has no VITEST_WORKER_ID; a worker
  // calling setup() directly (the SIGKILL case) must keep its own exit code.
  if (process.env.VITEST_WORKER_ID === undefined) process.exitCode = 1;
  throw leakErr;
}

export default function setup() {
  const leakError = startTmpGuard();
  return async () => {
    const leakErr = leakError();
    if (leakErr) failOnLeak(leakErr);
  };
}
