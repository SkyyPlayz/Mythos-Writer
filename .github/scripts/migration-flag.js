#!/usr/bin/env node
/**
 * Owns migration-path detection for carve-out-check; never fails a build.
 */
'use strict';

const DB_TS = 'electron-main/src/db.ts';

const ADDED_SQL = [
  { id: 'pragma-user-version', source: String.raw`PRAGMA user_version\s*=` },
  { id: 'create-table-or-index', source: String.raw`CREATE (TABLE|INDEX)` },
  { id: 'alter-table', source: String.raw`ALTER TABLE` },
  { id: 'drop-table-or-index', source: String.raw`DROP (TABLE|INDEX)` },
];

function addedLines(patch) {
  const lines = [];
  for (const raw of String(patch).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) lines.push(line.slice(1));
  }
  return lines;
}

function isTestFile(filename) {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  return /\.(test|spec)\.[^.]+$/.test(base);
}

function isMigrationPath(filename) {
  if (!filename.startsWith('electron-main/src/')) return false;
  if (isTestFile(filename)) return false;
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  if (/(^|\/)migrations?\//.test(filename)) return true;
  if (/^migrat\w*\.ts$/.test(base)) return true;
  if (/^\w*Migration\.ts$/.test(base)) return true;
  return false;
}

function classify(files) {
  const hits = [];
  for (const file of files || []) {
    const filename = file && file.filename ? file.filename : '';
    if (!filename) continue;
    if (filename === DB_TS) {
      if (file.patch == null) {
        hits.push({ filename, rule: 'db.ts changed (patch not available)' });
      } else {
        const added = addedLines(file.patch);
        for (const rule of ADDED_SQL) {
          const re = new RegExp(rule.source);
          if (added.some((line) => re.test(line))) hits.push({ filename, rule: rule.id });
        }
      }
      continue;
    }
    if (filename.endsWith('.sql')) {
      hits.push({ filename, rule: 'sql-file' });
      continue;
    }
    if (isMigrationPath(filename)) hits.push({ filename, rule: 'migration-path' });
  }
  return hits;
}

async function createLabel(github, owner, repo) {
  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: 'db-migration',
      color: '1D76DB',
    });
  } catch (err) {
    if (err && err.status === 422) return;
    throw err;
  }
}

module.exports = { classify, createLabel };
