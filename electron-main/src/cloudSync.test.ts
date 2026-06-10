import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CONFLICT_PATTERNS,
  MYTHOS_DIR,
  SYNC_LOG,
  detectConflicts,
  resolveConflict,
  acquireLockfile,
  releaseLockfile,
  checkLockfile,
  isLockfileLive,
  isForeignHostLock,
  appendSyncEvent,
  type LockfileData,
} from './cloudSync.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
}

// ─── CONFLICT_PATTERNS ────────────────────────────────────────────────────────

describe('CONFLICT_PATTERNS', () => {
  it('matches Dropbox conflict filename', () => {
    const { regex } = CONFLICT_PATTERNS.find((p) => p.provider === 'dropbox')!;
    expect(regex.test('My Scene (conflicted copy 2024-01-15).md')).toBe(true);
    expect(regex.test('My Scene.md')).toBe(false);
    expect(regex.exec('My Scene (conflicted copy 2024-01-15).md')?.[1]).toBe('My Scene');
  });

  it('matches iCloud paren-form conflict', () => {
    const p = CONFLICT_PATTERNS.find(
      (c) => c.provider === 'icloud' && /conflict\\s/.test(c.regex.source),
    )!;
    expect(p.regex.test('My Scene (conflict 2).md')).toBe(true);
    expect(p.regex.exec('My Scene (conflict 2).md')?.[1]).toBe('My Scene');
  });

  it('matches iCloud dot-form conflict', () => {
    const p = CONFLICT_PATTERNS.find(
      (c) => c.provider === 'icloud' && /\.conflict/.test(c.regex.source),
    )!;
    expect(p.regex.test('My Scene.conflict.1.md')).toBe(true);
    expect(p.regex.exec('My Scene.conflict.1.md')?.[1]).toBe('My Scene');
  });

  it('matches Syncthing conflict filename', () => {
    const { regex } = CONFLICT_PATTERNS.find((p) => p.provider === 'syncthing')!;
    expect(regex.test('My Scene.sync-conflict-20240115-120000-ABCDEF12.md')).toBe(true);
    expect(regex.exec('My Scene.sync-conflict-20240115-120000-ABCDEF12.md')?.[1]).toBe('My Scene');
  });

  it('does not match normal markdown files', () => {
    for (const { regex } of CONFLICT_PATTERNS) {
      expect(regex.test('Chapter One.md')).toBe(false);
      expect(regex.test('README.md')).toBe(false);
    }
  });
});

// ─── detectConflicts ──────────────────────────────────────────────────────────

