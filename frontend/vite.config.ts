import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production / dev config — no css?raw test plugin (Shield: Vitest-only).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy removed — IPC handles backend calls in Electron mode
  },
});
