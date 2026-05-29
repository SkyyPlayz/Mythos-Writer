// MYT-774: path-traversal hardening tests.
//
// Each describe block targets one of the six escape vectors listed in the
// issue: dotdot, symlink, absolute, encoded "..", null byte, and Windows
// drive-letter on Linux. The strict IPC variant adds dotfile + extension
// allow-list coverage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  safeVaultJoin,
  safeVaultIpcJoin,
  VAULT_IPC_ALLOWED_EXTENSIONS,
} from './safeVaultJoin.js';

describe('safeVaultJoin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-svj-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. dotdot escape ─────────────────────────────────────────────────────
  describe('dotdot escape', () => {
    it('rejects "../../../etc/passwd" when no parent exists', () => {
      expect(() => safeVaultJoin(tmpDir, '../../../etc/passwd')).toThrow(/Path traversal denied/);
    });

    it('rejects "sub/../../escape" when parent does exist', () => {
      fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
      expect(() => safeVaultJoin(tmpDir, 'sub/../../escape.md')).toThrow(/Path traversal denied/);
    });

    it('accepts a legitimate nested write that uses "." normalisation', () => {
      const result = safeVaultJoin(tmpDir, 'a/./b/c.md', { writeMode: true });
      expect(result.endsWith(path.join('a', 'b', 'c.md'))).toBe(true);
    });
  });

  // ── 2. symlink escape ────────────────────────────────────────────────────
  describe('symlink escape', () => {
    it('rejects a symlink-to-directory pointing outside the vault', () => {
      fs.symlinkSync(os.tmpdir(), path.join(tmpDir, 'escape'));
      expect(() => safeVaultJoin(tmpDir, 'escape')).toThrow(/symlink escape detected/);
    });

    it('rejects a symlink-to-file pointing outside the vault', () => {
      const targetFile = path.join(os.tmpdir(), `mythos-svj-target-${Date.now()}.txt`);
      fs.writeFileSync(targetFile, 'sensitive');
      fs.symlinkSync(targetFile, path.join(tmpDir, 'escape.txt'));
      try {
        expect(() => safeVaultJoin(tmpDir, 'escape.txt')).toThrow(/symlink escape detected/);
      } finally {
        fs.rmSync(targetFile, { force: true });
      }
    });

    it('rejects a write that lands through a symlinked parent directory', () => {
      fs.symlinkSync(os.tmpdir(), path.join(tmpDir, 'escape-dir'));
      expect(() =>
        safeVaultJoin(tmpDir, 'escape-dir/new.md', { writeMode: true }),
      ).toThrow(/parent symlink escapes vault/);
    });

    it('allows a symlink pointing inside the vault', () => {
      const inner = path.join(tmpDir, 'inner.md');
      fs.writeFileSync(inner, 'ok');
      fs.symlinkSync(inner, path.join(tmpDir, 'inner-link.md'));
      expect(() => safeVaultJoin(tmpDir, 'inner-link.md')).not.toThrow();
    });
  });

  // ── 3. absolute path ─────────────────────────────────────────────────────
  describe('absolute path', () => {
    it('rejects "/etc/passwd"', () => {
      expect(() => safeVaultJoin(tmpDir, '/etc/passwd')).toThrow(/Path traversal denied/);
    });

    it('rejects "/tmp/escape.md" (also in writeMode)', () => {
      expect(() =>
        safeVaultJoin(tmpDir, '/tmp/mythos-traversal-target.md', { writeMode: true }),
      ).toThrow(/Path traversal denied/);
    });
  });

  // ── 4. URL-encoded ".." ──────────────────────────────────────────────────
  describe('encoded ".."', () => {
    it('rejects single-encoded "%2e%2e/escape"', () => {
      expect(() => safeVaultJoin(tmpDir, '%2e%2e/escape.md')).toThrow(/encoded traversal sequence/);
    });

    it('rejects uppercase "%2E%2E%2F"', () => {
      expect(() => safeVaultJoin(tmpDir, '%2E%2E%2Fescape.md')).toThrow(/encoded traversal sequence/);
    });

    it('rejects double-encoded "%252e%252e/escape"', () => {
      expect(() => safeVaultJoin(tmpDir, '%252e%252e/escape.md')).toThrow(/encoded traversal sequence/);
    });

    it('allows an innocuous path that contains "%25" but no ".."', () => {
      // "%25-percent.md" decodes to "%-percent.md" — not a traversal sequence.
      expect(() =>
        safeVaultJoin(tmpDir, '%25-percent.md', { writeMode: true }),
      ).not.toThrow();
    });
  });

  // ── 5. null byte ─────────────────────────────────────────────────────────
  describe('null byte', () => {
    it('rejects a null byte in the middle of the path', () => {
      expect(() => safeVaultJoin(tmpDir, 'note\u0000.md')).toThrow(/null byte in path/);
    });

    it('rejects a null byte that would smuggle a different target', () => {
      // "scene.md\0../../etc/passwd" — Node truncates at the NUL when opening,
      // so without this check we'd silently target "scene.md" while bypassing
      // any extension/path policy applied to the visible suffix.
      expect(() =>
        safeVaultJoin(tmpDir, 'scene.md\u0000../../etc/passwd', { writeMode: true }),
      ).toThrow(/null byte in path/);
    });
  });

  // ── 6. Windows drive-letter on Linux ─────────────────────────────────────
  describe('Windows drive-letter on Linux', () => {
    it('rejects "C:\\Windows\\System32\\config\\SAM"', () => {
      expect(() =>
        safeVaultJoin(tmpDir, 'C:\\Windows\\System32\\config\\SAM'),
      ).toThrow(/absolute Windows path/);
    });

    it('rejects "D:/escape.md" with forward slash', () => {
      expect(() => safeVaultJoin(tmpDir, 'D:/escape.md', { writeMode: true })).toThrow(
        /absolute Windows path/,
      );
    });

    it('rejects a UNC "\\\\server\\share" prefix', () => {
      expect(() => safeVaultJoin(tmpDir, '\\\\evil-server\\share\\loot.md')).toThrow(
        /absolute Windows path/,
      );
    });

    it('allows a literal colon mid-path on Linux (not a drive prefix)', () => {
      // "notes/2024-06-01T12:00:00.md" — the colon is in the leaf, not at
      // position 1, so it isn't a drive letter.
      expect(() =>
        safeVaultJoin(tmpDir, 'notes/2024-06-01T12:00:00.md', { writeMode: true }),
      ).not.toThrow();
    });
  });

  // ── happy path sanity ────────────────────────────────────────────────────
  describe('happy path', () => {
    it('resolves a vault-relative scene path to an absolute path inside the vault root', () => {
      const result = safeVaultJoin(tmpDir, 'Manuscript/story/ch1/scene-1.md', { writeMode: true });
      const realTmp = fs.realpathSync.native(tmpDir);
      expect(result.startsWith(realTmp + path.sep)).toBe(true);
      expect(result.endsWith(path.join('Manuscript', 'story', 'ch1', 'scene-1.md'))).toBe(true);
    });

    it('returns the existing file path unchanged on read', () => {
      const p = 'notes/hello.md';
      fs.mkdirSync(path.join(tmpDir, 'notes'));
      fs.writeFileSync(path.join(tmpDir, p), 'hi');
      expect(safeVaultJoin(tmpDir, p)).toBe(path.join(tmpDir, p));
    });
  });
});

