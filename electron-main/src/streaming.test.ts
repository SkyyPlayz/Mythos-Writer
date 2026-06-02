import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before any imports so module resolution picks them up.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import { ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import {
  StreamRegistry,
  registerStreamingHandlers,
  categorizeStreamError,
  STREAM_ERROR_CATEGORIES,
  streamErrorUserMessage,
  STREAM_CHANNELS,
  MAX_PENDING_TOKENS,
  MAX_CONCURRENT_PER_SENDER,
  MAX_TOKENS_CAP,
  MAX_SYSTEM_LENGTH,
  MAX_PAYLOAD_BYTES,
  MODEL_ALLOWLIST,
  STREAM_ERRORS,
  type StreamStartPayload,
} from './streaming.js';

// ─── Test helpers ───

type MockSender = {
  id: number;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};

function makeSender(id = 1): MockSender {
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    once: vi.fn(),
    off: vi.fn(),
  };
}

// Mock event whose senderFrame self-references as `top` so the MYT-791
// isFromTopFrame() guard passes for normal tests.
function makeTopFrame(): unknown {
  const frame: { top: unknown } = { top: null };
  frame.top = frame;
  return frame;
}

function makeEvent(sender: MockSender): IpcMainInvokeEvent {
  return { sender, senderFrame: makeTopFrame() } as unknown as IpcMainInvokeEvent;
}

function getHandlers(reg?: StreamRegistry) {
  const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
  const onCalls = vi.mocked(ipcMain.on).mock.calls;

  const startEntry = [...handleCalls].reverse().find(([ch]) => ch === STREAM_CHANNELS.STREAM_START);
  const cancelEntry = [...handleCalls].reverse().find(([ch]) => ch === STREAM_CHANNELS.STREAM_CANCEL);
  const ackEntry = [...onCalls].reverse().find(([ch]) => ch === STREAM_CHANNELS.STREAM_ACK);

  type StartHandler = (event: IpcMainInvokeEvent, payload: StreamStartPayload) => Promise<{ streamId: string }>;
  type CancelHandler = (event: IpcMainInvokeEvent, payload: { streamId: string }) => Promise<{ cancelled: boolean }>;
  type AckHandler = (event: IpcMainEvent, payload: { streamId: string; count: number }) => void;

  return {
    startHandler: startEntry?.[1] as unknown as StartHandler,
    cancelHandler: cancelEntry?.[1] as unknown as CancelHandler,
    ackHandler: ackEntry?.[1] as unknown as AckHandler,
    _reg: reg,
  };
}

// Builds an async iterable of SDK-shaped chunks from a token array.
async function* makeTokenStream(tokens: string[]) {
  for (const text of tokens) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
  }
}

// Builds a stream that also includes message_start / message_delta events.
async function* makeFullStream(tokens: string[]) {
  yield { type: 'message_start', message: { usage: { input_tokens: 5 } } };
  for (const text of tokens) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
  }
  yield { type: 'message_delta', usage: { output_tokens: tokens.length } };
}

// ─── StreamRegistry unit tests ───

