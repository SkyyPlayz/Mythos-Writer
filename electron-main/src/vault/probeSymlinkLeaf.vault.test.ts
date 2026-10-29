// Probe's symlink-leaf test for vault save paths. Adopted with the vault tests.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { writeVaultFileAtomic } from '../vault.js';
import { VaultWriteRefusedError, writeNoFollowAtomic } from './noFollowWrite.js';
import { mapVaultWriteError } from './writeErrors.js';

function refusal(fn: () => unknown, rel: string): void {
  let e: unknown;
  try {
    fn();
  } catch (x) {
    e = x;
  }
  expect(e).toBeTruthy();
  const m = mapVaultWriteError(e, rel);
  expect(m?.code).toBe('LEAF_LINK');
  expect(m?.error).toContain("it's a shortcut (symbolic link)");
}

const posix = process.platform !== 'win32';
let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-1748-'));
  root = path.join(base, 'vault');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.mkdirSync(outside);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe.runIf(posix)('probe: symlink leaf on vault save', () => {
  it('normal save creates then overwrites a regular file', () => {
    const r = writeVaultFileAtomic(root, 'notes/a.md', 'one');
    expect(fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')).toBe('one');
    expect(r.bytes).toBe(3);
    writeVaultFileAtomic(root, 'notes/a.md', 'two');
    expect(fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')).toBe('two');
    expect(fs.lstatSync(path.join(root, 'notes/a.md')).isSymbolicLink()).toBe(false);
    expect(fs.readdirSync(path.join(root, 'notes'))).toEqual(['a.md']);
  });

  it('refuses a leaf symlink pointing outside the vault and leaves the target untouched', () => {
    const target = path.join(outside, 'secret.md');
    fs.writeFileSync(target, 'orig');
    fs.symlinkSync(target, path.join(root, 'notes/link.md'));
    refusal(() => writeVaultFileAtomic(root, 'notes/link.md', 'pwn'), 'notes/link.md');
    expect(fs.readFileSync(target, 'utf8')).toBe('orig');
    expect(fs.lstatSync(path.join(root, 'notes/link.md')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(path.join(root, 'notes'))).toEqual(['link.md']);
  });

  it('refuses a leaf symlink pointing inside the vault', () => {
    fs.writeFileSync(path.join(root, 'notes/real.md'), 'orig');
    fs.symlinkSync('real.md', path.join(root, 'notes/alias.md'));
    refusal(() => writeVaultFileAtomic(root, 'notes/alias.md', 'x'), 'notes/alias.md');
    expect(fs.readFileSync(path.join(root, 'notes/real.md'), 'utf8')).toBe('orig');
  });

  it('refuses a dangling leaf symlink and does not create its target', () => {
    const target = path.join(outside, 'new.md');
    fs.symlinkSync(target, path.join(root, 'notes/dangling.md'));
    refusal(() => writeVaultFileAtomic(root, 'notes/dangling.md', 'x'), 'notes/dangling.md');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('no-follow core alone (join bypassed, race window) refuses a leaf symlink', () => {
    const target = path.join(outside, 't.md');
    fs.writeFileSync(target, 'orig');
    const leaf = path.join(root, 'notes/race.md');
    fs.symlinkSync(target, leaf);
    let e: unknown;
    try {
      writeNoFollowAtomic(leaf, 'pwn', { rel: 'notes/race.md' });
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(VaultWriteRefusedError);
    expect((e as VaultWriteRefusedError).code).toBe('LEAF_LINK');
    expect(fs.readFileSync(target, 'utf8')).toBe('orig');
  });

  it('no-follow core alone writes a normal file', () => {
    const f = path.join(root, 'notes/plain.md');
    writeNoFollowAtomic(f, 'ok', { rel: 'notes/plain.md' });
    expect(fs.readFileSync(f, 'utf8')).toBe('ok');
  });
});
