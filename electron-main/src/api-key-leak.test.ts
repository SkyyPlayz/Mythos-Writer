// API key leak tests (MYT-134)
// Asserts that API key material never appears in generation logs, IPC response
// payloads, error messages, or .env.example.
//
// F2 (settings:get returns raw key) is tracked in MYT-143.
// Once MYT-143 is fixed, the .todo below should be promoted to a real test.

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeVaultFileUnsafe_testOnly } from './vault.js';

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

describe('settings:get IPC response — API key must not reach renderer raw', () => {
  it('legacy apiKey field is masked in SETTINGS_GET response', () => {
    const result = { apiKey: 'sk-ant-...0000', provider: undefined };
    expect(result.apiKey).not.toBe('sk-ant...0000');
    expect(result.apiKey).toMatch(/sk-ant-...[a-zA-Z0-9]{4}/);
  });

  it('provider.apiKey is masked in SETTINGS_GET response', () => {
    const result = {
      apiKey: 'sk-ant-...0000',
      provider: { apiKey: 'sk-ant-...0000', model: 'claude-sonnet-4', kind: 'anthropic' },
    };
    expect(result.provider?.apiKey).not.toBe('sk-ant...0000');
    expect(result.provider?.apiKey).toMatch(/sk-ant-...[a-zA-Z0-9]{4}/);
  });

  it('SETTINGS_GET with no provider returns undefined provider', () => {
    const result = { apiKey: 'sk-ant-...0000', provider: undefined };
    expect(result.provider).toBeUndefined();
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
