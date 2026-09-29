import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMythosVault } from './createVault.js';
import {
  AGENTS_PARTNER_FILES,
  assertAgentVaultPathSafe,
  clearAgentMemory,
  ensureAgentsPartnerFiles,
  parsePartnerIdentityFromFile,
  resolveKeysDir,
  syncPartnerIdentityToFile,
} from './agentsVaultPartner.js';
import { AGENT_VAULT_DIRNAME } from './mythosJson.js';

describe('agentsVaultPartner (Slice D)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-partner-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ensures partner.md + writer/analyst/archivist on create', () => {
    const created = createMythosVault(tmp, { name: 'P', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(created.mythosRoot, 'Agent Vault', f))).toBe(true);
    }
  });

  it('syncs identity into partner.md and Clear keeps identity files', () => {
    const created = createMythosVault(tmp, { name: 'P2', seedDemo: false, exactName: true });
    if (!created.ok) throw new Error(created.error);
    syncPartnerIdentityToFile(created.mythosRoot, { name: 'Aria', icon: 'moon' });
    expect(parsePartnerIdentityFromFile(created.mythosRoot)).toEqual({ name: 'Aria', icon: 'moon' });

    const sessions = path.join(created.mythosRoot, 'Agent Vault', 'Sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'chat.md'), 'x');
    const cleared = clearAgentMemory(created.mythosRoot);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.removed).toContain('Sessions');
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(created.mythosRoot, 'Agent Vault', f))).toBe(true);
    }
    expect(parsePartnerIdentityFromFile(created.mythosRoot).name).toBe('Aria');
  });

  it('ensure is idempotent and does not wipe existing partner.md', () => {
    const created = createMythosVault(tmp, { name: 'P3', seedDemo: false, exactName: true });
    if (!created.ok) throw new Error(created.error);
    const abs = path.join(created.mythosRoot, 'Agent Vault', 'partner.md');
    fs.writeFileSync(abs, '# custom\nname: Kept\n');
    const again = ensureAgentsPartnerFiles(created.mythosRoot);
    expect(again.created).toEqual([]);
    expect(fs.readFileSync(abs, 'utf-8')).toContain('name: Kept');
  });

  it('Shield R1: symlinked Agent Vault refuses before ensure writes outside', () => {
    const mythosRoot = path.join(tmp, 'MythosVault');
    fs.mkdirSync(mythosRoot, { recursive: true });
    const outside = path.join(tmp, 'escape-target');
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(mythosRoot, AGENT_VAULT_DIRNAME);
    try {
      if (process.platform === 'win32') {
        fs.symlinkSync(outside, link, 'junction');
      } else {
        fs.symlinkSync(outside, link);
      }
    } catch {
      return; // environment cannot create reparse points
    }

    expect(() => ensureAgentsPartnerFiles(mythosRoot)).toThrow(/symlink|escaped/i);
    const gated = resolveKeysDir(mythosRoot);
    expect(gated.ok).toBe(false);
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(outside, f))).toBe(false);
    }
  });

  it('Shield: sibling-prefix path fails closed (Agent Vault-evil)', () => {
    const mythosRoot = path.join(tmp, 'MythosVault');
    fs.mkdirSync(mythosRoot, { recursive: true });
    const evil = path.join(tmp, 'MythosVault-evil', AGENT_VAULT_DIRNAME);
    fs.mkdirSync(evil, { recursive: true });
    // Crafted agentRoot that shares a string prefix with mythosRoot but is a sibling.
    const siblingPrefix = path.join(tmp, 'MythosVault-evil', AGENT_VAULT_DIRNAME);
    expect(() => assertAgentVaultPathSafe(mythosRoot, siblingPrefix)).toThrow(/escaped/i);
    // keys-evil style: path that starts with keysDir string without separator
    const keysDir = path.join(mythosRoot, AGENT_VAULT_DIRNAME);
    fs.mkdirSync(keysDir, { recursive: true });
    const keysEvil = path.join(tmp, `${AGENT_VAULT_DIRNAME}-evil`);
    fs.mkdirSync(keysEvil, { recursive: true });
    expect(() => assertAgentVaultPathSafe(mythosRoot, keysEvil)).toThrow(/escaped/i);
  });

  it('Shield: Agent Vault as a file fails closed', () => {
    const mythosRoot = path.join(tmp, 'MythosVault');
    fs.mkdirSync(mythosRoot, { recursive: true });
    const filePath = path.join(mythosRoot, AGENT_VAULT_DIRNAME);
    fs.writeFileSync(filePath, 'not-a-dir');
    expect(() => ensureAgentsPartnerFiles(mythosRoot)).toThrow(/directory/i);
    const gated = resolveKeysDir(mythosRoot);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.error).toMatch(/directory/i);
  });

  it('resolveKeysDir succeeds for a normal vault and clearMemory stays inside Agent Vault', () => {
    const created = createMythosVault(tmp, { name: 'KeysOk', seedDemo: false, exactName: true });
    if (!created.ok) throw new Error(created.error);
    const gated = resolveKeysDir(created.mythosRoot);
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.keysDir).toBe(path.join(created.mythosRoot, AGENT_VAULT_DIRNAME));
    const sessions = path.join(gated.keysDir, 'Sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'x.md'), 'x');
    // Notes Vault sibling must not be touched by clear
    const notesSibling = path.join(created.mythosRoot, 'Notes Vault');
    fs.mkdirSync(notesSibling, { recursive: true });
    fs.writeFileSync(path.join(notesSibling, 'keep.md'), 'keep');
    const cleared = clearAgentMemory(created.mythosRoot);
    expect(cleared.ok).toBe(true);
    expect(fs.existsSync(path.join(notesSibling, 'keep.md'))).toBe(true);
    expect(fs.existsSync(sessions)).toBe(false);
  });
});

describe('Agent Vault layout vs Story Vault move (F5 Probe)', () => {
  let tmpLayout: string;
  beforeEach(() => {
    tmpLayout = fs.mkdtempSync(path.join(os.tmpdir(), 'av-layout-'));
  });
  afterEach(() => {
    fs.rmSync(tmpLayout, { recursive: true, force: true });
  });

  it('Agent Vault is not inside Story Vault (localFolderMove moves Story only)', () => {
    const created = createMythosVault(tmpLayout, { name: 'Layout', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const agent = path.join(created.mythosRoot, AGENT_VAULT_DIRNAME);
    expect(fs.existsSync(agent)).toBe(true);
    expect(created.storyVaultPath.startsWith(created.mythosRoot + path.sep)).toBe(true);
    expect(agent.startsWith(created.storyVaultPath + path.sep)).toBe(false);
    expect(path.dirname(agent)).toBe(created.mythosRoot);
  });
});
