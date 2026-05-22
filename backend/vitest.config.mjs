/** @type {import('vitest/config').UserConfig} */
export default {
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
};
