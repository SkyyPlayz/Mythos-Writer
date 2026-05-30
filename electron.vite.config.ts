import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node22',
      lib: {
        entry: 'electron-main/src/main.ts',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node22',
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
