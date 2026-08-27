// vault:guidedFolderMove — unit + integration tests (SKY-862)
//
// Gate tests (§1): pure validation — no FS, covers all checkGuidedMoveGate
// rejection branches from vaultGate.ts.
//
// Move tests (§2): real tmpdir FS — covers validateMoveTarget + moveVaultAtomic
// happy path and each error/rollback branch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkGuidedMoveGate, consumeGuidedMoveToken } from './vaultGate.js';
import { validateMoveTarget, moveVaultAtomic } from './vaultGuidedMove.js';
import {
  generateRegistrationToken,
  __clearRegistrationTokens,
  TOKEN_TTL_MS,
} from './registrationToken.js';

const HOME = '/home/testuser';
const DROPBOX = `${HOME}/Dropbox`;
const TARGET = `${DROPBOX}/Mythos/Story Vault`;

// ─── §1: checkGuidedMoveGate (pure, no FS) ───────────────────────────────────

describe('checkGuidedMoveGate', () => {
  beforeEach(() => __clearRegistrationTokens());

  function makeToken(path: string, now?: number) {
    return generateRegistrationToken(path, now);
  }

  it('accepts a valid payload with matching token', () => {
    const token = makeToken(TARGET);
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetPath).toBe(TARGET);
      expect(result.syncProvider).toBe('dropbox');
    }
  });

  it('accepts a valid Windows payload with matching token', () => {
    const windowsHome = 'C:\\Users\\testuser';
    const windowsTarget = `${windowsHome}\\Dropbox\\Mythos\\Story Vault`;
    const token = makeToken(windowsTarget);
    const result = checkGuidedMoveGate(
      { targetPath: windowsTarget, syncProvider: 'dropbox', sessionToken: token },
      windowsHome,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetPath).toBe(windowsTarget);
      expect(result.syncProvider).toBe('dropbox');
    }
  });

  it('rejects missing targetPath', () => {
    const token = makeToken(TARGET);
    const result = checkGuidedMoveGate(
      { targetPath: '', syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/targetPath/);
  });

  it('rejects null targetPath', () => {
    const token = makeToken(TARGET);
    const result = checkGuidedMoveGate(
      { targetPath: null, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects path traversal via .. components', () => {
    const badPath = `${HOME}/Dropbox/../../../etc/passwd`;
    const token = makeToken(badPath);
    const result = checkGuidedMoveGate(
      { targetPath: badPath, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/traversal/);
  });

  it('rejects path with .. segment even within homedir', () => {
    const badPath = `${HOME}/Dropbox/../Dropbox`;
    const token = makeToken(badPath);
    const result = checkGuidedMoveGate(
      { targetPath: badPath, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/traversal/);
  });

  it('rejects targetPath outside homedir (e.g. /tmp)', () => {
    const outsidePath = '/tmp/MyVault';
    const token = makeToken(outsidePath);
    const result = checkGuidedMoveGate(
      { targetPath: outsidePath, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/home directory/);
  });

  it('rejects targetPath equal to homedir itself', () => {
    const token = makeToken(HOME);
    const result = checkGuidedMoveGate(
      { targetPath: HOME, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/home directory/);
  });

  it('rejects a relative (non-absolute) targetPath', () => {
    const token = makeToken('Dropbox/Vault');
    const result = checkGuidedMoveGate(
      { targetPath: 'Dropbox/Vault', syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown syncProvider', () => {
    const token = makeToken(TARGET);
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'megacloud' as never, sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/syncProvider/);
  });

  it('accepts all four approved syncProviders', () => {
    for (const provider of ['icloud', 'dropbox', 'google-drive', 'onedrive'] as const) {
      const t = makeToken(TARGET);
      const r = checkGuidedMoveGate(
        { targetPath: TARGET, syncProvider: provider, sessionToken: t },
        HOME,
      );
      expect(r.ok, `expected ok for provider '${provider}'`).toBe(true);
    }
  });

  it('rejects missing sessionToken', () => {
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: '' },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionToken/);
  });

  it('rejects an invalid (random) sessionToken', () => {
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: 'not-a-real-token' },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionToken/);
  });

  it('rejects a token bound to a different path (renderer-tampered targetPath)', () => {
    const token = makeToken(`${HOME}/Dropbox/OtherFolder`);
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionToken/);
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = makeToken(TARGET, now);
    const result = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
      now + TOKEN_TTL_MS + 1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionToken/);
  });

  it('does NOT consume the token itself — the caller must call consumeGuidedMoveToken after the move succeeds (SKY-10890)', () => {
    const token = makeToken(TARGET);
    const first = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(first.ok).toBe(true);
    // Token is still valid — a mid-move failure (antivirus, a locked file,
    // a full disk) must not have burned it, or retry is permanently blocked
    // with UNAUTHORIZED_PATH (the SKY-10890 bug).
    const replay = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(replay.ok).toBe(true);
  });

  it('consumeGuidedMoveToken burns the token so it cannot be replayed', () => {
    const token = makeToken(TARGET);
    const first = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(first.ok).toBe(true);
    consumeGuidedMoveToken(token);
    const replay = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(replay.ok).toBe(false);
  });

  it('does not consume the token when validation fails before consume', () => {
    const token = makeToken(TARGET);
    // Fail due to bad syncProvider (checked before token consume).
    checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'bad' as never, sessionToken: token },
      HOME,
    );
    // Token should still be valid.
    const retry = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(retry.ok).toBe(true);
  });
});

