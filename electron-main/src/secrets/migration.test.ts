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
const FAKE_ARCHIVE_KEY = 'sk-ant-test-MigrationArchive000000000000000000000000000000';
const FAKE_STT_KEY = 'sk-proj-MigrationStt0000000000000000000000000000000000beef';
const FAKE_TTS_KEY = 'sk-proj-MigrationTts0000000000000000000000000000000000beef';

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

  // Regression: SKY-740 — archive key was never stripped before; ensure migration moves it.
  it('migrates a plaintext archive agent provider.apiKey out of app-settings.json (SKY-740)', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        baseSettings({
          agents: {
            writingAssistant: { enabled: false, model: 'claude', scanIntervalSeconds: 0, ...agentBudgets },
            brainstorm: { enabled: false, model: 'claude', ...agentBudgets },
            archive: {
              enabled: false,
              model: 'claude',
              continuityCheckIntervalSeconds: 0,
              ...agentBudgets,
              provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_ARCHIVE_KEY },
            },
          },
        }),
      ),
      'utf-8',
    );

    const result = migrateSecretsFromSettingsFile(settingsPath, store);

    expect(result.migrated).toBe(true);
    expect(result.movedIds).toContain('provider.archive.apiKey');

    const rewritten = fs.readFileSync(settingsPath, 'utf-8');
    expect(rewritten).not.toContain(FAKE_ARCHIVE_KEY);
    expect(store.get('provider.archive.apiKey')).toBe(FAKE_ARCHIVE_KEY);
  });

  // Regression: SKY-816/817 — STT/TTS keys were never stripped before; ensure migration moves them.
  it('migrates plaintext stt.cloudApiKey and tts.cloudApiKey out of app-settings.json (SKY-816/817)', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        baseSettings({
          stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://stt.example.com', cloudApiKey: FAKE_STT_KEY },
          tts: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://tts.example.com', cloudApiKey: FAKE_TTS_KEY },
        }),
      ),
      'utf-8',
    );

    const result = migrateSecretsFromSettingsFile(settingsPath, store);

    expect(result.migrated).toBe(true);
    expect(result.movedIds).toContain('stt.cloudApiKey');
    expect(result.movedIds).toContain('tts.cloudApiKey');

    const rewritten = fs.readFileSync(settingsPath, 'utf-8');
    expect(rewritten).not.toContain(FAKE_STT_KEY);
    expect(rewritten).not.toContain(FAKE_TTS_KEY);
    expect(store.get('stt.cloudApiKey')).toBe(FAKE_STT_KEY);
    expect(store.get('tts.cloudApiKey')).toBe(FAKE_TTS_KEY);
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

  // Regression: SKY-740 — archive key must be stripped and stored, not written to disk.
  it('strips and encrypts archive agent provider.apiKey (SKY-740)', () => {
    const { store } = mkStore();
    const incoming = baseSettings({
      agents: {
        writingAssistant: { enabled: false, model: 'claude', scanIntervalSeconds: 0, ...agentBudgets },
        brainstorm: { enabled: false, model: 'claude', ...agentBudgets },
        archive: {
          enabled: false,
          model: 'claude',
          continuityCheckIntervalSeconds: 0,
          ...agentBudgets,
          provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_ARCHIVE_KEY },
        },
      },
    });
    const stripped = persistSecretsAndStripSettings(incoming, store);

    expect(stripped.agents.archive.provider?.apiKey).toBe('');
    expect(store.get('provider.archive.apiKey')).toBe(FAKE_ARCHIVE_KEY);
    expect(JSON.stringify(stripped)).not.toContain(FAKE_ARCHIVE_KEY);
  });

  // Regression: SKY-816/817 — STT/TTS keys must be stripped and stored, not written to disk.
  it('strips and encrypts stt.cloudApiKey and tts.cloudApiKey (SKY-816/817)', () => {
    const { store } = mkStore();
    const incoming = baseSettings({
      stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://stt.example.com', cloudApiKey: FAKE_STT_KEY },
      tts: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://tts.example.com', cloudApiKey: FAKE_TTS_KEY },
    });
    const stripped = persistSecretsAndStripSettings(incoming, store);

    expect(stripped.stt?.cloudApiKey).toBe('');
    expect(stripped.tts?.cloudApiKey).toBe('');
    expect(store.get('stt.cloudApiKey')).toBe(FAKE_STT_KEY);
    expect(store.get('tts.cloudApiKey')).toBe(FAKE_TTS_KEY);
    expect(JSON.stringify(stripped)).not.toContain(FAKE_STT_KEY);
    expect(JSON.stringify(stripped)).not.toContain(FAKE_TTS_KEY);
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

  // Regression: SKY-740 — archive key must be hydrated from the store.
  it('hydrates archive agent provider.apiKey from the secrets store (SKY-740)', () => {
    const { store } = mkStore();
    store.set('provider.archive.apiKey', FAKE_ARCHIVE_KEY);
    const onDisk = baseSettings({
      agents: {
        writingAssistant: { enabled: false, model: 'claude', scanIntervalSeconds: 0, ...agentBudgets },
        brainstorm: { enabled: false, model: 'claude', ...agentBudgets },
        archive: {
          enabled: false,
          model: 'claude',
          continuityCheckIntervalSeconds: 0,
          ...agentBudgets,
          provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: '' },
        },
      },
    });
    const hydrated = hydrateSecretsIntoSettings(onDisk, store);
    expect(hydrated.agents.archive.provider?.apiKey).toBe(FAKE_ARCHIVE_KEY);
  });

  it('leaves archive provider alone when no archive key is in the store', () => {
    const { store } = mkStore();
    const hydrated = hydrateSecretsIntoSettings(baseSettings(), store);
    expect(hydrated.agents.archive.provider).toBeUndefined();
  });

  // Regression: SKY-816/817 — STT/TTS keys must be hydrated from the store.
  it('hydrates stt.cloudApiKey and tts.cloudApiKey from the secrets store (SKY-816/817)', () => {
    const { store } = mkStore();
    store.set('stt.cloudApiKey', FAKE_STT_KEY);
    store.set('tts.cloudApiKey', FAKE_TTS_KEY);
    const onDisk = baseSettings({
      stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://stt.example.com' },
      tts: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://tts.example.com' },
    });
    const hydrated = hydrateSecretsIntoSettings(onDisk, store);
    expect(hydrated.stt?.cloudApiKey).toBe(FAKE_STT_KEY);
    expect(hydrated.tts?.cloudApiKey).toBe(FAKE_TTS_KEY);
  });

  it('leaves stt/tts blocks alone when no keys are in the store', () => {
    const { store } = mkStore();
    const hydrated = hydrateSecretsIntoSettings(
      baseSettings({
        stt: { enabled: true, provider: 'local' },
        tts: { enabled: true, provider: 'local' },
      }),
      store,
    );
    expect(hydrated.stt?.cloudApiKey).toBeUndefined();
    expect(hydrated.tts?.cloudApiKey).toBeUndefined();
  });
});
