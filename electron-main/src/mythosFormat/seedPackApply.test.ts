import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyBothSeedWorlds, loadSeedFile, seedIsContentOnly } from './seedPackApply.js';

describe('seedPackApply (Slice D)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-pack-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads two-world seed without treating walkthroughSteps as enablement', () => {
    const seed = loadSeedFile();
    expect(seedIsContentOnly(seed)).toBe(true);
    expect(Array.isArray(seed.walkthroughSteps)).toBe(true);
  });

  it('materializes Mythos Vault + Shared Worlds with distinguishable content', () => {
    const r = applyBothSeedWorlds(tmp);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worlds).toHaveLength(2);
    const mythos = r.worlds[0];
    const aether = r.worlds[1];
    expect(mythos.ok && mythos.world).toMatch(/Veynn/i);
    expect(aether.ok && aether.world).toMatch(/Caerwyn/i);
    if (!mythos.ok || !aether.ok) return;
    const mythosTree = fs.readdirSync(mythos.notesVaultPath, { recursive: true }).map(String).join('\n');
    const aetherTree = fs.readdirSync(aether.notesVaultPath, { recursive: true }).map(String).join('\n');
    expect(mythosTree).toMatch(/Veynn|Mira|Sunken/i);
    expect(aetherTree).toMatch(/Caerwyn|Teodric|Maelis|Hollow/i);
    // Soft-FAIL: applying seed must not create Demo/Tour enablement markers in vault.
    expect(fs.existsSync(path.join(mythos.mythosRoot, 'walkthroughSteps.json'))).toBe(false);
    expect(mythos.storyTitles).toEqual(expect.arrayContaining(['The Last City of Veynn', 'The Ninth Bell']));
    expect(aether.storyTitles).toEqual(expect.arrayContaining(['The Hollow Crown', 'Saltwater Letters']));
  });
});
