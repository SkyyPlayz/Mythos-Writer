// Provider abstraction tests — MYT-324
// Strategy: mock @anthropic-ai/sdk and global fetch; test routing, token emission,
// error handling, validation, and config helpers without network calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import {
  streamFromProvider,
  validateProviderConfig,
  validateBaseUrl,
  providerConfigForAgent,
  isModelValid,
  ANTHROPIC_MODEL_ALLOWLIST,
  createProvider,
  PROVIDER_CAPABILITIES,
  getVoiceProvider,
  listModels,
  DEFAULT_BASE_URLS,
  type ProviderConfig,
  type StreamRequest,
  type Provider,
} from './provider.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function collectTokens(gen: AsyncIterable<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const t of gen) tokens.push(t);
  return tokens;
}

function makeAnthropicConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-haiku-4-5-20251001', ...overrides };
}

function makeOpenAIConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind: 'openai', apiKey: 'sk-openai-test', model: 'gpt-4o-mini', ...overrides };
}

function makeOllamaConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind: 'ollama', model: 'llama3', ...overrides };
}

function makeLmStudioConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind: 'lmstudio', model: 'local-model', ...overrides };
}

function makeCustomConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind: 'custom', baseUrl: 'http://localhost:9999/v1', model: 'my-model', ...overrides };
}

function makeReq(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return { messages: [{ role: 'user', content: 'Hello' }], ...overrides };
}

