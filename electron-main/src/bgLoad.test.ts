// SKY-134 — Regression tests for the bg:load IPC security gate.
//
// Verifies that the extension allowlist is enforced BEFORE any filesystem
// access, so an attacker-controlled path cannot exfiltrate arbitrary files.

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { mimeForBgImage, readBgImageAsDataUrl, MAX_BG_IMAGE_BYTES } from './bgLoad.js';

afterEach(() => vi.restoreAllMocks());

describe('mimeForBgImage — extension allowlist (security gate)', () => {
  // These are the cases an attacker would try via prompt injection or a
  // malicious app-settings.json overwriting bgImagePath.
  it('returns null for /etc/passwd (no image extension)', () => {
    expect(mimeForBgImage('/etc/passwd')).toBeNull();
  });

  it('returns null for SSH private keys', () => {
    expect(mimeForBgImage('/home/user/.ssh/id_rsa')).toBeNull();
  });

  it('returns null for .json files', () => {
    expect(mimeForBgImage('/home/user/app-settings.json')).toBeNull();
  });

  it('returns null for .txt files', () => {
    expect(mimeForBgImage('/home/user/notes.txt')).toBeNull();
  });

  it('returns null for .js files', () => {
    expect(mimeForBgImage('/tmp/evil.js')).toBeNull();
  });

  it('returns null for .ts files', () => {
    expect(mimeForBgImage('/tmp/evil.ts')).toBeNull();
  });

  it('returns null for .db files', () => {
    expect(mimeForBgImage('/home/user/data.db')).toBeNull();
  });

  it('returns null for empty filePath', () => {
    expect(mimeForBgImage('')).toBeNull();
  });

  it('returns null for relative paths (must be absolute)', () => {
    expect(mimeForBgImage('images/bg.png')).toBeNull();
    expect(mimeForBgImage('./bg.png')).toBeNull();
    expect(mimeForBgImage('../../../etc/passwd')).toBeNull();
  });

  // Allowed image extensions
  it('allows .jpg → image/jpeg', () => {
    expect(mimeForBgImage('/home/user/bg.jpg')).toBe('image/jpeg');
  });

  it('allows .jpeg → image/jpeg', () => {
    expect(mimeForBgImage('/home/user/bg.jpeg')).toBe('image/jpeg');
  });

  it('allows .png → image/png', () => {
    expect(mimeForBgImage('/home/user/bg.png')).toBe('image/png');
  });

  it('allows .webp → image/webp', () => {
    expect(mimeForBgImage('/home/user/bg.webp')).toBe('image/webp');
  });

  it('allows .gif → image/gif', () => {
    expect(mimeForBgImage('/home/user/bg.gif')).toBe('image/gif');
  });

  it('allows .avif → image/avif', () => {
    expect(mimeForBgImage('/home/user/bg.avif')).toBe('image/avif');
  });

  it('is case-insensitive for extensions', () => {
    expect(mimeForBgImage('/home/user/bg.PNG')).toBe('image/png');
    expect(mimeForBgImage('/home/user/bg.JPG')).toBe('image/jpeg');
    expect(mimeForBgImage('/home/user/bg.WEBP')).toBe('image/webp');
  });
});

describe('readBgImageAsDataUrl — FS access is gated by the allowlist', () => {
  it('returns null for /etc/passwd and never reads the file', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const result = readBgImageAsDataUrl('/etc/passwd');
    expect(result.dataUrl).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns null for a .json path even if the file exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 42 } as fs.Stats);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('secret'));
    const result = readBgImageAsDataUrl('/home/user/app-settings.json');
    expect(result.dataUrl).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns null for a relative path without touching the filesystem', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync');
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const result = readBgImageAsDataUrl('bg.png');
    expect(result.dataUrl).toBeNull();
    expect(existsSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns null for a file exceeding MAX_BG_IMAGE_BYTES without reading', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: MAX_BG_IMAGE_BYTES + 1 } as fs.Stats);
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const result = readBgImageAsDataUrl('/home/user/huge.png');
    expect(result.dataUrl).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns null for a non-existent allowed-extension file', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = readBgImageAsDataUrl('/home/user/missing.jpg');
    expect(result.dataUrl).toBeNull();
  });

  it('returns a valid data URL for an allowed image that passes all checks', () => {
    const fakeData = Buffer.from('PNG_DATA');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: fakeData.length } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fakeData);
    const result = readBgImageAsDataUrl('/home/user/background.png');
    expect(result.dataUrl).toBe(`data:image/png;base64,${fakeData.toString('base64')}`);
  });

  it('returns a jpeg data URL for a .jpg path', () => {
    const fakeData = Buffer.from('JPEG_DATA');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: fakeData.length } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(fakeData);
    const result = readBgImageAsDataUrl('/home/user/bg.jpg');
    expect(result.dataUrl).toBe(`data:image/jpeg;base64,${fakeData.toString('base64')}`);
  });

  it('returns null and does not throw on a read error', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('EPERM'); });
    const result = readBgImageAsDataUrl('/home/user/bg.png');
    expect(result.dataUrl).toBeNull();
  });
});

describe('main.ts — BG_LOAD handler delegates to readBgImageAsDataUrl', () => {
  it('the BG_LOAD handler body no longer contains fs.readFileSync directly', () => {
    const mainSrc = require('fs').readFileSync(
      require('path').resolve(__dirname, 'main.ts'),
      'utf-8',
    );
    // Extract the BG_LOAD handler block
    const bgLoadMatch = mainSrc.match(/\[IPC_CHANNELS\.BG_LOAD\][^}]+}/s);
    expect(bgLoadMatch).not.toBeNull();
    // The handler must not call readFileSync directly — it must delegate
    expect(bgLoadMatch![0]).not.toMatch(/readFileSync/);
    // It must call readBgImageAsDataUrl
    expect(bgLoadMatch![0]).toMatch(/readBgImageAsDataUrl/);
  });
});
