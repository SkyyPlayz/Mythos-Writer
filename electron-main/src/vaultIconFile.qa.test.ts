// SKY-11163 — QA independent acceptance tests for async vault-icon reads (SKY-11108 / PR#1373).
//
// Written from the SPEC (SKY-11141), NOT from the implementation.
// Spec invariants:
//   I1. readVaultIconAsDataUrl returns a Promise (is async — never sync).
//   I2. On a valid image file within size limit: returns { dataUrl: "data:<mime>;base64,..." }.
//   I3. On a missing file: returns { dataUrl: null }, does NOT throw.
//   I4. On a file over MAX_VAULT_ICON_BYTES: returns { dataUrl: null }.
//   I5. On a non-image extension (security gate): returns { dataUrl: null }.
//   I6. On a path traversal attempt in fileName: returns { dataUrl: null }.
//   I7. On a relative or empty mythosRoot: returns { dataUrl: null }.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readVaultIconAsDataUrl,
  MAX_VAULT_ICON_BYTES,
} from './vaultIconFile.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-icon-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── I1: returns a Promise ────────────────────────────────────────────────────

describe('[QA] readVaultIconAsDataUrl — is async (I1)', () => {
  it('returns a Promise, not a plain value', () => {
    const result = readVaultIconAsDataUrl(tmpDir, 'vault-icon.png');
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});

// ─── I2: valid small icon returns base64 dataUrl ─────────────────────────────

describe('[QA] readVaultIconAsDataUrl — valid icon (I2)', () => {
  it('returns a data URL starting with data:image/png for a small PNG', async () => {
    // Minimal 1×1 white PNG (67 bytes — well under the 5 MB limit)
    const minimalPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a4944415478016360000000020001e221bc330000000049454e44ae426082',
      'hex',
    );
    fs.writeFileSync(path.join(tmpDir, 'vault-icon.png'), minimalPng);
    const { dataUrl } = await readVaultIconAsDataUrl(tmpDir, 'vault-icon.png');
    expect(dataUrl).not.toBeNull();
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

// ─── I3: missing file returns null, not throws ───────────────────────────────

describe('[QA] readVaultIconAsDataUrl — missing file (I3)', () => {
  it('returns { dataUrl: null } when the icon file does not exist', async () => {
    const { dataUrl } = await readVaultIconAsDataUrl(tmpDir, 'vault-icon.png');
    expect(dataUrl).toBeNull();
  });
});

// ─── I4: oversized file returns null without reading ─────────────────────────

describe('[QA] readVaultIconAsDataUrl — oversized file (I4)', () => {
  it('returns { dataUrl: null } for a file over MAX_VAULT_ICON_BYTES', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce(
      { size: MAX_VAULT_ICON_BYTES + 1 } as import('node:fs').Stats,
    );
    const readSpy = vi.spyOn(fs.promises, 'readFile');
    const { dataUrl } = await readVaultIconAsDataUrl(tmpDir, 'vault-icon.png');
    expect(dataUrl).toBeNull();
    // Must NOT read the oversized file into memory
    expect(readSpy).not.toHaveBeenCalled();
    statSpy.mockRestore();
    readSpy.mockRestore();
  });
});

// ─── I5: non-image extension returns null ────────────────────────────────────

describe('[QA] readVaultIconAsDataUrl — security gate: extension (I5)', () => {
  for (const badName of ['vault-icon.js', 'vault-icon.json', 'vault-icon.db', 'vault-icon.sh']) {
    it(`returns { dataUrl: null } for ${badName}`, async () => {
      const { dataUrl } = await readVaultIconAsDataUrl(tmpDir, badName);
      expect(dataUrl).toBeNull();
    });
  }
});

// ─── I6: path traversal in fileName ──────────────────────────────────────────

describe('[QA] readVaultIconAsDataUrl — security gate: path traversal (I6)', () => {
  for (const traversalName of [
    '../etc/passwd',
    '../../secret.png',
    'vault-icon.png/../../config.json',
  ]) {
    it(`returns { dataUrl: null } for traversal attempt "${traversalName}"`, async () => {
      const { dataUrl } = await readVaultIconAsDataUrl(tmpDir, traversalName);
      expect(dataUrl).toBeNull();
    });
  }
});

// ─── I7: relative or empty mythosRoot ────────────────────────────────────────

describe('[QA] readVaultIconAsDataUrl — path guards (I7)', () => {
  it('returns { dataUrl: null } for a relative mythosRoot', async () => {
    const { dataUrl } = await readVaultIconAsDataUrl('./relative/path', 'vault-icon.png');
    expect(dataUrl).toBeNull();
  });

  it('returns { dataUrl: null } for empty mythosRoot', async () => {
    const { dataUrl } = await readVaultIconAsDataUrl('', 'vault-icon.png');
    expect(dataUrl).toBeNull();
  });
});
