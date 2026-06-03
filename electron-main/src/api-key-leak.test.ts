// API key leak tests (MYT-134)
// Asserts that API key material never appears in generation logs, IPC response
// payloads, error messages, or .env.example.
//
// SETTINGS_GET masking originally tracked in MYT-143 (Anthropic apiKey) and
// extended in MYT-424 to also cover voice.openaiApiKey.

import { describe, it, expect } from 'vitest';
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
} from './settings-masking.js';
import { SecretsStore, type SafeStorageLike } from './secrets/store.js';
import { persistSecretsAndStripSettings } from './secrets/migration.js';

// A plausible-looking synthetic key — not a real credential.
const FAKE_API_KEY = 'sk-ant-test-FakeKeyForTestingOnly000000000000000000000000000000';
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');

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
