/**
 * agentStreaming.smoke.test.ts  (MYT-209)
 *
 * Smoke checklist:
 *   1. Streaming token render   — chunk events delivered token-by-token per agent
 *   2. Mid-stream cancel        — stream-cancel channel aborts delivery cleanly
 *   3. Prompt-history capture   — generation_log row persisted after each call
 *
 * Covers: brainstorm, writing-assistant, vault-check agents.
 *
 * We don't import main.ts (Electron side-effects). Instead we replicate the
 * exact handler pattern from main.ts with injected mocks, mirroring the
 * approach in agentCancel.test.ts and streaming.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Hoist mocks so module resolution picks them up before any imports.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import type { IpcMainInvokeEvent } from 'electron';
import { openDb, closeDb, insertGenerationLog, listGenerationLog } from './db.js';
import { categorizeStreamError, streamErrorUserMessage } from './streaming.js';

// ─── Shared test helpers ─────────────────────────────────────────────────────

type MockSender = {
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};

function makeSender(): MockSender {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    once: vi.fn(),
    off: vi.fn(),
  };
}

function makeEvent(sender: MockSender): IpcMainInvokeEvent {
  return { sender } as unknown as IpcMainInvokeEvent;
}

/** Wraps tokens in a realistic SDK event sequence including usage counters. */
async function* fullStream(tokens: string[], tokensIn = 8, tokensOut?: number) {
  yield { type: 'message_start', message: { usage: { input_tokens: tokensIn } } };
  for (const t of tokens) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: t } };
  }
  yield { type: 'message_delta', usage: { output_tokens: tokensOut ?? tokens.length } };
}

/**
 * Yields one token then waits for the AbortSignal.
 * Used to test mid-stream cancel: the second token is never yielded.
 */
async function* abortableStream(signal: AbortSignal) {
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'first-token' } };
  await new Promise<void>((_, reject) =>
    signal.addEventListener('abort', () => {
      const e = Object.assign(new Error('aborted'), { name: 'AbortError' });
      reject(e);
    }),
  );
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'should-not-arrive' } };
}

// ─── Generic agent handler factory ───────────────────────────────────────────
//
// Replicates the exact loop from registerBrainstormHandler /
// registerWritingAssistantHandler / registerVaultAgentHandlers in main.ts.
// Deps are injected so tests can observe and control behaviour.

interface AgentConfig {
  /** Human label for describe.each */
  agentLabel: string;
  /** Value stored in generation_log.agent (matches main.ts) */
  dbAgentName: string;
  /** IPC event sent before the first token */
  streamStartChannel: string;
  /** IPC event sent for each text chunk */
  chunkChannel: string;
  /** IPC event sent when provider rejects (non-AbortError) */
  errorChannel: string;
  systemPrompt: string;
  buildMessages: (p: Record<string, unknown>) => Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Returns a valid payload for this agent */
  makePayload: () => Record<string, unknown>;
}

type MockAnthropicInstance = {
  messages: { stream: (args: unknown, opts: { signal: AbortSignal }) => AsyncIterable<unknown> };
};