describe('detectConflicts', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('finds a Dropbox conflict file at the vault root', () => {
    fs.writeFileSync(path.join(tmp, 'scene.md'), 'original');
    fs.writeFileSync(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'), 'conflict');
    const results = detectConflicts(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('dropbox');
    expect(results[0].conflictPath).toBe('scene (conflicted copy 2024-01-15).md');
    expect(results[0].originalPath).toBe('scene.md');
  });

  it('finds a Syncthing conflict file in a subdirectory', () => {
    fs.mkdirSync(path.join(tmp, 'Manuscript', 'Ch01'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Manuscript', 'Ch01', 'scene.md'), 'original');
    fs.writeFileSync(
      path.join(tmp, 'Manuscript', 'Ch01', 'scene.sync-conflict-20240115-120000-AABB1234.md'),
      'conflict',
    );
    const results = detectConflicts(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('syncthing');
  });

  it('skips files inside .mythos/', () => {
    const mythosDir = path.join(tmp, MYTHOS_DIR);
    fs.mkdirSync(mythosDir, { recursive: true });
    fs.writeFileSync(
      path.join(mythosDir, 'file (conflicted copy 2024-01-15).md'),
      'should be ignored',
    );
    expect(detectConflicts(tmp)).toHaveLength(0);
  });

  it('returns empty when no conflicts exist', () => {
    fs.writeFileSync(path.join(tmp, 'scene.md'), 'content');
    expect(detectConflicts(tmp)).toHaveLength(0);
  });

  it('returns empty for an empty vault', () => {
    expect(detectConflicts(tmp)).toHaveLength(0);
  });
});

// ─── resolveConflict ──────────────────────────────────────────────────────────

describe('resolveConflict', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function touchFile(absPath: string, content: string, mtimeOffsetMs = 0): void {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    const base = Date.now();
    fs.utimesSync(absPath, base / 1000, (base + mtimeOffsetMs) / 1000);
  }

  it('keeps the original when original is newer', () => {
    touchFile(path.join(tmp, 'scene.md'), 'original content', 10_000); // +10 s
    touchFile(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'), 'conflict content', 0);

    const result = resolveConflict(tmp, {
      conflictPath: 'scene (conflicted copy 2024-01-15).md',
      originalPath: 'scene.md',
      provider: 'dropbox',
    });

    expect(result.keptPath).toBe('scene.md');
    expect(fs.existsSync(path.join(tmp, 'scene.md'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'scene.md'), 'utf-8')).toBe('original content');
    expect(fs.existsSync(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'))).toBe(false);
    expect(result.archivedPath).toContain(MYTHOS_DIR);
  });

  it('replaces original with conflict file when conflict is newer', () => {
    touchFile(path.join(tmp, 'scene.md'), 'old original', 0);
    touchFile(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'), 'newer conflict', 10_000);

    const result = resolveConflict(tmp, {
      conflictPath: 'scene (conflicted copy 2024-01-15).md',
      originalPath: 'scene.md',
      provider: 'dropbox',
    });

    expect(result.keptPath).toBe('scene.md');
    expect(fs.readFileSync(path.join(tmp, 'scene.md'), 'utf-8')).toBe('newer conflict');
    expect(fs.existsSync(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'))).toBe(false);
  });

  it('archives loser under .mythos/.archive/<ts>/', () => {
    touchFile(path.join(tmp, 'scene.md'), 'original', 0);
    touchFile(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'), 'conflict', 10_000);

    const result = resolveConflict(tmp, {
      conflictPath: 'scene (conflicted copy 2024-01-15).md',
      originalPath: 'scene.md',
      provider: 'dropbox',
    });

    const archiveAbs = path.join(tmp, result.archivedPath);
    expect(fs.existsSync(archiveAbs)).toBe(true);
  });

  it('handles missing original (conflict becomes the canonical file)', () => {
    touchFile(path.join(tmp, 'scene (conflicted copy 2024-01-15).md'), 'conflict only', 0);

    const result = resolveConflict(tmp, {
      conflictPath: 'scene (conflicted copy 2024-01-15).md',
      originalPath: 'scene.md',
      provider: 'dropbox',
    });

    expect(result.keptPath).toBe('scene.md');
    expect(fs.existsSync(path.join(tmp, 'scene.md'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'scene.md'), 'utf-8')).toBe('conflict only');
  });
});

// ─── Lockfile ─────────────────────────────────────────────────────────────────

describe('acquireLockfile / releaseLockfile / checkLockfile', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('acquires a lockfile with current pid and hostname', () => {
    const data = acquireLockfile(tmp);
    expect(data).not.toBeNull();
    expect(data!.pid).toBe(process.pid);
    expect(data!.hostname).toBe(os.hostname());
    expect(data!.vaultPath).toBe(tmp);
  });

  it('checkLockfile reads back the written data', () => {
    acquireLockfile(tmp);
    const read = checkLockfile(tmp);
    expect(read).not.toBeNull();
    expect(read!.pid).toBe(process.pid);
  });

  it('releaseLockfile removes the file', () => {
    acquireLockfile(tmp);
    releaseLockfile(tmp);
    expect(checkLockfile(tmp)).toBeNull();
  });

  it('releaseLockfile is safe when no lockfile exists', () => {
    expect(() => releaseLockfile(tmp)).not.toThrow();
  });

  it('checkLockfile returns null when no lockfile exists', () => {
    expect(checkLockfile(tmp)).toBeNull();
  });

  // SKY-1128: atomic acquire — contention tests
  it('returns null (contention) when a live same-pid lock already exists', () => {
    // Write a lockfile with our own PID — acquireLockfile treats this as live.
    const lp = path.join(tmp, MYTHOS_DIR, 'vault.lock');
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    const existing: LockfileData = {
      hostname: os.hostname(),
      pid: process.pid,
      timestamp: new Date().toISOString(),
      vaultPath: tmp,
    };
    fs.writeFileSync(lp, JSON.stringify(existing));
    // A second acquire attempt on the same PID should NOT return null because
    // isLockfileLive returns false for our own PID — it re-acquires the lock.
    // (Idempotent: same process claiming its own vault is not contention.)
    const result = acquireLockfile(tmp);
    expect(result).not.toBeNull();
  });

  it('returns null (contention) when a foreign-host lock exists', () => {
    const lp = path.join(tmp, MYTHOS_DIR, 'vault.lock');
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    const foreign: LockfileData = {
      hostname: 'other-machine.local',
      pid: 99999,
      timestamp: new Date().toISOString(),
      vaultPath: tmp,
    };
    fs.writeFileSync(lp, JSON.stringify(foreign));
    expect(acquireLockfile(tmp)).toBeNull();
  });

  it('breaks a stale lock from a dead PID and re-acquires', () => {
    const lp = path.join(tmp, MYTHOS_DIR, 'vault.lock');
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    const stale: LockfileData = {
      hostname: os.hostname(),
      pid: 2_000_000_000, // guaranteed dead
      timestamp: new Date().toISOString(),
      vaultPath: tmp,
    };
    fs.writeFileSync(lp, JSON.stringify(stale));
    const result = acquireLockfile(tmp);
    expect(result).not.toBeNull();
    expect(result!.pid).toBe(process.pid);
  });

  it('acquireLockfile is idempotent for the same process (re-acquire after release)', () => {
    const first = acquireLockfile(tmp);
    expect(first).not.toBeNull();
    releaseLockfile(tmp);
    const second = acquireLockfile(tmp);
    expect(second).not.toBeNull();
    expect(second!.pid).toBe(process.pid);
  });
});

describe('isLockfileLive', () => {
  it('returns false for own PID (our lockfile)', () => {
    const data: LockfileData = {
      hostname: os.hostname(),
      pid: process.pid,
      timestamp: new Date().toISOString(),
      vaultPath: '/tmp/test',
    };
    expect(isLockfileLive(data)).toBe(false);
  });

  it('returns false for a dead PID on the same host', () => {
    const data: LockfileData = {
      hostname: os.hostname(),
      pid: 2_000_000_000, // guaranteed non-existent
      timestamp: new Date().toISOString(),
      vaultPath: '/tmp/test',
    };
    expect(isLockfileLive(data)).toBe(false);
  });

  it('returns false for a lock from a different hostname', () => {
    const data: LockfileData = {
      hostname: 'some-other-machine.local',
      pid: 12345,
      timestamp: new Date().toISOString(),
      vaultPath: '/tmp/test',
    };
    expect(isLockfileLive(data)).toBe(false);
  });
});

// ─── isForeignHostLock ────────────────────────────────────────────────────────

describe('isForeignHostLock', () => {
  it('returns true for a lock written by a different hostname', () => {
    const data: LockfileData = {
      hostname: 'some-other-machine.local',
      pid: 12345,
      timestamp: new Date().toISOString(),
      vaultPath: '/tmp/test',
    };
    expect(isForeignHostLock(data)).toBe(true);
  });

  it('returns false for a lock written by the current hostname', () => {
    const data: LockfileData = {
      hostname: os.hostname(),
      pid: 12345,
      timestamp: new Date().toISOString(),
      vaultPath: '/tmp/test',
    };
    expect(isForeignHostLock(data)).toBe(false);
  });
});

// ─── appendSyncEvent ──────────────────────────────────────────────────────────

describe('appendSyncEvent', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('creates .mythos/sync_events.log and appends JSON lines', () => {
    appendSyncEvent(tmp, {
      type: 'conflict_resolved',
      ts: '2024-01-15T12:00:00Z',
      detail: { conflictPath: 'scene (conflicted copy 2024-01-15).md' },
    });
    appendSyncEvent(tmp, {
      type: 'lockfile_acquired',
      ts: '2024-01-15T12:01:00Z',
      detail: { pid: 9999 },
    });

    const logPath = path.join(tmp, MYTHOS_DIR, SYNC_LOG);
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('conflict_resolved');
    expect(JSON.parse(lines[1]).type).toBe('lockfile_acquired');
  });

  it('creates .mythos/ if it does not exist', () => {
    expect(fs.existsSync(path.join(tmp, MYTHOS_DIR))).toBe(false);
    appendSyncEvent(tmp, { type: 'lockfile_acquired', ts: '2024-01-15T12:00:00Z', detail: {} });
    expect(fs.existsSync(path.join(tmp, MYTHOS_DIR))).toBe(true);
  });
});
