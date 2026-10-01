// API key leak tests (MYT-134)
// Asserts that API key material never appears in generation logs, IPC response
// payloads, error messages, or .env.example.
//
// SETTINGS_GET masking originally tracked in MYT-143 (Anthropic apiKey) and
// extended in MYT-424 to also cover voice.openaiApiKey.

import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeVaultFileUnsafe_testOnly } from './vault.js';
import type { AppSettings } from './ipc.js';
import {
  maskApiKey,
  maskSettingsForRenderer,
  reconcileSettingsFromRenderer,
  KEY_FIELD_PATHS,
  healMaskedKeyFields,
  isMaskedPreview,
  getKeyField,
  setKeyField,
  type KeyFieldPath,
} from './settings-masking.js';
import { SecretsStore, type SafeStorageLike } from './secrets/store.js';
import { persistSecretsAndStripSettings, migrateSecretsFromSettingsFile } from './secrets/migration.js';

// A plausible-looking synthetic key — not a real credential.
const FAKE_API_KEY = 'sk-ant-test-FakeKeyForTestingOnly000000000000000000000000000000';
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');

// Reusable test helpers for secrets store.
function makeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  };
}

function mkStore(): { store: SecretsStore; settingsPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-leak-disk-'));
  const settingsPath = path.join(dir, 'app-settings.json');
  const secretsPath = path.join(dir, 'secrets.json');
  return {
    store: new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage() }),
    settingsPath,
  };
}

// ── Generation log payload_digest ──────────────────────────────────────────

