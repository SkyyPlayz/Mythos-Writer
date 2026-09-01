// SKY-11068 — vault-icon collection/mutation: vault-local storage in
// mythos.json (+ a file at the mythos root for images), never app-global.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectProjectIcons, setProjectIcon } from './projectIcons.js';
import { STORY_VAULT_DIRNAME, NOTES_VAULT_DIRNAME, _clearDetectionCache } from './mythosFormat/mythosJson.js';

let tmpRoot: string;

function writeMythosJson(mythosRoot: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(mythosRoot, { recursive: true });
  fs.mkdirSync(path.join(mythosRoot, STORY_VAULT_DIRNAME), { recursive: true });
  fs.mkdirSync(path.join(mythosRoot, NOTES_VAULT_DIRNAME), { recursive: true });
  fs.writeFileSync(path.join(mythosRoot, 'mythos.json'), JSON.stringify({
    formatVersion: 2, id: 'v1', name: 'Test Vault', createdAt: '2026-08-26T00:00:00.000Z',
    stories: [], seed: null,
    ...extra,
  }, null, 2));
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-projicons-'));
  _clearDetectionCache();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('collectProjectIcons', () => {
  it('returns kind: null for a v0.4 legacy vault (no mythos.json)', async () => {
    const storyRoot = path.join(tmpRoot, 'legacy', STORY_VAULT_DIRNAME);
    fs.mkdirSync(storyRoot, { recursive: true });
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }]);
    expect(icons).toEqual([{ vaultRoot: storyRoot, kind: null }]);
  });

  it('returns kind: null when the v2 vault has no icon set — never empty/missing', async () => {
    const mythosRoot = path.join(tmpRoot, 'v2');
    writeMythosJson(mythosRoot);
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }]);
    expect(icons).toEqual([{ vaultRoot: storyRoot, kind: null }]);
  });

  it('resolves a glyph icon straight from mythos.json', async () => {
    const mythosRoot = path.join(tmpRoot, 'v2glyph');
    writeMythosJson(mythosRoot, { icon: { kind: 'glyph', value: '📖' } });
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }]);
    expect(icons).toEqual([{ vaultRoot: storyRoot, kind: 'glyph', value: '📖' }]);
  });

  it('resolves an image icon by reading the stored file as a data URL', async () => {
    const mythosRoot = path.join(tmpRoot, 'v2img');
    writeMythosJson(mythosRoot, { icon: { kind: 'image', file: 'vault-icon.png' } });
    fs.writeFileSync(path.join(mythosRoot, 'vault-icon.png'), Buffer.from('PNGDATA'));
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }]);
    expect(icons).toEqual([{
      vaultRoot: storyRoot,
      kind: 'image',
      dataUrl: `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`,
    }]);
  });

  it('falls back to kind: null when the referenced image file is missing (corrupt/deleted)', async () => {
    const mythosRoot = path.join(tmpRoot, 'v2missing');
    writeMythosJson(mythosRoot, { icon: { kind: 'image', file: 'vault-icon.png' } });
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }]);
    expect(icons).toEqual([{ vaultRoot: storyRoot, kind: null }]);
  });

  it('dedupes by vaultRoot, first entry wins', async () => {
    const mythosRoot = path.join(tmpRoot, 'v2dedupe');
    writeMythosJson(mythosRoot, { icon: { kind: 'glyph', value: '🐉' } });
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const icons = await collectProjectIcons([{ vaultRoot: storyRoot }, { vaultRoot: storyRoot }]);
    expect(icons).toHaveLength(1);
  });
});

describe('setProjectIcon', () => {
  it('rejects a v0.4 legacy vault (no mythos.json to write into)', async () => {
    const storyRoot = path.join(tmpRoot, 'legacy2', STORY_VAULT_DIRNAME);
    fs.mkdirSync(storyRoot, { recursive: true });
    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: { kind: 'glyph', value: '📖' } });
    expect(res.ok).toBe(false);
  });

  it('sets a glyph icon — persists into the vault-local mythos.json', async () => {
    const mythosRoot = path.join(tmpRoot, 'set-glyph');
    writeMythosJson(mythosRoot);
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);

    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: { kind: 'glyph', value: '🌙' } });
    expect(res.ok).toBe(true);
    expect(res.icon).toEqual({ vaultRoot: storyRoot, kind: 'glyph', value: '🌙' });

    const onDisk = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(onDisk.icon).toEqual({ kind: 'glyph', value: '🌙' });
  });

  it('rejects an invalid glyph without writing', async () => {
    const mythosRoot = path.join(tmpRoot, 'reject-glyph');
    writeMythosJson(mythosRoot);
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: { kind: 'glyph', value: 'x'.repeat(50) } });
    expect(res.ok).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(onDisk.icon).toBeUndefined();
  });

  it('sets an image icon — copies the source file into the vault root', async () => {
    const mythosRoot = path.join(tmpRoot, 'set-image');
    writeMythosJson(mythosRoot);
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);
    const sourcePath = path.join(tmpRoot, 'picked.jpg');
    fs.writeFileSync(sourcePath, Buffer.from('JPEGDATA'));

    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: { kind: 'image', sourcePath } });
    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.jpg'))).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(onDisk.icon).toEqual({ kind: 'image', file: 'vault-icon.jpg' });
  });

  it('clearing the icon removes the stored file and the mythos.json field', async () => {
    const mythosRoot = path.join(tmpRoot, 'clear');
    writeMythosJson(mythosRoot, { icon: { kind: 'image', file: 'vault-icon.png' } });
    fs.writeFileSync(path.join(mythosRoot, 'vault-icon.png'), 'x');
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);

    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: null });
    expect(res.ok).toBe(true);
    expect(res.icon).toEqual({ vaultRoot: storyRoot, kind: null });
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.png'))).toBe(false);

    const onDisk = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(onDisk.icon).toBeUndefined();
  });

  it('switching from image to glyph removes the stale image file', async () => {
    const mythosRoot = path.join(tmpRoot, 'switch');
    writeMythosJson(mythosRoot, { icon: { kind: 'image', file: 'vault-icon.png' } });
    fs.writeFileSync(path.join(mythosRoot, 'vault-icon.png'), 'x');
    const storyRoot = path.join(mythosRoot, STORY_VAULT_DIRNAME);

    const res = await setProjectIcon({ vaultRoot: storyRoot, icon: { kind: 'glyph', value: '⚔️' } });
    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.png'))).toBe(false);
  });
});
