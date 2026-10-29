// PLAN-AI-MODES M-1 (audit row 1): Settings "Test connection" is a no-AI
// key and reachability probe. These tests pin the probe's network shape (at
// most one GET, no tokens), which GET each endpoint gets (OpenRouter's key
// endpoint, /models elsewhere), its result mapping, the key-safety rules, the
// shared stored-key resolver, and that main.ts's IPC handlers run with the real
// stored settings in place of the old 1-token ping and the direct Anthropic client.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The handler tests import main.ts; same harness as aiSuggestOnly.handlers.test.ts.
const db = vi.hoisted(() => {
  const bag: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(bag, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (!target[prop]) target[prop] = vi.fn();
      return target[prop];
    },
  });
});
// The settings main.ts's loadAppSettings() returns, when a test sets them.
const settingsOverride = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    disableHardwareAcceleration: vi.fn(),
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
    once: vi.fn(),
    getPath: () => '/tmp/mythos-test-connection',
    getAppPath: () => '/workspace',
    getVersion: () => '0.0.0-test',
    getName: () => 'Mythos Writer',
    requestSingleInstanceLock: () => true,
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
  dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn(), trashItem: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}));
vi.mock('./jobs/jobWorker?nodeWorker', () => ({
  default: () => ({ postMessage() {}, terminate() {}, on() {}, once() {} }),
}));
vi.mock('./db.js', () => db);
vi.mock('./appSettingsLoad.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appSettingsLoad.js')>();
  return {
    ...actual,
    loadAppSettingsFrom: (...args: Parameters<typeof actual.loadAppSettingsFrom>) =>
      (settingsOverride.value as ReturnType<typeof actual.loadAppSettingsFrom> | undefined)
        ?? actual.loadAppSettingsFrom(...args),
  };
});
// The old ping reached Anthropic through the SDK; the spy proves it no longer does.
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
// listModels uses undici's fetch (SKY-11225), so the spy sits there. The rest
// of undici stays real: the guarded GET builds its own Agent dispatcher.
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { fetch as undiciFetch } from 'undici';
import { listModels, setAiMasterGate, AI_DISABLED_MESSAGE, type ProviderKind } from './provider.js';
import {
  probeConnection,
  resolveGlobalStoredApiKey,
  resolveStoredApiKey,
  type StoredKeySettings,
  type VerifyKeyResult,
} from './connectionProbe.js';
import { SETTINGS_DEFAULTS } from './appSettingsLoad.js';
import { handlers } from './main.js';
import { IPC_CHANNELS } from './ipc.js';

const mockFetch = undiciFetch as unknown as ReturnType<typeof vi.fn>;
const MASK = 'sk-ant-...wxyz';
const UNVERIFIED = "but the API key wasn't verified: this endpoint's model list may be public.";
const REENTER = "Your saved key isn't for this provider. Re-enter the API key, then test again.";

// A real Response: the guarded GET reads headers and streams the body.
function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

type FetchCall = { url: string; method: string; headers: Record<string, string> };
function fetchCalls(): FetchCall[] {
  return mockFetch.mock.calls.map(([url, init]) => {
    const opts = (init ?? {}) as { method?: string; headers?: Record<string, string> };
    return { url: String(url), method: (opts.method ?? 'GET').toUpperCase(), headers: opts.headers ?? {} };
  });
}

