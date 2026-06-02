// OpenAI-compatible adapter fixtures — SKY-463 / GH#210
//
// Golden request / response / stream-event shapes for the OpenAI-compatible
// provider path (OpenAI, Ollama, LM Studio, custom endpoints).
// These values compile against the ProviderAdapter contract types and are
// exercised by adapters.test.ts.  Cache fields (cacheReadInputTokens /
// cacheCreationInputTokens) are intentionally absent — they are Anthropic-specific.

import type {
  AdapterRequest,
  StreamEvent,
  TokenUsage,
  AdapterError,
} from '../types.js';

/** Minimal request for an OpenAI-compatible provider */
export const OPENAI_REQUEST_FIXTURE: AdapterRequest = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user', content: 'Summarise this chapter in two sentences.' },
  ],
  system: 'You are a helpful writing assistant.',
  maxTokens: 128,
  temperature: 0.5,
};

/** Token usage for an OpenAI-compatible provider (no cache fields) */
export const OPENAI_USAGE_FIXTURE: TokenUsage = {
  inputTokens: 20,
  outputTokens: 45,
  totalTokens: 65,
};

/** Normalized stream events for a typical OpenAI-compatible text completion */
export const OPENAI_STREAM_EVENTS_FIXTURE: StreamEvent[] = [
  { type: 'delta', text: 'The protagonist faces a moral dilemma.' },
  { type: 'delta', text: ' Ultimately, she chooses compassion over revenge.' },
  {
    type: 'finish',
    stopReason: 'end_turn',
    usage: OPENAI_USAGE_FIXTURE,
  },
];

/** Normalized auth error from an OpenAI-compatible provider (HTTP 401, non-retryable) */
export const OPENAI_AUTH_ERROR_FIXTURE: AdapterError = {
  kind: 'auth',
  message: 'Incorrect API key provided.',
  retryable: false,
  status: 401,
};

/** Normalized context-length error from an OpenAI-compatible provider (HTTP 400, non-retryable) */
export const OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE: AdapterError = {
  kind: 'context_length',
  message: "This model's maximum context length is 128000 tokens.",
  retryable: false,
  status: 400,
};