describe('StreamRegistry', () => {
  it('start registers an entry', () => {
    const reg = new StreamRegistry();
    const ctrl = new AbortController();
    reg.start('s1', ctrl, makeSender(1) as unknown as import("electron").WebContents);
    expect(reg.get('s1')).toBeDefined();
    expect(reg.size).toBe(1);
  });

  it('cancel aborts controller and returns true', () => {
    const reg = new StreamRegistry();
    const ctrl = new AbortController();
    reg.start('s1', ctrl, makeSender(1) as unknown as import("electron").WebContents);
    expect(reg.cancel('s1')).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('cancel returns false for unknown streamId', () => {
    expect(new StreamRegistry().cancel('no-such-id')).toBe(false);
  });

  it('ack decrements pendingTokens', () => {
    const reg = new StreamRegistry();
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 10;
    reg.ack('s1', 3);
    expect(reg.get('s1')!.pendingTokens).toBe(7);
  });

  it('ack clamps at zero', () => {
    const reg = new StreamRegistry();
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.ack('s1', 999);
    expect(reg.get('s1')!.pendingTokens).toBe(0);
  });

  it('ack is a no-op for unknown streamId', () => {
    expect(() => new StreamRegistry().ack('nope', 5)).not.toThrow();
  });

  it('remove deletes the entry', () => {
    const reg = new StreamRegistry();
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.remove('s1');
    expect(reg.get('s1')).toBeUndefined();
    expect(reg.size).toBe(0);
  });

  it('countBySender tracks concurrent streams per sender', () => {
    const reg = new StreamRegistry();
    expect(reg.countBySender(1)).toBe(0);
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.start('s2', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    expect(reg.countBySender(1)).toBe(2);
    reg.remove('s1');
    expect(reg.countBySender(1)).toBe(1);
    reg.remove('s2');
    expect(reg.countBySender(1)).toBe(0);
  });

  it('countBySender is independent per sender id', () => {
    const reg = new StreamRegistry();
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.start('s2', new AbortController(), makeSender(2) as unknown as import("electron").WebContents);
    expect(reg.countBySender(1)).toBe(1);
    expect(reg.countBySender(2)).toBe(1);
  });
});

// ─── STREAM_START ───

describe('STREAM_START', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('returns a unique streamId immediately', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream([]) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const result = await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    expect(typeof result.streamId).toBe('string');
    expect(result.streamId.length).toBeGreaterThan(0);
  });

  it('delivers STREAM_TOKEN events for each text chunk', async () => {
    const tokens = ['Hello', ', ', 'world', '!'];
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream(tokens) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Stream runs in the background; flush promise chain with setTimeout(0).
    await new Promise((r) => setTimeout(r, 0));

    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(4);
    expect(tokenCalls.map(([, d]) => (d as { token: string }).token)).toEqual(tokens);
    tokenCalls.forEach(([, d]) => expect((d as { streamId: string }).streamId).toBe(streamId));
  });

  it('sends STREAM_END after all tokens', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream(['a', 'b']) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const endCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END);
    expect(endCalls).toHaveLength(1);
    expect(endCalls[0][1]).toEqual({ streamId });
  });

  it('ignores non-text-delta chunk types without error', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeFullStream(['x']) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    await new Promise((r) => setTimeout(r, 0));

    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0][1]).toMatchObject({ token: 'x' });
  });

  it('sends STREAM_ERROR on SDK failure', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: () => {
          return (async function* () {
            throw new Error('API failure');
          })();
        },
      },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual({
      streamId,
      category: STREAM_ERROR_CATEGORIES.UNKNOWN,
      message: streamErrorUserMessage(STREAM_ERROR_CATEGORIES.UNKNOWN),
    });

    const endCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END);
    expect(endCalls).toHaveLength(0);
  });

  it('sends STREAM_END (not STREAM_ERROR) when stream throws AbortError', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: () => {
          return (async function* () {
            const e = new Error('The operation was aborted');
            e.name = 'AbortError';
            throw e;
          })();
        },
      },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    await new Promise((r) => setTimeout(r, 0));

    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR)).toHaveLength(0);
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(1);
  });

  it('cleans up registry entry after stream ends', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream([]) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const { streamId } = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Flush async-generator microtask chain; empty stream completes in one tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(reg.get(streamId)).toBeUndefined();
  });

  it('backpressure: pauses at MAX_PENDING_TOKENS (does not drop tokens)', async () => {
    const overflow = 5;
    const total = MAX_PENDING_TOKENS + overflow;
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream(Array.from({ length: total }, (_, i) => `t${i}`)) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    // Flush until the loop blocks on backpressure.
    await new Promise((r) => setTimeout(r, 0));

    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(MAX_PENDING_TOKENS);

    // Stream must NOT be ended — it is paused, not dropped.
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(0);

    // Ack all pending tokens to unblock the loop.
    const { ackHandler } = getHandlers(reg);
    ackHandler(makeEvent(sender) as unknown as IpcMainEvent, { streamId, count: MAX_PENDING_TOKENS });

    // Flush remaining tokens and STREAM_END through the now-unblocked generator.
    await new Promise((r) => setTimeout(r, 0));

    const allTokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(allTokenCalls).toHaveLength(total);
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(1);
  });

  it('backpressure: cancel during drain wait sends STREAM_END (no data loss confusion)', async () => {
    const total = MAX_PENDING_TOKENS + 5;
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream(Array.from({ length: total }, (_, i) => `t${i}`)) },
    } as unknown as Anthropic); })

    const { startHandler, cancelHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    // Let the stream hit backpressure.
    await new Promise((r) => setTimeout(r, 0));
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN)).toHaveLength(MAX_PENDING_TOKENS);

    // Cancel while the loop is parked in waitForDrain.
    await cancelHandler(makeEvent(sender), { streamId });

    // Flush the drain-resolve → break → STREAM_END microtask chain.
    await new Promise((r) => setTimeout(r, 0));

    // No extra tokens should have been sent after cancel.
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN)).toHaveLength(MAX_PENDING_TOKENS);
    // STREAM_END must be emitted (cancel = graceful termination).
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(1);
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR)).toHaveLength(0);
  });
});

