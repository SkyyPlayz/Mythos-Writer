// Flat config for this package only. Frontend lint is ESLint 8 via
// frontend/.eslintrc.json and is not pointed at this file. The CI gate for
// the testing-hook import is electron-main/src/vault/writeGuard.test.ts.
export default [
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/noFollowWrite.testing', '**/noFollowWrite.testing.js'],
              message: 'Test hooks must not be imported from production code.',
            },
          ],
        },
      ],
    },
  },
];
