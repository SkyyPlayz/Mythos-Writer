import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** Vitest stubs `.css?raw` to '' — resolve to a virtual module with real file text (F4 H4). */
function cssRawForTestsPlugin(): Plugin {
  return {
    name: 'mythos-css-raw-for-tests',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.includes('.css') || !id.includes('?raw')) return null;
      const filePart = id.split('?')[0]!;
      let abs: string;
      // Vite root-relative ids look absolute (`/src/...`) but are project-root based.
      if (filePart.startsWith('/src/') || filePart.startsWith('/frontend/')) {
        abs = path.join(frontendRoot, filePart.replace(/^\//, ''));
      } else if (path.isAbsolute(filePart) && filePart.startsWith(frontendRoot)) {
        abs = filePart;
      } else if (importer) {
        const imp = importer.startsWith('\0') ? importer : importer.split('?')[0]!;
        abs = path.resolve(path.dirname(imp.replace(/^\0mythos-css-raw:/, '')), filePart);
      } else {
        abs = path.resolve(frontendRoot, filePart.replace(/^\//, ''));
      }
      // Avoid a trailing `.css` in the virtual id — vitest's CSS pipeline
      // otherwise rewrites the module to `export default ''`.
      return `\0mythos-css-raw:${abs}.rawtxt`;
    },
    load(id) {
      if (!id.startsWith('\0mythos-css-raw:')) return null;
      const file = id.slice('\0mythos-css-raw:'.length).replace(/\.rawtxt$/, '');
      const text = readFileSync(file, 'utf8');
      return `export default ${JSON.stringify(text)};\n`;
    },
  };
}

export default defineConfig({
  plugins: [cssRawForTestsPlugin(), react()],
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