describe('safeVaultIpcJoin — strict renderer-facing entry point', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-svj-ipc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports the documented extension allow-list', () => {
    expect([...VAULT_IPC_ALLOWED_EXTENSIONS].sort()).toEqual(['.json', '.md']);
  });

  it('accepts a vault-relative .md path', () => {
    expect(() => safeVaultIpcJoin(tmpDir, 'Notes/hello.md', true)).not.toThrow();
  });

  it('accepts a vault-relative .json manifest path', () => {
    expect(() => safeVaultIpcJoin(tmpDir, 'manifest.json', true)).not.toThrow();
  });

  it('rejects a dotfile path even when it ends in .md', () => {
    expect(() => safeVaultIpcJoin(tmpDir, '.secret.md', true)).toThrow(/dotfile not allowed/);
  });

  it('rejects a path whose leaf has a disallowed extension', () => {
    expect(() => safeVaultIpcJoin(tmpDir, 'notes/passwords.txt', true)).toThrow(
      /extension '\.txt' not allowed/,
    );
  });

  it('rejects a path with no extension at all', () => {
    expect(() => safeVaultIpcJoin(tmpDir, 'notes/passwords', true)).toThrow(
      /extension '<none>' not allowed/,
    );
  });

  it('still rejects all six traversal vectors', () => {
    expect(() => safeVaultIpcJoin(tmpDir, '../escape.md', true)).toThrow(/Path traversal denied/);
    expect(() => safeVaultIpcJoin(tmpDir, '/etc/passwd', false)).toThrow(/Path traversal denied/);
    expect(() => safeVaultIpcJoin(tmpDir, '%2e%2e/escape.md', true)).toThrow(
      /encoded traversal sequence/,
    );
    expect(() => safeVaultIpcJoin(tmpDir, 'a\u0000.md', true)).toThrow(/null byte/);
    expect(() => safeVaultIpcJoin(tmpDir, 'C:/x.md', true)).toThrow(/absolute Windows path/);

    fs.symlinkSync(os.tmpdir(), path.join(tmpDir, 'escape-link'));
    expect(() => safeVaultIpcJoin(tmpDir, 'escape-link/x.md', true)).toThrow(
      /parent symlink escapes vault/,
    );
  });
});
