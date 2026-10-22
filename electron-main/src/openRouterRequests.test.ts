import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('undici', () => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
}));

import { fetch as undiciFetch } from 'undici';
import {
  applyOpenRouterRequestPolicy,
  GoogleModelExcludedError,
  isOpenRouterEndpoint,
  openRouterProviderBlock,
  selectModelExcludingGoogle,
} from '@mythos-writer/shared/openRouterPolicy';
import {
  buildOpenAiCompatibleChatBody,
  listModels,
  streamFromProvider,
  type ProviderConfig,
  type StreamRequest,
} from './provider.js';
import { buildCloudSpeechRequestBody, buildCloudTranscriptionBody } from './voice.js';

const OPENROUTER_PROVIDER = {
  ignore: ['google-vertex', 'google-ai-studio'],
  zdr: true,
  data_collection: 'deny',
} as const;

function expectOpenRouterProvider(provider: unknown): void {
  expect(provider).toEqual(OPENROUTER_PROVIDER);
}

function chatConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    kind: 'custom',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    apiKey: 'sk-or-test',
    ...overrides,
  };
}

function chatReq(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return { messages: [{ role: 'user', content: 'Hello' }], ...overrides };
}

function sseResponse(text: string): Response {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  let idx = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[idx++]));
      else controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

