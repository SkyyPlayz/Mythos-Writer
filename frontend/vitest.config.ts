import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { cssRawForTestsPlugin } from './viteCssRawForTestsPlugin';
import { ensureRunId } from '../electron-main/test-utils/tmpdir.mjs';

ensureRunId();

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [cssRawForTestsPlugin()],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      globalSetup: ['../electron-main/test-utils/tmp-guard.setup.mjs'],
      // Async UI tests use waitFor({timeout:15000+}); 5000ms default times out on loaded runners
      testTimeout: 30000,
      // Keep coverage writes deterministic on busy self-hosted runners. The V8 provider
      // can otherwise race worker shutdown with coverage/.tmp cleanup after large suites.
      fileParallelism: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        reportsDirectory: './coverage',
      },
    },
  }),
);
