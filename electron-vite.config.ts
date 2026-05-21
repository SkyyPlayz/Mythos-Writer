import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'src/main.ts',
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: 'src/preload.ts',
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: '../frontend',
    build: {
      rollupOptions: {
        input: '../frontend/index.html',
      },
    },
  },
});
