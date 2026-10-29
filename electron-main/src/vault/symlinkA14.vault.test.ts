// Windows junctions and case-folded containment. notes-windows matches the
// substring `vault.test`. Junctions are a win32-only symlink form.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { containmentKey, isResolvedPathInsideRoot, safeVaultJoin } from './safeVaultJoin.js';
import { writeVaultFileAtomic } from '../vault.js';

describe('win32 containment key', () => {
  it('strips \\\\?\\ and \\\\?\\UNC\\ then case-folds', () => {
    expect(containmentKey('\\\\?\\C:\\Vault', 'win32')).toBe('c:\\vault');
    expect(containmentKey('\\\\?\\UNC\\Server\\Share\\Note.md', 'win32')).toBe('\\\\server\\share\\note.md');
    expect(containmentKey('C:\\Vault\\A.md', 'win32')).toBe('c:\\vault\\a.md');
  });

  it('keeps a separator so a sibling prefix does not count as inside', () => {
    if (process.platform !== 'win32') return;
    expect(isResolvedPathInsideRoot('C:\\Vault', 'C:\\Vault\\a.md', 'win32')).toBe(true);
    expect(isResolvedPathInsideRoot('C:\\Vault', 'C:\\vault\\a.md', 'win32')).toBe(true);
    expect(isResolvedPathInsideRoot('C:\\Vault', 'C:\\Vault-evil\\a.md', 'win32')).toBe(false);
    expect(isResolvedPathInsideRoot('C:\\Vault', 'C:\\Vault2\\a.md', 'win32')).toBe(false);
  });
});

describe.skipIf(process.platform !== 'win32')('junction leaves', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses a junction directory on write and does not create a file outside', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-junction-'));
    const root = path.join(tmp, 'vault');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'KEEP');
    fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');

    expect(() => writeVaultFileAtomic(root, 'linked/note.md', 'nope')).toThrow(/Path traversal denied|symlink/);
    expect(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('KEEP');
    expect(fs.existsSync(path.join(outside, 'note.md'))).toBe(false);
    expect(() => safeVaultJoin(root, 'linked/note.md', { writeMode: true })).toThrow(/symlink/);
  });
});