// storedKey runs the real resolver main.ts wires for Test connection over
// `settings`; verifyOpenRouterKey is a spy so OpenRouter cases never touch the network.
function deps(settings: StoredKeySettings = {}, verify: VerifyKeyResult = { ok: true }) {
  let t = 1000;
  return {
    listModels,
    verifyOpenRouterKey: vi.fn(async (_payload: { baseUrl: string; apiKey: string }) => verify),
    now: () => (t += 7),
    storedKey: vi.fn((kind: ProviderKind, baseUrl: string | undefined) => resolveGlobalStoredApiKey(settings, kind, baseUrl)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The SDK reads this; cleared so a developer's gateway env can't move the Anthropic host.
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
  // Likewise a developer's ANTHROPIC_API_KEY must not become the stored-key fallback.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  setAiMasterGate(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  settingsOverride.value = undefined;
  setAiMasterGate(() => true);
});

describe('probeConnection: network shape', () => {
  it('makes exactly one GET to {base}/models and no POST, /messages or /chat/completions call', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await probeConnection(
      { kind: 'openai', apiKey: 'sk-openai-live', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deps(),
    );
    expect(result).toEqual({ ok: true, latencyMs: 7 });
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/models');
    expect(calls[0].method).toBe('GET');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.filter((c) => /\/messages|\/chat\/completions/.test(c.url))).toHaveLength(0);
  });

  it('probes Anthropic at api.anthropic.com/v1/models with x-api-key + anthropic-version, never Bearer', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await probeConnection(
      { kind: 'anthropic', apiKey: 'sk-ant-api03-real-key', model: 'claude-sonnet-4-6' },
      deps(),
    );
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-api03-real-key');
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  it('sends an Anthropic key only to the host the SDK chat path uses, not a leftover baseUrl', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    await probeConnection(
      { kind: 'anthropic', apiKey: 'sk-ant-api03-real-key', baseUrl: 'http://127.0.0.1:1234/v1', model: 'claude-sonnet-4-6' },
      deps(),
    );
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models');
  });

  it('probes the ANTHROPIC_BASE_URL host the SDK chat path uses when it is set', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.example.com/anthropic/');
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    await probeConnection({ kind: 'anthropic', apiKey: 'sk-ant-api03-real-key', model: 'claude-sonnet-4-6' }, deps());
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gateway.example.com/anthropic/v1/models');
  });
});

describe('probeConnection: result mapping', () => {
  it('maps an empty model list to ok:false with a plain message', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [] }));
    const result = await probeConnection(
      { kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'x' },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/LM Studio answered, but it lists no models/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('passes a listModels HTTP failure through as the error', async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 500));
    const result = await probeConnection(
      { kind: 'openai', apiKey: 'sk-live', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deps(),
    );
    expect(result).toEqual({
      ok: false,
      latencyMs: 7,
      error: 'OpenAI at https://api.openai.com/v1 returned HTTP 500. Check the endpoint and try again.',
    });
  });

  it('points a rejected key (HTTP 401 / 403) at the API key, not the endpoint', async () => {
    for (const status of [401, 403]) {
      mockFetch.mockReturnValueOnce(jsonResponse({}, status));
      const result = await probeConnection(
        { kind: 'openai', apiKey: 'sk-bad', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        deps(),
      );
      expect(result).toEqual({
        ok: false,
        latencyMs: 7,
        error: `OpenAI rejected the API key (HTTP ${status}). Check your API key in Settings.`,
      });
    }
  });

  it('maps a cloud timeout (5 s) to ok:false with the did-not-respond copy', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    );
    const pending = probeConnection(
      { kind: 'anthropic', apiKey: 'sk-ant-api03-real-key', model: 'claude-sonnet-4-6' },
      deps(),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Anthropic at https:\/\/api\.anthropic\.com\/v1 did not respond within 5 seconds/);
  });
});

