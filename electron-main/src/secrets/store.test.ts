// Unit tests for the SecretsStore (MYT-777).
// safeStorage is stubbed — no Electron runtime required.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { SecretsStore, type SafeStorageLike } from './store.js';

/**
 * Test stub that mimics safeStorage well enough to exercise the store. We
 * intentionally don't use real encryption — base64 round-trip is enough to
 * prove the store calls encrypt on writes and decrypt on reads, and that the
 * on-disk format isn't a literal plaintext echo.
 */
function makeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const raw = buf.toString('utf-8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice('enc:'.length);
    },
  };
}

function makeStore(opts: { available?: boolean; file?: string } = {}) {
  const filePath = opts.file ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-secrets-')), 'secrets.json');
  const safeStorage = makeSafeStorage(opts.available ?? true);
  return { store: new SecretsStore({ filePath, safeStorage }), filePath, safeStorage };
}

describe('SecretsStore — round-trip', () => {
  it('returns null for unknown ids', () => {
    const { store } = makeStore();
    expect(store.get('provider.apiKey')).toBeNull();
  });

  it('stores + retrieves a secret across cache reloads', () => {
    const { store, filePath, safeStorage } = makeStore();
    store.set('provider.apiKey', 'sk-test-1234567890abcdef');
    expect(store.get('provider.apiKey')).toBe('sk-test-1234567890abcdef');

    // New store instance, same on-disk file → still retrievable.
    const fresh = new SecretsStore({ filePath, safeStorage });
    expect(fresh.get('provider.apiKey')).toBe('sk-test-1234567890abcdef');
  });

  it('overwrites an existing secret in place', () => {
    const { store } = makeStore();
    store.set('provider.apiKey', 'first');
    store.set('provider.apiKey', 'second');
    expect(store.get('provider.apiKey')).toBe('second');
    expect(store.listIds()).toEqual(['provider.apiKey']);
  });

  it('removes a secret via delete()', () => {
    const { store } = makeStore();
    store.set('provider.apiKey', 'first');
    store.delete('provider.apiKey');
    expect(store.get('provider.apiKey')).toBeNull();
    expect(store.listIds()).toEqual([]);
  });

  it('treats set(id, empty) as delete', () => {
    const { store } = makeStore();
    store.set('provider.apiKey', 'first');
    store.set('provider.apiKey', '');
    expect(store.get('provider.apiKey')).toBeNull();
  });
});

describe('SecretsStore — on-disk format', () => {
  it('does not write plaintext to the file', () => {
    const { store, filePath } = makeStore();
    const raw = 'sk-ant-PLAINTEXT-must-not-leak';
    store.set('anthropic.apiKey', raw);
    const onDisk = fs.readFileSync(filePath, 'utf-8');
    expect(onDisk).not.toContain(raw);
    expect(onDisk).not.toContain('PLAINTEXT');
    // Sanity check: the file is JSON with the v1 envelope.
    const parsed = JSON.parse(onDisk) as { v: number; values: Record<string, string> };
    expect(parsed.v).toBe(1);
    expect(Object.keys(parsed.values)).toEqual(['anthropic.apiKey']);
  });

  it('tolerates a corrupt secrets file by returning empty values', () => {
    const { store, filePath } = makeStore();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not valid json', 'utf-8');
    expect(store.get('provider.apiKey')).toBeNull();
    expect(store.listIds()).toEqual([]);
  });

  it('drops entries that fail to decrypt instead of throwing', () => {
    const { filePath, safeStorage } = makeStore();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ v: 1, values: { 'provider.apiKey': Buffer.from('garbage', 'utf-8').toString('base64') } }),
      'utf-8',
    );
    const store = new SecretsStore({ filePath, safeStorage });
    expect(store.get('provider.apiKey')).toBeNull();
  });
});

describe('SecretsStore — safeStorage unavailable', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-secrets-unavail-'));
  });

  it('refuses to write when safeStorage encryption is unavailable', () => {
    const { store } = makeStore({ available: false, file: path.join(dir, 'secrets.json') });
    expect(() => store.set('provider.apiKey', 'sk-test')).toThrow(/safeStorage encryption is not available/);
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false);
  });

  it('reports availability honestly', () => {
    const { store } = makeStore({ available: false });
    expect(store.isAvailable()).toBe(false);
  });
});
