import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Electron tests run in a single worker — the app process is shared across tests
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    // Capture screenshot on failure for CI debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