// ─── F19: payload validation ───

describe('STREAM_START payload validation (F19)', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('rejects null payload with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), null as unknown as StreamStartPayload);
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects missing messages array with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {} as StreamStartPayload);
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects empty messages array with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), { messages: [] });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects message with invalid role with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'system' as 'user', content: 'Hi' }],
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects message with non-string content with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 42 as unknown as string }],
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects undefined payload with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), undefined as unknown as StreamStartPayload);
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects model outside allowlist with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('accepts a model from the allowlist', async () => {
    const allowedModel = [...MODEL_ALLOWLIST][0];
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream([]) },
    } as unknown as Anthropic); })
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      model: allowedModel,
    });
    expect((result as { streamId: string }).streamId).toBeDefined();
  });

  it('rejects maxTokens above cap with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: MAX_TOKENS_CAP + 1,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('accepts maxTokens equal to cap', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => makeTokenStream([]) },
    } as unknown as Anthropic); })
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: MAX_TOKENS_CAP,
    });
    expect((result as { streamId: string }).streamId).toBeDefined();
  });

  it('rejects maxTokens of zero with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 0,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects negative maxTokens with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: -1,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects fractional maxTokens with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 1.5,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects system string exceeding MAX_SYSTEM_LENGTH with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'x'.repeat(MAX_SYSTEM_LENGTH + 1),
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects null message array element with INVALID_PAYLOAD (MYT-635 type-guard)', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [null as unknown as { role: 'user'; content: string }],
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects non-object message array element with INVALID_PAYLOAD (MYT-635 type-guard)', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [42 as unknown as { role: 'user'; content: string }],
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects non-string system field with INVALID_PAYLOAD (MYT-635 type-guard)', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      system: 42 as unknown as string,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects object system field with INVALID_PAYLOAD (MYT-635 type-guard)', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
      system: { prompt: 'bad' } as unknown as string,
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('rejects payload exceeding MAX_PAYLOAD_BYTES with INVALID_PAYLOAD', async () => {
    const { startHandler } = getHandlers(reg);
    const result = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'x'.repeat(MAX_PAYLOAD_BYTES) }],
    });
    expect(result).toEqual({ error: STREAM_ERRORS.INVALID_PAYLOAD });
  });

  it('does not invoke SDK for invalid payloads', async () => {
    const streamSpy = vi.fn();
    vi.mocked(Anthropic).mockImplementation(function() { return (
      { messages: { stream: streamSpy } } as unknown as Anthropic,
    );

    const { startHandler } = getHandlers(reg);
    await startHandler(makeEvent(makeSender()), { messages: [] });
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

// ─── F20: ack validation ───

describe('STREAM_ACK validation (F20)', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('ignores ack with non-string streamId (no throw)', () => {
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 10;
    const { ackHandler } = getHandlers(reg);
    expect(() => ackHandler({} as import('electron').IpcMainEvent, { streamId: 123 as unknown as string, count: 3 })).not.toThrow();
    expect(reg.get('s1')!.pendingTokens).toBe(10); // unchanged
  });

  it('ignores ack with non-number count (no throw)', () => {
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 10;
    const { ackHandler } = getHandlers(reg);
    expect(() => ackHandler({} as import('electron').IpcMainEvent, { streamId: 's1', count: 'three' as unknown as number })).not.toThrow();
    expect(reg.get('s1')!.pendingTokens).toBe(10); // unchanged
  });

  it('ignores ack with count < 1 (no throw)', () => {
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 10;
    const { ackHandler } = getHandlers(reg);
    expect(() => ackHandler({} as import('electron').IpcMainEvent, { streamId: 's1', count: 0 })).not.toThrow();
    expect(reg.get('s1')!.pendingTokens).toBe(10); // unchanged
  });

  it('ignores null ack payload (no throw)', () => {
    const { ackHandler } = getHandlers(reg);
    expect(() => ackHandler({} as import('electron').IpcMainEvent, null as unknown as { streamId: string; count: number })).not.toThrow();
  });
});

// ─── STREAM_CANCEL ───

describe('STREAM_CANCEL', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('returns { cancelled: true } for a known stream', async () => {
    reg.start('s1', new AbortController(), makeSender(1) as unknown as import("electron").WebContents);
    const { cancelHandler } = getHandlers(reg);
    const result = await cancelHandler(makeEvent(makeSender()), { streamId: 's1' });
    expect(result).toEqual({ cancelled: true });
  });

  it('returns { cancelled: false } for an unknown streamId', async () => {
    const { cancelHandler } = getHandlers(reg);
    const result = await cancelHandler(makeEvent(makeSender()), { streamId: 'ghost' });
    expect(result).toEqual({ cancelled: false });
  });

  it('aborts the AbortController and stops token delivery', async () => {
    const sender = makeSender();
    let capturedSignal: AbortSignal | undefined;

    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (_args: unknown, opts: { signal: AbortSignal }) => {
          capturedSignal = opts.signal;
          return (async function* () {
            // Yield the first token synchronously (before any awaits).
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'token1' } };
            // Pause until abort fires (or forever if never cancelled).
            await new Promise<void>((_, reject) => {
              capturedSignal!.addEventListener('abort', () => {
                const e = new Error('The operation was aborted');
                e.name = 'AbortError';
                reject(e);
              });
            });
            // Never reached after cancel.
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'token2' } };
          })();
        },
      },
    } as unknown as Anthropic); })

    const { startHandler, cancelHandler } = getHandlers(reg);

    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Stream me' }],
    });

    // Async generators require an extra microtask tick to propagate yields.
    await new Promise((r) => setTimeout(r, 0));

    const beforeCancel = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(beforeCancel).toHaveLength(1);
    expect((beforeCancel[0][1] as { token: string }).token).toBe('token1');

    // Cancel — abort event fires synchronously, rejects the generator's
    // awaited promise on the next microtask.
    await cancelHandler(makeEvent(sender), { streamId });

    // Flush the abort → generator-throw → STREAM_END microtask chain.
    await new Promise((r) => setTimeout(r, 0));

    const afterCancel = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(afterCancel).toHaveLength(1); // token2 was never sent

    const endCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END);
    expect(endCalls).toHaveLength(1);
    expect((endCalls[0][1] as { streamId: string }).streamId).toBe(streamId);
  });

  it('returns { cancelled: false } when sender does not own the stream (MYT-635 sender-ownership)', async () => {
    const owner = makeSender(1);
    const other = makeSender(2);
    reg.start('s1', new AbortController(), owner as unknown as import("electron").WebContents);
    const { cancelHandler } = getHandlers(reg);
    const result = await cancelHandler(makeEvent(other), { streamId: 's1' });
    expect(result).toEqual({ cancelled: false });
    expect(reg.get('s1')?.controller.signal.aborted).toBe(false);
  });
});

