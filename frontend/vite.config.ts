import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy removed — IPC handles backend calls in Electron mode
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
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
});
