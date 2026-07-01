// SKY-4773: Regression tests for path-containment helpers.
// Uses real temp directories — no mocks needed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertUnderRoot, isUnderRoot } from './pathSecurity.js';

describe('assertUnderRoot', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-outside-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('allows a simple relative path inside root', () => {
    expect(() => assertUnderRoot(root, 'sub/file.md')).not.toThrow();
  });

  it('allows root itself (empty candidate)', () => {
    expect(() => assertUnderRoot(root, '')).not.toThrow();
  });

  it('rejects single-step ../ traversal', () => {
    expect(() => assertUnderRoot(root, '../escape')).toThrow('Path containment violation');
  });

  it('rejects deeply nested traversal', () => {
    expect(() => assertUnderRoot(root, 'a/b/../../..')).toThrow('Path containment violation');
  });

  it('rejects an absolute path outside root', () => {
    expect(() => assertUnderRoot(root, outside)).toThrow('Path containment violation');
  });

  it('rejects /etc/passwd absolute path', () => {
    expect(() => assertUnderRoot(root, '/etc/passwd')).toThrow('Path containment violation');
  });

  it('rejects a null-byte path', () => {
    expect(() => assertUnderRoot(root, 'safe\0evil')).toThrow('null byte');
  });

  it('rejects a symlink whose target is outside root', () => {
    const link = path.join(root, 'evil-link');
    fs.symlinkSync(outside, link);
    expect(() => assertUnderRoot(root, 'evil-link')).toThrow('Path containment violation');
  });

  it('allows a symlink whose target stays inside root', () => {
    const realDir = path.join(root, 'real');
    fs.mkdirSync(realDir);
    const link = path.join(root, 'safe-link');
    fs.symlinkSync(realDir, link);
    expect(() => assertUnderRoot(root, 'safe-link')).not.toThrow();
  });

  it('allows a normal nested file that does not exist yet', () => {
    // Path doesn't exist on disk — traversal check still works via path.resolve.
    expect(() => assertUnderRoot(root, 'new/dir/file.md')).not.toThrow();
  });

  it('rejects traversal through a non-existent intermediate', () => {
    expect(() => assertUnderRoot(root, 'nonexistent/../../escape')).toThrow('Path containment violation');
  });
});

describe('isUnderRoot', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-iur-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns true for a valid relative path', () => {
    expect(isUnderRoot(root, 'subdir/file.md')).toBe(true);
  });

  it('returns false for ../ traversal', () => {
    expect(isUnderRoot(root, '../outside')).toBe(false);
  });

  it('returns false for an absolute path outside root', () => {
    expect(isUnderRoot(root, '/etc/passwd')).toBe(false);
  });

  it('returns false for a null-byte path', () => {
    expect(isUnderRoot(root, 'foo\0bar')).toBe(false);
  });

  it('never throws even for malformed input', () => {
    expect(() => isUnderRoot(root, '\0\0\0')).not.toThrow();
    expect(() => isUnderRoot(root, '../../../../../../../../etc')).not.toThrow();
  });
});