describe('OpenRouter request policy', () => {
  it('rebuilds the provider block so a caller cannot weaken zdr or data_collection', () => {
    const first = openRouterProviderBlock();
    (first.ignore as string[]).push('extra');
    const second = openRouterProviderBlock();
    expectOpenRouterProvider(second);

    const poisoned = applyOpenRouterRequestPolicy({
      model: 'openai/gpt-5.1',
      provider: { zdr: false, data_collection: 'allow', ignore: [] },
    });
    expectOpenRouterProvider(poisoned.provider);
    expect(poisoned.provider.zdr).toBe(true);
    expect(poisoned.provider.data_collection).toBe('deny');
  });

  it('drops mixed-case google/* ids from an auto-route candidate list', () => {
    const routed = applyOpenRouterRequestPolicy({
      model: 'openrouter/auto',
      models: ['Google/Gemini', 'GOOGLE/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'google/gemma'],
    });
    expect(routed.model).toBe('openrouter/auto');
    expect(routed.models).toEqual(['anthropic/claude-sonnet-4.5']);
    expectOpenRouterProvider(routed.provider);
  });

  it('refuses to build a body whose model is Google/Gemini', () => {
    expect(() => applyOpenRouterRequestPolicy({ model: 'Google/Gemini' })).toThrow(GoogleModelExcludedError);
    expect(() => applyOpenRouterRequestPolicy({ model: '  google/gemini-2.5-flash  ' })).toThrow(
      GoogleModelExcludedError,
    );
  });

  it('recognizes OpenRouter hosts and rejects lookalikes', () => {
    expect(isOpenRouterEndpoint('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterEndpoint('HTTPS://OpenRouter.AI/api/v1')).toBe(true);
    expect(isOpenRouterEndpoint('https://api.openrouter.ai/v1')).toBe(true);
    expect(isOpenRouterEndpoint('https://openrouter.ai.evil.example/api/v1')).toBe(false);
    expect(isOpenRouterEndpoint('https://notopenrouter.ai/api/v1')).toBe(false);
    expect(isOpenRouterEndpoint('https://openrouter.ai@evil.example/api')).toBe(false);
    expect(isOpenRouterEndpoint('https://openrouter.ai%2eevil.com/api')).toBe(false);
    expect(isOpenRouterEndpoint('https://openrouter.ai./api/v1')).toBe(true);
    expect(isOpenRouterEndpoint('http://127.0.0.1:11434/v1')).toBe(false);
    expect(isOpenRouterEndpoint(undefined)).toBe(false);
  });

  it('excludes Google/Gemini when choosing a model, compared after lowercasing', () => {
    expect(selectModelExcludingGoogle(['Google/Gemini', 'openai/gpt-5.1'], 'google/gemini')).toBe('openai/gpt-5.1');
    expect(selectModelExcludingGoogle(['Google/Gemini', 'openai/gpt-5.1'], 'Google/Gemini')).toBe('openai/gpt-5.1');
    expect(selectModelExcludingGoogle(['GOOGLE/gemini-flash'], 'GOOGLE/gemini-flash')).toBe('');
    expect(selectModelExcludingGoogle(['anthropic/claude-sonnet-4.5'], 'anthropic/claude-sonnet-4.5')).toBe(
      'anthropic/claude-sonnet-4.5',
    );
  });
});

describe('buildOpenAiCompatibleChatBody', () => {
  const hosts = [
    'https://openrouter.ai/api/v1',
    'https://openrouter.ai/api/v1/',
    'HTTPS://OpenRouter.AI/api/v1',
    'https://api.openrouter.ai/api/v1',
  ];

  it.each(hosts)('adds ignore, zdr, and data_collection for %s', (baseUrl) => {
    const body = buildOpenAiCompatibleChatBody(chatConfig({ baseUrl }), chatReq({ maxTokens: 900 }), baseUrl);
    expectOpenRouterProvider(body.provider);
    expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    expect(body.max_tokens).toBe(900);
    expect(body.stream).toBe(true);
  });

  it('does not add the provider block for OpenAI, localhost, or lookalike hosts', () => {
    for (const baseUrl of [
      'https://api.openai.com/v1',
      'http://127.0.0.1:11434/v1',
      'https://openrouter.ai.evil.example/api/v1',
    ]) {
      const body = buildOpenAiCompatibleChatBody(
        chatConfig({ kind: 'custom', baseUrl, model: 'Google/Gemini' }),
        chatReq(),
        baseUrl,
      );
      expect(body.provider).toBeUndefined();
      expect(body.model).toBe('Google/Gemini');
    }
  });

  it('refuses Google/Gemini on OpenRouter before a request exists', () => {
    expect(() =>
      buildOpenAiCompatibleChatBody(chatConfig({ model: 'Google/Gemini' }), chatReq(), 'https://openrouter.ai/api/v1'),
    ).toThrow(GoogleModelExcludedError);
  });
});

describe('streamFromProvider OpenRouter wire body', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function collect(gen: AsyncIterable<string>): Promise<string[]> {
    const tokens: string[] = [];
    for await (const token of gen) tokens.push(token);
    return tokens;
  }

  it('sends the provider block on the chat completion request', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(sseResponse('ok'));
    await collect(streamFromProvider(chatConfig(), chatReq({ maxTokens: 900, system: 'Be brief.' })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const parsed = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      provider: unknown;
    };
    expectOpenRouterProvider(parsed.provider);
    expect(parsed.model).toBe('anthropic/claude-sonnet-4.5');
    expect(parsed.max_tokens).toBe(900);
    expect(parsed.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('does not call fetch when the OpenRouter model is Google/Gemini', async () => {
    const fetchMock = vi.mocked(fetch);
    await expect(
      collect(streamFromProvider(chatConfig({ model: 'Google/Gemini' }), chatReq())),
    ).rejects.toThrow(GoogleModelExcludedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listModels OpenRouter catalog', () => {
  const mockFetch = undiciFetch as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops mixed-case google/* ids from an OpenRouter catalog', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'Google/Gemini' },
          { id: 'google/gemini-2.5-pro' },
          { id: 'GOOGLE/gemini-flash' },
          { id: 'anthropic/claude-sonnet-4.5' },
          { id: 'openai/gpt-5.1' },
        ],
      }),
    });
    const result = await listModels({ kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(result).toEqual({ ok: true, models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.1'] });
  });

  it('keeps a local model whose id is Google/Gemini', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'Google/Gemini' }, { id: 'local-model' }] }),
    });
    const result = await listModels({ kind: 'custom', baseUrl: 'http://127.0.0.1:1234/v1' });
    expect(result).toEqual({ ok: true, models: ['Google/Gemini', 'local-model'] });
  });
});

describe('cloud voice OpenRouter bodies', () => {
  it('adds the provider block to an OpenRouter speech request and refuses Google/Gemini', () => {
    const body = buildCloudSpeechRequestBody('https://openrouter.ai/api/v1/audio/speech', 'Hello', 'nova');
    expectOpenRouterProvider(body.provider);
    expect(body.model).toBe('tts-1');
    expect(body.voice).toBe('nova');
    expect(body.input).toBe('Hello');

    const weakened = buildCloudSpeechRequestBody(
      'HTTPS://OpenRouter.AI/api/v1/audio/speech',
      'Hello',
      undefined,
      'openai/gpt-4o-mini-tts',
    );
    expectOpenRouterProvider(weakened.provider);
    expect(weakened.voice).toBe('alloy');

    expect(() =>
      buildCloudSpeechRequestBody('https://openrouter.ai/api/v1/audio/speech', 'Hello', 'nova', 'Google/Gemini'),
    ).toThrow(GoogleModelExcludedError);

    const local = buildCloudSpeechRequestBody('http://127.0.0.1:8080/v1/audio/speech', 'Hello', 'nova', 'Google/Gemini');
    expect(local.provider).toBeUndefined();
    expect(local.model).toBe('Google/Gemini');
  });

  it('adds the provider block to an OpenRouter transcription body and refuses Google/Gemini', () => {
    const body = buildCloudTranscriptionBody(
      'https://api.openrouter.ai/v1/audio/transcriptions',
      '----VoiceBoundaryabc',
      Buffer.from('audio'),
      'audio/wav',
      'recording.wav',
    );
    const raw = body.toString('utf8');
    const providerJson = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    expect(JSON.parse(providerJson)).toEqual(OPENROUTER_PROVIDER);
    expect(raw).toContain('whisper-1');
    expect(raw.toLowerCase()).not.toContain('google/gemini');

    const other = buildCloudTranscriptionBody(
      'https://api.openai.com/v1/audio/transcriptions',
      '----VoiceBoundaryabc',
      Buffer.from('audio'),
      'audio/wav',
      'recording.wav',
    );
    expect(other.toString('utf8')).not.toContain('google-vertex');

    expect(() =>
      buildCloudTranscriptionBody(
        'https://openrouter.ai/api/v1/audio/transcriptions',
        '----VoiceBoundaryabc',
        Buffer.from('audio'),
        'audio/wav',
        'recording.wav',
        undefined,
        'Google/Gemini',
      ),
    ).toThrow(GoogleModelExcludedError);

    expect(() =>
      buildCloudTranscriptionBody(
        'https://api.openai.com/v1/audio/transcriptions',
        '----VoiceBoundaryabc',
        Buffer.from('audio'),
        'audio/wav',
        'recording.wav',
        undefined,
        'whisper-1\r\nname="provider"',
      ),
    ).toThrow(/line break/);
  });
});
