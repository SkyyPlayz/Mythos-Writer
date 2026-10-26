/**
 * Temp-dir helper and leak guard.
 * Children are spawned with a 5s timeout. Signal cases run out of process so a
 * re-raise cannot kill the vitest worker.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTestTmp,
  ensureRunId,
  makeTestTmp,
  removeRecorded,
  sameDir,
} from '../test-utils/tmpdir.mjs';
import { snapshot, verify } from '../test-utils/tmp-guard.mjs';

const origRmSync = fs.rmSync;
const childPath = fileURLToPath(new URL('./fixtures/tmpdir-child.mjs', import.meta.url));
const guardCli = fileURLToPath(new URL('../test-utils/tmp-guard.mjs', import.meta.url));
const savedRun = process.env.MYTHOS_TEST_RUN_ID;
const scratch: string[] = [];

const ALLOW = ['cleanupTestTmp', 'ensureRunId', 'makeTestTmp', 'removeRecorded', 'sameDir'];

/** P7: named exports only, and the module namespace symbol is toStringTag alone. */
function p7ExportsOk(ns: object): boolean {
  const keys = Object.keys(ns).sort();
  if (keys.length !== ALLOW.length || keys.some((key, i) => key !== ALLOW[i])) return false;
  const syms = Object.getOwnPropertySymbols(ns);
  if (syms.length !== 1 || syms[0] !== Symbol.toStringTag) return false;
  return true;
}

function cleanupKeepingFailure(testFailed: boolean): void {
  try {
    cleanupTestTmp();
  } catch (err) {
    if (!testFailed) throw err;
  }
}

afterEach((ctx) => {
  expect(fs.rmSync).toBe(origRmSync);
  const failed = ctx.task.result?.state === 'fail';
  cleanupKeepingFailure(failed);
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (savedRun === undefined) delete process.env.MYTHOS_TEST_RUN_ID;
  else process.env.MYTHOS_TEST_RUN_ID = savedRun;
});

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out });
    });
  });
}

function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

function lineValue(out: string, label: string): string {
  const line = out.split('\n').find((row) => row.startsWith(`${label} `));
  if (!line) throw new Error(`missing ${label} in ${out}`);
  return line.slice(label.length + 1).trim();
}

describe('makeTestTmp / removeRecorded', () => {
  it('(j) rejects bad names', () => {
    for (const name of ['', 'A', 'HasCap', 'a_b', 'a.b', '../x', 'has space', 'a'.repeat(41)]) {
      expect(() => makeTestTmp(name)).toThrow(/bad tmp name/);
    }
  });

  it('(n) rejects a missing or bad run id and keeps a valid one', () => {
    delete process.env.MYTHOS_TEST_RUN_ID;
    expect(() => makeTestTmp('n')).toThrow(/MYTHOS_TEST_RUN_ID/);
    process.env.MYTHOS_TEST_RUN_ID = 'abcd';
    expect(() => makeTestTmp('n')).toThrow(/MYTHOS_TEST_RUN_ID/);
    process.env.MYTHOS_TEST_RUN_ID = 'GGGGGGGG';
    expect(() => makeTestTmp('n')).toThrow(/MYTHOS_TEST_RUN_ID/);
    process.env.MYTHOS_TEST_RUN_ID = 'abc12345';
    ensureRunId();
    expect(process.env.MYTHOS_TEST_RUN_ID).toBe('abc12345');
    const created = makeTestTmp('n');
    removeRecorded(created);
    expect(fs.existsSync(created)).toBe(false);
  });

  it('ensureRunId fills an empty id with 8 hex chars', () => {
    delete process.env.MYTHOS_TEST_RUN_ID;
    const id = ensureRunId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(process.env.MYTHOS_TEST_RUN_ID).toBe(id);
  });

  it('(t) sameDir is case-sensitive on linux and insensitive on win32 and darwin', () => {
    expect(sameDir('/tmp/A', '/tmp/a', 'linux')).toBe(false);
    expect(sameDir('/tmp/A', '/tmp/A', 'linux')).toBe(true);
    expect(sameDir('/tmp/A', '/tmp/a', 'win32')).toBe(true);
    expect(sameDir('C:\\Temp\\Foo', 'c:\\temp\\foo', 'win32')).toBe(true);
    expect(sameDir('/tmp/A', '/tmp/a', 'darwin')).toBe(true);
    expect(sameDir('/tmp/A', '/tmp/B', 'darwin')).toBe(false);
  });

  it('(g) removes an inner symlink and leaves the outside target', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'inner-target-'));
    scratch.push(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'ok');
    const dir = makeTestTmp('inner');
    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(dir, 'link'));
    removeRecorded(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('ok');
  });

  it('(h) removes a recorded directory and a second cleanup is a no-op', () => {
    const dir = makeTestTmp('recorded');
    removeRecorded(dir);
    expect(fs.existsSync(dir)).toBe(false);
    cleanupTestTmp();
  });

  it('(m) removes a directory created through a symlinked TMPDIR', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'real-tmp-'));
    const link = path.join(os.tmpdir(), `link-tmp-${process.pid}`);
    fs.symlinkSync(real, link);
    scratch.push(real);
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = link;
    try {
      const dir = makeTestTmp('sym');
      expect(dir.startsWith(fs.realpathSync.native(real))).toBe(true);
      removeRecorded(dir);
      expect(fs.existsSync(dir)).toBe(false);
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
      fs.unlinkSync(link);
    }
  });
});

