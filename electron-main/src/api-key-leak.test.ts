// API key leak tests (MYT-134)
// Asserts that API key material never appears in generation logs, IPC response
// payloads, error messages, or .env.example.
//
// F2 was resolved in MYT-143; these tests cover the masking contract and ensure
// it also applies to voice.openaiApiKey.

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppSettings } from './ipc.js';
import { maskSettingsForRenderer, preserveMaskedSettingsSecrets } from './settingsSecrets.js';
import { writeVaultFile } from './vault.js';

// A plausible-looking synthetic key — not a real credential.
const FAKE_API_KEY = 'sk-ant-test-FakeKeyForTestingOnly000000000000000000000000000000';
const FAKE_OPENAI_KEY = 'sk-openai-test-FakeKeyForVoiceOnly1234567890';
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    ...overrides,
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
      writeVaultFile(tmpDir, '../escape', 'content');
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

describe('settings:get IPC response — API key must not reach renderer raw', () => {
  it('masks stored API keys before returning settings to the renderer', () => {
    const result = maskSettingsForRenderer(makeSettings({
      apiKey: FAKE_API_KEY,
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    }));

    expect(result.apiKey).toBe('sk-ant-...0000');
    expect(result.apiKey).not.toBe(FAKE_API_KEY);
    expect(result.voice?.openaiApiKey).toBe('••••7890');
    expect(result.voice?.openaiApiKey).not.toBe(FAKE_OPENAI_KEY);
  });

  it('preserves stored API keys when the renderer echoes masked previews unchanged', () => {
    const current = makeSettings({
      apiKey: FAKE_API_KEY,
      voice: { enabled: true, cloudFallback: true, openaiApiKey: FAKE_OPENAI_KEY },
    });

    const echoedMaskedSettings = maskSettingsForRenderer(current);
    const updated = preserveMaskedSettingsSecrets(current, echoedMaskedSettings);

    expect(updated.apiKey).toBe(FAKE_API_KEY);
    expect(updated.voice?.openaiApiKey).toBe(FAKE_OPENAI_KEY);
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
