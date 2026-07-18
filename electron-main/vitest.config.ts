import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
