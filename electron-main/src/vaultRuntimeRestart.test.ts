// SKY-11351 — regression coverage for the failed-vault-move recovery path.
//
// Bug (SKY-11346): VAULT_SURFACE_MOVE_VAULTS_PARENT closes the DB before the
// fs.renameSync, and on failure restarted the watchers but never reopened the
// DB — leaving getDb() throwing "DB not open" until an app restart.
//
// These tests exercise restartVaultRuntime (the sequence shared by the success
// and failure paths) against the REAL db module in a temp vault: after a
// close()/failed-move, running the recovery must leave getDb() usable, and the
// DB must be reopened BEFORE the watchers restart.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, getDb, isDbOpen } from './db.js';
import { restartVaultRuntime, type VaultRuntimeRestartDeps } from './vaultRuntimeRestart.js';

describe('restartVaultRuntime (SKY-11351 failed-move recovery)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vault-restart-'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Mirrors the handler: the DB is open, then closeDb() runs, then the move
  // (fs.renameSync) throws. The recovery must bring the DB back.
  it('leaves the DB open and usable after a failed move recovery', async () => {
    openDb(tmpDir);
    expect(isDbOpen()).toBe(true);

    // Simulate the handler closing the DB before attempting the rename, then
    // the rename failing — at this point getDb() is dead (the SKY-11346 bug).
    closeDb();
    expect(isDbOpen()).toBe(false);
    expect(() => getDb()).toThrow(/DB not open/);

    const deps: VaultRuntimeRestartDeps = {
      // ensureVaultDir()/ensureNotesVaultDir() reopen the DB in main.ts; the
      // Story-Vault one is what reopens the SQLite handle.
      ensureVaultDir: () => { openDb(tmpDir); },
      ensureNotesVaultDir: vi.fn(),
      startVaultWatcher: vi.fn(),
      startNotesVaultWatcher: vi.fn(),
      startWritingScanScheduler: vi.fn(),
    };

    await restartVaultRuntime(tmpDir, tmpDir, deps);

    // The DB is usable again without any app restart.
    expect(isDbOpen()).toBe(true);
    expect(() => getDb()).not.toThrow();
    // Prove it truly works, not merely non-null.
    const row = getDb().prepare('PRAGMA user_version').get() as { user_version: number };
    expect(typeof row.user_version).toBe('number');
  });

  it('reopens the DB before restarting the watchers', async () => {
    const calls: string[] = [];
    openDb(tmpDir);
    closeDb();

    const deps: VaultRuntimeRestartDeps = {
      ensureVaultDir: () => { calls.push('ensureVaultDir'); openDb(tmpDir); },
      ensureNotesVaultDir: () => { calls.push('ensureNotesVaultDir'); },
      startVaultWatcher: () => {
        // If the watcher fires a change before the DB is back, getDb() throws.
        calls.push('startVaultWatcher');
        expect(isDbOpen()).toBe(true);
      },
      startNotesVaultWatcher: () => { calls.push('startNotesVaultWatcher'); },
      startWritingScanScheduler: () => { calls.push('startWritingScanScheduler'); },
    };

    await restartVaultRuntime(tmpDir, tmpDir, deps);

    expect(calls).toEqual([
      'ensureVaultDir',
      'ensureNotesVaultDir',
      'startVaultWatcher',
      'startNotesVaultWatcher',
      'startWritingScanScheduler',
    ]);
  });

  it('passes the supplied roots through to the watchers', async () => {
    openDb(tmpDir);
    closeDb();
    const startVaultWatcher = vi.fn();
    const startNotesVaultWatcher = vi.fn();

    await restartVaultRuntime('/story/root', '/notes/root', {
      ensureVaultDir: () => { openDb(tmpDir); },
      ensureNotesVaultDir: vi.fn(),
      startVaultWatcher,
      startNotesVaultWatcher,
      startWritingScanScheduler: vi.fn(),
    });

    expect(startVaultWatcher).toHaveBeenCalledWith('/story/root');
    expect(startNotesVaultWatcher).toHaveBeenCalledWith('/notes/root');
  });
});
