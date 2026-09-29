import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { adoptObsidianVaultInPlace } from './adoptObsidianInPlace.js';
import { tryReadMythosFile } from './mythosJson.js';
import { AGENTS_PARTNER_FILES } from './agentsVaultPartner.js';

describe('adoptObsidianVaultInPlace (Slice D openin)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openin-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('adopts Obsidian folder in place without copying notes', () => {
    const parent = path.join(tmp, 'parent');
    const obsidian = path.join(parent, 'MyWiki');
    fs.mkdirSync(path.join(obsidian, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(obsidian, 'Note.md'), '# Hello\n');
    const r = adoptObsidianVaultInPlace(obsidian);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mythosRoot).toBe(parent);
    expect(r.notesVaultPath).toBe(obsidian);
    expect(fs.readFileSync(path.join(obsidian, 'Note.md'), 'utf-8')).toBe('# Hello\n');
    expect(tryReadMythosFile(parent)?.seed?.layout).toContain('openin');
    expect(fs.existsSync(path.join(parent, 'Stories', 'Story Vault'))).toBe(true);
    for (const f of AGENTS_PARTNER_FILES) {
      expect(fs.existsSync(path.join(parent, 'Agent Vault', f))).toBe(true);
    }
  });

  it('refuses when parent already has mythos.json', () => {
    const parent = path.join(tmp, 'taken');
    const obsidian = path.join(parent, 'Wiki');
    fs.mkdirSync(path.join(obsidian, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(parent, 'mythos.json'), '{}');
    const r = adoptObsidianVaultInPlace(obsidian);
    expect(r.ok).toBe(false);
  });
});