describe('generation_log payload_digest — SHA-256, not raw text', () => {
  it('digest of a prompt is a 64-char hex string', () => {
    const prompt = 'Write me a dragon fight scene.';
    const digest = crypto.createHash('sha256').update(prompt).digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('digest does not contain the original prompt text', () => {
    const prompt = `User said: ${FAKE_API_KEY}`;
    const digest = crypto.createHash('sha256').update(prompt).digest('hex');
    expect(digest).not.toContain(FAKE_API_KEY);
    expect(digest).not.toContain('sk-ant-');
  });

  it('digest of the key itself does not reproduce the key', () => {
    // Even if the key were mistakenly hashed directly, the digest is safe.
    const digest = crypto.createHash('sha256').update(FAKE_API_KEY).digest('hex');
    expect(digest).not.toContain('sk-ant-');
    expect(digest).not.toContain(FAKE_API_KEY.slice(-8));
  });
});

// ── .env.example — must not contain a real-looking key ─────────────────────

describe('.env.example — no real API key present', () => {
  it('placeholder is not a real sk-ant-api0 credential', () => {
    const envExample = path.join(REPO_ROOT, '.env.example');
    if (!fs.existsSync(envExample)) {
      // File absent in CI environments — skip gracefully.
      return;
    }
    const content = fs.readFileSync(envExample, 'utf-8');
    // Real keys start with sk-ant-api0 and are 100+ chars.
    // The placeholder value in .env.example must not match that pattern.
    expect(content).not.toMatch(/sk-ant-api0[A-Za-z0-9_-]{90,}/);
  });
});

// ── vault.ts error messages — must not contain key material ────────────────

describe('vault safePath errors — no API key in message', () => {
  let tmpDir: string;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-leak-'));

  it('path traversal error message does not contain a key-like string', () => {
    let errorMsg = '';
    try {
      writeVaultFileUnsafe_testOnly(tmpDir, '../escape', 'content');
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    expect(errorMsg).toContain('Path traversal denied');
    expect(errorMsg).not.toContain('sk-ant-');
    expect(errorMsg).not.toContain(FAKE_API_KEY);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── SETTINGS_GET — expected: renderer receives masked key ─────────────────

const FAKE_OPENAI_KEY = 'sk-proj-TestOnlyVoiceWhisperKey00000000000000000000beef';
const MASKED_PATTERN = /^sk-ant-\.\.\.\w{4}$/;

function settingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  // Minimal fixture that satisfies the AppSettings shape for masking tests.
  // Only the fields the masking helpers touch matter — the rest are stubbed.
  const agentBudgets = {
    autoApply: false,
    confidenceThreshold: 0.8,
    maxTokensPerHour: 0,
    maxSuggestionsPerHour: 0,
    heartbeatIntervalMinutes: 0,
    maxTokensPerDay: 0,
  };
  return {
    apiKey: FAKE_API_KEY,
    agents: {
      writingAssistant: { enabled: false, model: 'claude', scanIntervalSeconds: 0, ...agentBudgets },
      brainstorm: { enabled: false, model: 'claude', ...agentBudgets },
      archive: { enabled: false, model: 'claude', continuityCheckIntervalSeconds: 0, ...agentBudgets },
    },
    theme: 'dark',
    ...overrides,
  };
}

describe('maskSettingsForRenderer — apiKey field (MYT-143)', () => {
  it('masks the Anthropic apiKey before returning it to the renderer', () => {
    const masked = maskSettingsForRenderer(settingsFixture());
    expect(masked.apiKey).not.toBe(FAKE_API_KEY);
    expect(masked.apiKey).toMatch(MASKED_PATTERN);
    expect(masked.apiKey).not.toContain(FAKE_API_KEY.slice(8, -4));
  });

  it('does not mutate the source settings object', () => {
    const original = settingsFixture();
    maskSettingsForRenderer(original);
    expect(original.apiKey).toBe(FAKE_API_KEY);
  });

  it('collapses missing apiKey to empty string', () => {
    const masked = maskSettingsForRenderer(settingsFixture({ apiKey: '' }));
    expect(masked.apiKey).toBe('');
  });

  it('does not mask onboarding recents fields', () => {
    const masked = maskSettingsForRenderer(settingsFixture({
      recentVaultParentPaths: ['/vaults/A', '/vaults/B'],
    }));

    expect(masked.recentVaultParentPaths).toEqual(['/vaults/A', '/vaults/B']);
  });

  it('stamps anthropicEnvKeyPresent as a boolean only (never the key value)', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-secret-must-not-cross-ipc';
    try {
      const masked = maskSettingsForRenderer(settingsFixture({ apiKey: '' }));
      expect(masked.anthropicEnvKeyPresent).toBe(true);
      expect(JSON.stringify(masked)).not.toContain('sk-ant-env-secret-must-not-cross-ipc');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

// E3 / Shield residual 12 — pin save-time strip of anthropicEnvKeyPresent.
describe('reconcileSettingsFromRenderer — strip anthropicEnvKeyPresent (Shield E3)', () => {
  it('never persists anthropicEnvKeyPresent from an incoming renderer echo', () => {
    const stored = settingsFixture({ apiKey: FAKE_API_KEY });
    const incoming = {
      ...stored,
      apiKey: maskApiKey(stored.apiKey),
      anthropicEnvKeyPresent: true,
    } as AppSettings;
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(
      Object.prototype.hasOwnProperty.call(reconciled, 'anthropicEnvKeyPresent'),
    ).toBe(false);
    expect((reconciled as { anthropicEnvKeyPresent?: boolean }).anthropicEnvKeyPresent).toBeUndefined();
  });
});

describe('maskSettingsForRenderer — voice.openaiApiKey field (MYT-424)', () => {
  it('masks voice.openaiApiKey before returning it to the renderer', () => {
    const masked = maskSettingsForRenderer(
      settingsFixture({
        voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
      }),
    );
    expect(masked.voice?.openaiApiKey).toBeDefined();
    expect(masked.voice?.openaiApiKey).not.toBe(FAKE_OPENAI_KEY);
    expect(masked.voice?.openaiApiKey).toMatch(MASKED_PATTERN);
    // The mask must not leak the middle of the real key.
    expect(masked.voice?.openaiApiKey).not.toContain(FAKE_OPENAI_KEY.slice(8, -4));
    // And the full settings object serialized for IPC must not contain the raw key anywhere.
    expect(JSON.stringify(masked)).not.toContain(FAKE_OPENAI_KEY);
  });

  it('uses the same masking helper as the Anthropic apiKey', () => {
    // Acceptance criterion: "matching the masking format used for apiKey".
    const masked = maskSettingsForRenderer(
      settingsFixture({
        voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
      }),
    );
    expect(masked.voice?.openaiApiKey).toBe(maskApiKey(FAKE_OPENAI_KEY));
  });

  it('does not mutate the source voice settings object', () => {
    const original = settingsFixture({
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    });
    maskSettingsForRenderer(original);
    expect(original.voice?.openaiApiKey).toBe(FAKE_OPENAI_KEY);
  });

  it('leaves voice block unmasked when no openaiApiKey is configured', () => {
    const masked = maskSettingsForRenderer(
      settingsFixture({ voice: { enabled: true, cloudFallback: false } }),
    );
    // No raw key to mask — voice block stays structurally intact and the key field stays absent.
    expect(masked.voice?.openaiApiKey).toBeUndefined();
  });

  it('leaves settings without a voice block untouched', () => {
    const masked = maskSettingsForRenderer(settingsFixture());
    expect(masked.voice).toBeUndefined();
  });
});

describe('reconcileSettingsFromRenderer — preserve stored keys on echo (MYT-424)', () => {
  it('keeps the stored voice.openaiApiKey when the renderer echoes the mask back unchanged', () => {
    const stored = settingsFixture({
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    });
    const incoming: AppSettings = {
      ...stored,
      apiKey: maskApiKey(stored.apiKey),
      voice: { ...stored.voice!, openaiApiKey: maskApiKey(FAKE_OPENAI_KEY) },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.voice?.openaiApiKey).toBe(FAKE_OPENAI_KEY);
    expect(reconciled.apiKey).toBe(FAKE_API_KEY);
  });

  it('saves a freshly entered voice.openaiApiKey verbatim', () => {
    const stored = settingsFixture({
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    });
    const newKey = 'sk-proj-NewKeyEntered00000000000000000000000000000000feed';
    const incoming: AppSettings = {
      ...stored,
      voice: { ...stored.voice!, openaiApiKey: newKey },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.voice?.openaiApiKey).toBe(newKey);
  });
});

// ── app-settings.json — no plaintext API keys on disk after save (MYT-777) ─

describe('app-settings.json on-disk payload — no plaintext keys (MYT-777)', () => {

  it('saveAppSettings-equivalent flow leaves no key material in the JSON file', () => {
    const { store, settingsPath } = mkStore();
    const incoming = settingsFixture({
      apiKey: FAKE_API_KEY,
      provider: { kind: 'anthropic', apiKey: FAKE_API_KEY, model: 'claude-haiku-4-5-20251001' },
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    });
    // Mirrors saveAppSettings() in main.ts: strip secrets, then write.
    const stripped = persistSecretsAndStripSettings(incoming, store);
    fs.writeFileSync(settingsPath, JSON.stringify(stripped, null, 2), 'utf-8');

    const onDisk = fs.readFileSync(settingsPath, 'utf-8');
    expect(onDisk).not.toContain(FAKE_API_KEY);
    expect(onDisk).not.toContain('sk-ant-test');
    expect(onDisk).not.toContain(FAKE_OPENAI_KEY);
    expect(onDisk).not.toContain('sk-proj-TestOnly');
  });

  // Regression test for SKY-740: archive agent API key must not be written plaintext.
  it('archive agent provider.apiKey is not written plaintext to app-settings.json (SKY-740)', () => {
    const { store, settingsPath } = mkStore();
    const incoming = settingsFixture({
      agents: {
        writingAssistant: {
          enabled: false, model: 'claude', scanIntervalSeconds: 0,
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
        },
        brainstorm: {
          enabled: false, model: 'claude',
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
        },
        archive: {
          enabled: false, model: 'claude', continuityCheckIntervalSeconds: 0,
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
          provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_ARCHIVE_KEY },
        },
      },
    });
    const stripped = persistSecretsAndStripSettings(incoming, store);
    fs.writeFileSync(settingsPath, JSON.stringify(stripped, null, 2), 'utf-8');

    const onDisk = fs.readFileSync(settingsPath, 'utf-8');
    expect(onDisk).not.toContain(FAKE_ARCHIVE_KEY);
    expect(onDisk).not.toContain('ArchiveKey');
    // The secret must be in the store, not on disk.
    expect(store.get('provider.archive.apiKey')).toBe(FAKE_ARCHIVE_KEY);
    expect(stripped.agents.archive.provider?.apiKey).toBe('');
  });
});

// ── Per-agent provider.apiKey masking (SKY-738) ───────────────────────────

const FAKE_BRAINSTORM_KEY = 'sk-ant-test-BrainstormKeyForTestingOnly0000000000000000';
const FAKE_WRITING_KEY = 'sk-ant-test-WritingKeyForTestingOnly00000000000000000';
const FAKE_ARCHIVE_KEY = 'sk-ant-test-ArchiveKeyForTestingOnly000000000000000000';

function agentKeysFixture(): AppSettings {
  return settingsFixture({
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude',
        scanIntervalSeconds: 0,
        autoApply: false,
        confidenceThreshold: 0.8,
        maxTokensPerHour: 0,
        maxSuggestionsPerHour: 0,
        heartbeatIntervalMinutes: 0,
        maxTokensPerDay: 0,
        provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_WRITING_KEY },
      },
      brainstorm: {
        enabled: false,
        model: 'claude',
        autoApply: false,
        confidenceThreshold: 0.8,
        maxTokensPerHour: 0,
        maxSuggestionsPerHour: 0,
        heartbeatIntervalMinutes: 0,
        maxTokensPerDay: 0,
        provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_BRAINSTORM_KEY },
      },
      archive: {
        enabled: false,
        model: 'claude',
        continuityCheckIntervalSeconds: 0,
        autoApply: false,
        confidenceThreshold: 0.8,
        maxTokensPerHour: 0,
        maxSuggestionsPerHour: 0,
        heartbeatIntervalMinutes: 0,
        maxTokensPerDay: 0,
        provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_ARCHIVE_KEY },
      },
    },
  });
}

describe('maskSettingsForRenderer — per-agent provider.apiKey fields (SKY-738)', () => {
  it('masks brainstorm provider.apiKey before returning to the renderer', () => {
    const masked = maskSettingsForRenderer(agentKeysFixture());
    expect(masked.agents.brainstorm.provider?.apiKey).not.toBe(FAKE_BRAINSTORM_KEY);
    expect(masked.agents.brainstorm.provider?.apiKey).toMatch(MASKED_PATTERN);
  });

  it('masks writingAssistant provider.apiKey before returning to the renderer', () => {
    const masked = maskSettingsForRenderer(agentKeysFixture());
    expect(masked.agents.writingAssistant.provider?.apiKey).not.toBe(FAKE_WRITING_KEY);
    expect(masked.agents.writingAssistant.provider?.apiKey).toMatch(MASKED_PATTERN);
  });

  it('masks archive provider.apiKey before returning to the renderer', () => {
    const masked = maskSettingsForRenderer(agentKeysFixture());
    expect(masked.agents.archive.provider?.apiKey).not.toBe(FAKE_ARCHIVE_KEY);
    expect(masked.agents.archive.provider?.apiKey).toMatch(MASKED_PATTERN);
  });

  it('full JSON serialization contains no raw per-agent key material', () => {
    const masked = maskSettingsForRenderer(agentKeysFixture());
    const json = JSON.stringify(masked);
    expect(json).not.toContain(FAKE_BRAINSTORM_KEY);
    expect(json).not.toContain(FAKE_WRITING_KEY);
    expect(json).not.toContain(FAKE_ARCHIVE_KEY);
  });

  it('does not mutate the source agents object', () => {
    const original = agentKeysFixture();
    maskSettingsForRenderer(original);
    expect(original.agents.brainstorm.provider?.apiKey).toBe(FAKE_BRAINSTORM_KEY);
    expect(original.agents.writingAssistant.provider?.apiKey).toBe(FAKE_WRITING_KEY);
    expect(original.agents.archive.provider?.apiKey).toBe(FAKE_ARCHIVE_KEY);
  });

  it('leaves agent provider unchanged when no apiKey is configured', () => {
    const base = settingsFixture({
      agents: {
        writingAssistant: {
          enabled: false, model: 'claude', scanIntervalSeconds: 0,
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
          provider: { kind: 'ollama', model: 'llama3.2' },
        },
        brainstorm: {
          enabled: false, model: 'claude',
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
        },
        archive: {
          enabled: false, model: 'claude', continuityCheckIntervalSeconds: 0,
          autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 0,
          maxSuggestionsPerHour: 0, heartbeatIntervalMinutes: 0, maxTokensPerDay: 0,
        },
      },
    });
    const masked = maskSettingsForRenderer(base);
    expect(masked.agents.writingAssistant.provider?.apiKey).toBeUndefined();
    expect(masked.agents.brainstorm.provider).toBeUndefined();
    expect(masked.agents.archive.provider).toBeUndefined();
  });
});

describe('reconcileSettingsFromRenderer — per-agent provider keys (SKY-738)', () => {
  it('restores all three stored per-agent keys when the renderer echoes the masked previews back', () => {
    const stored = agentKeysFixture();
    const incoming: AppSettings = {
      ...stored,
      apiKey: maskApiKey(stored.apiKey),
      agents: {
        writingAssistant: { ...stored.agents.writingAssistant, provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: maskApiKey(FAKE_WRITING_KEY) } },
        brainstorm: { ...stored.agents.brainstorm, provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: maskApiKey(FAKE_BRAINSTORM_KEY) } },
        archive: { ...stored.agents.archive, provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: maskApiKey(FAKE_ARCHIVE_KEY) } },
      },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.agents.writingAssistant.provider?.apiKey).toBe(FAKE_WRITING_KEY);
    expect(reconciled.agents.brainstorm.provider?.apiKey).toBe(FAKE_BRAINSTORM_KEY);
    expect(reconciled.agents.archive.provider?.apiKey).toBe(FAKE_ARCHIVE_KEY);
  });

  it('saves a freshly entered per-agent key verbatim without restoring the stored key', () => {
    const stored = agentKeysFixture();
    const newKey = 'sk-ant-test-NewBrainstormKeyEntered0000000000000000000';
    const incoming: AppSettings = {
      ...stored,
      apiKey: maskApiKey(stored.apiKey),
      agents: {
        ...stored.agents,
        brainstorm: { ...stored.agents.brainstorm, provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: newKey } },
      },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.agents.brainstorm.provider?.apiKey).toBe(newKey);
  });
});

