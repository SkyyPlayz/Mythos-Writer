#!/usr/bin/env node
/**
 * Fixture matrix for migration-path detection.
 * Run: node .github/scripts/migration-flag.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { classify, createLabel } = require('./migration-flag.js');

function rulesFor(filename, patch) {
  return classify([{ filename, status: 'modified', patch }])
    .filter((hit) => hit.filename === filename)
    .map((hit) => hit.rule);
}

test('an added PRAGMA line in db.ts is a hit', () => {
  const rules = rulesFor(
    'electron-main/src/db.ts',
    '@@ -1 +1,2 @@\n const x = 1;\n+PRAGMA user_version = 99;\n',
  );
  assert.deepEqual(rules, ['pragma-user-version']);
});

test('added CREATE, ALTER, and DROP lines in db.ts are hits', () => {
  assert.deepEqual(
    rulesFor('electron-main/src/db.ts', '@@ -0,0 +1 @@\n+CREATE TABLE notes (id INT);\n'),
    ['create-table-or-index'],
  );
  assert.deepEqual(
    rulesFor('electron-main/src/db.ts', '@@ -0,0 +1 @@\n+ALTER TABLE notes ADD COLUMN title TEXT;\n'),
    ['alter-table'],
  );
  assert.deepEqual(
    rulesFor('electron-main/src/db.ts', '@@ -0,0 +1 @@\n+DROP INDEX notes_title;\n'),
    ['drop-table-or-index'],
  );
});

test('a missing patch on db.ts is a hit', () => {
  const hits = classify([{ filename: 'electron-main/src/db.ts', status: 'modified' }]);
  assert.deepEqual(hits, [
    { filename: 'electron-main/src/db.ts', rule: 'db.ts changed (patch not available)' },
  ]);
});

test('a db.ts edit with no SQL is not a hit', () => {
  const patch = [
    '@@ -1,2 +1,2 @@',
    '-const a = 1;',
    '+const a = 2;',
    '-CREATE TABLE removed (id INT);',
    ' PRAGMA user_version = 1;',
  ].join('\n');
  assert.deepEqual(rulesFor('electron-main/src/db.ts', patch), []);
});

test('migration paths and sql files are hits', () => {
  const files = [
    'electron-main/src/migration/bootMigration.ts',
    'electron-main/src/vault/manifest/migrations/v0ToV1.ts',
    'electron-main/src/secrets/migration.ts',
    'electron-main/src/vault/VaultMigration.ts',
    'notes/seed.sql',
    'electron-main/src/migration.test.sql',
  ];
  const hits = classify(files.map((filename) => ({ filename, status: 'added' })));
  assert.deepEqual(
    hits.map((hit) => hit.filename),
    files,
  );
  assert.equal(hits.find((hit) => hit.filename.endsWith('.sql')).rule, 'sql-file');
  assert.equal(
    hits.find((hit) => hit.filename.endsWith('bootMigration.ts')).rule,
    'migration-path',
  );
});

test('a test file and a frontend migration screen are not hits', () => {
  const hits = classify([
    { filename: 'electron-main/src/migration.test.ts', status: 'modified' },
    { filename: 'electron-main/src/migrations/foo.test.ts', status: 'added' },
    { filename: 'frontend/src/migration/MythosMigrationCenter.tsx', status: 'modified' },
  ]);
  assert.deepEqual(hits, []);
});

test('createLabel ignores a 422 from an existing label', async () => {
  const calls = [];
  const github = {
    rest: {
      issues: {
        createLabel: async (args) => {
          calls.push(args);
          const err = new Error('already exists');
          err.status = 422;
          throw err;
        },
      },
    },
  };
  await createLabel(github, 'SkyyPlayz', 'Mythos-Writer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'db-migration');
  assert.equal(calls[0].owner, 'SkyyPlayz');
  assert.equal(calls[0].repo, 'Mythos-Writer');
});
