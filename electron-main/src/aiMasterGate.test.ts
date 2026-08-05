// M11a (SKY-9160) — master AI gate tests. "Nothing is sent anywhere" is a
// testable claim: with the gate off, streamFromProvider and listModels must
// reject before any SDK construction or fetch, so zero provider egress occurs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import {
  streamFromProvider,
  listModels,
  setAiMasterGate,
  AiDisabledError,
  AI_DISABLED_MESSAGE,
  type ProviderConfig,
  type StreamRequest,
} from './provider.js';

const fetchSpy = vi.fn();

function makeReq(): StreamRequest {
  return { messages: [{ role: 'user', content: 'Hello' }] };
}

const ANTHROPIC_CONFIG: ProviderConfig = {
  kind: 'anthropic',
  apiKey: 'sk-ant-test',
  model: 'claude-haiku-4-5-20251001',
};

const OPENAI_CONFIG: ProviderConfig = {
  kind: 'openai',
  apiKey: 'sk-openai-test',
  model: 'gpt-4o-mini',
};

async function drain(gen: AsyncIterable<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const t of gen) tokens.push(t);
  return tokens;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  setAiMasterGate(() => true);
  vi.unstubAllGlobals();
});

describe('M11a master AI gate', () => {
  it('streamFromProvider throws AiDisabledError with zero network when the gate is off (anthropic)', async () => {
    setAiMasterGate(() => false);
    await expect(drain(streamFromProvider(ANTHROPIC_CONFIG, makeReq()))).rejects.toThrow(AiDisabledError);
    expect(Anthropic).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('streamFromProvider throws AiDisabledError with zero network when the gate is off (openai-compatible)', async () => {
    setAiMasterGate(() => false);
    await expect(drain(streamFromProvider(OPENAI_CONFIG, makeReq()))).rejects.toThrow(AI_DISABLED_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('listModels returns ok:false with zero network when the gate is off', async () => {
    setAiMasterGate(() => false);
    const result = await listModels({ kind: 'openai', apiKey: 'sk-openai-test' });
    expect(result).toEqual({ ok: false, error: AI_DISABLED_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gate reads live state — re-enabling lets calls through again', async () => {
    let enabled = false;
    setAiMasterGate(() => enabled);
    await expect(drain(streamFromProvider(OPENAI_CONFIG, makeReq()))).rejects.toThrow(AiDisabledError);

    enabled = true;
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    // Reaches the provider (fetch fires) — failure past the gate is fine here.
    await expect(drain(streamFromProvider(OPENAI_CONFIG, makeReq()))).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('default gate (tests / standalone module use) is enabled', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const result = await listModels({ kind: 'openai', apiKey: 'sk-openai-test' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false); // 500 from the mock, not the gate
  });
});