describe('refusal cases also run in the child with rm calls 0', () => {
  it('(a)-(f) child refusals do not call rm', async () => {
    const result = await runNode(
      [childPath, 'refusals'],
      childEnv({ MYTHOS_TEST_NO_FALLBACK: '1' }),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain('case-a survived');
    expect(result.out).toContain('case-b survived');
    expect(result.out).toContain('case-c target-intact');
    expect(result.out).toContain('case-d survived');
    expect(result.out).toContain('case-e survived');
    expect(result.out).toContain('case-f new-dir-survived');
    expect(result.out).toContain('rm calls 0');
  });
});

describe('fallback', () => {
  it('(k) MYTHOS_TEST_NO_FALLBACK leaves the directory and prints nothing', async () => {
    const result = await runNode([childPath, 'no-fallback'], childEnv({ MYTHOS_TEST_NO_FALLBACK: '1' }));
    expect(result.code).toBe(0);
    expect(result.out).not.toContain('mythos-test fallback');
    const dir = lineValue(result.out, 'dir');
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('(l) failRm prints hook hit and fallback failed and exits 0', async () => {
    const result = await runNode([childPath, 'fail-rm'], childEnv());
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.out).toContain('hook hit');
    expect(result.out).toContain('mythos-test fallback failed');
    const dir = lineValue(result.out, 'dir');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('(x) R20 cleanup then exit prints no fallback line and a second cleanup is a no-op', async () => {
    const result = await runNode([childPath, 'r20'], childEnv());
    expect(result.code).toBe(0);
    expect(result.out).toContain('second cleanup ok');
    expect(result.out).not.toContain('mythos-test fallback');
  });

  it('(o) AggregateError is one error for every failed remove and does not replace a test failure', async () => {
    const aggregate = await runNode(
      [childPath, 'aggregate'],
      childEnv({ MYTHOS_TEST_NO_FALLBACK: '1' }),
    );
    expect(aggregate.code).toBe(0);
    expect(aggregate.out).toContain('aggregate 2');
    const kept = await runNode(
      [childPath, 'keep-failure'],
      childEnv({ MYTHOS_TEST_NO_FALLBACK: '1' }),
    );
    expect(kept.code).toBe(0);
    expect(kept.out).toContain('kept yes');
    expect(kept.out).toContain('propagated aggregate');
  });

  it('(q1) a pre-installed handler keeps exit 7', async () => {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [childPath, 'q1'], { env: childEnv() });
        let out = '';
        let sent = false;
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          out += chunk;
          if (!sent && out.includes('ready')) {
            sent = true;
            child.kill('SIGTERM');
          }
        });
        child.stderr.on('data', (chunk: string) => {
          out += chunk;
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal, out });
        });
      },
    );
    expect(result.code).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.out).toContain('pre-hits 1');
    expect(result.out).not.toContain('pre-hits 2');
  });

  it('(q2) the lone handler dies by SIGTERM and SIGINT', async () => {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [childPath, 'signal-wait'], { env: childEnv() });
          let out = '';
          let sent = false;
          const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (chunk: string) => {
            out += chunk;
            if (!sent && out.includes('ready')) {
              sent = true;
              child.kill(sig);
            }
          });
          child.stderr.on('data', (chunk: string) => {
            out += chunk;
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
          child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, out });
          });
        },
      );
      expect(result.signal).toBe(sig);
      expect(result.code).toBeNull();
      expect(result.out).toContain('mythos-test fallback cleaned');
    }
  });

  it('(q3) double SIGTERM prints one line per directory', async () => {
    const result = await runNode([childPath, 'q3'], childEnv());
    expect(result.code).toBe(0);
    const cleaned = result.out.split('\n').filter((row) => row.includes('mythos-test fallback cleaned'));
    expect(cleaned).toHaveLength(2);
  });

  it('(q4) swapped symlink: outside target survives and fallback failed is printed', async () => {
    // S-a (i): a mutant that rm's before the checks deletes only the link, so
    // the target still exists. The missing "fallback failed" line is what turns
    // that mutant red.
    const result = await runNode([childPath, 'q4-symlink'], childEnv());
    expect(result.code).toBe(0);
    expect(result.out).toContain('mythos-test fallback failed');
    const outside = lineValue(result.out, 'outside');
    const link = lineValue(result.out, 'link');
    expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true);
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('(q4) recreated directory survives and fallback failed is printed', async () => {
    // S-a (ii): both asserts. A premature rm deletes the new directory, so the
    // new file is gone and the failed line is missing.
    const result = await runNode([childPath, 'q4-recreate'], childEnv());
    const dir = lineValue(result.out, 'dir');
    try {
      expect(result.code).toBe(0);
      expect(result.out).toContain('mythos-test fallback failed');
      expect(fs.existsSync(path.join(dir, 'new.txt'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P7 export keys', () => {
  it('real module namespace matches the allowlist and Symbol.toStringTag', async () => {
    const ns = await import('../test-utils/tmpdir.mjs');
    expect(p7ExportsOk(ns)).toBe(true);
  });

  it('CJS-shim key-check: namespace keys ["default"] is not the allowlist', () => {
    expect(p7ExportsOk({ default: {} })).toBe(false);
  });

  it('symbol clause rejects an extra Symbol on an otherwise valid object', () => {
    const synth: Record<string | symbol, unknown> = {};
    for (const key of ALLOW) synth[key] = () => undefined;
    Object.defineProperty(synth, Symbol.toStringTag, { value: 'Module' });
    expect(p7ExportsOk(synth)).toBe(true);
    const extra = Symbol('extra');
    Object.defineProperty(synth, extra, { value: 1 });
    expect(p7ExportsOk(synth)).toBe(false);
  });
});

describe('tmp guard', () => {
  it('(i) watches only depth-1 mythos-test-<run>-* directories', () => {
    process.env.MYTHOS_TEST_RUN_ID = 'a1b2c3d4';
    snapshot();
    const id = process.env.MYTHOS_TEST_RUN_ID;
    const top = path.join(os.tmpdir(), `mythos-test-${id}-depth`);
    fs.mkdirSync(top);
    fs.mkdirSync(path.join(top, `mythos-test-${id}-nested`));
    const other = path.join(os.tmpdir(), `not-mythos-${id}`);
    fs.mkdirSync(other);
    const file = path.join(os.tmpdir(), `mythos-test-${id}-file`);
    fs.writeFileSync(file, 'x');
    const link = path.join(os.tmpdir(), `mythos-test-${id}-link`);
    fs.symlinkSync(other, link);
    try {
      const result = verify();
      expect(result.skipped).toBe(false);
      expect(result.leaks).toEqual([top]);
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      fs.unlinkSync(link);
    }
  });

  it('(s) lists a leak and does not delete it', () => {
    process.env.MYTHOS_TEST_RUN_ID = 'd4e5f6a7';
    snapshot();
    const id = process.env.MYTHOS_TEST_RUN_ID;
    const leak = path.join(os.tmpdir(), `mythos-test-${id}-sleak`);
    fs.mkdirSync(leak);
    try {
      const result = verify();
      expect(result.leaks).toContain(leak);
      expect(fs.existsSync(leak)).toBe(true);
    } finally {
      fs.rmSync(leak, { recursive: true, force: true });
    }
  });

  it('(w) win32 EPERM read skips, logs, and resolves', () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    };
    const eperm = Object.assign(new Error("EPERM: operation not permitted, scandir 'C:\\Windows\\Temp'"), {
      code: 'EPERM',
    });
    const readDir = () => {
      throw eperm;
    };
    try {
      const snapped = snapshot({ platform: 'win32', readDir });
      const checked = verify({ platform: 'win32', readDir });
      expect(snapped.skipped).toBe(true);
      expect(checked.skipped).toBe(true);
      expect(logs.join('\n')).toMatch(/mythos-test guard skipped win32:.*EPERM/);
    } finally {
      console.log = orig;
    }
  });

  it('a successful read still reports a leak when the skip path is not taken', () => {
    const id = process.env.MYTHOS_TEST_RUN_ID ?? 'abc12345';
    process.env.MYTHOS_TEST_RUN_ID = id;
    const name = `mythos-test-${id}-listed`;
    const dirent = {
      name,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as fs.Dirent;
    snapshot({ readDir: () => [] });
    const result = verify({ readDir: () => [dirent] });
    expect(result.skipped).toBe(false);
    expect(result.leaks).toEqual([path.join(os.tmpdir(), name)]);
  });

  it('(u) CLI with an unset id shares that id with the child and exits 5 on a leak', async () => {
    const env = childEnv();
    delete env.MYTHOS_TEST_RUN_ID;
    const result = await runNode([guardCli, '--', process.execPath, childPath, 'print-id-and-leak'], env);
    expect(result.code).toBe(5);
    const runLine = result.out.split('\n').find((row) => row.startsWith('mythos-test guard run '));
    expect(runLine).toBeTruthy();
    const id = runLine?.slice('mythos-test guard run '.length).trim();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(result.out).toContain(`child-id ${id}`);
    fs.rmSync(path.join(os.tmpdir(), `mythos-test-${id}-uleak`), { recursive: true, force: true });
  });

  it('(v) a nested runner shares the parent id and its leak turns the parent red', async () => {
    const env = childEnv({ MYTHOS_TEST_RUN_ID: 'abc12345' });
    const result = await runNode(
      [guardCli, '--', process.execPath, guardCli, '--', process.execPath, childPath, 'print-id-and-leak'],
      env,
    );
    expect(result.code).toBe(5);
    const ids = result.out
      .split('\n')
      .filter((row) => row.startsWith('mythos-test guard run '))
      .map((row) => row.slice('mythos-test guard run '.length).trim());
    expect(ids).toEqual(['abc12345', 'abc12345']);
    expect(result.out).toContain('child-id abc12345');
    fs.rmSync(path.join(os.tmpdir(), 'mythos-test-abc12345-uleak'), { recursive: true, force: true });
  });

  it('(p) a failed command code wins over a leak exit of 5', async () => {
    const env = childEnv({ MYTHOS_TEST_RUN_ID: 'b2c3d4e5' });
    const leakPath = path.join(os.tmpdir(), 'mythos-test-b2c3d4e5-exit-leak');
    const leaked = await runNode(
      [guardCli, '--', process.execPath, childPath, 'exit-leak', '3', 'leak'],
      env,
    );
    expect(leaked.code).toBe(3);
    fs.rmSync(leakPath, { recursive: true, force: true });
    const cleanFail = await runNode(
      [guardCli, '--', process.execPath, childPath, 'exit-leak', '3'],
      env,
    );
    expect(cleanFail.code).toBe(3);
    const leakOnly = await runNode(
      [guardCli, '--', process.execPath, childPath, 'exit-leak', '0', 'leak'],
      env,
    );
    expect(leakOnly.code).toBe(5);
    fs.rmSync(leakPath, { recursive: true, force: true });
    const ok = await runNode(
      [guardCli, '--', process.execPath, childPath, 'exit-leak', '0'],
      env,
    );
    expect(ok.code).toBe(0);
  });

  it('(r) SIGKILL skips the child fallback and the teardown is red', async () => {
    process.env.MYTHOS_TEST_RUN_ID = 'c3d4e5f6';
    const { default: setup } = await import('../test-utils/tmp-guard.setup.mjs');
    const teardown = await setup();
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [childPath, 'leak-wait'], { env: childEnv() });
        let out = '';
        let sent = false;
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          out += chunk;
          if (!sent && out.includes('ready ')) {
            sent = true;
            child.kill('SIGKILL');
          }
        });
        child.stderr.on('data', (chunk: string) => {
          out += chunk;
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal, out });
        });
      },
    );
    expect(result.signal).toBe('SIGKILL');
    const dir = lineValue(result.out, 'ready');
    await expect(teardown()).rejects.toThrow(/mythos-test guard leak/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
