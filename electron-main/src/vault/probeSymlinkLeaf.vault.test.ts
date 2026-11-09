// Probe's symlink-leaf test for vault save paths. Adopted with the vault tests.
// notes-windows runs it (filter `vault.test`). File-symlink cases skip, with a
// logged reason, only where win32 refuses to create a symlink; junction cases
// need no privilege and always run.
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

/**
 * True only for the one refusal that means "this Windows host may not create
 * symlinks": libuv maps ERROR_PRIVILEGE_NOT_HELD (1314, no Developer Mode and
 * no SeCreateSymbolicLinkPrivilege) to EPERM on the symlink syscall. EACCES is
 * an access-denied on the path (an ACL or a locked tmp dir), not a missing
 * privilege, so it fails the file instead of skipping it. So does any error
 * from another syscall (mkdtemp, write) and any error on POSIX.
 */
function isSymlinkPrivilegeRefusal(err: unknown, platform: NodeJS.Platform): boolean {
  const e = err as NodeJS.ErrnoException;
  return platform === 'win32' && e?.code === 'EPERM' && e?.syscall === 'symlink';
}

/** null when this OS lets the test create a file symlink, else why it refused. */
function fileSymlinkRefusal(): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-1748-cap-'));
  try {
    const target = path.join(dir, 'target.md');
    fs.writeFileSync(target, 'x');
    try {
      fs.symlinkSync(target, path.join(dir, 'link.md'), 'file');
    } catch (err) {
      if (isSymlinkPrivilegeRefusal(err, process.platform)) {
        return 'EPERM: Windows refused to create a file symlink (needs Developer Mode or SeCreateSymbolicLinkPrivilege)';
      }
      throw err;
    }
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const symlinkRefused = fileSymlinkRefusal();
if (symlinkRefused) {
  console.warn(`[probe-1748] skipping file-symlink leaf cases on ${process.platform}: ${symlinkRefused}`);
}

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

describe('probe: regular save on every platform', () => {
  it('file symlinks are only skipped where win32 refuses to create them', () => {
    if (process.platform !== 'win32') expect(symlinkRefused).toBeNull();
    if (symlinkRefused) expect(symlinkRefused).toMatch(/^EPERM: Windows refused/);
  });

  it('skips only for EPERM from the symlink syscall on win32', () => {
    const err = (code: string, syscall: string) => Object.assign(new Error(code), { code, syscall });
    expect(isSymlinkPrivilegeRefusal(err('EPERM', 'symlink'), 'win32')).toBe(true);
    // Access denied on the path is not a missing privilege: fail, do not skip.
    expect(isSymlinkPrivilegeRefusal(err('EACCES', 'symlink'), 'win32')).toBe(false);
    // A refusal from another step of the probe is not a symlink refusal.
    expect(isSymlinkPrivilegeRefusal(err('EPERM', 'open'), 'win32')).toBe(false);
    expect(isSymlinkPrivilegeRefusal(err('EACCES', 'open'), 'win32')).toBe(false);
    // POSIX never skips.
    expect(isSymlinkPrivilegeRefusal(err('EPERM', 'symlink'), 'linux')).toBe(false);
    expect(isSymlinkPrivilegeRefusal(err('EPERM', 'symlink'), 'darwin')).toBe(false);
    expect(isSymlinkPrivilegeRefusal(undefined, 'win32')).toBe(false);
  });

  it('normal save creates then overwrites a regular file', () => {
    const r = writeVaultFileAtomic(root, 'notes/a.md', 'one');
    expect(fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')).toBe('one');
    expect(r.bytes).toBe(3);
    writeVaultFileAtomic(root, 'notes/a.md', 'two');
    expect(fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')).toBe('two');
    expect(fs.lstatSync(path.join(root, 'notes/a.md')).isSymbolicLink()).toBe(false);
    expect(fs.readdirSync(path.join(root, 'notes'))).toEqual(['a.md']);
  });

  it('no-follow core alone writes a normal file', () => {
    const f = path.join(root, 'notes/plain.md');
    writeNoFollowAtomic(f, 'ok', { rel: 'notes/plain.md' });
    expect(fs.readFileSync(f, 'utf8')).toBe('ok');
  });
});

// Junctions need no privilege on Windows, so these run on every win32 host.
// On POSIX the 'junction' type is ignored and the leaf is a directory symlink.
describe('probe: junction leaf on vault save', () => {
  function junctionLeaf(rel: string): string {
    const leaf = path.join(root, rel);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'KEEP');
    fs.symlinkSync(outside, leaf, 'junction');
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
    return leaf;
  }

  function outsideUntouched(): void {
    expect(fs.readdirSync(outside)).toEqual(['sentinel.txt']);
    expect(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('KEEP');
  }

  it('refuses a junction leaf pointing outside the vault and writes nothing there', () => {
    const leaf = junctionLeaf('notes/junction.md');
    refusal(() => writeVaultFileAtomic(root, 'notes/junction.md', 'pwn'), 'notes/junction.md');
    outsideUntouched();
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(path.join(root, 'notes'))).toEqual(['junction.md']);
  });

  it('no-follow core alone (join bypassed, race window) refuses a junction leaf', () => {
    const leaf = junctionLeaf('notes/race-junction.md');
    let e: unknown;
    try {
      writeNoFollowAtomic(leaf, 'pwn', { rel: 'notes/race-junction.md' });
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(VaultWriteRefusedError);
    expect((e as VaultWriteRefusedError).code).toBe('LEAF_LINK');
    outsideUntouched();
    expect(fs.readdirSync(path.join(root, 'notes'))).toEqual(['race-junction.md']);
  });
});

describe.skipIf(symlinkRefused !== null)('probe: symlink leaf on vault save', () => {
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
});
