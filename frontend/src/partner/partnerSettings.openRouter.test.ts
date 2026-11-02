import { describe, it, expect } from 'vitest';
import { GoogleModelExcludedError } from '@mythos-writer/shared/openRouterPolicy';
import {
  buildPartnerOpenRouterRequest,
  modelsForProvider,
  scopedModel,
  PROVIDER_MODEL_LISTS,
} from './partnerSettings';

const OPENROUTER_PROVIDER = {
  ignore: ['google-vertex', 'google-ai-studio'],
  zdr: true,
  data_collection: 'deny',
};

describe('partner OpenRouter request builder', () => {
  it('puts ignore, zdr, and data_collection on every partner OpenRouter request', () => {
    const body = buildPartnerOpenRouterRequest({
      model: 'anthropic/claude-sonnet-4.5',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 256,
    });
    expect(body.provider).toEqual(OPENROUTER_PROVIDER);
    expect(body.provider.zdr).toBe(true);
    expect(body.provider.data_collection).toBe('deny');
    expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.stream).toBe(true);
  });

  it('refuses an explicit Google/Gemini model', () => {
    expect(() => buildPartnerOpenRouterRequest({ model: 'Google/Gemini' })).toThrow(GoogleModelExcludedError);
    expect(() => buildPartnerOpenRouterRequest({ model: '  GOOGLE/gemini-2.5-pro  ' })).toThrow(
      GoogleModelExcludedError,
    );
  });

  it('keeps a non-google model and still drops google candidates', () => {
    const body = buildPartnerOpenRouterRequest({
      model: 'anthropic/claude-sonnet-4.5',
      models: ['Google/Gemini', 'openai/gpt-5.1', 'anthropic/claude-sonnet-4.5'],
    });
    expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    expect(body.models).toEqual(['openai/gpt-5.1', 'anthropic/claude-sonnet-4.5']);
    expect(body.provider).toEqual(OPENROUTER_PROVIDER);
  });

  it('drops mixed-case google/* ids from auto-routing candidates', () => {
    const body = buildPartnerOpenRouterRequest({
      model: 'Google/Gemini',
      models: ['Google/Gemini', 'GOOGLE/gemini-flash', 'openai/gpt-5.1', 'google/gemma-2'],
    });
    expect(body.model).toBe('openai/gpt-5.1');
    expect(body.models).toEqual(['openai/gpt-5.1']);
    expect(body.provider).toEqual(OPENROUTER_PROVIDER);
    expect(body.model.toLowerCase().startsWith('google/')).toBe(false);
  });

  it('refuses auto-routing when every candidate is a google model', () => {
    expect(() =>
      buildPartnerOpenRouterRequest({
        model: 'Google/Gemini',
        models: ['Google/Gemini', 'google/gemini-2.5-pro'],
      }),
    ).toThrow(GoogleModelExcludedError);
  });
});

describe('partner OpenRouter model selection', () => {
  it('does not select Google/Gemini for OpenRouter', () => {
    expect(scopedModel('openrouter', 'Google/Gemini')).toBe(PROVIDER_MODEL_LISTS.openrouter[0]);
    expect(scopedModel('openrouter', 'google/gemini')).toBe('anthropic/claude-sonnet-4.5');
    expect(scopedModel('openrouter', 'GOOGLE/gemini-2.5-flash', 1)).toBe('openai/gpt-5.1');
    expect(scopedModel('openrouter', 'Google/Gemini').toLowerCase().startsWith('google/')).toBe(false);
  });

  it('still returns a listed non-google model', () => {
    expect(scopedModel('openrouter', 'openai/gpt-5.1')).toBe('openai/gpt-5.1');
    expect(scopedModel('claude', 'claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(scopedModel('openrouter', 'OpenAI/GPT-5.1')).toBe('anthropic/claude-sonnet-4.5');
  });

  it('hides google/* ids from every provider model list', () => {
    for (const id of Object.keys(PROVIDER_MODEL_LISTS) as Array<keyof typeof PROVIDER_MODEL_LISTS>) {
      for (const model of modelsForProvider(id)) {
        expect(model.trim().toLowerCase().startsWith('google/')).toBe(false);
      }
    }
  });
});