// ─── §2: validateMoveTarget + moveVaultAtomic (real FS via tmpdir) ────────────

describe('validateMoveTarget', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky862-validate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts when src exists and target does not yet exist', () => {
    const src = path.join(tmpDir, 'VaultSrc');
    fs.mkdirSync(src);
    const dst = path.join(tmpDir, 'VaultDst');
    const result = validateMoveTarget(src, dst);
    expect(result.ok).toBe(true);
  });

  it('accepts when target exists but is empty', () => {
    const src = path.join(tmpDir, 'VaultSrc');
    fs.mkdirSync(src);
    const dst = path.join(tmpDir, 'VaultDst');
    fs.mkdirSync(dst);
    const result = validateMoveTarget(src, dst);
    expect(result.ok).toBe(true);
  });

  it('rejects when source vault does not exist', () => {
    const src = path.join(tmpDir, 'NonExistentVault');
    const dst = path.join(tmpDir, 'VaultDst');
    const result = validateMoveTarget(src, dst);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Source vault/);
  });

  it('rejects when target is the same path as the source', () => {
    const src = path.join(tmpDir, 'VaultSrc');
    fs.mkdirSync(src);
    const result = validateMoveTarget(src, src);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/same/);
  });

  it('rejects when target directory is not empty', () => {
    const src = path.join(tmpDir, 'VaultSrc');
    fs.mkdirSync(src);
    const dst = path.join(tmpDir, 'VaultDst');
    fs.mkdirSync(dst);
    fs.writeFileSync(path.join(dst, 'existing.md'), 'content');
    const result = validateMoveTarget(src, dst);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not empty/);
  });

  it('rejects when target path exists as a file (not a directory)', () => {
    const src = path.join(tmpDir, 'VaultSrc');
    fs.mkdirSync(src);
    const dst = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(dst, 'I am a file');
    const result = validateMoveTarget(src, dst);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a directory/);
  });
});

