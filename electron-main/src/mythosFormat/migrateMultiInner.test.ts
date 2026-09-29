import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMythosVault } from './createVault.js';
import { migrateVaultToMultiInner } from './migrateMultiInner.js';
import { AGENTS_PARTNER_FILES } from './agentsVaultPartner.js';

describe('migrateVaultToMultiInner (Slice D)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-inner-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('migrates without wiping user notes', () => {
    const created = createMythosVault(tmp, { name: 'Exist', seedDemo: false, exactName: true });
    if (!created.ok) throw new Error(created.error);
    const note = path.join(created.notesVaultPath, 'KeepMe.md');
    fs.writeFileSync(note, '# keep\n');
    // Simulate missing partner files
    for (const f of AGENTS_PARTNER_FILES) {
      const abs = path.join(created.mythosRoot, 'Agent Vault', f);
      if (fs.existsSync(abs)) fs.rmSync(abs);
    }
    const r = migrateVaultToMultiInner(created.mythosRoot);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(note, 'utf-8')).toBe('# keep\n');
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(created.mythosRoot, 'Agent Vault', f))).toBe(true);
    }
  });
});