describe('probeConnection: guards', () => {
  it('rejects an SSRF target before any network call', async () => {
    const d = deps({ provider: { kind: 'custom', baseUrl: 'http://169.254.169.254/v1', apiKey: 'sk-stored' } });
    const result = await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'http://169.254.169.254/v1', model: 'm' },
      d,
    );
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'Invalid provider URL.' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(d.storedKey).not.toHaveBeenCalled();
    expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
  });

  it('returns ok:false with zero fetch when the master AI gate is off', async () => {
    setAiMasterGate(() => false);
    const result = await probeConnection(
      { kind: 'openai', apiKey: 'sk-openai-live', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(AI_DISABLED_MESSAGE);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// Review item 1: a public /models proves nothing about the key.
describe('probeConnection: OpenRouter checks the key, not the public model list', () => {
  const OR_BASE = 'https://openrouter.ai/api/v1';

  it('fails a wrong key with a 401 from /api/v1/key even though /models would answer 200', async () => {
    // /models is public on OpenRouter: a listModels probe would pass this bad key.
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'openai/gpt-4o' }] }));
    const d = deps({}, { ok: false, error: 'HTTP 401', status: 401 });
    const result = await probeConnection({ kind: 'custom', apiKey: 'sk-or-wrong', baseUrl: OR_BASE, model: 'm' }, d);
    expect(result).toEqual({
      ok: false,
      latencyMs: 7,
      error: 'OpenRouter rejected the API key (HTTP 401). Check your API key in Settings.',
    });
    expect(d.verifyOpenRouterKey).toHaveBeenCalledTimes(1);
    expect(d.verifyOpenRouterKey).toHaveBeenCalledWith({ baseUrl: OR_BASE, apiKey: 'sk-or-wrong' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps a 403 from the key endpoint to the key-rejected message', async () => {
    const d = deps({}, { ok: false, error: 'HTTP 403', status: 403 });
    const result = await probeConnection({ kind: 'custom', apiKey: 'sk-or-x', baseUrl: OR_BASE, model: 'm' }, d);
    expect(result.error).toBe('OpenRouter rejected the API key (HTTP 403). Check your API key in Settings.');
  });

  it('passes a good key with one key-endpoint call and no /models GET', async () => {
    const d = deps();
    const result = await probeConnection({ kind: 'custom', apiKey: 'sk-or-good', baseUrl: `${OR_BASE}/`, model: 'm' }, d);
    expect(result).toEqual({ ok: true, latencyMs: 7 });
    expect(d.verifyOpenRouterKey).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('checks the key endpoint for an OpenRouter URL whatever the provider kind', async () => {
    const d = deps({}, { ok: false, error: 'HTTP 401', status: 401 });
    const result = await probeConnection({ kind: 'openai', apiKey: 'sk-or-wrong', baseUrl: OR_BASE, model: 'm' }, d);
    expect(result.ok).toBe(false);
    expect(d.verifyOpenRouterKey).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes a non-auth key-endpoint failure through as the error', async () => {
    const d = deps({}, { ok: false, error: 'OpenRouter at https://openrouter.ai returned HTTP 502.', status: 502 });
    const result = await probeConnection({ kind: 'custom', apiKey: 'sk-or-x', baseUrl: OR_BASE, model: 'm' }, d);
    expect(result).toEqual({ ok: false, latencyMs: 7, error: 'OpenRouter at https://openrouter.ai returned HTTP 502.' });
  });

  it('maps a thrown key check to a plain failure', async () => {
    const d = deps();
    d.verifyOpenRouterKey.mockRejectedValueOnce(new Error('boom'));
    const result = await probeConnection({ kind: 'custom', apiKey: 'sk-or-x', baseUrl: OR_BASE, model: 'm' }, d);
    expect(result).toEqual({ ok: false, latencyMs: 7, error: 'Connection test failed.' });
  });
});

describe('probeConnection: other remote endpoints', () => {
  it('reports a 200 public model list as reachable but not key-verified', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    const d = deps();
    const result = await probeConnection(
      { kind: 'custom', apiKey: 'sk-wrong', baseUrl: 'https://api.models.example/v1', model: 'm' },
      d,
    );
    expect(result).toEqual({
      ok: false,
      latencyMs: 7,
      error: `Reached https://api.models.example/v1, ${UNVERIFIED}`,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
  });

  it('treats an openai-kind endpoint off api.openai.com as unverified, not ok', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await probeConnection(
      { kind: 'openai', apiKey: 'sk-wrong', baseUrl: 'https://gateway.example.com/v1', model: 'gpt-4o' },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(`Reached https://gateway.example.com/v1, ${UNVERIFIED}`);
  });

  it('verifies the key at api.openai.com whatever the provider kind (its /models requires auth)', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await probeConnection(
      { kind: 'custom', apiKey: 'sk-openai-live', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deps(),
    );
    expect(result).toEqual({ ok: true, latencyMs: 7 });
    expect(fetchCalls()[0].url).toBe('https://api.openai.com/v1/models');
  });

  it('names the endpoint without userinfo, query or hash (displayUrl)', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    const result = await probeConnection(
      { kind: 'custom', apiKey: 'sk-x', baseUrl: 'https://user:hunter2@api.models.example/v1?token=abc#frag', model: 'm' },
      deps(),
    );
    expect(result.error).toBe(`Reached https://api.models.example/v1, ${UNVERIFIED}`);
  });

  it('still points a 401 / 403 from such an endpoint at the key', async () => {
    for (const status of [401, 403]) {
      mockFetch.mockReturnValueOnce(jsonResponse({}, status));
      const result = await probeConnection(
        { kind: 'custom', apiKey: 'sk-bad', baseUrl: 'https://api.models.example/v1', model: 'm' },
        deps(),
      );
      expect(result.error).toBe(`Custom endpoint rejected the API key (HTTP ${status}). Check your API key in Settings.`);
    }
  });

  it('passes a custom endpoint on loopback with no key (a local runtime)', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    const d = deps();
    const result = await probeConnection({ kind: 'custom', baseUrl: 'http://localhost:8000/v1', model: 'm' }, d);
    expect(result).toEqual({ ok: true, latencyMs: 7 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(fetchCalls()[0].headers['Authorization']).toBeUndefined();
  });

  it('treats a hostname that only starts with "127." as remote: no key, no probe', async () => {
    for (const baseUrl of ['http://127.attacker.example/v1', 'http://127.0.0.1.nip.io/v1']) {
      const d = deps();
      const result = await probeConnection({ kind: 'custom', apiKey: '', baseUrl, model: 'm' }, d);
      expect(result, baseUrl).toEqual({ ok: false, latencyMs: 0, error: 'Enter an API key for Custom endpoint, then test again.' });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reaches a local runtime on a Tailscale (100.64/10) address', async () => {
    mockFetch.mockReturnValue(jsonResponse({ models: [{ name: 'llama3' }] }));
    const result = await probeConnection({ kind: 'ollama', baseUrl: 'http://100.101.102.103:11434/v1', model: 'llama3' }, deps());
    expect(result).toEqual({ ok: true, latencyMs: 7 });
    expect(fetchCalls().map((c) => c.url)).toEqual(['http://100.101.102.103:11434/api/tags']);
  });
});

// Review item 2: no key (or a key that isn't this provider's) means no probe.
describe('probeConnection: missing key', () => {
  it('asks for a key with zero network for every key-needing endpoint', async () => {
    const cases: Array<{ kind: ProviderKind; baseUrl?: string; label: string }> = [
      { kind: 'anthropic', label: 'Anthropic' },
      { kind: 'openai', baseUrl: 'https://api.openai.com/v1', label: 'OpenAI' },
      { kind: 'openai', label: 'OpenAI' },
      { kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', label: 'Custom endpoint' },
      { kind: 'custom', baseUrl: 'https://api.models.example/v1', label: 'Custom endpoint' },
    ];
    for (const c of cases) {
      for (const apiKey of ['', undefined]) {
        const d = deps();
        const result = await probeConnection({ kind: c.kind, apiKey, baseUrl: c.baseUrl, model: 'm' }, d);
        expect(result, `${c.kind} ${c.baseUrl}`).toEqual({
          ok: false,
          latencyMs: 0,
          error: `Enter an API key for ${c.label}, then test again.`,
        });
        expect(d.storedKey).toHaveBeenCalledTimes(1);
        expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
      }
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to the stored key of the same kind and host for an empty key', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await probeConnection(
      { kind: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deps({ provider: { kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored' } }),
    );
    expect(result.ok).toBe(true);
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-openai-stored');
  });

  it('probes a local runtime with no key', async () => {
    mockFetch.mockReturnValue(jsonResponse({ models: [{ name: 'llama3' }] }));
    const result = await probeConnection({ kind: 'ollama', apiKey: '', model: 'llama3' }, deps());
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('probeConnection: masked key handling', () => {
  it('swaps a masked preview for the stored key saved for the same kind and host', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'http://127.0.0.1:8000/v1/', model: 'm' },
      deps({ provider: { kind: 'custom', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-local-stored-wxyz' } }),
    );
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-local-stored-wxyz');
  });

  it('swaps a masked OpenRouter preview for the stored OpenRouter key at the key endpoint', async () => {
    const d = deps({ provider: { kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-stored-wxyz' } });
    await probeConnection({ kind: 'custom', apiKey: MASK, baseUrl: 'https://openrouter.ai/api/v1/', model: 'm' }, d);
    expect(d.verifyOpenRouterKey).toHaveBeenCalledWith({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'sk-or-stored-wxyz' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('asks to re-enter the key, with zero network, when the stored key belongs to another provider kind', async () => {
    const d = deps({ provider: { kind: 'anthropic', apiKey: 'sk-ant-api03-stored' } });
    const result = await probeConnection({ kind: 'openai', apiKey: MASK, model: 'gpt-4o' }, d);
    expect(result).toEqual({
      ok: false,
      latencyMs: 0,
      error: "Your saved key isn't for this provider. Re-enter the API key, then test again.",
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
  });

  it('asks to re-enter the key when the stored key was saved for another remote host of the same kind', async () => {
    const d = deps({ provider: { kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-stored' } });
    const result = await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'https://api.models.example/v1', model: 'm' },
      d,
    );
    expect(result.error).toBe("Your saved key isn't for this provider. Re-enter the API key, then test again.");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
  });

  it('asks to re-enter the key, with zero network, for a local runtime when the stored key was saved for another host', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    const d = deps({ provider: { kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-stored-wxyz' } });
    const result = await probeConnection({ kind: 'custom', apiKey: MASK, baseUrl: 'http://127.0.0.1:9999/v1', model: 'm' }, d);
    expect(result).toEqual({ ok: false, latencyMs: 0, error: REENTER });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(d.verifyOpenRouterKey).not.toHaveBeenCalled();
  });

  it('asks to re-enter the key when the stored key of the same kind and host is not the one the preview masks', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const d = deps({ provider: { kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored-ABCD' } });
    const result = await probeConnection({ kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }, d);
    expect(result).toEqual({ ok: false, latencyMs: 0, error: REENTER });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never sends the masked preview itself, even with no stored key', async () => {
    const result = await probeConnection({ kind: 'anthropic', apiKey: MASK, model: 'claude-sonnet-4-6' }, deps());
    expect(result.error).toBe("Your saved key isn't for this provider. Re-enter the API key, then test again.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends a freshly typed key as-is without reading the stored key', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const d = deps({ provider: { kind: 'openai', apiKey: 'sk-old' } });
    await probeConnection({ kind: 'openai', apiKey: 'sk-new-typed', model: 'gpt-4o' }, d);
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-new-typed');
    expect(d.storedKey).not.toHaveBeenCalled();
  });
});

// Review items 3 + 5: the one stored-key resolver Test connection and
// PROVIDER_LIST_MODELS share.
// Review findings: Test connection reads only the key global chat would send.
describe('resolveGlobalStoredApiKey', () => {
  const OR = 'https://openrouter.ai/api/v1';

  it('returns the global provider key for the same kind and host only', () => {
    const s: StoredKeySettings = { provider: { kind: 'custom', baseUrl: OR, apiKey: 'sk-or-global' } };
    expect(resolveGlobalStoredApiKey(s, 'custom', `${OR}/`)).toBe('sk-or-global');
    expect(resolveGlobalStoredApiKey(s, 'custom', 'https://evil.example/v1')).toBeUndefined();
    expect(resolveGlobalStoredApiKey(s, 'openai', OR)).toBeUndefined();
  });

  it('never reads a per-agent provider override', () => {
    const s: StoredKeySettings = {
      provider: { kind: 'custom', baseUrl: OR, apiKey: '' },
      agents: { brainstorm: { provider: { kind: 'custom', baseUrl: OR, apiKey: 'sk-or-v1-agentkeyAAAA' } } },
    };
    expect(resolveGlobalStoredApiKey(s, 'custom', OR)).toBeUndefined();
    expect(resolveGlobalStoredApiKey({ agents: s.agents }, 'custom', OR)).toBeUndefined();
  });

  it('for anthropic, uses the legacy apiKey / ANTHROPIC_API_KEY only when no provider block is saved', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    expect(resolveGlobalStoredApiKey({ apiKey: 'sk-ant-legacy', provider: { kind: 'anthropic', apiKey: '' } }, 'anthropic', undefined)).toBeUndefined();
    expect(resolveGlobalStoredApiKey({ apiKey: 'sk-ant-legacy', provider: { kind: 'openai', apiKey: 'sk-o' } }, 'anthropic', undefined)).toBeUndefined();
    expect(resolveGlobalStoredApiKey({ apiKey: 'sk-ant-legacy' }, 'anthropic', undefined)).toBe('sk-ant-legacy');
    expect(resolveGlobalStoredApiKey({ apiKey: '' }, 'anthropic', undefined)).toBe('sk-ant-env');
    expect(resolveGlobalStoredApiKey({ apiKey: 'sk-ant-legacy' }, 'openai', undefined)).toBeUndefined();
  });
});

describe('resolveStoredApiKey', () => {
  const OPENAI = 'https://api.openai.com/v1';

  it('returns the global provider key for the same kind and host (trailing slash ignored)', () => {
    const s: StoredKeySettings = { provider: { kind: 'openai', baseUrl: OPENAI, apiKey: 'sk-openai' } };
    expect(resolveStoredApiKey(s, 'openai', `${OPENAI}/`)).toBe('sk-openai');
    // No baseUrl on either side means the kind's default host.
    expect(resolveStoredApiKey({ provider: { kind: 'openai', apiKey: 'sk-openai' } }, 'openai', undefined)).toBe('sk-openai');
    expect(resolveStoredApiKey({ provider: { kind: 'openai', apiKey: 'sk-openai' } }, 'openai', OPENAI)).toBe('sk-openai');
  });

  it('never returns a key saved for another kind', () => {
    const s: StoredKeySettings = { apiKey: 'sk-ant-legacy', provider: { kind: 'anthropic', apiKey: 'sk-ant-stored' } };
    expect(resolveStoredApiKey(s, 'openai', OPENAI)).toBeUndefined();
    expect(resolveStoredApiKey(s, 'custom', OPENAI)).toBeUndefined();
  });

  it('never returns a key saved for another host of the same kind', () => {
    const s: StoredKeySettings = { provider: { kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' } };
    expect(resolveStoredApiKey(s, 'custom', 'https://evil.example/v1')).toBeUndefined();
    expect(resolveStoredApiKey(s, 'custom', 'https://openrouter.ai.evil.example/api/v1')).toBeUndefined();
    // Two missing custom URLs are not "the same host".
    expect(resolveStoredApiKey({ provider: { kind: 'custom', apiKey: 'sk-c' } }, 'custom', undefined)).toBeUndefined();
  });

  it('matches per-agent provider overrides by the same kind + host rule', () => {
    const s: StoredKeySettings = {
      provider: { kind: 'anthropic', apiKey: 'sk-ant-global' },
      agents: {
        writingAssistant: {},
        brainstorm: { provider: { kind: 'custom', baseUrl: 'https://api.together.example/v1', apiKey: 'sk-agent' } },
      },
    };
    expect(resolveStoredApiKey(s, 'custom', 'https://api.together.example/v1')).toBe('sk-agent');
    expect(resolveStoredApiKey(s, 'custom', 'https://evil.example/v1')).toBeUndefined();
    expect(resolveStoredApiKey(s, 'openai', OPENAI)).toBeUndefined();
  });

  it('for anthropic, falls back to the legacy apiKey and then ANTHROPIC_API_KEY', () => {
    const openaiOnly = { kind: 'openai' as const, baseUrl: OPENAI, apiKey: 'sk-openai' };
    expect(resolveStoredApiKey({ apiKey: 'sk-ant-legacy', provider: openaiOnly }, 'anthropic', undefined)).toBe('sk-ant-legacy');
    expect(resolveStoredApiKey({ apiKey: 'sk-ant-legacy' }, 'anthropic', 'http://127.0.0.1:1/v1')).toBe('sk-ant-legacy');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    expect(resolveStoredApiKey({ apiKey: '', provider: openaiOnly }, 'anthropic', undefined)).toBe('sk-ant-env');
    // The env key is the Anthropic fallback only.
    expect(resolveStoredApiKey({ provider: { kind: 'openai' } }, 'openai', OPENAI)).toBeUndefined();
  });

  it('prefers a stored anthropic provider key over the legacy and env keys', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    const s: StoredKeySettings = { apiKey: 'sk-ant-legacy', provider: { kind: 'anthropic', apiKey: 'sk-ant-provider' } };
    expect(resolveStoredApiKey(s, 'anthropic', undefined)).toBe('sk-ant-provider');
  });

  it('never counts a masked value in storage as a key', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', MASK);
    expect(resolveStoredApiKey({ provider: { kind: 'openai', apiKey: MASK } }, 'openai', OPENAI)).toBeUndefined();
    expect(resolveStoredApiKey({ apiKey: MASK, provider: { kind: 'anthropic', apiKey: MASK } }, 'anthropic', undefined)).toBeUndefined();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    expect(resolveStoredApiKey({ apiKey: MASK, provider: { kind: 'anthropic', apiKey: MASK } }, 'anthropic', undefined)).toBe('sk-ant-env');
  });
});

// ─── main.ts IPC handlers (real settings read) ───────────────────────────────

function useSettings(extra: Record<string, unknown>): void {
  settingsOverride.value = { ...SETTINGS_DEFAULTS, ...extra };
}

describe('SETTINGS_TEST_CONNECTION handler in main.ts', () => {
  const testConnection = handlers[IPC_CHANNELS.SETTINGS_TEST_CONNECTION];

  it('never sends the legacy Anthropic key to another provider for a masked preview', async () => {
    useSettings({ apiKey: 'sk-ant-legacy-secret', provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await testConnection({
      provider: { kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    expect(result).toEqual({
      ok: false,
      latencyMs: 0,
      error: "Your saved key isn't for this provider. Re-enter the API key, then test again.",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('asks to re-enter the key with zero fetch for a masked openai key over a stored anthropic provider', async () => {
    useSettings({ provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-api03-stored' } });
    const result = await testConnection({
      provider: { kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Your saved key isn't for this provider. Re-enter the API key, then test again.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swaps a masked preview for the stored provider key of the same kind and host', async () => {
    useSettings({ provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored-wxyz' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    await testConnection({
      provider: { kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-openai-stored-wxyz');
  });

  it('tests Anthropic with one GET /models and no SDK client or token spend', async () => {
    useSettings({ provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-api03-stored-wxyz' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await testConnection({
      provider: { kind: 'anthropic', apiKey: MASK, model: 'claude-sonnet-4-6' },
    });
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.anthropic.com/v1/models', method: 'GET' });
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-api03-stored-wxyz');
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it('tests a legacy-only Anthropic setup with the legacy apiKey when the renderer sends no key', async () => {
    useSettings({ apiKey: 'sk-ant-legacy', provider: undefined });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await testConnection({ provider: { kind: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6' } });
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.anthropic.com/v1/models', method: 'GET' });
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-legacy');
  });

  it('tests Anthropic with ANTHROPIC_API_KEY when nothing is saved', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    useSettings({ apiKey: '', provider: undefined });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await testConnection({ provider: { kind: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6' } });
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models');
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-env');
  });

  it('does not pass Anthropic on the legacy key when the saved provider block has no key (chat would refuse)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    useSettings({ apiKey: 'sk-ant-api03-legacyZZZZ', provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await testConnection({ provider: { kind: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6' } });
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'Enter an API key for Anthropic, then test again.' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never tests the global provider with a key saved only on an agent override", async () => {
    const OR = 'https://openrouter.ai/api/v1';
    useSettings({
      provider: { kind: 'custom', model: 'm', baseUrl: OR, apiKey: '' },
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, provider: { kind: 'custom', model: 'm', baseUrl: OR, apiKey: 'sk-or-v1-agentkeyAAAA' } },
      },
    });
    mockFetch.mockReturnValue(jsonResponse({}));
    const result = await testConnection({ provider: { kind: 'custom', apiKey: '', baseUrl: OR, model: 'm' } });
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'Enter an API key for Custom endpoint, then test again.' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a wrong stored OpenRouter key through the key endpoint, not the public /models', async () => {
    useSettings({ provider: { kind: 'custom', model: 'm', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-wrong-wxyz' } });
    mockFetch.mockImplementation((url: string) =>
      String(url).endsWith('/api/v1/key') ? jsonResponse({}, 401) : jsonResponse({ data: [{ id: 'm' }] }));
    const result = await testConnection({
      provider: { kind: 'custom', apiKey: MASK, baseUrl: 'https://openrouter.ai/api/v1', model: 'm' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('OpenRouter rejected the API key (HTTP 401). Check your API key in Settings.');
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://openrouter.ai/api/v1/key', method: 'GET' });
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-or-wrong-wxyz');
  });
});

describe('PROVIDER_LIST_MODELS handler in main.ts', () => {
  const listModelsHandler = handlers[IPC_CHANNELS.PROVIDER_LIST_MODELS];

  it('never sends the stored key to a renderer-chosen foreign baseUrl', async () => {
    useSettings({ provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    await listModelsHandler({ kind: 'custom', baseUrl: 'https://evil.example/v1' });
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://evil.example/v1/models');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(JSON.stringify(calls[0].headers)).not.toContain('sk-openai-stored');
  });

  it('never sends the legacy Anthropic key to another kind', async () => {
    useSettings({ apiKey: 'sk-ant-legacy', provider: undefined });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    await listModelsHandler({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(fetchCalls()[0].headers['Authorization']).toBeUndefined();
  });

  it('sends the stored key for the same kind and host', async () => {
    useSettings({ provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    await listModelsHandler({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-openai-stored');
  });

  it("still lists OpenRouter's public catalog keyless when no stored key matches", async () => {
    useSettings({ provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'openai/gpt-4o' }] }));
    const result = await listModelsHandler({ kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(result).toEqual({ ok: true, models: ['openai/gpt-4o'] });
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/models');
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });
});

// ─── main.ts source guard (wiring) ───────────────────────────────────────────

const MAIN_SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
  'utf-8',
);

function sliceFrom(src: string, start: string, end: RegExp): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const rest = src.slice(i + start.length);
  const j = rest.search(end);
  return j < 0 ? rest : rest.slice(0, j);
}

describe('main.ts wiring (M-1 cut check)', () => {
  it('SETTINGS_TEST_CONNECTION delegates to probeConnection and no longer streams', () => {
    const handler = sliceFrom(MAIN_SRC, '[IPC_CHANNELS.SETTINGS_TEST_CONNECTION]:', /\n\s*\[IPC_CHANNELS\./);
    expect(handler).not.toBe('');
    expect(handler).toMatch(/probeConnection\(/);
    expect(handler).not.toMatch(/streamFromProvider/);
    expect(/import\s*\{[^}]*\bprobeConnection\b[^}]*\}\s*from\s*'\.\/connectionProbe\.js'/.test(MAIN_SRC), 'main.ts imports probeConnection').toBe(true);
  });

  it('BRAINSTORM_EXTRACT_PROPOSALS runs the extract script', () => {
    const fn = sliceFrom(MAIN_SRC, 'function registerBrainstormExtractionHandlers(', /\n\}\n/);
    expect(fn).toMatch(/IPC_CHANNELS\.BRAINSTORM_EXTRACT_PROPOSALS/);
    expect(fn).toMatch(/extractProposalsByScript\(/);
    expect(/import\s*\{[^}]*\bextractProposalsByScript\b[^}]*\}\s*from\s*'\.\/brainstormExtractScript\.js'/.test(MAIN_SRC), 'main.ts imports extractProposalsByScript').toBe(true);
  });

  it('BRAINSTORM_EXTRACT_PROPOSALS reads vault names off the main thread, with a scoped fallback', () => {
    const fn = sliceFrom(MAIN_SRC, 'function registerBrainstormExtractionHandlers(', /\n\}\n/);
    // The sync walk blocked the main process on every extract.
    expect(fn).not.toMatch(/collectNotesVaultNoteNames\(/);
    // An unreadable vault falls back to the renderer's names; proposals still run.
    expect(fn).toMatch(/try\s*\{[^}]*await collectNotesVaultNoteNamesAsync\(getNotesVaultRoot\(\)\)[\s\S]*?\}\s*catch\b[^{]*\{[^}]*\}\s*const proposals = extractProposalsByScript\(/);
  });

  it('has no Haiku literal, no direct Anthropic client and no SDK import', () => {
    // Boolean checks keep a failure from dumping all of main.ts.
    expect(MAIN_SRC.includes('claude-haiku-4-5-20251001'), 'Haiku literal in main.ts').toBe(false);
    expect(MAIN_SRC.includes('new Anthropic('), 'direct Anthropic client in main.ts').toBe(false);
    expect(MAIN_SRC.includes("from '@anthropic-ai/sdk'"), 'SDK import in main.ts').toBe(false);
  });
});
