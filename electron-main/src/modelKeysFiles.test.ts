import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearModelKeysMemory,
  getModelKeysLocation,
  isInsideKeysDir,
  resolveKeysDir,
} from './modelKeysFiles.js';
import { AGENT_VAULT_DIRNAME } from './mythosFormat/mythosJson.js';
import { AGENTS_PARTNER_FILES } from './mythosFormat/agentsVaultPartner.js';

describe('modelKeysFiles (F5 sandbox)', () => {
  let tmp: string;
  let mythosRoot: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-keys-'));
    mythosRoot = path.join(tmp, 'MythosVault');
    fs.mkdirSync(mythosRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolveKeysDir creates Agent Vault under the mythos root', () => {
    const keysDir = resolveKeysDir(mythosRoot);
    expect(keysDir).toBe(path.join(mythosRoot, AGENT_VAULT_DIRNAME));
    expect(fs.existsSync(keysDir)).toBe(true);
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(keysDir, f))).toBe(true);
    }
  });

  it('isInsideKeysDir rejects escape attempts', () => {
    const keysDir = resolveKeysDir(mythosRoot);
    expect(isInsideKeysDir(keysDir, keysDir)).toBe(true);
    expect(isInsideKeysDir(keysDir, path.join(keysDir, 'partner.md'))).toBe(true);
    expect(isInsideKeysDir(keysDir, mythosRoot)).toBe(false);
    expect(isInsideKeysDir(keysDir, path.join(tmp, 'other'))).toBe(false);
  });

  it('getModelKeysLocation returns sandboxed path + chips', () => {
    const loc = getModelKeysLocation(mythosRoot, 'Test Vault');
    expect(loc.ok).toBe(true);
    expect(loc.path).toBe(path.join(mythosRoot, AGENT_VAULT_DIRNAME));
    expect(loc.scope).toBe('Test Vault');
    expect(loc.chips).toContain('partner.md');
    expect(loc.files).toBeGreaterThanOrEqual(AGENTS_PARTNER_FILES.length);
  });

  it('clearModelKeysMemory keeps identity files and removes extras', () => {
    const keysDir = resolveKeysDir(mythosRoot);
    const sessions = path.join(keysDir, 'Sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'chat.json'), '{}');
    const res = clearModelKeysMemory(mythosRoot);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.removed).toContain('Sessions');
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(keysDir, f))).toBe(true);
    }
    expect(fs.existsSync(sessions)).toBe(false);
  });
});
