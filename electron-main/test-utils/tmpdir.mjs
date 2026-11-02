/**
 * Per-run temp directories for vitest.
 *
 * The only delete sink is removeRecorded(). It refuses anything that is not the
 * directory makeTestTmp() recorded: wrong inode, a symlink/junction, a parent
 * outside the real tmpdir, or a basename without this run's prefix.
 * cleanupTestTmp() drops the record only after a successful remove (R20), so a
 * later cleanup or the exit fallback is a no-op once the set is empty.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUN_ID_RE = /^[0-9a-f]{8}$/;
const NAME_RE = /^[a-z0-9-]{1,40}$/;

/** @type {Map<string, { dev: number, ino: number }>} */
const records = new Map();

let fallbackInstalled = false;
let fallbackRan = false;

/**
 * @returns {string}
 */
export function ensureRunId() {
  process.env.MYTHOS_TEST_RUN_ID ??= crypto.randomBytes(4).toString('hex');
  return process.env.MYTHOS_TEST_RUN_ID;
}

/**
 * Case-insensitive on win32 and darwin. Pure string compare; callers pass realpaths.
 * @param {string} a
 * @param {string} b
 * @param {string} [platform]
 * @returns {boolean}
 */
export function sameDir(a, b, platform = process.platform) {
  if (platform === 'win32' || platform === 'darwin') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/**
 * @param {string} name
 * @returns {string}
 */
export function makeTestTmp(name) {
  const run = process.env.MYTHOS_TEST_RUN_ID;
  if (!run || !RUN_ID_RE.test(run)) {
    throw new Error(`MYTHOS_TEST_RUN_ID missing or invalid: ${String(run)}`);
  }
  if (!NAME_RE.test(name)) {
    throw new Error(`bad tmp name: ${String(name)}`);
  }
  const created = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-test-${run}-${name}-`));
  const real = fs.realpathSync.native(created);
  const st = fs.lstatSync(real);
  records.set(real, { dev: st.dev, ino: st.ino });
  return real;
}

/**
 * @param {string} p
 * @returns {void}
 */
export function removeRecorded(p) {
  if (!records.has(p)) {
    throw new Error(`unrecorded tmp path: ${p}`);
  }
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`refusing to remove symlink or non-directory: ${p}`);
  }
  const rec = records.get(p);
  if (!rec || st.dev !== rec.dev || st.ino !== rec.ino) {
    throw new Error(`dev/ino mismatch: ${p}`);
  }
  const resolved = fs.realpathSync.native(p);
  const parent = path.dirname(resolved);
  const tmpReal = fs.realpathSync.native(os.tmpdir());
  if (!sameDir(parent, tmpReal)) {
    throw new Error(`parent outside tmpdir: ${p}`);
  }
  const run = process.env.MYTHOS_TEST_RUN_ID;
  const base = path.basename(resolved);
  if (!run || !base.startsWith(`mythos-test-${run}-`)) {
    throw new Error(`basename prefix mismatch: ${base}`);
  }
  fs.rmSync(p, { recursive: true, force: false, maxRetries: 3 });
  records.delete(p);
}

/**
 * Remove every recorded directory. One AggregateError if any remove fails.
 * An empty record set is a no-op (R20).
 * @returns {void}
 */
export function cleanupTestTmp() {
  /** @type {unknown[]} */
  const errors = [];
  for (const p of [...records.keys()]) {
    try {
      removeRecorded(p);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'cleanupTestTmp failed');
  }
}

function fallbackClean() {
  if (fallbackRan) return;
  fallbackRan = true;
  for (const p of [...records.keys()]) {
    try {
      removeRecorded(p);
      console.log(`mythos-test fallback cleaned ${p}`);
    } catch {
      console.log(`mythos-test fallback failed ${p}`);
    }
  }
}

function installFallback() {
  if (process.env.MYTHOS_TEST_NO_FALLBACK === '1') return;
  if (fallbackInstalled) return;
  fallbackInstalled = true;
  process.on('exit', fallbackClean);
  for (const sig of ['SIGTERM', 'SIGINT']) {
    const handler = () => {
      fallbackClean();
      process.off(sig, handler);
      if (process.listenerCount(sig) === 0) {
        process.kill(process.pid, sig);
      }
    };
    process.on(sig, handler);
  }
}

installFallback();