// ─── STREAM_ACK ───

describe('STREAM_ACK', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('decrements pendingTokens by count', () => {
    const sender = makeSender(1);
    reg.start('s1', new AbortController(), sender as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 20;

    const { ackHandler } = getHandlers(reg);
    ackHandler(makeEvent(sender) as unknown as IpcMainEvent, { streamId: 's1', count: 7 });

    expect(reg.get('s1')!.pendingTokens).toBe(13);
  });

  it('ack on unknown streamId is a no-op', () => {
    const { ackHandler } = getHandlers(reg);
    expect(() => ackHandler({} as IpcMainEvent, { streamId: 'ghost', count: 1 })).not.toThrow();
  });

  it('ack from a different sender is a no-op (MYT-635 sender-ownership)', () => {
    const owner = makeSender(1);
    const other = makeSender(2);
    reg.start('s1', new AbortController(), owner as unknown as import("electron").WebContents);
    reg.get('s1')!.pendingTokens = 20;

    const { ackHandler } = getHandlers(reg);
    ackHandler(makeEvent(other) as unknown as IpcMainEvent, { streamId: 's1', count: 7 });

    expect(reg.get('s1')!.pendingTokens).toBe(20); // unchanged
  });
});

// ─── Integration — mock Anthropic response ───

describe('integration: mock Anthropic response', () => {
  it('streams a full response with custom model, system, and maxTokens', async () => {
    vi.clearAllMocks();
    const reg = new StreamRegistry();

    const tokens = ['The', ' dragon', ' flew', '.'];
    let capturedArgs: Record<string, unknown> | undefined;

    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: (args: Record<string, unknown>) => {
          capturedArgs = args;
          return makeTokenStream(tokens);
        },
      },
    } as unknown as Anthropic); })

    registerStreamingHandlers(() => 'sk-ant-api-key', reg);
    const { startHandler } = getHandlers(reg);

    const sender = makeSender();
    const payload: StreamStartPayload = {
      messages: [{ role: 'user', content: 'Tell me about dragons' }],
      system: 'You are a fantasy author.',
      model: 'claude-opus-4-7',
      maxTokens: 256,
    };

    const { streamId } = await startHandler(makeEvent(sender), payload);
    await new Promise((r) => setTimeout(r, 0));

    // Verify SDK was called with correct parameters.
    expect(capturedArgs).toMatchObject({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      system: 'You are a fantasy author.',
    });

    // Verify token events carry the right content and streamId.
    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(4);
    const assembled = tokenCalls.map(([, d]) => (d as { token: string }).token).join('');
    expect(assembled).toBe('The dragon flew.');

    // Verify STREAM_END is emitted after all tokens.
    const endCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END);
    expect(endCalls).toHaveLength(1);
    expect(endCalls[0][1]).toEqual({ streamId });
  });
});

