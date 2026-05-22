import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      target: 'node20',
      lib: {
        entry: 'electron-main/src/main.ts',
      },
    },
  },
  preload: {
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
