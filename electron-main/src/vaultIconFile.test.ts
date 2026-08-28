// SKY-11068 — regression tests for the vault-icon security gate. Mirrors
// bgLoad.test.ts: the extension allowlist must be enforced BEFORE any
// filesystem access, and stored-file reads must reject any name that isn't
// a strict vault-icon.<ext> literal (no renderer-supplied path segments).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  mimeForVaultIconSource,
  isVaultIconFileName,
  importVaultIconFile,
  readVaultIconAsDataUrl,
  removeVaultIconFiles,
  MAX_VAULT_ICON_BYTES,
} from './vaultIconFile.js';

afterEach(() => vi.restoreAllMocks());

describe('mimeForVaultIconSource — extension allowlist (security gate)', () => {
  it('returns null for /etc/passwd (no image extension)', () => {
    expect(mimeForVaultIconSource('/etc/passwd')).toBeNull();
  });

  it('returns null for .json/.js/.ts/.db files', () => {
    expect(mimeForVaultIconSource('/home/user/app-settings.json')).toBeNull();
    expect(mimeForVaultIconSource('/tmp/evil.js')).toBeNull();
    expect(mimeForVaultIconSource('/tmp/evil.ts')).toBeNull();
    expect(mimeForVaultIconSource('/home/user/data.db')).toBeNull();
  });

  it('returns null for empty or relative paths', () => {
    expect(mimeForVaultIconSource('')).toBeNull();
    expect(mimeForVaultIconSource('images/bg.png')).toBeNull();
    expect(mimeForVaultIconSource('../../../etc/passwd')).toBeNull();
  });

  it('allows the standard image extensions, case-insensitively', () => {
    expect(mimeForVaultIconSource('/home/user/icon.jpg')).toBe('image/jpeg');
    expect(mimeForVaultIconSource('/home/user/icon.PNG')).toBe('image/png');
    expect(mimeForVaultIconSource('/home/user/icon.webp')).toBe('image/webp');
    expect(mimeForVaultIconSource('/home/user/icon.gif')).toBe('image/gif');
    expect(mimeForVaultIconSource('/home/user/icon.avif')).toBe('image/avif');
  });
});

describe('isVaultIconFileName — strict literal match (no path segments possible)', () => {
  it('accepts exactly vault-icon.<allowed ext>', () => {
    expect(isVaultIconFileName('vault-icon.png')).toBe(true);
    expect(isVaultIconFileName('vault-icon.jpeg')).toBe(true);
  });

  it('rejects anything else, including traversal attempts', () => {
    expect(isVaultIconFileName('../vault-icon.png')).toBe(false);
    expect(isVaultIconFileName('vault-icon.png/../../etc/passwd')).toBe(false);
    expect(isVaultIconFileName('vault-icon.exe')).toBe(false);
    expect(isVaultIconFileName('other.png')).toBe(false);
    expect(isVaultIconFileName('')).toBe(false);
  });
});

describe('readVaultIconAsDataUrl — FS access gated by the allowlist', () => {
  it('returns null for a non-absolute mythos root without touching the filesystem', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat');
    const result = await readVaultIconAsDataUrl('relative/root', 'vault-icon.png');
    expect(result.dataUrl).toBeNull();
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('returns null for a renderer-supplied non-literal file name', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat');
    const result = await readVaultIconAsDataUrl('/home/user/vault', '../../etc/passwd');
    expect(result.dataUrl).toBeNull();
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('returns null for a file exceeding MAX_VAULT_ICON_BYTES without reading', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: MAX_VAULT_ICON_BYTES + 1 } as fs.Stats);
    const readSpy = vi.spyOn(fs.promises, 'readFile');
    const result = await readVaultIconAsDataUrl('/home/user/vault', 'vault-icon.png');
    expect(result.dataUrl).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns null for a missing file', async () => {
    vi.spyOn(fs.promises, 'stat').mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const result = await readVaultIconAsDataUrl('/home/user/vault', 'vault-icon.png');
    expect(result.dataUrl).toBeNull();
  });

  it('returns null and does not throw on a read error', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 100 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('EPERM'));
    const result = await readVaultIconAsDataUrl('/home/user/vault', 'vault-icon.png');
    expect(result.dataUrl).toBeNull();
  });
});

