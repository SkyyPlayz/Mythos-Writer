// Adapter contract conformance tests — SKY-463 / GH#210
//
// Asserts that Anthropic and OpenAI-compatible fixtures satisfy the
// ProviderAdapter interface types at runtime.  TypeScript compilation
// validates structural conformance; these tests validate value invariants
// (e.g. totalTokens === inputTokens + outputTokens, valid enum members).

import { describe, it, expect } from 'vitest';
import type {
  AdapterRequest,
  StreamEvent,
  TokenUsage,
  AdapterError,
  DeltaEvent,
  FinishEvent,
  AdapterErrorKind,
  StopReason,
} from './types.js';
import {
  ANTHROPIC_REQUEST_FIXTURE,
  ANTHROPIC_USAGE_FIXTURE,
  ANTHROPIC_STREAM_EVENTS_FIXTURE,
  ANTHROPIC_AUTH_ERROR_FIXTURE,
  ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE,
} from './fixtures/anthropic.js';
import {
  OPENAI_REQUEST_FIXTURE,
  OPENAI_USAGE_FIXTURE,
  OPENAI_STREAM_EVENTS_FIXTURE,
  OPENAI_AUTH_ERROR_FIXTURE,
  OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE,
} from './fixtures/openai.js';
import { REGISTERED_ADAPTER_KINDS, isAdapterRegistered } from './registry.js';

// ─── Shape-conformance helpers ────────────────────────────────────────────────

const VALID_ROLES = ['user', 'assistant'] as const;
const VALID_STOP_REASONS: StopReason[] = [
  'end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'cancelled', 'error',
];
const VALID_ERROR_KINDS: AdapterErrorKind[] = [
  'auth', 'rate_limit', 'context_length', 'network', 'server', 'malformed',
];

function assertValidRequest(req: AdapterRequest): void {
  expect(typeof req.model).toBe('string');
  expect(req.model.length).toBeGreaterThan(0);
  expect(Array.isArray(req.messages)).toBe(true);
  for (const msg of req.messages) {
    expect(VALID_ROLES).toContain(msg.role);
    expect(msg.content).toBeDefined();
  }
  if (req.maxTokens !== undefined) {
    expect(typeof req.maxTokens).toBe('number');
    expect(req.maxTokens).toBeGreaterThan(0);
  }
  if (req.temperature !== undefined) {
    expect(typeof req.temperature).toBe('number');
    expect(req.temperature).toBeGreaterThanOrEqual(0);
    expect(req.temperature).toBeLessThanOrEqual(1);
  }
  if (req.stopSequences !== undefined) {
    expect(Array.isArray(req.stopSequences)).toBe(true);
  }
}

function assertValidTokenUsage(usage: TokenUsage): void {
  expect(typeof usage.inputTokens).toBe('number');
  expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
  expect(typeof usage.outputTokens).toBe('number');
  expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
  expect(typeof usage.totalTokens).toBe('number');
  expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  if (usage.cacheReadInputTokens !== undefined) {
    expect(typeof usage.cacheReadInputTokens).toBe('number');
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    expect(typeof usage.cacheCreationInputTokens).toBe('number');
  }
}

function assertValidStreamEvent(evt: StreamEvent): void {
  expect(['delta', 'tool_use', 'finish', 'error']).toContain(evt.type);
  if (evt.type === 'delta') {
    expect(typeof (evt as DeltaEvent).text).toBe('string');
  } else if (evt.type === 'finish') {
    const finish = evt as FinishEvent;
    expect(VALID_STOP_REASONS).toContain(finish.stopReason);
    assertValidTokenUsage(finish.usage);
  } else if (evt.type === 'tool_use') {
    expect(typeof (evt as { type: 'tool_use'; id: string; name: string }).id).toBe('string');
    expect(typeof (evt as { type: 'tool_use'; id: string; name: string }).name).toBe('string');
  }
}

function assertValidAdapterError(err: AdapterError): void {
  expect(VALID_ERROR_KINDS).toContain(err.kind);
  expect(typeof err.message).toBe('string');
  expect(err.message.length).toBeGreaterThan(0);
  expect(typeof err.retryable).toBe('boolean');
  if (err.status !== undefined) {
    expect(typeof err.status).toBe('number');
    expect(err.status).toBeGreaterThanOrEqual(100);
  }
}

// ─── Anthropic fixture suite ──────────────────────────────────────────────────

describe('Anthropic fixtures — shape conformance', () => {
  it('ANTHROPIC_REQUEST_FIXTURE satisfies AdapterRequest', () => {
    assertValidRequest(ANTHROPIC_REQUEST_FIXTURE);
  });

  it('ANTHROPIC_REQUEST_FIXTURE targets a Claude model', () => {
    expect(ANTHROPIC_REQUEST_FIXTURE.model).toMatch(/^claude-/);
  });

  it('ANTHROPIC_USAGE_FIXTURE satisfies TokenUsage (includes cache fields)', () => {
    assertValidTokenUsage(ANTHROPIC_USAGE_FIXTURE);
    expect(ANTHROPIC_USAGE_FIXTURE.cacheReadInputTokens).toBeDefined();
    expect(ANTHROPIC_USAGE_FIXTURE.cacheCreationInputTokens).toBeDefined();
  });

  it('every ANTHROPIC_STREAM_EVENTS_FIXTURE entry satisfies StreamEvent', () => {
    expect(ANTHROPIC_STREAM_EVENTS_FIXTURE.length).toBeGreaterThan(0);
    for (const evt of ANTHROPIC_STREAM_EVENTS_FIXTURE) {
      assertValidStreamEvent(evt);
    }
  });

  it('ANTHROPIC_STREAM_EVENTS_FIXTURE ends with a finish event', () => {
    const last = ANTHROPIC_STREAM_EVENTS_FIXTURE[ANTHROPIC_STREAM_EVENTS_FIXTURE.length - 1];
    expect(last.type).toBe('finish');
  });

  it('ANTHROPIC_AUTH_ERROR_FIXTURE is non-retryable auth error with status 401', () => {
    assertValidAdapterError(ANTHROPIC_AUTH_ERROR_FIXTURE);
    expect(ANTHROPIC_AUTH_ERROR_FIXTURE.kind).toBe('auth');
    expect(ANTHROPIC_AUTH_ERROR_FIXTURE.retryable).toBe(false);
    expect(ANTHROPIC_AUTH_ERROR_FIXTURE.status).toBe(401);
  });

  it('ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE is retryable rate_limit error with status 429', () => {
    assertValidAdapterError(ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE);
    expect(ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE.kind).toBe('rate_limit');
    expect(ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE.retryable).toBe(true);
    expect(ANTHROPIC_RATE_LIMIT_ERROR_FIXTURE.status).toBe(429);
  });
});

