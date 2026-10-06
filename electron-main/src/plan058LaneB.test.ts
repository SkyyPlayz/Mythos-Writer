/**
 * PLAN-058 Lane B — settings-write hygiene (red-on-revert pins).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect } from 'vitest';
import { maskApiKey, reconcileSettingsFromRenderer } from './settings-masking.js';
import { SETTINGS_DEFAULTS, saveAppSettingsTo } from './appSettingsLoad.js';
import { SecretsStore } from './secrets/store.js';
import type { AppSettings } from './ipc.js';
import { persistSecretsAndStripSettings } from './secrets/migration.js';

function makeSafeStorage(available: boolean) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (buf: Buffer) => {
      const raw = buf.toString('utf-8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice('enc:'.length);
    },
  };
}

describe('PLAN-058 Lane B — B-2 KEYS-B blank provider stub', () => {
  it('reconcile drops materialized empty Anthropic provider when stored had none', () => {
    const stored: AppSettings = {
      ...SETTINGS_DEFAULTS,
      apiKey: 'sk-ant-legacy-only',
    };
    const incoming: AppSettings = {
      ...stored,
      provider: { kind: 'anthropic', model: '', apiKey: '' },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.provider).toBeUndefined();
  });

  it('legacy-key-only Settings close cannot delete stored apiKey secret', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-b2-'));
    const settingsPath = path.join(dir, 'app-settings.json');
    const secretsPath = path.join(dir, 'secrets.json');
    const store = new SecretsStore({
      filePath: secretsPath,
      safeStorage: makeSafeStorage(true),
    });
    const K = 'sk-ant-legacy-only-stored';
    store.set('apiKey', K);
    store.reload();
    const stored: AppSettings = { ...SETTINGS_DEFAULTS, apiKey: K };
    const incoming: AppSettings = {
      ...stored,
      apiKey: maskApiKey(K),
      provider: { kind: 'anthropic', model: '', apiKey: '' },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.provider).toBeUndefined();
    saveAppSettingsTo(settingsPath, () => store, reconciled);
    expect(store.get('apiKey')).toBe(K);
    persistSecretsAndStripSettings(reconciled, store);
    expect(store.get('apiKey')).toBe(K);
  });
});

describe('PLAN-058 Lane B — B-3 delete ungated createProvider().stream', () => {
  it('Provider interface must not expose stream (use streamFromProvider)', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'provider.ts'), 'utf-8');
    expect(src).not.toMatch(/stream\s*\(\s*req:\s*StreamRequest\s*\)/);
    expect(src).toMatch(/export async function\* streamFromProvider/);
  });
});
