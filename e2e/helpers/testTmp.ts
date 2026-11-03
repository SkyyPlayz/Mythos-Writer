/**
 * Playwright bridge to the shared per-run temp-dir helper and leak guard in
 * electron-main/test-utils (lane A0). Specs import makeTestTmp / removeRecorded /
 * cleanupTestTmp from here; the default export is playwright.config's globalSetup.
 *
 * tmpdir.mjs is loaded with createRequire (a static import would leave the
 * electron-main TS project's rootDir). Every spec in a worker shares that one
 * cached instance, which owns the record set removeRecorded() checks before
 * deleting. tmp-guard.mjs uses import.meta, so globalSetup loads it with a
 * dynamic import(); playwright.config's build.external keeps both files native
 * ESM so the two loads agree.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type TmpDirHelper = {
  ensureRunId(): string;
  makeTestTmp(name: string): string;
  removeRecorded(p: string): void;
  cleanupTestTmp(): void;
};

type TmpGuard = {
  snapshot(): { skipped: boolean; leaks: string[] };
  verify(): { skipped: boolean; leaks: string[] };
};

const requireMjs = createRequire(__filename);
const helper = requireMjs('../../electron-main/test-utils/tmpdir.mjs') as TmpDirHelper;

// playwright.config.ts already set the id in the runner; workers inherit it
// through the environment, so this is a no-op there (??=).
helper.ensureRunId();
if (process.env.TEST_WORKER_INDEX !== undefined) {
  console.log(
    `mythos-test worker ${process.env.TEST_WORKER_INDEX} run ${process.env.MYTHOS_TEST_RUN_ID}`,
  );
}

export const makeTestTmp = helper.makeTestTmp;
export const removeRecorded = helper.removeRecorded;
export const cleanupTestTmp = helper.cleanupTestTmp;

/**
 * globalSetup: snapshot this run's mythos-test-<run>-* dirs; the returned
 * teardown fails the Playwright run if a new one is still in tmpdir. Lists only,
 * never deletes. An unreadable tmpdir logs `mythos-test guard skipped <platform>`.
 */
export default async function tmpGuardGlobalSetup(): Promise<() => Promise<void>> {
  const guardUrl = pathToFileURL(
    path.resolve(__dirname, '../../electron-main/test-utils/tmp-guard.mjs'),
  ).href;
  const guard = (await import(guardUrl)) as TmpGuard;
  console.log(`mythos-test guard run ${helper.ensureRunId()}`);
  guard.snapshot();
  return async () => {
    const result = guard.verify();
    if (!result.skipped && result.leaks.length > 0) {
      for (const leak of result.leaks) console.error(`mythos-test guard leak ${leak}`);
      throw new Error(`mythos-test guard leak: ${result.leaks.join(', ')}`);
    }
  };
}
