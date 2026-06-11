// Anthropic adapter fixtures — SKY-463 / GH#210
//
// Golden request / response / stream-event shapes for the Anthropic provider.
// These values compile against the ProviderAdapter contract types and are
// exercised by adapters.test.ts to assert shape conformance at runtime.

import type {
  AdapterRequest,
  StreamEvent,
  TokenUsage,
  AdapterError,
} from '../types.js';

/** Minimal request that exercises Anthropic-specific fields */
export const ANTHROPIC_REQUEST_FIXTURE: AdapterRequest = {
  model: 'claude-sonnet-4-6',
  messages: [
    { role: 'user', content: 'Write a short paragraph about the nature of creativity.' },
  ],
  system: 'You are a creative writing assistant.',
  maxTokens: 256,
  temperature: 0.7,
  stopSequences: ['\n\n---'],
};

/** Token usage including Anthropic-specific prompt-cache accounting */
export const ANTHROPIC_USAGE_FIXTURE: TokenUsage = {
  inputTokens: 42,
  outputTokens: 128,
  totalTokens: 170,
  cacheReadInputTokens: 30,
  cacheCreationInputTokens: 0,
};

/** Normalized stream events for a typical Anthropic text completion */
export const ANTHROPIC_STREAM_EVENTS_FIXTURE: StreamEvent[] = [
  { type: 'delta', text: 'Creativity is' },
  { type: 'delta', text: ' the bridge between' },
  { type: 'delta', text: ' the known and the unknown.' },
  {
    type: 'finish',
    stopReason: 'end_turn',
    usage: ANTHROPIC_USAGE_FIXTURE,
  },
];

/** Normalized auth error from Anthropic (HTTP 401, non-retryable) */
export const ANTHROPIC_AUTH_ERROR_FIXTURE: AdapterError = {
  kind: 'auth',
  message: 'Invalid API key.',
  retryable: false,
  status: 401,
};

/** Normalized rate-limit error from Anthropic (HTTP 429, retryable) */
export const ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE: AdapterError = {
  kind: 'rate_limit',
  message: 'Rate limit exceeded. Please retry after 60 seconds.',
  retryable: true,
  status: 429,
};