describe('importVaultIconFile / readVaultIconAsDataUrl — real round trip', () => {
  let mythosRoot: string;
  let sourceDir: string;

  beforeEach(() => {
    mythosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-mythos-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-src-'));
  });

  afterEach(() => {
    fs.rmSync(mythosRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('copies an allowed source image into <mythosRoot>/vault-icon.<ext> and reads it back', async () => {
    const source = path.join(sourceDir, 'picked.png');
    fs.writeFileSync(source, Buffer.from('PNG_BYTES'));

    const { file } = importVaultIconFile(mythosRoot, source);
    expect(file).toBe('vault-icon.png');
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.png'))).toBe(true);

    const { dataUrl } = await readVaultIconAsDataUrl(mythosRoot, file!);
    expect(dataUrl).toBe(`data:image/png;base64,${Buffer.from('PNG_BYTES').toString('base64')}`);
  });

  it('rejects a disallowed source extension without writing anything', () => {
    const source = path.join(sourceDir, 'malicious.exe');
    fs.writeFileSync(source, Buffer.from('MZ'));
    const { file } = importVaultIconFile(mythosRoot, source);
    expect(file).toBeNull();
    expect(fs.readdirSync(mythosRoot)).toHaveLength(0);
  });

  it('rejects a source exceeding MAX_VAULT_ICON_BYTES', () => {
    const source = path.join(sourceDir, 'huge.png');
    fs.writeFileSync(source, Buffer.alloc(MAX_VAULT_ICON_BYTES + 1, 1));
    const { file } = importVaultIconFile(mythosRoot, source);
    expect(file).toBeNull();
  });

  it('rejects a missing source file', () => {
    const { file } = importVaultIconFile(mythosRoot, path.join(sourceDir, 'missing.png'));
    expect(file).toBeNull();
  });

  it('replacing the icon removes the stale extension (avif -> png swap leaves one file)', () => {
    const avifSource = path.join(sourceDir, 'first.avif');
    fs.writeFileSync(avifSource, Buffer.from('AVIF'));
    expect(importVaultIconFile(mythosRoot, avifSource).file).toBe('vault-icon.avif');

    const pngSource = path.join(sourceDir, 'second.png');
    fs.writeFileSync(pngSource, Buffer.from('PNG'));
    expect(importVaultIconFile(mythosRoot, pngSource).file).toBe('vault-icon.png');

    const entries = fs.readdirSync(mythosRoot);
    expect(entries).toEqual(['vault-icon.png']);
  });
});

describe('removeVaultIconFiles', () => {
  let mythosRoot: string;

  beforeEach(() => {
    mythosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-mythos-'));
  });

  afterEach(() => {
    fs.rmSync(mythosRoot, { recursive: true, force: true });
  });

  it('removes every stored vault-icon.* file when no keep is given', () => {
    fs.writeFileSync(path.join(mythosRoot, 'vault-icon.png'), 'x');
    fs.writeFileSync(path.join(mythosRoot, 'mythos.json'), '{}');
    removeVaultIconFiles(mythosRoot);
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.png'))).toBe(false);
    expect(fs.existsSync(path.join(mythosRoot, 'mythos.json'))).toBe(true);
  });

  it('keeps the named file when keep is given', () => {
    fs.writeFileSync(path.join(mythosRoot, 'vault-icon.png'), 'x');
    removeVaultIconFiles(mythosRoot, 'vault-icon.png');
    expect(fs.existsSync(path.join(mythosRoot, 'vault-icon.png'))).toBe(true);
  });

  it('does not throw for a non-absolute or unreadable root', () => {
    expect(() => removeVaultIconFiles('relative/root')).not.toThrow();
    expect(() => removeVaultIconFiles('/does/not/exist/at/all')).not.toThrow();
  });
});