// ─── categorizeStreamError unit tests ───

describe('categorizeStreamError', () => {
  function makeStatusError(status: number, message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
  }
  it('maps 401 to invalid-API-key message', () => {
    expect(categorizeStreamError(makeStatusError(401, 'Unauthorized'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });
  it('maps 403 to permission-denied message', () => {
    expect(categorizeStreamError(makeStatusError(403, 'Forbidden'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });
  it('maps 429 to rate-limit message', () => {
    expect(categorizeStreamError(makeStatusError(429, 'Too Many Requests'))).toBe(
      STREAM_ERROR_CATEGORIES.RATE_LIMITED,
    );
  });
  it('maps 404 to model-unavailable message', () => {
    expect(categorizeStreamError(makeStatusError(404, 'Not Found'))).toBe(
      STREAM_ERROR_CATEGORIES.INVALID_REQUEST,
    );
  });
  it('passes through raw message for unrecognised status (e.g. 500)', () => {
    expect(categorizeStreamError(makeStatusError(500, 'Internal Server Error'))).toBe(
      STREAM_ERROR_CATEGORIES.NETWORK,
    );
  });
  it('passes through raw message when no status property is present', () => {
    expect(categorizeStreamError(new Error('API failure'))).toBe(
      STREAM_ERROR_CATEGORIES.UNKNOWN,
    );
  });
  it('returns fallback string when error has no message and no status', () => {
    expect(categorizeStreamError({})).toBe(STREAM_ERROR_CATEGORIES.UNKNOWN);
  });

  // ─── Non-HTTP: err.name classification ───

  it('maps AbortError to network', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(categorizeStreamError(err)).toBe(STREAM_ERROR_CATEGORIES.NETWORK);
  });
  it('maps TypeError to invalid_request', () => {
    const err = new TypeError('invalid type');
    expect(categorizeStreamError(err)).toBe(STREAM_ERROR_CATEGORIES.INVALID_REQUEST);
  });
  it('maps SyntaxError to invalid_request', () => {
    const err = new SyntaxError('bad syntax');
    expect(categorizeStreamError(err)).toBe(STREAM_ERROR_CATEGORIES.INVALID_REQUEST);
  });

  // ─── Non-HTTP: message-pattern classification ───

  it('maps message containing "rate" to rate_limited', () => {
    expect(categorizeStreamError(new Error('rate limit exceeded'))).toBe(
      STREAM_ERROR_CATEGORIES.RATE_LIMITED,
    );
  });
  it('maps message containing "limit" to rate_limited', () => {
    expect(categorizeStreamError(new Error('request limit reached'))).toBe(
      STREAM_ERROR_CATEGORIES.RATE_LIMITED,
    );
  });
  it('maps message containing "429" to rate_limited', () => {
    expect(categorizeStreamError(new Error('HTTP 429'))).toBe(
      STREAM_ERROR_CATEGORIES.RATE_LIMITED,
    );
  });
  it('maps message containing "auth" to auth', () => {
    expect(categorizeStreamError(new Error('auth failed'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });
  it('maps message containing "key" to auth', () => {
    expect(categorizeStreamError(new Error('invalid API key'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });
  it('maps message containing "permission" to auth', () => {
    expect(categorizeStreamError(new Error('permission denied'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });
  it('maps message containing "network" to network', () => {
    expect(categorizeStreamError(new Error('network unreachable'))).toBe(
      STREAM_ERROR_CATEGORIES.NETWORK,
    );
  });
  it('maps message containing "connect" to network', () => {
    expect(categorizeStreamError(new Error('connection refused'))).toBe(
      STREAM_ERROR_CATEGORIES.NETWORK,
    );
  });
  it('maps message containing "timeout" to network', () => {
    expect(categorizeStreamError(new Error('request timeout'))).toBe(
      STREAM_ERROR_CATEGORIES.NETWORK,
    );
  });
  it('maps message containing "dns" to network', () => {
    expect(categorizeStreamError(new Error('DNS resolution failed'))).toBe(
      STREAM_ERROR_CATEGORIES.NETWORK,
    );
  });

  // ─── Priority: status code overrides message patterns ───

  it('status 429 overrides message containing "auth"', () => {
    expect(categorizeStreamError(makeStatusError(429, 'auth error'))).toBe(
      STREAM_ERROR_CATEGORIES.RATE_LIMITED,
    );
  });
  it('status 401 overrides message containing "network"', () => {
    expect(categorizeStreamError(makeStatusError(401, 'network auth issue'))).toBe(
      STREAM_ERROR_CATEGORIES.AUTH,
    );
  });

  // ─── streamErrorUserMessage unit tests ───

  it('returns rate-limit user message', () => {
    expect(streamErrorUserMessage(STREAM_ERROR_CATEGORIES.RATE_LIMITED)).toBe(
      'Rate limit reached — try again shortly.',
    );
  });
  it('returns auth user message', () => {
    expect(streamErrorUserMessage(STREAM_ERROR_CATEGORIES.AUTH)).toBe(
      'Authentication error — check your API key in Settings.',
    );
  });
  it('returns network user message', () => {
    expect(streamErrorUserMessage(STREAM_ERROR_CATEGORIES.NETWORK)).toBe(
      'Network error — check your connection and try again.',
    );
  });
  it('returns invalid-request user message', () => {
    expect(streamErrorUserMessage(STREAM_ERROR_CATEGORIES.INVALID_REQUEST)).toBe(
      'Invalid request — check the model and input parameters.',
    );
  });
  it('returns unknown user message', () => {
    expect(streamErrorUserMessage(STREAM_ERROR_CATEGORIES.UNKNOWN)).toBe(
      'An unexpected error occurred — check the logs for details.',
    );
  });
});

// ─── Provider rejection before first content chunk ───

describe('Provider rejection before first content chunk', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  function makeStatusError(status: number, message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
  }

  function rejectingStream(err: Error) {
    return (async function* () {
      throw err;
    })();
  }

  it('sends categorized auth error on 401 rejection before first token', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(401, 'Unauthorized')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual({
      streamId,
      category: STREAM_ERROR_CATEGORIES.AUTH,
      message: streamErrorUserMessage(STREAM_ERROR_CATEGORIES.AUTH),
    });
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(0);
  });

  it('sends categorized rate-limit error on 429 rejection before first token', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(429, 'Rate limit exceeded')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual({
      streamId,
      category: STREAM_ERROR_CATEGORIES.RATE_LIMITED,
      message: streamErrorUserMessage(STREAM_ERROR_CATEGORIES.RATE_LIMITED),
    });
    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END)).toHaveLength(0);
  });

  it('sends user-friendly model-unavailable error on 404 rejection before first token', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(404, 'Model not found')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual({
      streamId,
      category: STREAM_ERROR_CATEGORIES.INVALID_REQUEST,
      message: streamErrorUserMessage(STREAM_ERROR_CATEGORIES.INVALID_REQUEST),
    });
  });

  it('sends permission-denied message on 403 rejection before first token', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(403, 'Permission denied')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual({
      streamId,
      category: STREAM_ERROR_CATEGORIES.AUTH,
      message: streamErrorUserMessage(STREAM_ERROR_CATEGORIES.AUTH),
    });
  });

  it('cleans up registry entry after pre-stream rejection', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(401, 'Unauthorized')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const { streamId } = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(reg.get(streamId)).toBeUndefined();
  });

  it('sends no STREAM_TOKEN events when rejection fires before any content', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: { stream: () => rejectingStream(makeStatusError(429, 'Rate limited')) },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    await new Promise((r) => setTimeout(r, 0));

    expect(sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN)).toHaveLength(0);
  });
});

// ─── Mid-stream Anthropic errors (MYT-22 regression guard) ───
//
// When the SDK throws after yielding partial tokens, the streaming layer must
// send exactly one STREAM_ERROR and no STREAM_END. The client must not receive
// any further tokens after the failure point.

describe('Mid-stream Anthropic errors (MYT-22 regression guard)', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  function makeMidStreamError(status: number, message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
  }

  it('sends STREAM_ERROR and no STREAM_END when SDK throws after partial tokens', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: () =>
          (async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
            throw makeMidStreamError(500, 'Internal Server Error');
          })(),
      },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    const { streamId } = await startHandler(makeEvent(sender), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(2);

    const errorCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_ERROR);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toMatchObject({
      streamId,
      category: STREAM_ERROR_CATEGORIES.NETWORK,
    });

    const endCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_END);
    expect(endCalls).toHaveLength(0);
  });

  it('sends no STREAM_TOKEN after the error point', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: () =>
          (async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'before-error' } };
            throw makeMidStreamError(429, 'Rate limited');
            // unreachable — documents that these would not be sent:
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after-error' } };
          })(),
      },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const sender = makeSender();
    await startHandler(makeEvent(sender), { messages: [{ role: 'user', content: 'Hi' }] });

    await new Promise((r) => setTimeout(r, 0));

    const tokenCalls = sender.send.mock.calls.filter(([ch]) => ch === STREAM_CHANNELS.STREAM_TOKEN);
    expect(tokenCalls).toHaveLength(1);
    expect((tokenCalls[0][1] as { token: string }).token).toBe('before-error');
  });

  it('cleans up registry after mid-stream error', async () => {
    vi.mocked(Anthropic).mockImplementation(function() { return ({
      messages: {
        stream: () =>
          (async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } };
            throw makeMidStreamError(503, 'Service unavailable');
          })(),
      },
    } as unknown as Anthropic); })

    const { startHandler } = getHandlers(reg);
    const { streamId } = await startHandler(makeEvent(makeSender()), {
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(reg.get(streamId)).toBeUndefined();
  });
});