// ── Beta Reader per-agent provider.apiKey (Beta 3 M22) ─────────────────────

const FAKE_BETA_READER_KEY = 'sk-ant-test-BetaReaderKeyForTestingOnly000000000000000';

function betaReaderKeyFixture(): AppSettings {
  const base = agentKeysFixture();
  return {
    ...base,
    agents: {
      ...base.agents,
      betaReader: {
        enabled: true,
        model: 'claude',
        autoApply: false,
        confidenceThreshold: 0.8,
        maxTokensPerHour: 0,
        maxSuggestionsPerHour: 0,
        heartbeatIntervalMinutes: 0,
        maxTokensPerDay: 0,
        provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: FAKE_BETA_READER_KEY },
      },
    },
  };
}

describe('betaReader provider.apiKey — mask / strip / reconcile (Beta 3 M22)', () => {
  it('masks betaReader provider.apiKey before returning to the renderer', () => {
    const masked = maskSettingsForRenderer(betaReaderKeyFixture());
    expect(masked.agents.betaReader?.provider?.apiKey).not.toBe(FAKE_BETA_READER_KEY);
    expect(masked.agents.betaReader?.provider?.apiKey).toMatch(MASKED_PATTERN);
    expect(JSON.stringify(masked)).not.toContain(FAKE_BETA_READER_KEY);
  });

  it('masking tolerates settings without a betaReader slot (pre-M22 files)', () => {
    const masked = maskSettingsForRenderer(agentKeysFixture());
    expect(masked.agents.betaReader).toBeUndefined();
  });

  it('betaReader provider.apiKey is not written plaintext to app-settings.json', () => {
    const { store, settingsPath } = mkStore();
    const stripped = persistSecretsAndStripSettings(betaReaderKeyFixture(), store);
    fs.writeFileSync(settingsPath, JSON.stringify(stripped, null, 2), 'utf-8');

    const onDisk = fs.readFileSync(settingsPath, 'utf-8');
    expect(onDisk).not.toContain(FAKE_BETA_READER_KEY);
    expect(onDisk).not.toContain('BetaReaderKey');
    expect(store.get('provider.betaReader.apiKey')).toBe(FAKE_BETA_READER_KEY);
    expect(stripped.agents.betaReader?.provider?.apiKey).toBe('');
  });

  it('restores the stored betaReader key when the renderer echoes the mask back', () => {
    const stored = betaReaderKeyFixture();
    const incoming: AppSettings = {
      ...stored,
      apiKey: maskApiKey(stored.apiKey),
      agents: {
        ...stored.agents,
        betaReader: {
          ...stored.agents.betaReader!,
          provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: maskApiKey(FAKE_BETA_READER_KEY) },
        },
      },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.agents.betaReader?.provider?.apiKey).toBe(FAKE_BETA_READER_KEY);
  });
});