describe('moveVaultAtomic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky862-move-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('happy path: moves vault, calls updateSettings, writes audit log', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'DropboxVault');
    let settingsReceived = '';

    const moveResult = await moveVaultAtomic(src, dst, {
      syncProvider: 'dropbox',
      updateSettings: (newPath) => { settingsReceived = newPath; },
    });

    expect(settingsReceived).toBe(dst);
    expect(moveResult.verification.ok).toBe(true);
    expect(moveResult.verification.dropped).toBe(0);
    // Source should be gone.
    expect(fs.existsSync(src)).toBe(false);
    // Destination should exist with the manifest.
    expect(fs.existsSync(path.join(dst, 'manifest.json'))).toBe(true);
    // Audit log should exist.
    const auditLog = path.join(dst, '.mythos', 'settings_audit.log');
    expect(fs.existsSync(auditLog)).toBe(true);
    const entry = JSON.parse(fs.readFileSync(auditLog, 'utf-8').trim());
    expect(entry.action).toBe('vault:guidedFolderMove');
    expect(entry.fromPath).toBe(src);
    expect(entry.toPath).toBe(dst);
    expect(entry.syncProvider).toBe('dropbox');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('rolls back the rename when updateSettings throws', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'DropboxVault');
    const boom = new Error('Settings write failed');

    await expect(
      moveVaultAtomic(src, dst, {
        syncProvider: 'icloud',
        updateSettings: () => { throw boom; },
      }),
    ).rejects.toThrow('Settings write failed');

    // Rollback: vault must be back at the original location.
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(path.join(src, 'manifest.json'))).toBe(true);
    // Target must be gone (rolled back).
    expect(fs.existsSync(dst)).toBe(false);
  });

  it('preserves vault contents in the destination after a successful move', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(path.join(src, 'Manuscript', 'ch1'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Manuscript', 'ch1', 'scene.md'), '# Scene One');

    const dst = path.join(tmpDir, 'GoogleDriveVault');

    const r = await moveVaultAtomic(src, dst, {
      syncProvider: 'google-drive',
      updateSettings: () => {},
    });

    expect(
      fs.readFileSync(path.join(dst, 'Manuscript', 'ch1', 'scene.md'), 'utf-8'),
    ).toBe('# Scene One');
    expect(r.verification.ok).toBe(true);
  });

  it('SKY-10367: records vault:localFolderMove in the audit log for a local destination', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'ExternalDriveVault');

    const moveResult = await moveVaultAtomic(src, dst, {
      syncProvider: 'local',
      updateSettings: () => {},
    });

    expect(moveResult.verification.ok).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
    const auditLog = path.join(dst, '.mythos', 'settings_audit.log');
    const entry = JSON.parse(fs.readFileSync(auditLog, 'utf-8').trim());
    expect(entry.action).toBe('vault:localFolderMove');
    expect(entry.syncProvider).toBe('local');
  });

  it('SKY-10367: falls back to copy+delete when rename fails with EXDEV (cross-device move)', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(path.join(src, 'Manuscript'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Manuscript', 'scene.md'), '# Scene One');

    const dst = path.join(tmpDir, 'OtherDriveVault');

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(() => {
      const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      return Promise.reject(err);
    });

    const r = await moveVaultAtomic(src, dst, {
      syncProvider: 'local',
      updateSettings: () => {},
    });

    expect(r.verification.ok).toBe(true);
    // Source must be gone (copy+delete fallback completed the move).
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dst, 'Manuscript', 'scene.md'), 'utf-8')).toBe('# Scene One');

    renameSpy.mockRestore();
  });

  it('SKY-10895: retries a transient EPERM and succeeds once the lock clears', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'MovedVault');

    // First two attempts see the transient lock (our own just-closed watcher
    // / DB handle, or a background scanner); the third succeeds for real.
    const realRename = fs.promises.rename.bind(fs.promises);
    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EPERM' }))
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockImplementationOnce((...args: Parameters<typeof fs.promises.rename>) => realRename(...args));

    const r = await moveVaultAtomic(src, dst, { syncProvider: 'local', updateSettings: () => {} });

    expect(renameSpy).toHaveBeenCalledTimes(3);
    expect(r.verification.ok).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(dst, 'manifest.json'))).toBe(true);

    renameSpy.mockRestore();
  });

  it('SKY-10895: falls back to copy+delete once the same-device rename retry budget is exhausted', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(path.join(src, 'Manuscript'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Manuscript', 'scene.md'), '# Scene One');

    const dst = path.join(tmpDir, 'MovedVault');

    // fs.rename never succeeds (simulates a handle Windows won't let go of),
    // but nothing else about `src` is actually restricted — a real copy +
    // per-entry delete both work fine, so the move should still complete
    // instead of surfacing the rename's error to the user.
    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('still locked'), { code: 'EPERM' }));

    // Fake timers so the full 6s retry budget doesn't cost 6 real seconds.
    vi.useFakeTimers();
    let result: ReturnType<typeof moveVaultAtomic>;
    try {
      result = moveVaultAtomic(src, dst, { syncProvider: 'local', updateSettings: () => {} });
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    const r = await result;

    // 1 initial attempt + 40 retries before falling back to copy+delete.
    expect(renameSpy).toHaveBeenCalledTimes(41);
    expect(r.verification.ok).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dst, 'Manuscript', 'scene.md'), 'utf-8')).toBe('# Scene One');

    renameSpy.mockRestore();
  });

  it('SKY-10895: surfaces the original rename error when the copy+delete fallback also cannot touch the source', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'MovedVault');

    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('still locked'), { code: 'EPERM' }));
    // A genuinely stuck source (not just a rename-specific quirk) fails the
    // copy fallback too — this must still surface the original rename error,
    // not the copy error, and must never touch dest or src.
    const cpSpy = vi
      .spyOn(fs.promises, 'cp')
      .mockRejectedValue(Object.assign(new Error('cannot read'), { code: 'EPERM' }));

    vi.useFakeTimers();
    let result: ReturnType<typeof moveVaultAtomic>;
    try {
      result = moveVaultAtomic(src, dst, { syncProvider: 'local', updateSettings: () => {} });
      const assertion = expect(result).rejects.toMatchObject({ message: 'still locked', code: 'EPERM' });
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }

    expect(renameSpy).toHaveBeenCalledTimes(41);
    // Source untouched, destination never left half-written.
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(dst)).toBe(false);

    cpSpy.mockRestore();
    renameSpy.mockRestore();
  });

  it('SKY-11039: surfaces the original rename error (not the cleanup error) when copy succeeds but source cleanup fails', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');

    const dst = path.join(tmpDir, 'MovedVault');

    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('still locked'), { code: 'EPERM' }));
    // Copy succeeds (real fs.cp), but deleting the now-copied source keeps
    // failing — e.g. another process still has manifest.json open even
    // though it no longer blocks a read.
    const unlinkSpy = vi
      .spyOn(fs.promises, 'unlink')
      .mockRejectedValue(Object.assign(new Error('cannot delete'), { code: 'EPERM' }));

    // Real timers, not fake: this test needs a real disk copy (fs.promises.cp)
    // to finish, then a *second* retry loop (the delete-cleanup retries) to
    // start only after that. A single `vi.runAllTimersAsync()` returns before
    // the real copy settles, so any fake timer scheduled after it never
    // advances — real timers sidestep that fake-clock/real-I/O race entirely.
    // Worst case here is bounded (40 rename retries + 20 delete retries, all
    // at 150ms), well under the suite's test timeout.
    const result = moveVaultAtomic(src, dst, { syncProvider: 'local', updateSettings: () => {} });
    await expect(result).rejects.toMatchObject({
      message: 'still locked',
      code: 'EPERM',
      lockedEntries: expect.any(Array),
    });

    // The copy already landed at dest even though source cleanup failed —
    // the caller must see the original rename failure, not the unlink one,
    // while the copied data and the (not fully cleaned up) source both
    // remain on disk rather than being silently lost.
    expect(fs.existsSync(path.join(dst, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(src)).toBe(true);

    unlinkSpy.mockRestore();
    renameSpy.mockRestore();
  });

  it('SKY-11039: lock probe does not crash the diagnostic walk when reverting its own probe rename fails', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    const lockedFile = path.join(src, 'manifest.json');
    fs.writeFileSync(lockedFile, '{}');
    const probePath = `${lockedFile}.__sky10895_lockprobe__`;

    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('still locked'), { code: 'EPERM' }));

    // Simulate something grabbing a handle on the probe-renamed file between
    // the probe rename and its revert: the sync probe-out succeeds for real,
    // but the sync revert back to the original name fails.
    const realRenameSync = fs.renameSync;
    const renameSyncSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
        if (from === probePath && to === lockedFile) {
          throw Object.assign(new Error('probe revert blocked'), { code: 'EPERM' });
        }
        return realRenameSync(from, to);
      });

    const dst = path.join(tmpDir, 'MovedVault');

    // Real timers (see the sibling SKY-11039 test above for why): the
    // diagnostic lock probe runs synchronously inside the async rename-retry
    // loop, followed by a real disk copy. Asserting the outer promise still
    // settles (rather than an unhandled throw from the unguarded revert
    // killing the whole walk) is the point of this test. The probe leaving
    // the file stuck under its `.__sky10895_lockprobe__` suffix is a known,
    // reported consequence (surfaced via a failed checksum below) — not a
    // crash.
    const result = moveVaultAtomic(src, dst, { syncProvider: 'local', updateSettings: () => {} });
    await expect(result).resolves.toMatchObject({
      verification: expect.objectContaining({ ok: false, dropped: 0, checksumMatch: false }),
    });

    // The stuck probe-suffixed file made it to the destination instead of
    // crashing the move outright.
    expect(fs.existsSync(path.join(dst, 'manifest.json.__sky10895_lockprobe__'))).toBe(true);

    renameSyncSpy.mockRestore();
    renameSpy.mockRestore();
  });

  it('appends to an existing audit log rather than overwriting it', async () => {
    const src = path.join(tmpDir, 'Vault1');
    fs.mkdirSync(src);

    const dst = path.join(tmpDir, 'Vault2');

    // Pre-seed an existing audit log inside the vault.
    const mythosDir = path.join(src, '.mythos');
    fs.mkdirSync(mythosDir);
    fs.writeFileSync(
      path.join(mythosDir, 'settings_audit.log'),
      JSON.stringify({ action: 'earlier-event' }) + '\n',
      'utf-8',
    );

    await moveVaultAtomic(src, dst, {
      syncProvider: 'onedrive',
      updateSettings: () => {},
    });

    const logContent = fs.readFileSync(
      path.join(dst, '.mythos', 'settings_audit.log'),
      'utf-8',
    );
    const lines = logContent.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).action).toBe('earlier-event');
    expect(JSON.parse(lines[1]).action).toBe('vault:guidedFolderMove');
  });
});