// ─── Concurrent stream cap ───

describe('concurrent stream cap', () => {
  let reg: StreamRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    reg = new StreamRegistry();
    registerStreamingHandlers(() => 'sk-ant-test', reg);
  });

  it('rejects the (N+1)th concurrent STREAM_START from the same sender without invoking the SDK', async () => {
    const streamSpy = vi.fn(() =>
      (async function* () {
        await new Promise<never>(() => {}); // never resolves — keeps stream open
      })(),
    );
    vi.mocked(Anthropic).mockImplementation(function() { return (
      { messages: { stream: streamSpy } } as unknown as Anthropic,
    );

    const { startHandler } = getHandlers(reg);
    const sender = makeSender(42);
    const event = makeEvent(sender);

    for (let i = 0; i < MAX_CONCURRENT_PER_SENDER; i++) {
      const result = await startHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
      expect((result as { streamId: string }).streamId).toBeDefined();
    }

    expect(streamSpy).toHaveBeenCalledTimes(MAX_CONCURRENT_PER_SENDER);

    const overCapResult = await startHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
    expect(overCapResult).toEqual({ error: STREAM_ERRORS.TOO_MANY_STREAMS });

    // SDK must not have been invoked for the rejected request.
    expect(streamSpy).toHaveBeenCalledTimes(MAX_CONCURRENT_PER_SENDER);
  });

  it('a stream from a different sender is not affected by another sender reaching the cap', async () => {
    const streamSpy = vi.fn(() =>
      (async function* () {
        await new Promise<never>(() => {});
      })(),
    );
    vi.mocked(Anthropic).mockImplementation(function() { return (
      { messages: { stream: streamSpy } } as unknown as Anthropic,
    );

    const { startHandler } = getHandlers(reg);
    const senderA = makeSender(1);
    const senderB = makeSender(2);

    // Fill senderA to the cap.
    for (let i = 0; i < MAX_CONCURRENT_PER_SENDER; i++) {
      await startHandler(makeEvent(senderA), { messages: [{ role: 'user', content: 'Hi' }] });
    }
    expect((await startHandler(makeEvent(senderA), { messages: [{ role: 'user', content: 'Hi' }] }))).toEqual({
      error: STREAM_ERRORS.TOO_MANY_STREAMS,
    });

    // senderB is unaffected and can still start a stream.
    const result = await startHandler(makeEvent(senderB), { messages: [{ role: 'user', content: 'Hi' }] });
    expect((result as { streamId: string }).streamId).toBeDefined();
  });
});
