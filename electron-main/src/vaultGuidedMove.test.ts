// vault:guidedFolderMove — unit + integration tests (SKY-862)
//
// Gate tests (§1): pure validation — no FS, covers all checkGuidedMoveGate
// rejection branches from vaultGate.ts.
//
// Move tests (§2): real tmpdir FS — covers validateMoveTarget + moveVaultAtomic
// happy path and each error/rollback branch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkGuidedMoveGate } from './vaultGate.js';
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

  it('consumes the token on success — replay is rejected', () => {
    const token = makeToken(TARGET);
    const first = checkGuidedMoveGate(
      { targetPath: TARGET, syncProvider: 'dropbox', sessionToken: token },
      HOME,
    );
    expect(first.ok).toBe(true);
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

    await moveVaultAtomic(src, dst, {
      syncProvider: 'dropbox',
      updateSettings: (newPath) => { settingsReceived = newPath; },
    });

    expect(settingsReceived).toBe(dst);
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

    await moveVaultAtomic(src, dst, {
      syncProvider: 'google-drive',
      updateSettings: () => {},
    });

    expect(
      fs.readFileSync(path.join(dst, 'Manuscript', 'ch1', 'scene.md'), 'utf-8'),
    ).toBe('# Scene One');
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
