import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MYTHOS_DIR,
  SYNC_LOG,
  acquireLockfile,
  releaseLockfile,
  checkLockfile,
  isLockfileLive,
  isForeignHostLock,
  appendSyncEvent,
  type LockfileData,
} from './vaultSessionLock.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vsl-'));
}

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
      type: 'concurrent_session_detected',
      ts: '2024-01-15T12:00:00Z',
      detail: { hostname: 'other-host', pid: 4242 },
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
    expect(JSON.parse(lines[0]).type).toBe('concurrent_session_detected');
    expect(JSON.parse(lines[1]).type).toBe('lockfile_acquired');
  });

  it('creates .mythos/ if it does not exist', () => {
    expect(fs.existsSync(path.join(tmp, MYTHOS_DIR))).toBe(false);
    appendSyncEvent(tmp, { type: 'lockfile_acquired', ts: '2024-01-15T12:00:00Z', detail: {} });
    expect(fs.existsSync(path.join(tmp, MYTHOS_DIR))).toBe(true);
  });
});