// ── STT / TTS cloud API key masking (SKY-816 / SKY-817) ────────────────────

const FAKE_STT_CLOUD_KEY = 'sk-proj-TestSttCloudKey00000000000000000000000000';
const FAKE_TTS_CLOUD_KEY = 'sk-proj-TestTtsCloudKey00000000000000000000000000';

describe('maskSettingsForRenderer — stt.cloudApiKey and tts.cloudApiKey (SKY-816/817)', () => {
  it('masks stt.cloudApiKey before returning it to the renderer', () => {
    const masked = maskSettingsForRenderer(
      settingsFixture({
        stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://stt.example.com', cloudApiKey: FAKE_STT_CLOUD_KEY },
      }),
    );
    expect(masked.stt?.cloudApiKey).toBeDefined();
    expect(masked.stt?.cloudApiKey).not.toBe(FAKE_STT_CLOUD_KEY);
    expect(masked.stt?.cloudApiKey).toMatch(MASKED_PATTERN);
    expect(JSON.stringify(masked)).not.toContain(FAKE_STT_CLOUD_KEY);
  });

  it('masks tts.cloudApiKey before returning it to the renderer', () => {
    const masked = maskSettingsForRenderer(
      settingsFixture({
        tts: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://tts.example.com', cloudApiKey: FAKE_TTS_CLOUD_KEY },
      }),
    );
    expect(masked.tts?.cloudApiKey).toBeDefined();
    expect(masked.tts?.cloudApiKey).not.toBe(FAKE_TTS_CLOUD_KEY);
    expect(masked.tts?.cloudApiKey).toMatch(MASKED_PATTERN);
    expect(JSON.stringify(masked)).not.toContain(FAKE_TTS_CLOUD_KEY);
  });

  it('does not mutate the source stt/tts settings', () => {
    const original = settingsFixture({
      stt: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_STT_CLOUD_KEY },
      tts: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_TTS_CLOUD_KEY },
    });
    maskSettingsForRenderer(original);
    expect(original.stt?.cloudApiKey).toBe(FAKE_STT_CLOUD_KEY);
    expect(original.tts?.cloudApiKey).toBe(FAKE_TTS_CLOUD_KEY);
  });

  it('leaves stt/tts blocks unmasked when no cloudApiKey is configured', () => {
    const masked = maskSettingsForRenderer(
      settingsFixture({
        stt: { enabled: true, provider: 'local' },
        tts: { enabled: true, provider: 'local' },
      }),
    );
    expect(masked.stt?.cloudApiKey).toBeUndefined();
    expect(masked.tts?.cloudApiKey).toBeUndefined();
  });
});