async function runAgentHandler(
  cfg: AgentConfig,
  event: IpcMainInvokeEvent,
  payload: Record<string, unknown>,
  controllers: Map<string, AbortController>,
): Promise<{ text: string; requestId: string }> {
  const client = new Anthropic({ apiKey: 'sk-ant-test' }) as unknown as MockAnthropicInstance;

  const messages = cfg.buildMessages(payload);
  const requestId = crypto.randomUUID();
  const model = 'claude-haiku-4-5-20251001';
  let fullText = '';
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let genError: string | null = null;
  const startedAt = Date.now();

  const controller = new AbortController();
  controllers.set(requestId, controller);
  const onDestroyed = () => controller.abort();
  event.sender.once('destroyed', onDestroyed);

  if (!event.sender.isDestroyed()) {
    event.sender.send(cfg.streamStartChannel, { requestId });
  }

  const stream = client.messages.stream(
    { model, max_tokens: 1024, system: cfg.systemPrompt, messages },
    { signal: controller.signal },
  );

  try {
    for await (const raw of stream) {
      const chunk = raw as {
        type: string;
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        delta?: { type: string; text: string };
      };
      if (chunk.type === 'message_start') {
        tokensIn = chunk.message?.usage?.input_tokens ?? null;
      } else if (chunk.type === 'message_delta') {
        tokensOut = chunk.usage?.output_tokens ?? null;
      } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        fullText += chunk.delta.text;
        if (!event.sender.isDestroyed()) {
          event.sender.send(cfg.chunkChannel, { chunk: chunk.delta.text });
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      genError = (err as Error).message ?? 'unknown';
      const category = categorizeStreamError(err);
      const userMsg = streamErrorUserMessage(category);
      if (!event.sender.isDestroyed()) {
        event.sender.send(cfg.errorChannel, { requestId, category, message: userMsg });
      }
      throw new Error(userMsg);
    }
    // AbortError is swallowed — stream cancelled cleanly.
  } finally {
    controllers.delete(requestId);
    event.sender.off('destroyed', onDestroyed);
    try {
      insertGenerationLog({
        id: crypto.randomUUID(),
        agent: cfg.dbAgentName,
        model,
        endpoint: 'messages.stream',
        request_id: requestId,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: Date.now() - startedAt,
        error: genError,
        created_at: new Date().toISOString(),
        payload_digest: null,
        prompt_text: null,
        response_text: null,
      });
    } catch { /* non-fatal — log failure must not break the agent response */ }
  }

  return { text: fullText, requestId };
}

// ─── Agent configurations ─────────────────────────────────────────────────────

const AGENT_CONFIGS: AgentConfig[] = [
  {
    agentLabel: 'brainstorm',
    dbAgentName: 'brainstorm',
    streamStartChannel: 'agent:brainstorm:stream-start',
    chunkChannel: 'agent:brainstorm:chunk',
    errorChannel: 'agent:brainstorm:error',
    systemPrompt: 'You are a Brainstorm Agent for fiction authors.',
    buildMessages: (p) => {
      const history = (p.history as Array<{ role: 'user' | 'assistant'; content: string }>) ?? [];
      return [...history, { role: 'user', content: String(p.prompt) }];
    },
    makePayload: () => ({ prompt: 'Give me three ideas for a fantasy villain.' }),
  },
  {
    agentLabel: 'writing-assistant',
    dbAgentName: 'writing-assistant',
    streamStartChannel: 'agent:writing-assistant:stream-start',
    chunkChannel: 'agent:writing-assistant:chunk',
    errorChannel: 'agent:writing-assistant:error',
    systemPrompt: 'You are a Writing Assistant for fiction authors.',
    buildMessages: (p) => [{ role: 'user', content: String(p.prompt) }],
    makePayload: () => ({ prompt: 'Improve the pacing of this opening paragraph.' }),
  },
  {
    agentLabel: 'vault-check',
    dbAgentName: 'vault-agent',
    streamStartChannel: 'agent:vault-check:stream-start',
    chunkChannel: 'agent:vault-check:chunk',
    errorChannel: 'agent:vault-check:error',
    systemPrompt: 'You are a Vault Agent. Check the scene for continuity errors.',
    buildMessages: (p) => [{ role: 'user', content: `Scene to check:\n\n${String(p.sceneContent)}` }],
    makePayload: () => ({ sceneContent: 'Elara rode her horse through the dark forest.' }),
  },
];

// ─── Smoke tests (parameterised over all three agents) ────────────────────────

describe.each(AGENT_CONFIGS)('[$agentLabel] streaming smoke', (cfg) => {
  let tmpDir: string;
  let controllers: Map<string, AbortController>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-smoke-'));
    openDb(tmpDir);
    controllers = new Map();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Streaming token render ─────────────────────────────────────────────

  it('sends stream-start with a requestId before the first chunk', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['hello']) },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const result = await runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers);

    const startCalls = sender.send.mock.calls.filter(([ch]) => ch === cfg.streamStartChannel);
    expect(startCalls).toHaveLength(1);
    expect((startCalls[0][1] as { requestId: string }).requestId).toBe(result.requestId);
  });

  it('delivers one chunk event per text token via the correct IPC channel', async () => {
    const tokens = ['The', ' dragon', ' soared', '.'];
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(tokens) },
    } as unknown as Anthropic); })

    const sender = makeSender();
    await runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers);

    const chunkCalls = sender.send.mock.calls.filter(([ch]) => ch === cfg.chunkChannel);
    expect(chunkCalls).toHaveLength(tokens.length);
    expect(chunkCalls.map(([, d]) => (d as { chunk: string }).chunk)).toEqual(tokens);
  });

  it('assembles full response text from all tokens', async () => {
    const tokens = ['Once', ' upon', ' a', ' time', '.'];
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(tokens) },
    } as unknown as Anthropic); })

    const result = await runAgentHandler(
      cfg,
      makeEvent(makeSender()),
      cfg.makePayload(),
      controllers,
    );

    expect(result.text).toBe('Once upon a time.');
  });

  it('ignores non-text-delta chunk types without error or extra events', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['word']) },
    } as unknown as Anthropic); })

    const sender = makeSender();
    await runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers);

    // message_start and message_delta events must NOT leak out as chunk events.
    const chunkCalls = sender.send.mock.calls.filter(([ch]) => ch === cfg.chunkChannel);
    expect(chunkCalls).toHaveLength(1);
    expect((chunkCalls[0][1] as { chunk: string }).chunk).toBe('word');
  });

  it('returns a unique requestId for each invocation', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream([]) },
    } as unknown as Anthropic); })

    const r1 = await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);
    const r2 = await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);

    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it('includes conversation history in messages for brainstorm (multi-turn)', async () => {
    if (cfg.agentLabel !== 'brainstorm') return; // only brainstorm carries history

    let capturedMessages: unknown[] | undefined;
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (args: { messages: unknown[] }) => {
          capturedMessages = args.messages;
          return fullStream(['ok']);
        },
      },
    } as unknown as Anthropic); })

    const payload = {
      prompt: 'Expand on that.',
      history: [
        { role: 'user', content: 'Give me a villain idea.' },
        { role: 'assistant', content: 'How about a fallen angel?' },
      ],
    };

    await runAgentHandler(cfg, makeEvent(makeSender()), payload, controllers);

    expect(Array.isArray(capturedMessages)).toBe(true);
    expect((capturedMessages as Array<{ role: string }>).length).toBe(3);
    expect((capturedMessages as Array<{ role: string }>)[0].role).toBe('user');
    expect((capturedMessages as Array<{ role: string }>)[1].role).toBe('assistant');
    expect((capturedMessages as Array<{ role: string }>)[2].role).toBe('user');
  });

  // ── 2. Mid-stream cancel via STREAM_CANCEL ────────────────────────────────

  it('cancel stops chunk delivery — only tokens before cancel arrive', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_args: unknown, opts: { signal: AbortSignal }) =>
          abortableStream(opts.signal),
      },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const handlerPromise = runAgentHandler(
      cfg,
      makeEvent(sender),
      cfg.makePayload(),
      controllers,
    );

    // Allow generator to yield the first token.
    await new Promise((r) => setTimeout(r, 0));

    const chunksBefore = sender.send.mock.calls.filter(([ch]) => ch === cfg.chunkChannel);
    expect(chunksBefore).toHaveLength(1);
    expect((chunksBefore[0][1] as { chunk: string }).chunk).toBe('first-token');

    // Simulate cancel IPC: abort + remove from registry (exact behaviour from main.ts).
    const startCall = sender.send.mock.calls.find(([ch]) => ch === cfg.streamStartChannel);
    const requestId = (startCall![1] as { requestId: string }).requestId;
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);

    await handlerPromise;

    const chunksAfter = sender.send.mock.calls.filter(([ch]) => ch === cfg.chunkChannel);
    expect(chunksAfter).toHaveLength(1); // 'should-not-arrive' was never sent
  });

  it('cancel resolves the handler cleanly (no rejection)', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_: unknown, opts: { signal: AbortSignal }) =>
          abortableStream(opts.signal),
      },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const handlerPromise = runAgentHandler(
      cfg,
      makeEvent(sender),
      cfg.makePayload(),
      controllers,
    );
    await new Promise((r) => setTimeout(r, 0));

    const startCall = sender.send.mock.calls.find(([ch]) => ch === cfg.streamStartChannel);
    const requestId = (startCall![1] as { requestId: string }).requestId;
    controllers.get(requestId)?.abort();

    await expect(handlerPromise).resolves.not.toThrow();
  });

  it('partial text accumulated before cancel is returned', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_: unknown, opts: { signal: AbortSignal }) =>
          abortableStream(opts.signal),
      },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const handlerPromise = runAgentHandler(
      cfg,
      makeEvent(sender),
      cfg.makePayload(),
      controllers,
    );
    await new Promise((r) => setTimeout(r, 0));

    const startCall = sender.send.mock.calls.find(([ch]) => ch === cfg.streamStartChannel);
    const requestId = (startCall![1] as { requestId: string }).requestId;
    controllers.get(requestId)?.abort();

    const result = await handlerPromise;
    expect(result.text).toBe('first-token');
  });

  it('controller is removed from the registry after cancel', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_: unknown, opts: { signal: AbortSignal }) =>
          abortableStream(opts.signal),
      },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const handlerPromise = runAgentHandler(
      cfg,
      makeEvent(sender),
      cfg.makePayload(),
      controllers,
    );
    await new Promise((r) => setTimeout(r, 0));

    const startCall = sender.send.mock.calls.find(([ch]) => ch === cfg.streamStartChannel);
    const requestId = (startCall![1] as { requestId: string }).requestId;
    expect(controllers.has(requestId)).toBe(true);

    controllers.get(requestId)?.abort();
    controllers.delete(requestId); // mirrors cancel handler

    await handlerPromise;
    expect(controllers.has(requestId)).toBe(false);
  });

  it('multiple independent streams can be cancelled independently', async () => {
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    controllers.set('req-a', ctrlA);
    controllers.set('req-b', ctrlB);

    controllers.get('req-a')?.abort();
    controllers.delete('req-a');

    expect(ctrlA.signal.aborted).toBe(true);
    expect(ctrlB.signal.aborted).toBe(false);
    expect(controllers.has('req-a')).toBe(false);
    expect(controllers.has('req-b')).toBe(true);
  });

  // ── 3. Prompt-history capture ─────────────────────────────────────────────

  it('writes one generation_log row with correct agent name and model', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['A', 'B', 'C']) },
    } as unknown as Anthropic); })

    await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);

    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe(cfg.dbAgentName);
    expect(rows[0].model).toBe('claude-haiku-4-5-20251001');
    expect(rows[0].endpoint).toBe('messages.stream');
  });

  it('generation_log captures input and output token counts', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['hello'], 42, 7) },
    } as unknown as Anthropic); })

    await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);

    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows[0].tokens_in).toBe(42);
    expect(rows[0].tokens_out).toBe(7);
  });

  it('generation_log records a non-negative latency_ms', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['x']) },
    } as unknown as Anthropic); })

    await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);

    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('generation_log row has null error on successful stream', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['ok']) },
    } as unknown as Anthropic); })

    await runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers);

    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows[0].error).toBeNull();
  });

  it('generation_log row is persisted even when stream is cancelled mid-flight', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_: unknown, opts: { signal: AbortSignal }) =>
          abortableStream(opts.signal),
      },
    } as unknown as Anthropic); })

    const sender = makeSender();
    const handlerPromise = runAgentHandler(
      cfg,
      makeEvent(sender),
      cfg.makePayload(),
      controllers,
    );
    await new Promise((r) => setTimeout(r, 0));

    const startCall = sender.send.mock.calls.find(([ch]) => ch === cfg.streamStartChannel);
    const requestId = (startCall![1] as { requestId: string }).requestId;
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);

    await handlerPromise;

    // Log must exist — AbortError is swallowed, not an error.
    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBeNull();
  });

  it('generation_log request_id matches the requestId returned to the caller', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['token']) },
    } as unknown as Anthropic); })

    const result = await runAgentHandler(
      cfg,
      makeEvent(makeSender()),
      cfg.makePayload(),
      controllers,
    );

    const rows = listGenerationLog({ agent: cfg.dbAgentName });
    expect(rows[0].request_id).toBe(result.requestId);
  });

  it('controller is removed from registry after successful stream', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => fullStream(['done']) },
    } as unknown as Anthropic); })

    const result = await runAgentHandler(
      cfg,
      makeEvent(makeSender()),
      cfg.makePayload(),
      controllers,
    );

    expect(controllers.has(result.requestId)).toBe(false);
  });

  // ── 4. Provider rejection before first content chunk ─────────────────────

  async function* rejectingStream(err: unknown) {
    throw err;
    yield; // make TypeScript happy with the async generator return type
  }

  const providerRejections = [
    {
      label: '401 invalid API key',
      error: Object.assign(new Error('invalid_api_key'), { status: 401 }),
      expectedCategory: 'auth',
      expectedMessage: 'Authentication error — check your API key in Settings.',
    },
    {
      label: '429 rate limit',
      error: Object.assign(new Error('rate_limit_exceeded'), { status: 429 }),
      expectedCategory: 'rate_limited',
      expectedMessage: 'Rate limit reached — try again shortly.',
    },
    {
      label: '403 permission denied',
      error: Object.assign(new Error('permission_error'), { status: 403 }),
      expectedCategory: 'auth',
      expectedMessage: 'Authentication error — check your API key in Settings.',
    },
    {
      label: '404 model not found',
      error: Object.assign(new Error('model_not_found'), { status: 404 }),
      expectedCategory: 'invalid_request',
      expectedMessage: 'Invalid request — check the model and input parameters.',
    },
  ] as const;

  describe.each(providerRejections)('provider rejection: $label', ({ error, expectedCategory, expectedMessage }) => {
    it('sends a categorized error IPC event on the error channel', async () => {
      vi.mocked(Anthropic).mockImplementation(function() { return ({
        messages: { stream: () => rejectingStream(error) },
      } as unknown as Anthropic); })

      const sender = makeSender();
      await expect(
        runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers),
      ).rejects.toThrow(expectedMessage);

      const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === cfg.errorChannel);
      expect(errorCalls).toHaveLength(1);
      const payload = errorCalls[0][1] as { requestId: string; category: string; message: string };
      expect(payload.category).toBe(expectedCategory);
      expect(payload.message).toBe(expectedMessage);
      expect(typeof payload.requestId).toBe('string');
    });

    it('sends no chunk events when the provider rejects before streaming', async () => {
      vi.mocked(Anthropic).mockImplementation(function() { return ({
        messages: { stream: () => rejectingStream(error) },
      } as unknown as Anthropic); })

      const sender = makeSender();
      await expect(
        runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers),
      ).rejects.toThrow();

      const chunkCalls = sender.send.mock.calls.filter(([ch]) => ch === cfg.chunkChannel);
      expect(chunkCalls).toHaveLength(0);
    });

    it('removes the controller from the registry after provider rejection', async () => {
      vi.mocked(Anthropic).mockImplementation(function() { return ({
        messages: { stream: () => rejectingStream(error) },
      } as unknown as Anthropic); })

      const sender = makeSender();
      const startCall = new Promise<string>((resolve) => {
        sender.send.mockImplementation((ch: string, d: unknown) => {
          if (ch === cfg.streamStartChannel) resolve((d as { requestId: string }).requestId);
        });
      });

      await expect(
        runAgentHandler(cfg, makeEvent(sender), cfg.makePayload(), controllers),
      ).rejects.toThrow();

      const requestId = await startCall;
      expect(controllers.has(requestId)).toBe(false);
    });

    it('writes a generation_log row with the error field populated', async () => {
      vi.mocked(Anthropic).mockImplementation(function() { return ({
        messages: { stream: () => rejectingStream(error) },
      } as unknown as Anthropic); })

      await expect(
        runAgentHandler(cfg, makeEvent(makeSender()), cfg.makePayload(), controllers),
      ).rejects.toThrow();

      const rows = listGenerationLog({ agent: cfg.dbAgentName });
      expect(rows).toHaveLength(1);
      expect(rows[0].error).not.toBeNull();
    });
  });
});
