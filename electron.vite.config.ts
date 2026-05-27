import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // Externalize node dependencies (notably the native better-sqlite3) so they
    // are required from node_modules at runtime instead of bundled. Rollup cannot
    // bundle native .node addons (loaded via a dynamic require), which otherwise
    // crashes the main process on startup before any window is created.
    // `include` is required because the workspace hoists deps to the root, whose
    // package.json lists none, so the plugin's auto-detection finds nothing.
    plugins: [externalizeDepsPlugin({ include: ['better-sqlite3'] })],
    build: {
      target: 'node20',
      lib: {
        entry: 'electron-main/src/main.ts',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node20',
      lib: {
        entry: 'electron-main/src/preload.ts',
      },
    },
  },
  renderer: {
    root: 'frontend',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: 'frontend/index.html',
      },
    },
  },
});