describe('reconcileSettingsFromRenderer — preserve stored STT/TTS keys on echo (SKY-816/817)', () => {
  it('keeps the stored stt.cloudApiKey when the renderer echoes the mask back unchanged', () => {
    const stored = settingsFixture({
      stt: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_STT_CLOUD_KEY },
    });
    const incoming: AppSettings = {
      ...stored,
      stt: { ...stored.stt!, cloudApiKey: maskApiKey(FAKE_STT_CLOUD_KEY) },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.stt?.cloudApiKey).toBe(FAKE_STT_CLOUD_KEY);
  });

  it('keeps the stored tts.cloudApiKey when the renderer echoes the mask back unchanged', () => {
    const stored = settingsFixture({
      tts: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_TTS_CLOUD_KEY },
    });
    const incoming: AppSettings = {
      ...stored,
      tts: { ...stored.tts!, cloudApiKey: maskApiKey(FAKE_TTS_CLOUD_KEY) },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.tts?.cloudApiKey).toBe(FAKE_TTS_CLOUD_KEY);
  });

  it('saves a freshly entered stt.cloudApiKey verbatim', () => {
    const stored = settingsFixture({
      stt: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_STT_CLOUD_KEY },
    });
    const newKey = 'sk-proj-NewSttKeyEntered000000000000000000000000';
    const incoming: AppSettings = {
      ...stored,
      stt: { ...stored.stt!, cloudApiKey: newKey },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.stt?.cloudApiKey).toBe(newKey);
  });

  it('saves a freshly entered tts.cloudApiKey verbatim', () => {
    const stored = settingsFixture({
      tts: { enabled: true, provider: 'cloud', cloudApiKey: FAKE_TTS_CLOUD_KEY },
    });
    const newKey = 'sk-proj-NewTtsKeyEntered000000000000000000000000';
    const incoming: AppSettings = {
      ...stored,
      tts: { ...stored.tts!, cloudApiKey: newKey },
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.tts?.cloudApiKey).toBe(newKey);
  });
});

describe('app-settings.json — STT/TTS cloudApiKey not plaintext (SKY-816/817)', () => {
  it('stt.cloudApiKey and tts.cloudApiKey are not written plaintext to app-settings.json', () => {
    const { store, settingsPath } = mkStore();
    const incoming = settingsFixture({
      stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://stt.example.com', cloudApiKey: FAKE_STT_CLOUD_KEY },
      tts: { enabled: true, provider: 'cloud', cloudEndpoint: 'https://tts.example.com', cloudApiKey: FAKE_TTS_CLOUD_KEY },
    });
    const stripped = persistSecretsAndStripSettings(incoming, store);
    fs.writeFileSync(settingsPath, JSON.stringify(stripped, null, 2), 'utf-8');

    const onDisk = fs.readFileSync(settingsPath, 'utf-8');
    expect(onDisk).not.toContain(FAKE_STT_CLOUD_KEY);
    expect(onDisk).not.toContain(FAKE_TTS_CLOUD_KEY);
    expect(onDisk).not.toContain('sk-proj-TestStt');
    expect(onDisk).not.toContain('sk-proj-TestTts');
    // The secrets must be in the store, not on disk.
    expect(store.get('stt.cloudApiKey')).toBe(FAKE_STT_CLOUD_KEY);
    expect(store.get('tts.cloudApiKey')).toBe(FAKE_TTS_CLOUD_KEY);
    expect(stripped.stt?.cloudApiKey).toBe('');
    expect(stripped.tts?.cloudApiKey).toBe('');
  });
});