// ─── OpenAI-compatible fixture suite ─────────────────────────────────────────

describe('OpenAI-compatible fixtures — shape conformance', () => {
  it('OPENAI_REQUEST_FIXTURE satisfies AdapterRequest', () => {
    assertValidRequest(OPENAI_REQUEST_FIXTURE);
  });

  it('OPENAI_REQUEST_FIXTURE does not target a Claude model', () => {
    expect(OPENAI_REQUEST_FIXTURE.model).not.toMatch(/^claude-/);
  });

  it('OPENAI_USAGE_FIXTURE satisfies TokenUsage without cache fields', () => {
    assertValidTokenUsage(OPENAI_USAGE_FIXTURE);
    expect(OPENAI_USAGE_FIXTURE.cacheReadInputTokens).toBeUndefined();
    expect(OPENAI_USAGE_FIXTURE.cacheCreationInputTokens).toBeUndefined();
  });

  it('every OPENAI_STREAM_EVENTS_FIXTURE entry satisfies StreamEvent', () => {
    expect(OPENAI_STREAM_EVENTS_FIXTURE.length).toBeGreaterThan(0);
    for (const evt of OPENAI_STREAM_EVENTS_FIXTURE) {
      assertValidStreamEvent(evt);
    }
  });

  it('OPENAI_STREAM_EVENTS_FIXTURE ends with a finish event', () => {
    const last = OPENAI_STREAM_EVENTS_FIXTURE[OPENAI_STREAM_EVENTS_FIXTURE.length - 1];
    expect(last.type).toBe('finish');
  });

  it('OPENAI_AUTH_ERROR_FIXTURE is non-retryable auth error with status 401', () => {
    assertValidAdapterError(OPENAI_AUTH_ERROR_FIXTURE);
    expect(OPENAI_AUTH_ERROR_FIXTURE.kind).toBe('auth');
    expect(OPENAI_AUTH_ERROR_FIXTURE.retryable).toBe(false);
    expect(OPENAI_AUTH_ERROR_FIXTURE.status).toBe(401);
  });

  it('OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE is non-retryable context_length error with status 400', () => {
    assertValidAdapterError(OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE);
    expect(OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE.kind).toBe('context_length');
    expect(OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE.retryable).toBe(false);
    expect(OPENAI_CONTEXT_LENGTH_ERROR_FIXTURE.status).toBe(400);
  });
});

// ─── Cross-fixture invariants ─────────────────────────────────────────────────

describe('Cross-fixture invariants', () => {
  it('Anthropic and OpenAI fixtures target different model identifiers', () => {
    expect(ANTHROPIC_REQUEST_FIXTURE.model).not.toBe(OPENAI_REQUEST_FIXTURE.model);
  });

  it('Anthropic usage has cache fields; OpenAI usage does not', () => {
    expect(ANTHROPIC_USAGE_FIXTURE.cacheReadInputTokens).toBeDefined();
    expect(OPENAI_USAGE_FIXTURE.cacheReadInputTokens).toBeUndefined();
  });

  it('both fixture streams end with stop_reason end_turn', () => {
    const anthLast = ANTHROPIC_STREAM_EVENTS_FIXTURE[ANTHROPIC_STREAM_EVENTS_FIXTURE.length - 1] as FinishEvent;
    const oaiLast = OPENAI_STREAM_EVENTS_FIXTURE[OPENAI_STREAM_EVENTS_FIXTURE.length - 1] as FinishEvent;
    expect(anthLast.stopReason).toBe('end_turn');
    expect(oaiLast.stopReason).toBe('end_turn');
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe('REGISTERED_ADAPTER_KINDS', () => {
  it('contains anthropic', () => {
    expect(REGISTERED_ADAPTER_KINDS.has('anthropic')).toBe(true);
  });

  it('does not include openai (transport-layer only; not yet wrapped in adapter)', () => {
    expect(REGISTERED_ADAPTER_KINDS.has('openai')).toBe(false);
  });

  it('does not include ollama, lmstudio, or custom', () => {
    expect(REGISTERED_ADAPTER_KINDS.has('ollama')).toBe(false);
    expect(REGISTERED_ADAPTER_KINDS.has('lmstudio')).toBe(false);
    expect(REGISTERED_ADAPTER_KINDS.has('custom')).toBe(false);
  });

  it('isAdapterRegistered returns true for anthropic', () => {
    expect(isAdapterRegistered('anthropic')).toBe(true);
  });

  it('isAdapterRegistered returns false for every non-registered kind', () => {
    expect(isAdapterRegistered('openai')).toBe(false);
    expect(isAdapterRegistered('ollama')).toBe(false);
    expect(isAdapterRegistered('lmstudio')).toBe(false);
    expect(isAdapterRegistered('custom')).toBe(false);
  });
});
