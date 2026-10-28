/**
 * Lists mythos-test-<run>-* directories that are direct children of tmpdir.
 * Never deletes. A tmpdir read error is logged and skipped; a leak already
 * enumerated is still reported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureRunId } from './tmpdir.mjs';

const RUN_ID_RE = /^[0-9a-f]{8}$/;

/** @type {Set<string> | null} */
let baseline = null;

/**
 * @param {{ platform?: string, readDir?: () => import('node:fs').Dirent[] }} [opts]
 * @returns {string[] | null}
 */
function collect(opts = {}) {
  const run = process.env.MYTHOS_TEST_RUN_ID;
  if (!run || !RUN_ID_RE.test(run)) {
    throw new Error(`MYTHOS_TEST_RUN_ID missing or invalid: ${String(run)}`);
  }
  const platform = opts.platform ?? process.platform;
  let entries;
  try {
    entries = opts.readDir ? opts.readDir() : fs.readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`mythos-test guard skipped ${platform}: ${reason}`);
    return null;
  }
  const prefix = `mythos-test-${run}-`;
  const tmp = os.tmpdir();
  /** @type {string[]} */
  const found = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith(prefix)) continue;
    found.push(path.join(tmp, ent.name));
  }
  return found;
}

/**
 * @param {{ platform?: string, readDir?: () => import('node:fs').Dirent[] }} [opts]
 */
export function snapshot(opts = {}) {
  const listed = collect(opts);
  if (listed === null) {
    baseline = null;
    return { skipped: true, leaks: /** @type {string[]} */ ([]) };
  }
  baseline = new Set(listed);
  return { skipped: false, leaks: /** @type {string[]} */ ([]) };
}

/**
 * @param {{ platform?: string, readDir?: () => import('node:fs').Dirent[] }} [opts]
 */
export function verify(opts = {}) {
  const listed = collect(opts);
  if (listed === null) {
    return { skipped: true, leaks: /** @type {string[]} */ ([]) };
  }
  const base = baseline ?? new Set();
  const leaks = listed.filter((p) => !base.has(p));
  return { skipped: false, leaks };
}

function runCli() {
  const idx = process.argv.indexOf('--');
  if (idx === -1 || idx >= process.argv.length - 1) {
    console.error('usage: node tmp-guard.mjs -- <cmd> [args...]');
    process.exit(2);
  }
  ensureRunId();
  console.log(`mythos-test guard run ${process.env.MYTHOS_TEST_RUN_ID}`);
  snapshot();
  const cmd = process.argv[idx + 1];
  const args = process.argv.slice(idx + 2);
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    const result = verify();
    if (typeof code === 'number' && code !== 0) {
      process.exit(code);
    }
    if (!result.skipped && result.leaks.length > 0) {
      for (const leak of result.leaks) {
        console.error(`mythos-test guard leak ${leak}`);
      }
      process.exit(5);
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(0);
  });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) {
  runCli();
}
