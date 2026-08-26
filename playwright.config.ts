import { defineConfig } from '@playwright/test';

// SKY-10405: the e2e corpus seeds v0.4 twin-root fixture vaults and asserts
// against their on-disk paths. The boot-time silent MythosVault migration
// would repoint every one of them at launch, so it is disabled suite-wide
// here (electron.launch inherits the worker's env). The boot-migration specs
// in e2e/mythos-migration.spec.ts override this per launch to exercise the
// real path. Never set in production.
process.env.MYTHOS_DISABLE_BOOT_MIGRATION = '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Electron tests run in a single worker — the app process is shared across tests
  workers: 1,
  // SKY-10969: e2e-shard-4 runs on a self-hosted box alongside 3 sibling
  // shards + other in-flight PR runs (see SKY-9620). No retry budget meant
  // any single tail-latency stall on a contended runner failed the whole
  // required `ci` check — different specs each run, no product regression.
  // Local dev keeps 0 retries so genuine bugs still fail fast.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    // Capture screenshot on failure for CI debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