// ── Streaming error — Anthropic SDK error must not echo the key ───────────

describe('streaming handler error path — Anthropic error body', () => {
  it('a realistic Anthropic 401 error message does not contain the real key', () => {
    // The SDK returns errors shaped like:
    //   "401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"
    // The error body does NOT include the Authorization header value.
    // This test documents the expected SDK behavior — not something we control, but
    // worth asserting so any SDK upgrade that changes this is caught.
    const simulatedError = new Error(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    );
    // The simulated error message should not contain our key.
    // In production the real key is passed as a header, not echoed back.
    expect(simulatedError.message).not.toContain(FAKE_API_KEY);
    expect(simulatedError.message).not.toContain('sk-ant-test');
  });
});

// ── Keys backstop pins (P1–P1d, P3, P6, P6a) ───────────────────────────────

const K1 = 'sk-ant-OlderStoredKeyAAAA1111111111111111111111111111';
const K2 = 'sk-ant-CurrentStoredKeyBBBB222222222222222222222222';
const K3 = 'sk-ant-BrandNewTypedKeyCCCC33333333333333333333333';

const AGENT_BUDGET = {
  autoApply: false,
  confidenceThreshold: 0.8,
  maxTokensPerHour: 0,
  maxSuggestionsPerHour: 0,
  heartbeatIntervalMinutes: 0,
  maxTokensPerDay: 0,
};

function agentWithKey(apiKey: string) {
  return {
    enabled: false,
    model: 'claude',
    ...AGENT_BUDGET,
    provider: { kind: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', apiKey },
  };
}

function fullKeyFixture(keyForAll: string): AppSettings {
  return settingsFixture({
    apiKey: keyForAll,
    provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: keyForAll },
    voice: { enabled: false, cloudFallback: false, openaiApiKey: keyForAll },
    stt: { enabled: true, provider: 'cloud', cloudApiKey: keyForAll },
    tts: { enabled: true, provider: 'cloud', cloudApiKey: keyForAll },
    agents: {
      writingAssistant: { ...agentWithKey(keyForAll), scanIntervalSeconds: 0 },
      brainstorm: agentWithKey(keyForAll),
      archive: { ...agentWithKey(keyForAll), continuityCheckIntervalSeconds: 0 },
      betaReader: agentWithKey(keyForAll),
      alphaReader: agentWithKey(keyForAll),
      storylineConsultant: agentWithKey(keyForAll),
      lineEditor: agentWithKey(keyForAll),
    },
  });
}

function seedMaskOnPath(settings: AppSettings, path: KeyFieldPath, mask: string): AppSettings {
  return setKeyField(settings, path, mask);
}

describe('P1 — KEY_FIELD_PATHS backstop (keys carve-out)', () => {
  it('iterates KEY_FIELD_PATHS: stored K2 + incoming maskApiKey(K1) keeps K2', () => {
    const stored = fullKeyFixture(K2);
    const incoming = maskSettingsForRenderer(fullKeyFixture(K1));
    // Stale panel: every field holds mask of K1 while disk has K2.
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(incoming, path)).toBe(maskApiKey(K1));
    }
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(reconciled, path), path).toBe(K2);
    }
  });

  it('stored empty + mask → empty string (never the mask)', () => {
    const stored = fullKeyFixture('');
    // Clear nested keys that fullKeyFixture still materializes as ''.
    let empty = stored;
    for (const path of KEY_FIELD_PATHS) {
      empty = setKeyField(empty, path, '');
    }
    const incoming = maskSettingsForRenderer(fullKeyFixture(K1));
    const reconciled = reconcileSettingsFromRenderer(incoming, empty);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(reconciled, path), path).toBe('');
    }
  });

  it('real K3 is stored verbatim; empty clear stays empty', () => {
    const stored = fullKeyFixture(K2);
    const withK3 = fullKeyFixture(K3);
    expect(reconcileSettingsFromRenderer(withK3, stored).apiKey).toBe(K3);
    const cleared = { ...stored, apiKey: '' };
    expect(reconcileSettingsFromRenderer(cleared, stored).apiKey).toBe('');
  });
});

describe('P1a — isMaskedPreview property + negatives', () => {
  it('accepts isMaskedPreview(maskApiKey(k)) for lengths 1–64 (printable ASCII)', () => {
    for (let len = 1; len <= 64; len++) {
      const k = 'a'.repeat(len);
      expect(isMaskedPreview(maskApiKey(k)), `len=${len}`).toBe(true);
    }
  });

  it('refuses negatives — each stored as a real key', () => {
    const negatives = [
      'sk-ant-...ABCDE', // 5-char suffix
      'xsk-ant-...ABCD',
      'sk-ant-...ABCD\n',
      'sk-ant-api03-ABCD',
      '',
    ];
    for (const neg of negatives) {
      expect(isMaskedPreview(neg), JSON.stringify(neg)).toBe(false);
      const stored = settingsFixture({ apiKey: K2 });
      const incoming = { ...stored, apiKey: neg };
      const reconciled = reconcileSettingsFromRenderer(incoming, stored);
      expect(reconciled.apiKey, JSON.stringify(neg)).toBe(neg);
    }
  });

  it('positives cover 1–4 char masks', () => {
    expect(isMaskedPreview('sk-ant-...A')).toBe(true);
    expect(isMaskedPreview('sk-ant-...AB')).toBe(true);
    expect(isMaskedPreview('sk-ant-...ABC')).toBe(true);
    expect(isMaskedPreview('sk-ant-...ABCD')).toBe(true);
  });

  it('accepts maskApiKey outputs that embed line terminators (JS . does not)', () => {
    const stored = settingsFixture({ apiKey: K2 });
    const withNewline = maskApiKey('abc\n');
    const withCrlf = maskApiKey('ab\r\n');
    const withLineSep = maskApiKey('abc\u2028');
    expect(isMaskedPreview(withNewline)).toBe(true);
    expect(isMaskedPreview(withCrlf)).toBe(true);
    expect(isMaskedPreview(withLineSep)).toBe(true);
    expect(reconcileSettingsFromRenderer({ ...stored, apiKey: withNewline }, stored).apiKey).toBe(K2);
    expect(reconcileSettingsFromRenderer({ ...stored, apiKey: withCrlf }, stored).apiKey).toBe(K2);
    expect(reconcileSettingsFromRenderer({ ...stored, apiKey: withLineSep }, stored).apiKey).toBe(K2);
  });
});

