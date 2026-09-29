import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMythosVault } from './createVault.js';
import {
  AGENTS_PARTNER_FILES,
  clearAgentMemory,
  ensureAgentsPartnerFiles,
  parsePartnerIdentityFromFile,
  syncPartnerIdentityToFile,
} from './agentsVaultPartner.js';

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
});
