// Provider abstraction tests — MYT-324
// Strategy: mock @anthropic-ai/sdk and global fetch; test routing, token emission,
// error handling, validation, and config helpers without network calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import {
  streamFromProvider,
  validateProviderConfig,
  providerConfigForAgent,
  DEFAULT_BASE_URLS,
  type ProviderConfig,
  type StreamRequest,
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
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(opts: { apiKey: string }) {
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
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ messages: mockMessages });

    const tokens = await collectTokens(streamFromProvider(makeAnthropicConfig(), makeReq()));
    expect(tokens).toEqual(['Hello', ' World']);
  });

  it('passes system prompt to the SDK when present', async () => {
    let capturedParams: unknown;
    const mockMessages = {
      stream: vi.fn().mockImplementation((params: unknown) => {
        capturedParams = params;
        return (async function* () {})();
      }),
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ messages: mockMessages });

    await collectTokens(streamFromProvider(makeAnthropicConfig(), makeReq({ system: 'You are a writer.' })));
    expect((capturedParams as { system: string }).system).toBe('You are a writer.');
  });

  it('omits system field when no system prompt given', async () => {
    let capturedParams: unknown;
    const mockMessages = {
      stream: vi.fn().mockImplementation((params: unknown) => {
        capturedParams = params;
        return (async function* () {})();
      }),
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ messages: mockMessages });

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
});
