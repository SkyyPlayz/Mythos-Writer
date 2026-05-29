// Migration tests for plaintext → safeStorage (MYT-777).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { SecretsStore, type SafeStorageLike } from './store.js';
import {
  migrateSecretsFromSettingsFile,
  hydrateSecretsIntoSettings,
  persistSecretsAndStripSettings,
} from './migration.js';
import type { AppSettings } from '../ipc.js';

const FAKE_ANTHROPIC = 'sk-ant-test-MigrationFixture00000000000000000000000000000000';
const FAKE_OPENAI = 'sk-proj-MigrationFixture000000000000000000000000000000000beef';
const FAKE_PROVIDER = 'sk-ant-test-MigrationProvider00000000000000000000000000000000';

function makeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  };
}

function mkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migration-'));
  const settingsPath = path.join(dir, 'app-settings.json');
  const secretsPath = path.join(dir, 'secrets.json');
  const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage() });
  return { dir, settingsPath, secretsPath, store };
}

const agentBudgets = {
  autoApply: false,
  confidenceThreshold: 0.8,
  maxTokensPerHour: 0,
  maxSuggestionsPerHour: 0,
  heartbeatIntervalMinutes: 0,
  maxTokensPerDay: 0,
};

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: { enabled: false, model: 'claude', scanIntervalSeconds: 0, ...agentBudgets },
      brainstorm: { enabled: false, model: 'claude', ...agentBudgets },
      archive: { enabled: false, model: 'claude', continuityCheckIntervalSeconds: 0, ...agentBudgets },
    },
    theme: 'dark',
    ...overrides,
  };
}

describe('migrateSecretsFromSettingsFile', () => {
  it('moves plaintext keys out of app-settings.json into the store', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        baseSettings({
          apiKey: FAKE_ANTHROPIC,
          provider: { kind: 'anthropic', apiKey: FAKE_PROVIDER, model: 'claude-haiku-4-5-20251001' },
          voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI },
        }),
      ),
      'utf-8',
    );

    const result = migrateSecretsFromSettingsFile(settingsPath, store);

    expect(result.migrated).toBe(true);
    expect(result.movedIds.sort()).toEqual(['anthropic.apiKey', 'provider.apiKey', 'voice.openaiApiKey']);

    // app-settings.json no longer contains any of the raw key material.
    const rewritten = fs.readFileSync(settingsPath, 'utf-8');
    expect(rewritten).not.toContain(FAKE_ANTHROPIC);
    expect(rewritten).not.toContain(FAKE_PROVIDER);
    expect(rewritten).not.toContain(FAKE_OPENAI);

    // The store now holds the plaintext, available via get().
    expect(store.get('anthropic.apiKey')).toBe(FAKE_ANTHROPIC);
    expect(store.get('provider.apiKey')).toBe(FAKE_PROVIDER);
    expect(store.get('voice.openaiApiKey')).toBe(FAKE_OPENAI);
  });

  it('is a no-op when there are no plaintext keys to move', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(settingsPath, JSON.stringify(baseSettings()), 'utf-8');
    const result = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(result.migrated).toBe(false);
    expect(result.movedIds).toEqual([]);
    expect(store.listIds()).toEqual([]);
  });

  it('is idempotent — second run does nothing', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(baseSettings({ apiKey: FAKE_ANTHROPIC })),
      'utf-8',
    );
    migrateSecretsFromSettingsFile(settingsPath, store);
    const second = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(second.migrated).toBe(false);
    expect(store.get('anthropic.apiKey')).toBe(FAKE_ANTHROPIC);
  });

  it('returns migrated:false when app-settings.json is absent', () => {
    const { settingsPath, store } = mkStore();
    const result = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(result.migrated).toBe(false);
  });
});

describe('persistSecretsAndStripSettings', () => {
  it('routes incoming key material into the store and zeroes the JSON fields', () => {
    const { store } = mkStore();
    const incoming = baseSettings({
      apiKey: FAKE_ANTHROPIC,
      provider: { kind: 'anthropic', apiKey: FAKE_PROVIDER, model: 'claude-haiku-4-5-20251001' },
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI },
    });
    const stripped = persistSecretsAndStripSettings(incoming, store);

    expect(stripped.apiKey).toBe('');
    expect(stripped.provider?.apiKey).toBe('');
    expect(stripped.voice?.openaiApiKey).toBe('');

    expect(store.get('anthropic.apiKey')).toBe(FAKE_ANTHROPIC);
    expect(store.get('provider.apiKey')).toBe(FAKE_PROVIDER);
    expect(store.get('voice.openaiApiKey')).toBe(FAKE_OPENAI);

    // The serialized stripped payload contains no key material.
    const serialized = JSON.stringify(stripped);
    expect(serialized).not.toContain(FAKE_ANTHROPIC);
    expect(serialized).not.toContain(FAKE_PROVIDER);
    expect(serialized).not.toContain(FAKE_OPENAI);
  });

  it('clears a previously stored secret when the renderer submits an empty value', () => {
    const { store } = mkStore();
    store.set('anthropic.apiKey', FAKE_ANTHROPIC);
    const stripped = persistSecretsAndStripSettings(baseSettings({ apiKey: '' }), store);
    expect(stripped.apiKey).toBe('');
    expect(store.get('anthropic.apiKey')).toBeNull();
  });
});

describe('hydrateSecretsIntoSettings', () => {
  it('overlays decrypted secrets onto a freshly loaded AppSettings', () => {
    const { store } = mkStore();
    store.set('anthropic.apiKey', FAKE_ANTHROPIC);
    store.set('provider.apiKey', FAKE_PROVIDER);
    store.set('voice.openaiApiKey', FAKE_OPENAI);

    const onDisk = baseSettings({
      provider: { kind: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001' },
      voice: { enabled: true, cloudFallback: true },
    });
    const hydrated = hydrateSecretsIntoSettings(onDisk, store);
    expect(hydrated.apiKey).toBe(FAKE_ANTHROPIC);
    expect(hydrated.provider?.apiKey).toBe(FAKE_PROVIDER);
    expect(hydrated.voice?.openaiApiKey).toBe(FAKE_OPENAI);
  });

  it('leaves voice block alone when there is no voice settings block', () => {
    const { store } = mkStore();
    store.set('voice.openaiApiKey', FAKE_OPENAI);
    const hydrated = hydrateSecretsIntoSettings(baseSettings(), store);
    expect(hydrated.voice).toBeUndefined();
  });
});
