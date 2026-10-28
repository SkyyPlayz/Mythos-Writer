/**
 * Test-only patches for fs.rmSync. Imported only by tests/fixtures/tmpdir-child.mjs.
 * tmpdir.mjs calls fs.rmSync on the default fs object, so these patches are visible.
 */
import fs from 'node:fs';

const orig = fs.rmSync;

/** @type {number} */
let calls = 0;

export function failRm() {
  fs.rmSync = function failRmSync() {
    console.log('hook hit');
    throw new Error('failRm');
  };
}

export function recordRm() {
  calls = 0;
  fs.rmSync = function recordedRmSync(...args) {
    calls += 1;
    return orig.apply(fs, args);
  };
}

export function restoreRm() {
  fs.rmSync = orig;
}

export function rmCalls() {
  return calls;
}
