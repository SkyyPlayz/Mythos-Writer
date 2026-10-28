// S3.0 L1 — a symlink swapped in after the guard and before rename is refused.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeVaultFileAtomicAbs } from '../vault.js';

const cleanup: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  delete (globalThis as { __mythosWriteVaultBeforeRename?: () => void }).__mythosWriteVaultBeforeRename;
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeVaultFileAtomicAbs race (S3.0 L1)', () => {
  it('refuses when a hook swaps the target for a symlink between guard and rename', () => {
    const vault = tmp('mythos-atomic-');
    const outside = tmp('mythos-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideFile, 'untouched');
    const target = path.join(vault, 'note.md');
    fs.writeFileSync(target, 'original');
    (globalThis as { __mythosWriteVaultBeforeRename?: () => void }).__mythosWriteVaultBeforeRename = () => {
      fs.unlinkSync(target);
      fs.symlinkSync(outsideFile, target);
    };
    expect(() => writeVaultFileAtomicAbs(target, 'pwned')).toThrow(/refused: symlink/);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('untouched');
  });

  it('refuses a hardlink target', () => {
    const vault = tmp('mythos-atomic-hl-');
    const target = path.join(vault, 'note.md');
    const link = path.join(vault, 'alias.md');
    fs.writeFileSync(target, 'original');
    fs.linkSync(target, link);
    expect(() => writeVaultFileAtomicAbs(target, 'pwned')).toThrow(/refused: hardlink/);
    expect(fs.readFileSync(target, 'utf8')).toBe('original');
    expect(fs.readFileSync(link, 'utf8')).toBe('original');
  });

  it('refuses when the parent realpath leaves the vault root before rename', () => {
    const vault = tmp('mythos-atomic-parent-');
    const outside = tmp('mythos-outside-parent-');
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'untouched');
    const target = path.join(vault, 'note.md');
    fs.writeFileSync(target, 'original');
    (globalThis as { __mythosWriteVaultBeforeRename?: () => void }).__mythosWriteVaultBeforeRename = () => {
      const parked = `${vault}-parked`;
      fs.renameSync(vault, parked);
      fs.symlinkSync(outside, vault);
      cleanup.push(parked);
    };
    expect(() => writeVaultFileAtomicAbs(target, 'pwned')).toThrow(/refused/);
    expect(fs.readFileSync(secret, 'utf8')).toBe('untouched');
  });
});