// ─── §3 SKY-10890 regression: a failed move must not burn the one-shot token ──
//
// Reproduces the owner-reported bug end to end: gate a move, simulate the
// underlying FS operation being blocked mid-flight (the ticket's real-world
// trigger was Avast; here `fs.promises.rename` is stubbed to fail the same
// way any mid-move failure — a locked file, a full disk, a dropped network
// drive — would), then confirm the *same* token authorises a retry and the
// retry actually succeeds, exactly as the caller in main.ts now behaves by
// only calling consumeGuidedMoveToken after moveVaultAtomic resolves.

describe('SKY-10890: failed move does not consume the registration token', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky10890-'));
    __clearRegistrationTokens();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('retry with the same token succeeds after a simulated mid-move failure, without re-picking the folder', async () => {
    const src = path.join(tmpDir, 'StoryVault');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), '{}');
    const dst = path.join(tmpDir, 'NewHome');

    const token = generateRegistrationToken(dst);
    const gate = checkGuidedMoveGate(
      { targetPath: dst, syncProvider: 'dropbox', sessionToken: token },
      tmpDir,
    );
    expect(gate.ok).toBe(true);

    // Simulate the move being blocked mid-operation (antivirus / locked file
    // / full disk / dropped network drive all surface the same way: the
    // rename rejects with something other than EXDEV). Persistent (not
    // `...Once`) because SKY-10895 added a bounded retry for EPERM/EBUSY/
    // ENOTEMPTY — a single transient rejection now self-heals, so this must
    // reject on every attempt to still exercise the "exhausts the retry
    // budget, surfaces to the user" path this test is about. `cp` is also
    // stubbed to fail so a genuinely-stuck source still fails the whole move
    // instead of succeeding via the SKY-10895 copy+delete fallback — this
    // test is about the token surviving a real failure, not that fallback.
    const renameSpy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('Operation blocked'), { code: 'EPERM' }));
    const cpSpy = vi
      .spyOn(fs.promises, 'cp')
      .mockRejectedValue(Object.assign(new Error('Operation blocked'), { code: 'EPERM' }));

    vi.useFakeTimers();
    try {
      const result = moveVaultAtomic(src, dst, { syncProvider: 'dropbox', updateSettings: () => {} });
      const assertion = expect(result).rejects.toThrow('Operation blocked');
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    cpSpy.mockRestore();
    renameSpy.mockRestore();

    // The real IPC handler only calls consumeGuidedMoveToken after
    // moveVaultAtomic resolves, so a failed attempt like the one above must
    // leave the token usable — gating the retry with the identical token
    // must still succeed.
    const retryGate = checkGuidedMoveGate(
      { targetPath: dst, syncProvider: 'dropbox', sessionToken: token },
      tmpDir,
    );
    expect(retryGate.ok).toBe(true);

    // And the retry itself (now unblocked) actually completes the move.
    const retryResult = await moveVaultAtomic(src, dst, {
      syncProvider: 'dropbox',
      updateSettings: () => {},
    });
    expect(retryResult.verification.ok).toBe(true);
    expect(fs.existsSync(path.join(dst, 'manifest.json'))).toBe(true);

    // Only now — after real success — does the token get burned.
    consumeGuidedMoveToken(token);
    const replay = checkGuidedMoveGate(
      { targetPath: dst, syncProvider: 'dropbox', sessionToken: token },
      tmpDir,
    );
    expect(replay.ok).toBe(false);
  });
});