// Build a mock SSE ReadableStream with the given token chunks.
function makeSseStream(tokens: string[]): ReadableStream {
  const chunks: string[] = [
    ...tokens.map(
      (t, i) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: t }, index: i, finish_reason: null }] })}\n\n`,
    ),
    'data: [DONE]\n\n',
  ];
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[idx++]));
      } else {
        controller.close();
      }
    },
  });
}

function makeOkFetchResponse(tokens: string[]) {
  return Promise.resolve({
    ok: true,
    status: 200,
    body: makeSseStream(tokens),
  } as unknown as Response);
}

// ─── Anthropic routing (§1) ───────────────────────────────────────────────────

describe('Anthropic routing (§1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an Anthropic client with the supplied apiKey', async () => {
    let capturedKey = '';
    const mockStream = async function* () { yield 'Hi'; };
    const mockMessages = { stream: vi.fn().mockReturnValue(mockStream()) };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: unknown, opts: { apiKey: string }) {
      capturedKey = opts.apiKey;
      return { messages: mockMessages };
    });

    await collectTokens(streamFromProvider(makeAnthropicConfig({ apiKey: 'sk-ant-xyz' }), makeReq()));
    expect(capturedKey).toBe('sk-ant-xyz');
  });

  it('yields tokens from content_block_delta / text_delta chunks', async () => {
    const fakeChunks = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } },
      { type: 'message_stop' },
    ];
    const mockStream = async function* () { for (const c of fakeChunks) yield c; };
    const mockMessages = { stream: vi.fn().mockReturnValue(mockStream()) };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: unknown) { return { messages: mockMessages }; });

    const tokens = await collectTokens(streamFromProvider(makeAnthropicConfig(), makeReq()));
    expect(tokens).toEqual(['Hello', ' World']);
  });

  it('passes system prompt to the SDK when present', async () => {
    let capturedParams: unknown;
    const mockMessages = {
      stream: vi.fn().mockImplementation(function(params: unknown) {
        capturedParams = params;
        return (async function* () {})();
      }),
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: unknown) { return { messages: mockMessages }; });

    await collectTokens(streamFromProvider(makeAnthropicConfig(), makeReq({ system: 'You are a writer.' })));
    expect((capturedParams as { system: string }).system).toBe('You are a writer.');
  });

  it('omits system field when no system prompt given', async () => {
    let capturedParams: unknown;
    const mockMessages = {
      stream: vi.fn().mockImplementation(function(params: unknown) {
        capturedParams = params;
        return (async function* () {})();
      }),
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: unknown) { return { messages: mockMessages }; });

    await collectTokens(streamFromProvider(makeAnthropicConfig(), makeReq()));
    expect(capturedParams).not.toHaveProperty('system');
  });

  it('throws when apiKey is missing', async () => {
    await expect(
      collectTokens(streamFromProvider(makeAnthropicConfig({ apiKey: undefined }), makeReq())),
    ).rejects.toThrow(/api key/i);
  });
});

// ─── OpenAI-compatible routing (§2) ──────────────────────────────────────────

describe('OpenAI-compatible routing (§2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('uses DEFAULT_BASE_URLS.openai when no baseUrl override is given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse(['Hello']));
    await collectTokens(streamFromProvider(makeOpenAIConfig(), makeReq()));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain(DEFAULT_BASE_URLS.openai);
  });

  it('uses DEFAULT_BASE_URLS.ollama for ollama kind', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse(['Hi']));
    await collectTokens(streamFromProvider(makeOllamaConfig(), makeReq()));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain(DEFAULT_BASE_URLS.ollama);
  });

  it('uses DEFAULT_BASE_URLS.lmstudio for lmstudio kind', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse(['Hi']));
    await collectTokens(streamFromProvider(makeLmStudioConfig(), makeReq()));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain(DEFAULT_BASE_URLS.lmstudio);
  });

  it('uses custom baseUrl for custom kind', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse(['Hi']));
    await collectTokens(streamFromProvider(makeCustomConfig(), makeReq()));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('http://localhost:9999/v1');
  });

  it('includes Authorization header when apiKey is set', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse([]));
    await collectTokens(streamFromProvider(makeOpenAIConfig({ apiKey: 'sk-x' }), makeReq())).catch(() => {});
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-x');
  });

  it('omits Authorization header when apiKey is absent (Ollama)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse([]));
    await collectTokens(streamFromProvider(makeOllamaConfig(), makeReq())).catch(() => {});
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('emits tokens from SSE stream', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeOkFetchResponse(['Hello', ' World', '!']));
    const tokens = await collectTokens(streamFromProvider(makeOpenAIConfig(), makeReq()));
    expect(tokens).toEqual(['Hello', ' World', '!']);
  });

  it('prepends system message when system is provided', async () => {
    let capturedBody = '';
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
      return makeOkFetchResponse([]);
    });
    await collectTokens(streamFromProvider(makeOpenAIConfig(), makeReq({ system: 'Be a writer.' }))).catch(() => {});
    const parsed = JSON.parse(capturedBody) as { messages: Array<{ role: string; content: string }> };
    expect(parsed.messages[0]).toMatchObject({ role: 'system', content: 'Be a writer.' });
  });

  it('throws a structured error with .status on non-200 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') } as unknown as Response),
    );
    await expect(
      collectTokens(streamFromProvider(makeOpenAIConfig(), makeReq())),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws when custom kind has no baseUrl', async () => {
    await expect(
      collectTokens(streamFromProvider({ kind: 'custom', model: 'x' }, makeReq())),
    ).rejects.toThrow(/baseUrl/i);
  });
});

// ─── validateProviderConfig (§3) ─────────────────────────────────────────────

describe('validateProviderConfig (§3)', () => {
  it('returns null for a valid anthropic config', () => {
    expect(validateProviderConfig(makeAnthropicConfig())).toBeNull();
  });

  it('returns null for a valid openai config', () => {
    expect(validateProviderConfig(makeOpenAIConfig())).toBeNull();
  });

  it('returns null for a valid ollama config (no apiKey required)', () => {
    expect(validateProviderConfig(makeOllamaConfig())).toBeNull();
  });

  it('returns null for a valid lmstudio config', () => {
    expect(validateProviderConfig(makeLmStudioConfig())).toBeNull();
  });

  it('returns null for a valid custom config with baseUrl', () => {
    expect(validateProviderConfig(makeCustomConfig())).toBeNull();
  });

  it('returns error when model is empty', () => {
    expect(validateProviderConfig(makeAnthropicConfig({ model: '' }))).toMatch(/model/i);
  });

  it('returns error when anthropic apiKey is missing', () => {
    expect(validateProviderConfig(makeAnthropicConfig({ apiKey: undefined }))).toMatch(/api key/i);
  });

  it('returns error when openai apiKey is missing', () => {
    expect(validateProviderConfig(makeOpenAIConfig({ apiKey: undefined }))).toMatch(/api key/i);
  });

  it('returns error when custom kind has no baseUrl', () => {
    expect(validateProviderConfig({ kind: 'custom', model: 'x' })).toMatch(/baseUrl/i);
  });
});

// ─── Capability discovery (§5) ────────────────────────────────────────────────

describe('Capability discovery (§5)', () => {
  describe('Anthropic adapter', () => {
    let p: Provider;
    beforeEach(() => { p = createProvider(makeAnthropicConfig()); });

    it('reports no capabilities', () => {
      expect(p.capabilities).toEqual([]);
    });
    it('supportsCapability("stt") → false', () => {
      expect(p.supportsCapability('stt')).toBe(false);
    });
    it('supportsCapability("tts") → false', () => {
      expect(p.supportsCapability('tts')).toBe(false);
    });
    it('transcribe method is absent', () => {
      expect(p.transcribe).toBeUndefined();
    });
    it('speak method is absent', () => {
      expect(p.speak).toBeUndefined();
    });
  });

  describe('OpenAI adapter', () => {
    let p: Provider;
    beforeEach(() => { p = createProvider(makeOpenAIConfig()); });

    it('reports stt capability', () => {
      expect(p.capabilities).toContain('stt');
    });
    it('reports tts capability', () => {
      expect(p.capabilities).toContain('tts');
    });
    it('supportsCapability("stt") → true', () => {
      expect(p.supportsCapability('stt')).toBe(true);
    });
    it('supportsCapability("tts") → true', () => {
      expect(p.supportsCapability('tts')).toBe(true);
    });
    it('transcribe stub rejects with not-implemented', async () => {
      expect(p.transcribe).toBeDefined();
      await expect(p.transcribe!(Buffer.alloc(0))).rejects.toThrow(/not yet implemented/i);
    });
    it('speak stub rejects with not-implemented on first next()', async () => {
      expect(p.speak).toBeDefined();
      const iter = p.speak!('hello')[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrow(/not yet implemented/i);
    });
  });

  describe('Ollama adapter', () => {
    it('reports stt and tts capabilities', () => {
      const p = createProvider(makeOllamaConfig());
      expect(p.capabilities).toContain('stt');
      expect(p.capabilities).toContain('tts');
    });
  });

  describe('LM Studio adapter', () => {
    it('reports stt and tts capabilities', () => {
      const p = createProvider(makeLmStudioConfig());
      expect(p.capabilities).toContain('stt');
      expect(p.capabilities).toContain('tts');
    });
  });

  describe('Custom adapter', () => {
    it('reports stt and tts capabilities', () => {
      const p = createProvider(makeCustomConfig());
      expect(p.capabilities).toContain('stt');
      expect(p.capabilities).toContain('tts');
    });
  });

  describe('PROVIDER_CAPABILITIES constant', () => {
    it('anthropic has no entries', () => {
      expect(PROVIDER_CAPABILITIES.anthropic).toHaveLength(0);
    });
    it('openai has both stt and tts', () => {
      expect(PROVIDER_CAPABILITIES.openai).toContain('stt');
      expect(PROVIDER_CAPABILITIES.openai).toContain('tts');
    });
  });
});

// ─── providerConfigForAgent (§4) ─────────────────────────────────────────────

describe('providerConfigForAgent (§4)', () => {
  const global: ProviderConfig = makeAnthropicConfig({ model: 'claude-sonnet-4-6' });

  it('returns global config unchanged when no model override', () => {
    expect(providerConfigForAgent(global)).toStrictEqual(global);
  });

  it('overrides model only, preserving other fields', () => {
    const result = providerConfigForAgent(global, 'claude-haiku-4-5-20251001');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.kind).toBe('anthropic');
    expect(result.apiKey).toBe('sk-ant-test');
  });

  it('does not mutate the global config', () => {
    providerConfigForAgent(global, 'other-model');
    expect(global.model).toBe('claude-sonnet-4-6');
  });

  it('returns agentProviderOverride unchanged when provided (SKY-683)', () => {
    const override: ProviderConfig = { kind: 'ollama', model: 'llama3', baseUrl: 'http://127.0.0.1:11434/v1' };
    expect(providerConfigForAgent(global, undefined, override)).toStrictEqual(override);
  });

  it('agentProviderOverride takes precedence over agentModelOverride (SKY-683)', () => {
    const override: ProviderConfig = { kind: 'ollama', model: 'llama3' };
    const result = providerConfigForAgent(global, 'ignored-model', override);
    expect(result.model).toBe('llama3');
    expect(result.kind).toBe('ollama');
  });

  it('falls back to global apiKey when agent override has same kind but no apiKey (SKY-684 §PM3)', () => {
    const globalWithKey = makeAnthropicConfig({ apiKey: 'global-key', model: 'claude-sonnet-4-6' });
    const agentOverride: ProviderConfig = { kind: 'anthropic', model: 'claude-opus-4-7' };
    const result = providerConfigForAgent(globalWithKey, undefined, agentOverride);
    expect(result.apiKey).toBe('global-key');
    expect(result.model).toBe('claude-opus-4-7');
    expect(result.kind).toBe('anthropic');
  });

  it('does not inherit global apiKey when agent override has different kind (Ollama local, SKY-684)', () => {
    const globalWithKey = makeAnthropicConfig({ apiKey: 'global-key', model: 'claude-sonnet-4-6' });
    const agentOverride: ProviderConfig = { kind: 'ollama', model: 'llama3' };
    const result = providerConfigForAgent(globalWithKey, undefined, agentOverride);
    expect(result.apiKey).toBeUndefined();
    expect(result.kind).toBe('ollama');
  });

  it('does not inherit global apiKey when agent override has different kind (LM Studio, SKY-684)', () => {
    const globalWithKey = makeAnthropicConfig({ apiKey: 'global-key', model: 'claude-sonnet-4-6' });
    const agentOverride: ProviderConfig = { kind: 'lmstudio', model: 'local-model' };
    const result = providerConfigForAgent(globalWithKey, undefined, agentOverride);
    expect(result.apiKey).toBeUndefined();
    expect(result.kind).toBe('lmstudio');
  });
});

// ─── isModelValid (§5) ────────────────────────────────────────────────────────

describe('isModelValid (§5)', () => {
  it('accepts Claude models for anthropic kind', () => {
    for (const m of ANTHROPIC_MODEL_ALLOWLIST) {
      expect(isModelValid(m, 'anthropic')).toBe(true);
    }
  });

  it('rejects unknown model for anthropic kind', () => {
    expect(isModelValid('gpt-4o', 'anthropic')).toBe(false);
    expect(isModelValid('llama3', 'anthropic')).toBe(false);
    expect(isModelValid('', 'anthropic')).toBe(false);
  });

  it('accepts any non-empty string up to 128 chars for ollama kind', () => {
    expect(isModelValid('llama3', 'ollama')).toBe(true);
    expect(isModelValid('mistral:7b', 'ollama')).toBe(true);
    expect(isModelValid('x'.repeat(128), 'ollama')).toBe(true);
  });

  it('rejects empty string for ollama kind', () => {
    expect(isModelValid('', 'ollama')).toBe(false);
    expect(isModelValid('  ', 'ollama')).toBe(false);
  });

  it('rejects model over 128 chars for non-anthropic kind', () => {
    expect(isModelValid('x'.repeat(129), 'openai')).toBe(false);
  });

  it('accepts any non-empty model for openai, lmstudio, custom kinds', () => {
    expect(isModelValid('gpt-4o-mini', 'openai')).toBe(true);
    expect(isModelValid('local-model', 'lmstudio')).toBe(true);
    expect(isModelValid('my-model', 'custom')).toBe(true);
  });
});

// ─── validateBaseUrl (§6) — SSRF prevention (SKY-739) ─────────────────────────

describe('validateBaseUrl (§6)', () => {
  // Allowed: loopback / localhost (Ollama, LM Studio defaults)
  it('allows http://localhost', () => {
    expect(validateBaseUrl('http://localhost:11434/v1')).toBeNull();
  });

  it('allows http://127.0.0.1 (Ollama default)', () => {
    expect(validateBaseUrl('http://127.0.0.1:1234/v1')).toBeNull();
  });

  it('allows any 127.x.x.x address (full loopback block)', () => {
    expect(validateBaseUrl('http://127.255.255.255/v1')).toBeNull();
  });

  it('allows https://api.openai.com (public cloud endpoint)', () => {
    expect(validateBaseUrl('https://api.openai.com/v1')).toBeNull();
  });

  it('allows https://api.anthropic.com', () => {
    expect(validateBaseUrl('https://api.anthropic.com/v1')).toBeNull();
  });

  // Blocked: APIPA / link-local
  it('blocks APIPA 169.254.169.254 (cloud IMDS — AWS/GCP/Azure)', () => {
    const result = validateBaseUrl('http://169.254.169.254/latest/meta-data/');
    expect(result).toMatch(/link-local/i);
  });

  it('blocks 169.254.x.x range generally', () => {
    expect(validateBaseUrl('http://169.254.1.1/')).toMatch(/link-local/i);
  });

  it('blocks link-local IPv6 fe80::1', () => {
    expect(validateBaseUrl('http://[fe80::1]/')).toMatch(/link-local/i);
  });

  // Blocked: RFC-1918
  it('blocks RFC-1918 10.0.0.1', () => {
    expect(validateBaseUrl('http://10.0.0.1/')).toMatch(/rfc-1918/i);
  });

  it('blocks RFC-1918 10.255.255.255', () => {
    expect(validateBaseUrl('http://10.255.255.255/')).toMatch(/rfc-1918/i);
  });

  it('blocks RFC-1918 192.168.1.100', () => {
    expect(validateBaseUrl('http://192.168.1.100/')).toMatch(/rfc-1918/i);
  });

  it('blocks RFC-1918 172.16.0.1 (start of range)', () => {
    expect(validateBaseUrl('http://172.16.0.1/')).toMatch(/rfc-1918/i);
  });

  it('blocks RFC-1918 172.31.255.255 (end of range)', () => {
    expect(validateBaseUrl('http://172.31.255.255/')).toMatch(/rfc-1918/i);
  });

  it('allows 172.15.0.1 (just below RFC-1918 172.x range)', () => {
    expect(validateBaseUrl('http://172.15.0.1/')).toBeNull();
  });

  it('allows 172.32.0.1 (just above RFC-1918 172.x range)', () => {
    expect(validateBaseUrl('http://172.32.0.1/')).toBeNull();
  });

  // Blocked: non-http(s) schemes
  it('blocks file:// scheme', () => {
    expect(validateBaseUrl('file:///etc/passwd')).toMatch(/scheme/i);
  });

  it('blocks ftp:// scheme', () => {
    expect(validateBaseUrl('ftp://example.com/')).toMatch(/scheme/i);
  });

  // Blocked: 0.0.0.0
  it('blocks 0.0.0.0 (unspecified address)', () => {
    expect(validateBaseUrl('http://0.0.0.0/')).toMatch(/0\.0\.0\.0/);
  });

  // Blocked: unparseable
  it('rejects unparseable string', () => {
    expect(validateBaseUrl('not-a-url')).toMatch(/invalid/i);
  });

  it('rejects empty string', () => {
    expect(validateBaseUrl('')).toMatch(/invalid/i);
  });

  // IPv4-mapped IPv6 bypass (SKY-752) — WHATWG URL normalises ::ffff:a.b.c.d to hex form.
  it('blocks IPv4-mapped IPv6 APIPA (::ffff:169.254.169.254)', () => {
    expect(validateBaseUrl('http://[::ffff:169.254.169.254]/')).toMatch(/link-local/i);
  });
  it('blocks IPv4-mapped IPv6 RFC-1918 10.x', () => {
    expect(validateBaseUrl('http://[::ffff:10.0.0.1]/')).toMatch(/rfc-1918/i);
  });
  it('blocks IPv4-mapped IPv6 RFC-1918 192.168.x', () => {
    expect(validateBaseUrl('http://[::ffff:192.168.1.1]/')).toMatch(/rfc-1918/i);
  });
  it('blocks IPv4-mapped IPv6 RFC-1918 172.16.x', () => {
    expect(validateBaseUrl('http://[::ffff:172.16.0.1]/')).toMatch(/rfc-1918/i);
  });
  it('allows IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', () => {
    expect(validateBaseUrl('http://[::ffff:127.0.0.1]/')).toBeNull();
  });
});

// ─── capabilities field round-trips (§5) ─────────────────────────────────────

describe('capabilities field round-trips (§5)', () => {
  it('validateProviderConfig accepts config with full capabilities', () => {
    expect(validateProviderConfig(makeOpenAIConfig({ capabilities: { transcribe: true, speak: true } }))).toBeNull();
  });

  it('validateProviderConfig accepts config with partial capabilities', () => {
    expect(validateProviderConfig(makeOpenAIConfig({ capabilities: { transcribe: true } }))).toBeNull();
  });

  it('validateProviderConfig accepts config without capabilities (backward compat)', () => {
    expect(validateProviderConfig(makeOpenAIConfig())).toBeNull();
  });

  it('validateProviderConfig accepts anthropic config with explicit capabilities', () => {
    expect(validateProviderConfig(makeAnthropicConfig({ capabilities: { transcribe: true, speak: true } }))).toBeNull();
  });

  it('capabilities are preserved through providerConfigForAgent', () => {
    const base = makeOpenAIConfig({ capabilities: { transcribe: true, speak: false } });
    const result = providerConfigForAgent(base, 'gpt-4o');
    expect(result.capabilities).toEqual({ transcribe: true, speak: false });
    expect(result.model).toBe('gpt-4o');
  });
});

// ─── getVoiceProvider (§6) ───────────────────────────────────────────────────

describe('getVoiceProvider (§6)', () => {
  it('returns null when settings has no provider', () => {
    expect(getVoiceProvider({})).toBeNull();
  });

  it('returns null when provider is anthropic (no default voice caps)', () => {
    expect(getVoiceProvider({ provider: makeAnthropicConfig() })).toBeNull();
  });

  it('returns null when provider is ollama (no default voice caps)', () => {
    expect(getVoiceProvider({ provider: makeOllamaConfig() })).toBeNull();
  });

  it('returns null when provider is lmstudio (no default voice caps)', () => {
    expect(getVoiceProvider({ provider: makeLmStudioConfig() })).toBeNull();
  });

  it('returns null for custom kind without baseUrl', () => {
    expect(getVoiceProvider({ provider: { kind: 'custom', model: 'x' } })).toBeNull();
  });

  it('returns provider for openai kind (auto voice-capable)', () => {
    const p = makeOpenAIConfig();
    expect(getVoiceProvider({ provider: p })).toBe(p);
  });

  it('returns provider for custom kind with baseUrl (auto voice-capable)', () => {
    const p = makeCustomConfig();
    expect(getVoiceProvider({ provider: p })).toBe(p);
  });

  it('returns provider when explicit transcribe=true overrides kind default', () => {
    const p = makeAnthropicConfig({ capabilities: { transcribe: true } });
    expect(getVoiceProvider({ provider: p })).toBe(p);
  });

  it('returns provider when explicit speak=true overrides kind default', () => {
    const p = makeOllamaConfig({ capabilities: { speak: true } });
    expect(getVoiceProvider({ provider: p })).toBe(p);
  });

  it('returns provider when both transcribe and speak are explicitly true', () => {
    const p = makeOpenAIConfig({ capabilities: { transcribe: true, speak: true } });
    expect(getVoiceProvider({ provider: p })).toBe(p);
  it('inherits the global api key when an agent provider override uses the same kind without its own key', () => {
    const globalOpenAI = makeOpenAIConfig({ apiKey: 'sk-openai-global', model: 'gpt-4o' });
    const agentOpenAI = makeOpenAIConfig({ apiKey: undefined, model: 'gpt-4o-mini' });

    const result = providerConfigForAgent(globalOpenAI, undefined, agentOpenAI);

    expect(result).toStrictEqual({ ...agentOpenAI, apiKey: 'sk-openai-global' });
    expect(agentOpenAI.apiKey).toBeUndefined();
  });

  it('does not inherit the global api key when an agent provider override uses a different kind', () => {
    const globalAnthropic = makeAnthropicConfig({ apiKey: 'sk-ant-global', model: 'claude-sonnet-4-6' });
    const agentOllama = makeOllamaConfig({ model: 'llama3.2' });

    const result = providerConfigForAgent(globalAnthropic, undefined, agentOllama);

    expect(result).toStrictEqual(agentOllama);
    expect(result.kind).toBe('ollama');
    expect(result.apiKey).toBeUndefined();
  });

  it('inherits the global api key when an agent provider override uses the same kind without its own key', () => {
    const globalOpenAI = makeOpenAIConfig({ apiKey: 'sk-openai-global', model: 'gpt-4o' });
    const agentOpenAI = makeOpenAIConfig({ apiKey: undefined, model: 'gpt-4o-mini' });

    const result = providerConfigForAgent(globalOpenAI, undefined, agentOpenAI);

    expect(result).toStrictEqual({ ...agentOpenAI, apiKey: 'sk-openai-global' });
    expect(agentOpenAI.apiKey).toBeUndefined();
  });

  it('does not inherit the global api key when an agent provider override uses a different kind', () => {
    const globalAnthropic = makeAnthropicConfig({ apiKey: 'sk-ant-global', model: 'claude-sonnet-4-6' });
    const agentOllama = makeOllamaConfig({ model: 'llama3.2' });

    const result = providerConfigForAgent(globalAnthropic, undefined, agentOllama);

    expect(result).toStrictEqual(agentOllama);
    expect(result.kind).toBe('ollama');
    expect(result.apiKey).toBeUndefined();
  });
});

// ─── validateBaseUrl (§5) ─────────────────────────────────────────────────────

describe('validateBaseUrl (§5)', () => {
  it('returns null for localhost', () => {
    expect(validateBaseUrl('http://localhost:11434')).toBeNull();
  });

  it('returns null for 127.0.0.1', () => {
    expect(validateBaseUrl('http://127.0.0.1:1234')).toBeNull();
  });

  it('returns null for 127.x.x.x subnet', () => {
    expect(validateBaseUrl('http://127.0.0.99')).toBeNull();
  });

  it('returns null for ::1 (IPv6 loopback)', () => {
    expect(validateBaseUrl('http://[::1]:8080')).toBeNull();
  });

  it('blocks 10.x.x.x (RFC-1918 /8)', () => {
    expect(validateBaseUrl('http://10.0.0.1')).toMatch(/RFC-1918/);
  });

  it('blocks 192.168.x.x (RFC-1918 /16)', () => {
    expect(validateBaseUrl('http://192.168.1.1')).toMatch(/RFC-1918/);
  });

  it('blocks 172.16.x.x (RFC-1918 /12 lower bound)', () => {
    expect(validateBaseUrl('http://172.16.0.1')).toMatch(/RFC-1918/);
  });

  it('blocks 172.31.x.x (RFC-1918 /12 upper bound)', () => {
    expect(validateBaseUrl('http://172.31.255.255')).toMatch(/RFC-1918/);
  });

  it('allows 172.15.x.x (just outside RFC-1918 /12)', () => {
    expect(validateBaseUrl('http://172.15.0.1')).toBeNull();
  });

  it('blocks 169.254.x.x (link-local / APIPA)', () => {
    expect(validateBaseUrl('http://169.254.169.254')).toMatch(/link-local/);
  });

  it('blocks fe80:: (IPv6 link-local)', () => {
    expect(validateBaseUrl('http://[fe80::1]')).toMatch(/link-local/);
  });

  it('blocks 0.0.0.0', () => {
    expect(validateBaseUrl('http://0.0.0.0')).toMatch(/0\.0\.0\.0/);
  });

  it('blocks file:// scheme', () => {
    expect(validateBaseUrl('file:///etc/passwd')).toMatch(/scheme/i);
  });

  it('blocks ftp:// scheme', () => {
    expect(validateBaseUrl('ftp://example.com')).toMatch(/scheme/i);
  });

  it('returns error for unparseable URL', () => {
    expect(validateBaseUrl('not-a-url')).toMatch(/invalid url/i);
  });

  it('blocks IPv4-mapped IPv6 for RFC-1918 address (::ffff:c0a8:101 → 192.168.1.1)', () => {
    expect(validateBaseUrl('http://[::ffff:c0a8:101]')).toMatch(/RFC-1918/);
  });

  it('blocks IPv4-mapped IPv6 for 10.x (::ffff:0a00:0001 → 10.0.0.1)', () => {
    expect(validateBaseUrl('http://[::ffff:0a00:0001]')).toMatch(/RFC-1918/);
  });
});

// ─── listModels (§6) ─────────────────────────────────────────────────────────

describe('listModels (§6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeJsonResponse(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }

  it('returns { ok: false } when SSRF guard blocks the URL (no fetch called)', async () => {
    const result = await listModels({ kind: 'custom', baseUrl: 'http://192.168.1.1/v1' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/RFC-1918/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns { ok: false } with timeout copy on AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(abortErr);
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/timed out/i);
  });

  it('parses Ollama /api/tags response (models[].name)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ models: [{ name: 'llama3' }, { name: 'phi3' }] }),
    );
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result).toEqual({ ok: true, models: ['llama3', 'phi3'] });
  });

  it('fetches Ollama at {origin}/api/tags, stripping any /v1 suffix', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:11434/api/tags');
  });

  it('parses OpenAI /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
    );
    const result = await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(result).toEqual({ ok: true, models: ['gpt-4o', 'gpt-4o-mini'] });
  });

  it('parses LM Studio /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'local-model' }] }),
    );
    const result = await listModels({ kind: 'lmstudio', baseUrl: 'http://localhost:1234/v1' });
    expect(result).toEqual({ ok: true, models: ['local-model'] });
  });

  it('parses custom endpoint /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'custom-model' }] }),
    );
    const result = await listModels({ kind: 'custom', baseUrl: 'http://localhost:9999/v1' });
    expect(result).toEqual({ ok: true, models: ['custom-model'] });
  });

  it('returns { ok: false } on HTTP error response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({}, 401));
    const result = await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/HTTP 401/);
  });

  it('returns { ok: false } on network error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('fetch failed'));
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result.ok).toBe(false);
  });

  it('forwards Bearer token when apiKey is provided', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ data: [] }));
    await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('omits Authorization header when no apiKey', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('returns { ok: false } when custom kind has no baseUrl', async () => {
    const result = await listModels({ kind: 'custom' });
    expect(result.ok).toBe(false);
  });

  it('uses DEFAULT_BASE_URLS.ollama when no baseUrl given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('127.0.0.1:11434');
  });
});

// ─── validateBaseUrl (§5) ─────────────────────────────────────────────────────

describe('validateBaseUrl (§5)', () => {
  it('returns null for localhost', () => {
    expect(validateBaseUrl('http://localhost:11434')).toBeNull();
  });

  it('returns null for 127.0.0.1', () => {
    expect(validateBaseUrl('http://127.0.0.1:1234')).toBeNull();
  });

  it('returns null for 127.x.x.x subnet', () => {
    expect(validateBaseUrl('http://127.0.0.99')).toBeNull();
  });

  it('returns null for ::1 (IPv6 loopback)', () => {
    expect(validateBaseUrl('http://[::1]:8080')).toBeNull();
  });

  it('blocks 10.x.x.x (RFC-1918 /8)', () => {
    expect(validateBaseUrl('http://10.0.0.1')).toMatch(/RFC-1918/);
  });

  it('blocks 192.168.x.x (RFC-1918 /16)', () => {
    expect(validateBaseUrl('http://192.168.1.1')).toMatch(/RFC-1918/);
  });

  it('blocks 172.16.x.x (RFC-1918 /12 lower bound)', () => {
    expect(validateBaseUrl('http://172.16.0.1')).toMatch(/RFC-1918/);
  });

  it('blocks 172.31.x.x (RFC-1918 /12 upper bound)', () => {
    expect(validateBaseUrl('http://172.31.255.255')).toMatch(/RFC-1918/);
  });

  it('allows 172.15.x.x (just outside RFC-1918 /12)', () => {
    expect(validateBaseUrl('http://172.15.0.1')).toBeNull();
  });

  it('blocks 169.254.x.x (link-local / APIPA)', () => {
    expect(validateBaseUrl('http://169.254.169.254')).toMatch(/link-local/);
  });

  it('blocks fe80:: (IPv6 link-local)', () => {
    expect(validateBaseUrl('http://[fe80::1]')).toMatch(/link-local/);
  });

  it('blocks 0.0.0.0', () => {
    expect(validateBaseUrl('http://0.0.0.0')).toMatch(/0\.0\.0\.0/);
  });

  it('blocks file:// scheme', () => {
    expect(validateBaseUrl('file:///etc/passwd')).toMatch(/scheme/i);
  });

  it('blocks ftp:// scheme', () => {
    expect(validateBaseUrl('ftp://example.com')).toMatch(/scheme/i);
  });

  it('returns error for unparseable URL', () => {
    expect(validateBaseUrl('not-a-url')).toMatch(/invalid url/i);
  });

  it('blocks IPv4-mapped IPv6 for RFC-1918 address (::ffff:c0a8:101 → 192.168.1.1)', () => {
    expect(validateBaseUrl('http://[::ffff:c0a8:101]')).toMatch(/RFC-1918/);
  });

  it('blocks IPv4-mapped IPv6 for 10.x (::ffff:0a00:0001 → 10.0.0.1)', () => {
    expect(validateBaseUrl('http://[::ffff:0a00:0001]')).toMatch(/RFC-1918/);
  });
});

// ─── listModels (§6) ─────────────────────────────────────────────────────────

describe('listModels (§6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeJsonResponse(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }

  it('returns { ok: false } when SSRF guard blocks the URL (no fetch called)', async () => {
    const result = await listModels({ kind: 'custom', baseUrl: 'http://192.168.1.1/v1' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/RFC-1918/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns { ok: false } with timeout copy on AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(abortErr);
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/timed out/i);
  });

  it('parses Ollama /api/tags response (models[].name)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ models: [{ name: 'llama3' }, { name: 'phi3' }] }),
    );
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result).toEqual({ ok: true, models: ['llama3', 'phi3'] });
  });

  it('fetches Ollama at {origin}/api/tags, stripping any /v1 suffix', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:11434/api/tags');
  });

  it('parses OpenAI /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
    );
    const result = await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(result).toEqual({ ok: true, models: ['gpt-4o', 'gpt-4o-mini'] });
  });

  it('parses LM Studio /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'local-model' }] }),
    );
    const result = await listModels({ kind: 'lmstudio', baseUrl: 'http://localhost:1234/v1' });
    expect(result).toEqual({ ok: true, models: ['local-model'] });
  });

  it('parses custom endpoint /models response (data[].id)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJsonResponse({ data: [{ id: 'custom-model' }] }),
    );
    const result = await listModels({ kind: 'custom', baseUrl: 'http://localhost:9999/v1' });
    expect(result).toEqual({ ok: true, models: ['custom-model'] });
  });

  it('returns { ok: false } on HTTP error response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({}, 401));
    const result = await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/HTTP 401/);
  });

  it('returns { ok: false } on network error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('fetch failed'));
    const result = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(result.ok).toBe(false);
  });

  it('forwards Bearer token when apiKey is provided', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ data: [] }));
    await listModels({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('omits Authorization header when no apiKey', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434' });
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('returns { ok: false } when custom kind has no baseUrl', async () => {
    const result = await listModels({ kind: 'custom' });
    expect(result.ok).toBe(false);
  });

  it('uses DEFAULT_BASE_URLS.ollama when no baseUrl given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(makeJsonResponse({ models: [] }));
    await listModels({ kind: 'ollama' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('127.0.0.1:11434');
  });
});
