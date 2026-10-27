import { defineConfig } from 'vitest/config';
import { ensureRunId } from './test-utils/tmpdir.mjs';

ensureRunId();

export default defineConfig({
  test: {
    // T14 lives in shared/, which has no CI test script. Include it here so
    // `npm run test -w electron-main` runs the flag source guard. Importing
    // that file from src/ would pull it under tsconfig rootDir.
    include: ['src/**/*.test.ts', 'tests/**/*.spec.ts', '../shared/aiSuggestOnly.test.ts'],
    globalSetup: ['./test-utils/tmp-guard.setup.mjs'],
    // Matches frontend/vite.config.ts's testTimeout — vitest's 5000ms default
    // is too tight for fast-check property tests and large fixture builds
    // (manifestValidate's oversize-array cases) under self-hosted runner
    // contention (SKY-6991).
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
