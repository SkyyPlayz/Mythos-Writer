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
  {
    // Story-facts extractors are blind to stored facts: nothing under
    // factLedger/extract/ (tests included) may import the DB or the ledger DB.
    // This entry replaces the options above for these files, so it repeats
    // the test-hook pattern. Dynamic imports are checked by
    // src/factLedger/extract/blindness.test.ts.
    files: ['src/factLedger/extract/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/noFollowWrite.testing', '**/noFollowWrite.testing.js'],
              message: 'Test hooks must not be imported from production code.',
            },
            {
              group: ['**/db', '**/db.js', '**/db.ts', '**/ledgerDb', '**/ledgerDb.js', '**/ledgerDb.ts'],
              message: 'factLedger/extract must not import the DB or the ledger DB.',
            },
          ],
        },
      ],
    },
  },
];
