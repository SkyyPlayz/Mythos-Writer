// SKY-12.2: unit tests for the onboarding wizard path-validation utility.
// Uses real temp dirs — no mocks needed (pure fs operations).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validatePathForVault, vaultPresentState } from './validatePathUtil.js';

const HOME = os.homedir();

describe('validatePathForVault', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exists=false, isEmpty=true, writable=true for a non-existent path under a writable parent', () => {
    const target = path.join(tmpDir, 'new-vault');
    const result = validatePathForVault(target, HOME);
    expect(result.exists).toBe(false);
    expect(result.isEmpty).toBe(true);
    expect(result.writable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns exists=true, isEmpty=true, writable=true for an existing empty directory', () => {
    const target = path.join(tmpDir, 'empty-vault');
    fs.mkdirSync(target);
    const result = validatePathForVault(target, HOME);
    expect(result.exists).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.writable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns exists=true, isEmpty=false, writable=true for a non-empty directory', () => {
    const target = path.join(tmpDir, 'full-vault');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'something.md'), '# hi');
    const result = validatePathForVault(target, HOME);
    expect(result.exists).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.writable).toBe(true);
  });

  it('returns error when path exists but is a file, not a directory', () => {
    const target = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(target, 'content');
    const result = validatePathForVault(target, HOME);
    expect(result.exists).toBe(true);
    expect(result.writable).toBe(false);
    expect(result.error).toMatch(/not a directory/);
  });

  it('returns error for empty string input', () => {
    const result = validatePathForVault('', HOME);
    expect(result.writable).toBe(false);
    expect(result.error).toMatch(/non-empty string/);
  });

  it('returns error for non-absolute path that is not ~ expanded', () => {
    const result = validatePathForVault('relative/path', HOME);
    expect(result.writable).toBe(false);
    expect(result.error).toMatch(/absolute/);
  });

  it('expands ~ to homeDir for non-existent target', () => {
    // This just needs to not throw and return a result. The actual path
    // under home may or may not exist; we just verify ~ is expanded.
    const result = validatePathForVault('~/Mythos/__sky-12-test-nonexistent__', HOME);
    expect(typeof result.exists).toBe('boolean');
    expect(typeof result.writable).toBe('boolean');
    // If the path doesn't exist it should be writable (home is writable).
    if (!result.exists) {
      expect(result.writable).toBe(true);
    }
  });

  it('handles deeply nested non-existent path under a writable ancestor', () => {
    const target = path.join(tmpDir, 'a', 'b', 'c', 'deep-vault');
    const result = validatePathForVault(target, HOME);
    expect(result.exists).toBe(false);
    expect(result.writable).toBe(true);
  });
});

// ─── vaultPresentState (SKY-69) ───

describe('vaultPresentState', () => {
  let tmpDir: string;
  let settingsPath: string;
  let vaultRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-test-'));
    settingsPath = path.join(tmpDir, 'vault-settings.json');
    vaultRoot = path.join(tmpDir, 'Story Vault');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns "present" when vault root exists', () => {
    fs.mkdirSync(vaultRoot);
    expect(vaultPresentState(vaultRoot, settingsPath)).toBe('present');
  });

  it('returns "present" when vault root exists regardless of settings file', () => {
    fs.mkdirSync(vaultRoot);
    fs.writeFileSync(settingsPath, JSON.stringify({ vaultRoot }), 'utf-8');
    expect(vaultPresentState(vaultRoot, settingsPath)).toBe('present');
  });

  it('returns "fresh-install" when vault root is missing and no settings file exists', () => {
    expect(vaultPresentState(vaultRoot, settingsPath)).toBe('fresh-install');
  });

  it('returns "deleted" when vault root is missing but settings file exists', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ vaultRoot }), 'utf-8');
    expect(vaultPresentState(vaultRoot, settingsPath)).toBe('deleted');
  });
});
