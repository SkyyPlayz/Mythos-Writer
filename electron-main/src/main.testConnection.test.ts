// PLAN-AI-MODES M-1 (audit row 1): Settings "Test connection" is a no-AI
// GET /models probe. These tests pin the probe's network shape (one GET, no
// tokens), its result mapping, the key-safety rules, and that main.ts's IPC
// handler runs the probe with the real stored settings in place of the old
// 1-token ping and the direct Anthropic client.

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
// listModels uses undici's fetch (SKY-11225), so the spy sits there.
vi.mock('undici', () => ({ fetch: vi.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import { fetch as undiciFetch } from 'undici';
import { listModels, setAiMasterGate, AI_DISABLED_MESSAGE } from './provider.js';
import { probeConnection, storedProviderKey, type StoredProviderKey } from './connectionProbe.js';
import { SETTINGS_DEFAULTS } from './appSettingsLoad.js';
import { handlers } from './main.js';
import { IPC_CHANNELS } from './ipc.js';

const mockFetch = undiciFetch as unknown as ReturnType<typeof vi.fn>;
const MASK = 'sk-ant-...wxyz';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

type FetchCall = { url: string; method: string; headers: Record<string, string> };
function fetchCalls(): FetchCall[] {
  return mockFetch.mock.calls.map(([url, init]) => {
    const opts = (init ?? {}) as { method?: string; headers?: Record<string, string> };
    return { url: String(url), method: (opts.method ?? 'GET').toUpperCase(), headers: opts.headers ?? {} };
  });
}

function deps(storedKey?: StoredProviderKey) {
  let t = 1000;
  return {
    listModels,
    now: () => (t += 7),
    storedKey: storedKey ? vi.fn(() => storedKey) : vi.fn(() => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The SDK reads this; cleared so a developer's gateway env can't move the Anthropic host.
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
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
    const d = deps({ kind: 'custom', baseUrl: 'http://169.254.169.254/v1', apiKey: 'sk-stored' });
    const result = await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'http://169.254.169.254/v1', model: 'm' },
      d,
    );
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'Invalid provider URL.' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(d.storedKey).not.toHaveBeenCalled();
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

describe('probeConnection: masked key handling', () => {
  it('swaps a masked preview for the stored key saved for the same kind and host', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'https://openrouter.ai/api/v1/', model: 'm' },
      deps({ kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-stored' }),
    );
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-or-stored');
  });

  it('sends no key when the stored key belongs to another provider kind', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    await probeConnection(
      { kind: 'openai', apiKey: MASK, model: 'gpt-4o' },
      deps({ kind: 'anthropic', apiKey: 'sk-ant-api03-stored' }),
    );
    const headers = fetchCalls()[0].headers;
    expect(headers['Authorization']).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain('sk-ant');
  });

  it('sends no key when the stored key was saved for another host of the same kind', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'm' }] }));
    await probeConnection(
      { kind: 'custom', apiKey: MASK, baseUrl: 'http://127.0.0.1:9999/v1', model: 'm' },
      deps({ kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-stored' }),
    );
    expect(fetchCalls()[0].headers['Authorization']).toBeUndefined();
  });

  it('never sends the masked preview itself, even with no stored key', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    await probeConnection({ kind: 'anthropic', apiKey: MASK, model: 'claude-sonnet-4-6' }, deps());
    const headers = fetchCalls()[0].headers;
    expect(headers['x-api-key']).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(MASK);
  });

  it('sends a freshly typed key as-is without reading the stored key', async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const d = deps({ kind: 'openai', apiKey: 'sk-old' });
    await probeConnection({ kind: 'openai', apiKey: 'sk-new-typed', model: 'gpt-4o' }, d);
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-new-typed');
    expect(d.storedKey).not.toHaveBeenCalled();
  });
});

describe('storedProviderKey', () => {
  it('is the provider block key only, never the legacy top-level apiKey', () => {
    const legacy = { apiKey: 'sk-ant-legacy' };
    expect(storedProviderKey({ ...legacy, provider: undefined })).toBeUndefined();
    expect(storedProviderKey({ ...legacy, provider: { kind: 'anthropic' } })).toEqual({ kind: 'anthropic', apiKey: undefined });
    expect(storedProviderKey({ ...legacy, provider: { kind: 'openai', apiKey: 'sk-openai' } }))
      .toEqual({ kind: 'openai', apiKey: 'sk-openai' });
  });
});

// ─── main.ts IPC handler (real settings read) ────────────────────────────────

describe('SETTINGS_TEST_CONNECTION handler in main.ts', () => {
  const testConnection = handlers[IPC_CHANNELS.SETTINGS_TEST_CONNECTION];

  function useSettings(extra: Record<string, unknown>): void {
    settingsOverride.value = { ...SETTINGS_DEFAULTS, ...extra };
  }

  it('never sends the legacy Anthropic key to another provider for a masked preview', async () => {
    useSettings({ apiKey: 'sk-ant-legacy-secret', provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const result = await testConnection({
      provider: { kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(JSON.stringify(calls[0].headers)).not.toContain('sk-ant');
  });

  it('swaps a masked preview for the stored provider key of the same kind and host', async () => {
    useSettings({ provider: { kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai-stored' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    await testConnection({
      provider: { kind: 'openai', apiKey: MASK, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    expect(fetchCalls()[0].headers['Authorization']).toBe('Bearer sk-openai-stored');
  });

  it('tests Anthropic with one GET /models and no SDK client or token spend', async () => {
    useSettings({ provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-api03-stored' } });
    mockFetch.mockReturnValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] }));
    const result = await testConnection({
      provider: { kind: 'anthropic', apiKey: MASK, model: 'claude-sonnet-4-6' },
    });
    expect(result.ok).toBe(true);
    const calls = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.anthropic.com/v1/models', method: 'GET' });
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-api03-stored');
    expect(Anthropic).not.toHaveBeenCalled();
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

  it('has no Haiku literal, no direct Anthropic client and no SDK import', () => {
    // Boolean checks keep a failure from dumping all of main.ts.
    expect(MAIN_SRC.includes('claude-haiku-4-5-20251001'), 'Haiku literal in main.ts').toBe(false);
    expect(MAIN_SRC.includes('new Anthropic('), 'direct Anthropic client in main.ts').toBe(false);
    expect(MAIN_SRC.includes("from '@anthropic-ai/sdk'"), 'SDK import in main.ts').toBe(false);
  });
});