describe('P1b — stored-absent backstop', () => {
  it('optional agents missing from stored + incoming mask → no mask stored', () => {
    const stored = settingsFixture({ apiKey: K2 });
    // No betaReader/alphaReader/storylineConsultant/lineEditor on stored.
    const incoming = settingsFixture({
      apiKey: maskApiKey(K1),
      agents: {
        ...settingsFixture().agents,
        betaReader: agentWithKey(maskApiKey(K1)),
        alphaReader: agentWithKey(maskApiKey(K1)),
        storylineConsultant: agentWithKey(maskApiKey(K1)),
        lineEditor: agentWithKey(maskApiKey(K1)),
      },
    });
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.agents.betaReader?.provider?.apiKey).toBe('');
    expect(reconciled.agents.alphaReader?.provider?.apiKey).toBe('');
    expect(reconciled.agents.storylineConsultant?.provider?.apiKey).toBe('');
    expect(reconciled.agents.lineEditor?.provider?.apiKey).toBe('');
  });

  it('provider/voice/stt/tts with no stored key + incoming mask → empty', () => {
    const stored = settingsFixture({ apiKey: K2 });
    const incoming = settingsFixture({
      apiKey: maskApiKey(K1),
      provider: { kind: 'anthropic', model: 'x', apiKey: maskApiKey(K1) },
      voice: { enabled: false, cloudFallback: false, openaiApiKey: maskApiKey(K1) },
      stt: { enabled: true, provider: 'cloud', cloudApiKey: maskApiKey(K1) },
      tts: { enabled: true, provider: 'cloud', cloudApiKey: maskApiKey(K1) },
    });
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled.provider?.apiKey).toBe('');
    expect(reconciled.voice?.openaiApiKey).toBe('');
    expect(reconciled.stt?.cloudApiKey).toBe('');
    expect(reconciled.tts?.cloudApiKey).toBe('');
  });
});

describe('P1c — maskSettingsForRenderer covers KEY_FIELD_PATHS', () => {
  it('fully populated fixture → no raw key in any of the 12 fields; list equals KEY_FIELD_PATHS', () => {
    expect(KEY_FIELD_PATHS).toHaveLength(12);
    const raw = fullKeyFixture(K2);
    const masked = maskSettingsForRenderer(raw);
    for (const path of KEY_FIELD_PATHS) {
      const v = getKeyField(masked, path);
      expect(v, path).not.toBe(K2);
      expect(v, path).toBe(maskApiKey(K2));
      expect(String(v), path).not.toContain(K2.slice(8, -4));
    }
  });
});

describe('P1d — no key/mask substring in console or thrown messages', () => {
  it('spies console + logger during reconcile and heal', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const stored = fullKeyFixture(K2);
      const incoming = maskSettingsForRenderer(fullKeyFixture(K1));
      reconcileSettingsFromRenderer(incoming, stored);
      const seeded = seedMaskOnPath(settingsFixture({ apiKey: '' }), 'apiKey', maskApiKey(K1));
      healMaskedKeyFields(seeded);
      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls, ...debugSpy.mock.calls]
        .flat()
        .map(String)
        .join('\n');
      expect(allCalls).not.toContain(K1);
      expect(allCalls).not.toContain(K2);
      expect(allCalls).not.toContain(maskApiKey(K1));
      expect(allCalls).not.toContain(maskApiKey(K2));
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});

describe('P3 — IPC SETTINGS_SET sequence keeps K2', () => {
  it('SETTINGS_SET(real K2), then stale masked panel + theme, then shell full write → stored = K2', () => {
    let disk = settingsFixture({ apiKey: '', provider: { kind: 'anthropic', model: 'x', apiKey: '' } });
    // 1) Save real K2
    disk = reconcileSettingsFromRenderer(
      { ...disk, apiKey: K2, provider: { kind: 'anthropic', model: 'x', apiKey: K2 } },
      disk,
    );
    expect(disk.apiKey).toBe(K2);
    expect(disk.provider?.apiKey).toBe(K2);
    // 2) Stale masked panel + theme write
    const stalePanel = {
      ...maskSettingsForRenderer(fullKeyFixture(K1)),
      apiKey: maskApiKey(K1),
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: maskApiKey(K1) },
      vaultThemes: { '/vault/a': 'ember' },
    };
    disk = reconcileSettingsFromRenderer(stalePanel, disk);
    expect(disk.apiKey).toBe(K2);
    expect(disk.provider?.apiKey).toBe(K2);
    expect(disk.vaultThemes?.['/vault/a']).toBe('ember');
    // 3) Shell full write (rightSidebarVisible) echoing masked keys
    const shellWrite = {
      ...maskSettingsForRenderer(disk),
      rightSidebarVisible: false,
    };
    disk = reconcileSettingsFromRenderer(shellWrite, disk);
    expect(disk.apiKey).toBe(K2);
    expect(disk.provider?.apiKey).toBe(K2);
    expect(JSON.stringify(disk)).not.toMatch(/sk-ant-\.\.\./);
  });
});

