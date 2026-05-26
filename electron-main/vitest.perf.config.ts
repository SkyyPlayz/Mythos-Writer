import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/perfBudget.bench.ts'],
    reporters: ['verbose'],
  },
});
