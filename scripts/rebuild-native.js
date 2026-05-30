#!/usr/bin/env node
// Rebuilds better-sqlite3 for Electron's ABI.
// Mirrors the explicit `npm rebuild` approach used in CI, which works reliably
// where @electron/rebuild's tree-search does not (better-sqlite3 is hoisted to
// the root node_modules by the workspace but not listed in the root package.json).
const { execSync } = require('child_process');
const path = require('path');

const electronPkg = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json'));
const version = electronPkg.version;

console.log(`Rebuilding better-sqlite3 for Electron ${version}...`);
execSync(
  `npm rebuild better-sqlite3 --runtime=electron --target=${version} --dist-url=https://electronjs.org/headers`,
  { stdio: 'inherit' }
);
console.log('Done.');