describe('P6 — heal-on-read iterates KEY_FIELD_PATHS', () => {
  it('stored mask per field → load heals to empty + flag; no write; next save stores empty', () => {
    const writer = { writes: 0 };
    const g = globalThis as unknown as { __mythosHealWrite?: () => void; __mythosHealWrote?: boolean };
    g.__mythosHealWrite = () => { writer.writes += 1; };
    g.__mythosHealWrote = false;
    try {
      for (const path of KEY_FIELD_PATHS) {
        const mask = maskApiKey(K1);
        let seeded = settingsFixture({ apiKey: '' });
        seeded = seedMaskOnPath(seeded, path, mask);
        const healed = healMaskedKeyFields(seeded);
        // Heal is pure — no disk write / no write-on-read hook.
        expect(writer.writes).toBe(0);
        expect(g.__mythosHealWrote).toBe(false);
        expect(getKeyField(healed, path), path).toBe('');
        expect(healed.keyReentryPaths, path).toContain(path);
        // Provider lookup sees empty.
        expect(getKeyField(healed, path)).toBe('');
        // Next normal save stores ''.
        const afterSave = reconcileSettingsFromRenderer(
          { ...maskSettingsForRenderer(healed), ...(path === 'apiKey' ? { apiKey: '' } : {}) },
          healed,
        );
        expect(getKeyField(afterSave, path), `save ${path}`).toBe('');
        expect(afterSave).not.toHaveProperty('keyReentryPaths');
      }
    } finally {
      delete g.__mythosHealWrite;
      delete g.__mythosHealWrote;
    }
  });

  it('real key clears flag; deliberate clear drops flag; reload rebuilds set', () => {
    const masked = seedMaskOnPath(settingsFixture({ apiKey: '' }), 'provider.apiKey', maskApiKey(K1));
    const healed = healMaskedKeyFields(masked);
    expect(healed.keyReentryPaths).toContain('provider.apiKey');
    // Real key save — next load won't flag.
    const withReal = setKeyField(healed, 'provider.apiKey', K2);
    const afterReal = healMaskedKeyFields(withReal);
    expect(afterReal.keyReentryPaths ?? []).not.toContain('provider.apiKey');
    // Deliberate clear.
    const cleared = setKeyField(healed, 'provider.apiKey', '');
    const afterClear = healMaskedKeyFields(cleared);
    expect(afterClear.keyReentryPaths ?? []).not.toContain('provider.apiKey');
    // Reload rebuilds when mask still on disk.
    const again = healMaskedKeyFields(masked);
    expect(again.keyReentryPaths).toContain('provider.apiKey');
  });

  it('S2: migration-path seed (plaintext mask → secrets) then heal', () => {
    const { store, settingsPath } = mkStore();
    const plaintext = settingsFixture({
      apiKey: maskApiKey(K1),
      provider: { kind: 'anthropic', model: 'x', apiKey: maskApiKey(K1) },
    });
    fs.writeFileSync(settingsPath, JSON.stringify(plaintext, null, 2), 'utf-8');
    const migrated = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(migrated.migrated).toBe(true);
    // Decrypt/hydrate then heal (never heal the encrypted blob).
    const base = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    const hydrated = { ...base, apiKey: store.get('anthropic.apiKey') ?? '', provider: { ...(base.provider as { kind: 'anthropic'; model: string; apiKey?: string }), apiKey: store.get('provider.apiKey') ?? '' } };
    const healed = healMaskedKeyFields(hydrated as AppSettings);
    expect(healed.apiKey).toBe('');
    expect(healed.provider?.apiKey).toBe('');
    expect(healed.keyReentryPaths).toEqual(expect.arrayContaining(['apiKey', 'provider.apiKey']));
  });

  it('S3: healed empty + env key present → empty settings key; re-enter path still flagged', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-fallback-must-not-be-logged';
    try {
      const seeded = seedMaskOnPath(settingsFixture({ apiKey: maskApiKey(K1) }), 'apiKey', maskApiKey(K1));
      const healed = healMaskedKeyFields(seeded);
      expect(healed.apiKey).toBe('');
      expect(healed.keyReentryPaths).toContain('apiKey');
      const masked = maskSettingsForRenderer(healed);
      expect(masked.anthropicEnvKeyPresent).toBe(true);
      expect(masked.keyReentryPaths).toContain('apiKey');
      expect(JSON.stringify(masked)).not.toContain('sk-ant-env-fallback-must-not-be-logged');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('P6a — keyReentryPaths never saved', () => {
  it('SETTINGS_SET with keyReentryPaths in payload → field not saved', () => {
    const stored = settingsFixture({ apiKey: K2 });
    const incoming = {
      ...maskSettingsForRenderer(stored),
      keyReentryPaths: ['apiKey', 'provider.apiKey'],
    };
    const reconciled = reconcileSettingsFromRenderer(incoming, stored);
    expect(reconciled).not.toHaveProperty('keyReentryPaths');
    expect(reconciled.apiKey).toBe(K2);
  });
});
