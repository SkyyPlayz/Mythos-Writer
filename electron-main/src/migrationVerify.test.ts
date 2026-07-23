// SKY-7948: Tests for migrationVerify.ts — post-operation verification helpers.
// All pure Node — no Electron imports.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  snapshotDirectory,
  verifyPostMove,
  verifyObsidianImport,
  describeFileError,
} from './migrationVerify.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sky7948-'));
}

function writeFile(dir: string, rel: string, content: string | Buffer): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (typeof content === 'string') {
    fs.writeFileSync(full, content, 'utf-8');
  } else {
    fs.writeFileSync(full, content);
  }
}

// ─── snapshotDirectory ────────────────────────────────────────────────────────

describe('snapshotDirectory', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns count=0 and stable checksum for non-existent directory', () => {
    const snap = snapshotDirectory(path.join(tmp, 'nope'));
    expect(snap.count).toBe(0);
    expect(snap.dehydratedStubs).toHaveLength(0);
    expect(snap.lockedFiles).toHaveLength(0);
    expect(typeof snap.checksum).toBe('string');
  });

  it('counts files and produces a checksum', () => {
    writeFile(tmp, 'a.md', '# A');
    writeFile(tmp, 'sub/b.md', '# B');
    const snap = snapshotDirectory(tmp);
    expect(snap.count).toBe(2);
    expect(snap.checksum).toHaveLength(64); // sha256 hex
    expect(snap.dehydratedStubs).toHaveLength(0);
  });

  it('skips dotfiles and dot-directories', () => {
    writeFile(tmp, '.hidden', 'secret');
    writeFile(tmp, '.obsidian/config.json', '{}');
    writeFile(tmp, 'visible.md', '# Visible');
    const snap = snapshotDirectory(tmp);
    expect(snap.count).toBe(1);
  });

  it('detects .cloud OneDrive stub extensions', () => {
    writeFile(tmp, 'real.md', '# Real');
    writeFile(tmp, 'dehydrated.cloud', '');
    const snap = snapshotDirectory(tmp);
    expect(snap.count).toBe(1); // real.md only
    expect(snap.dehydratedStubs).toContain('dehydrated.cloud');
  });

  it('produces identical checksums for identical directory trees', () => {
    const dirA = path.join(tmp, 'A');
    const dirB = path.join(tmp, 'B');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    writeFile(dirA, 'x.md', 'Hello');
    writeFile(dirB, 'x.md', 'Hello');
    const snapA = snapshotDirectory(dirA);
    const snapB = snapshotDirectory(dirB);
    expect(snapA.checksum).toBe(snapB.checksum);
    expect(snapA.count).toBe(snapB.count);
  });

  it('produces different checksums when content differs', () => {
    const dirA = path.join(tmp, 'A');
    const dirB = path.join(tmp, 'B');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    writeFile(dirA, 'x.md', 'Hello');
    writeFile(dirB, 'x.md', 'World');
    const snapA = snapshotDirectory(dirA);
    const snapB = snapshotDirectory(dirB);
    expect(snapA.checksum).not.toBe(snapB.checksum);
  });
});

// ─── verifyPostMove ───────────────────────────────────────────────────────────

describe('verifyPostMove', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns ok=true when all files are present and checksums match', async () => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src);
    writeFile(src, 'a.md', '# A');
    writeFile(src, 'sub/b.md', '# B');

    const srcSnapshot = snapshotDirectory(src);

    // Simulate rename by copying
    fs.mkdirSync(dst);
    writeFile(dst, 'a.md', '# A');
    writeFile(dst, 'sub/b.md', '# B');

    const result = verifyPostMove(srcSnapshot, dst);
    expect(result.ok).toBe(true);
    expect(result.dropped).toBe(0);
    expect(result.checksumMatch).toBe(true);
    expect(result.sourceCount).toBe(2);
    expect(result.destCount).toBe(2);
    expect(result.message).toBe('');
  });

  it('returns ok=false with dropped>0 when destination has fewer files', () => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src);
    writeFile(src, 'a.md', '# A');
    writeFile(src, 'b.md', '# B');

    const srcSnapshot = snapshotDirectory(src);

    fs.mkdirSync(dst);
    writeFile(dst, 'a.md', '# A');
    // b.md is missing from dst

    const result = verifyPostMove(srcSnapshot, dst);
    expect(result.ok).toBe(false);
    expect(result.dropped).toBe(1);
    expect(result.message).toMatch(/missing/);
  });

  it('returns ok=false and surfaces OneDrive stub files in destination', () => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src);
    writeFile(src, 'a.md', '# A');

    const srcSnapshot = snapshotDirectory(src);

    fs.mkdirSync(dst);
    // Simulate a .cloud stub instead of the real file
    writeFile(dst, 'a.cloud', '');

    const result = verifyPostMove(srcSnapshot, dst);
    expect(result.ok).toBe(false);
    expect(result.dehydratedStubs).toContain('a.cloud');
    expect(result.message).toMatch(/OneDrive/);
  });

  it('returns ok=true for an empty vault (no files)', () => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src);
    fs.mkdirSync(dst);

    const srcSnapshot = snapshotDirectory(src);
    const result = verifyPostMove(srcSnapshot, dst);
    expect(result.ok).toBe(true);
    expect(result.sourceCount).toBe(0);
    expect(result.destCount).toBe(0);
  });
});

// ─── verifyObsidianImport ─────────────────────────────────────────────────────

describe('verifyObsidianImport', () => {
  it('returns no drop warning when all files are accounted for', () => {
    const v = verifyObsidianImport(10, 8, 2, 0);
    expect(v.droppedCount).toBe(0);
    expect(v.dropWarning).toBe('');
    expect(v.importedCount).toBe(8);
    expect(v.skippedCount).toBe(2);
    expect(v.sourceCount).toBe(10);
  });

  it('returns a dropWarning when files are silently unaccounted', () => {
    // source=10, imported=7, skipped=2, errored=0 → 1 unaccounted
    const v = verifyObsidianImport(10, 7, 2, 0);
    expect(v.droppedCount).toBe(1);
    expect(v.dropWarning).toMatch(/not imported/);
  });

  it('considers errored files as accounted (not silently dropped)', () => {
    // source=10, imported=7, skipped=2, errored=1 → all accounted
    const v = verifyObsidianImport(10, 7, 2, 1);
    expect(v.droppedCount).toBe(0);
    expect(v.dropWarning).toBe('');
  });

  it('never returns negative droppedCount', () => {
    const v = verifyObsidianImport(0, 0, 0, 0);
    expect(v.droppedCount).toBe(0);
  });
});

// ─── describeFileError ────────────────────────────────────────────────────────

describe('describeFileError', () => {
  it('produces an actionable message for EBUSY (locked file)', () => {
    const err = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    const msg = describeFileError(err, '/path/to/story.docx');
    expect(msg).toMatch(/locked|in use/i);
    expect(msg).toMatch(/story\.docx/);
  });

  it('produces an actionable message for EPERM (permissions)', () => {
    const err = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    const msg = describeFileError(err, '/path/to/story.docx');
    expect(msg).toMatch(/locked|in use/i);
  });

  it('produces a not-found message for ENOENT', () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    const msg = describeFileError(err, '/path/to/story.docx');
    expect(msg).toMatch(/not found/i);
  });

  it('falls back to the error message for unknown codes', () => {
    const err = new Error('something weird');
    const msg = describeFileError(err, '/path/to/file.docx');
    expect(msg).toBe('something weird');
  });
});
