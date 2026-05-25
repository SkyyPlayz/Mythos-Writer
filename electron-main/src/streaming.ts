// Token-streaming IPC channel with cancellation and backpressure.
import { ipcMain, WebContents } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

export const STREAM_CHANNELS = {
  STREAM_START: 'stream:start',
  STREAM_CANCEL: 'stream:cancel',
  STREAM_ACK: 'stream:ack',
  STREAM_TOKEN: 'stream:token',
  STREAM_END: 'stream:end',
  STREAM_ERROR: 'stream:error',
} as const;

// Max unacknowledged tokens before backpressure drops further tokens.
export const MAX_PENDING_TOKENS = 50;

// Max concurrent streams allowed from a single renderer sender (cost-DoS guard).
export const MAX_CONCURRENT_PER_SENDER = 4;

// IPC payload validation limits.
export const MAX_TOKENS_CAP = 2048;
export const MAX_SYSTEM_LENGTH = 16 * 1024; // 16 KB
export const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB

export const MODEL_ALLOWLIST = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

export const STREAM_ERRORS = {
  TOO_MANY_STREAMS: 'TOO_MANY_STREAMS',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  START_FAILED: 'START_FAILED',
} as const;

// Typed error categories sent over IPC. These are safe for the renderer —
// no URLs, trace IDs, retry counts, or other main-process environment details.
export const STREAM_ERROR_CATEGORIES = {
  CONFIGURATION: 'configuration',
  RATE_LIMITED: 'rate_limited',
  AUTH: 'auth',
  NETWORK: 'network',
  MODEL_UNAVAILABLE: 'model_unavailable',
  INVALID_REQUEST: 'invalid_request',
  UNKNOWN: 'unknown',
} as const;

export type StreamErrorCategory = (typeof STREAM_ERROR_CATEGORIES)[keyof typeof STREAM_ERROR_CATEGORIES];

// Maps an error to a typed category for IPC.
// Uses HTTP status code when available, then err.name / err.message patterns.
export function categorizeStreamError(err: unknown): StreamErrorCategory {
  const status = (err as { status?: number }).status;
  if (status !== undefined) {
    if (status === 429) return STREAM_ERROR_CATEGORIES.RATE_LIMITED;
    if (status === 401 || status === 403) return STREAM_ERROR_CATEGORIES.AUTH;
    if (status === 404) return STREAM_ERROR_CATEGORIES.MODEL_UNAVAILABLE;
    // 5xx and other HTTP errors are network-level
    if (status >= 500 || (status >= 400 && status !== 401 && status !== 403 && status !== 404 && status !== 429)) {
      return STREAM_ERROR_CATEGORIES.NETWORK;
    }
  }
  // Non-HTTP errors: classify by name / message patterns
  const name = (err as Error)?.name;
  if (name === 'AbortError') return STREAM_ERROR_CATEGORIES.NETWORK;
  if (name === 'TypeError' || name === 'SyntaxError') return STREAM_ERROR_CATEGORIES.INVALID_REQUEST;
  const msg = (err as Error)?.message?.toLowerCase() ?? '';
  if (msg.includes('not set') || msg.includes('missing') || msg.includes('configuration') || msg.includes('config')) {
    return STREAM_ERROR_CATEGORIES.CONFIGURATION;
  }
  if (msg.includes('rate') || msg.includes('limit') || msg.includes('429')) return STREAM_ERROR_CATEGORIES.RATE_LIMITED;
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('unavailable') || msg.includes('access'))) {
    return STREAM_ERROR_CATEGORIES.MODEL_UNAVAILABLE;
  }
  if (msg.includes('auth') || msg.includes('key') || msg.includes('permission')) return STREAM_ERROR_CATEGORIES.AUTH;
  if (msg.includes('network') || msg.includes('connect') || msg.includes('timeout') || msg.includes('dns')) return STREAM_ERROR_CATEGORIES.NETWORK;
  return STREAM_ERROR_CATEGORIES.UNKNOWN;
}

// Returns a generic, user-facing error message for a given category.
// Never includes raw SDK details (URLs, trace IDs, retry counts, etc.).
export function streamErrorUserMessage(category: StreamErrorCategory): string {
  switch (category) {
    case STREAM_ERROR_CATEGORIES.CONFIGURATION:
      return 'Configuration error — check your AI provider settings and try again.';
    case STREAM_ERROR_CATEGORIES.RATE_LIMITED:
      return 'Rate limit reached — try again shortly.';
    case STREAM_ERROR_CATEGORIES.AUTH:
      return 'Authentication error — check your API key in Settings.';
    case STREAM_ERROR_CATEGORIES.NETWORK:
      return 'Network error — check your connection and try again.';
    case STREAM_ERROR_CATEGORIES.MODEL_UNAVAILABLE:
      return 'Model unavailable — the selected model may not be accessible on your account.';
    case STREAM_ERROR_CATEGORIES.INVALID_REQUEST:
      return 'Invalid request — check the model and input parameters.';
    case STREAM_ERROR_CATEGORIES.UNKNOWN:
      return 'An unexpected error occurred — check the logs for details.';
  }
}

// IPC payload for STREAM_ERROR: category label + user-facing message.
// The raw SDK error message is logged in main process only (never sent to renderer).
export interface StreamErrorPayload {
  streamId: string;
  category: StreamErrorCategory;
  message: string; // generic user-facing message
}

export interface StreamStartPayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  model?: string;
  maxTokens?: number;
}

export interface StreamStartSuccessPayload {
  streamId: string;
}

export interface StreamStartErrorPayload {
  error: string;
  category?: StreamErrorCategory;
  message?: string;
}

export type StreamStartResponse = StreamStartSuccessPayload | StreamStartErrorPayload;

type StreamChunk = {
  type: string;
  delta?: {
    type?: string;
    text?: string;
  };
};

const STREAM_START_PREFLIGHT_TIMEOUT_MS = 0;

interface StreamEntry {
  controller: AbortController;
  pendingTokens: number;
  senderId: number;
  drainResolve?: () => void;
}

export class StreamRegistry {
  private streams = new Map<string, StreamEntry>();
  private concurrentBySender = new Map<number, number>();
  // Track which senders have a consolidated 'destroyed' listener attached.
  private destroyedListeners = new Set<number>();

  countBySender(senderId: number): number {
    return this.concurrentBySender.get(senderId) ?? 0;
  }

  start(streamId: string, controller: AbortController, sender: WebContents): void {
    const senderId = sender.id;
    this.streams.set(streamId, { controller, pendingTokens: 0, senderId });
    this.concurrentBySender.set(senderId, this.countBySender(senderId) + 1);
    this.registerDestroyedListener(sender);
  }

  get(streamId: string): StreamEntry | undefined {
    return this.streams.get(streamId);
  }

  cancel(streamId: string): boolean {
    const entry = this.streams.get(streamId);
    if (!entry) return false;
    entry.controller.abort();
    // Unblock any pending drain wait so runStream can observe the abort.
    if (entry.drainResolve) {
      const resolve = entry.drainResolve;
      entry.drainResolve = undefined;
      resolve();
    }
    return true;
  }

  ack(streamId: string, count: number): void {
    const entry = this.streams.get(streamId);
    if (entry) {
      entry.pendingTokens = Math.max(0, entry.pendingTokens - count);
      if (entry.pendingTokens < MAX_PENDING_TOKENS && entry.drainResolve) {
        const resolve = entry.drainResolve;
        entry.drainResolve = undefined;
        resolve();
      }
    }
  }

  waitForDrain(streamId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const entry = this.streams.get(streamId);
      if (!entry || entry.pendingTokens < MAX_PENDING_TOKENS) {
        resolve();
        return;
      }
      entry.drainResolve = resolve;
    });
  }

  remove(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (entry) {
      const newCount = Math.max(0, this.countBySender(entry.senderId) - 1);
      if (newCount === 0) {
        this.concurrentBySender.delete(entry.senderId);
        // No more streams from this sender — clean up the listener.
        this.unregisterDestroyedListener(entry.senderId);
      } else {
        this.concurrentBySender.set(entry.senderId, newCount);
      }
    }
    this.streams.delete(streamId);
  }

  get size(): number {
    return this.streams.size;
  }

  // Attach a single 'destroyed' listener for a sender that cancels all its streams.
  // This avoids per-stream listeners exceeding EventEmitter.maxListeners (default 10)
  // when F25 raises MAX_CONCURRENT_PER_SENDER above 10.
  private registerDestroyedListener(sender: WebContents): void {
    const senderId = sender.id;
    if (this.destroyedListeners.has(senderId)) return; // already registered
    this.destroyedListeners.add(senderId);
    sender.once('destroyed', () => {
      // Walk the registry and cancel every stream whose senderId matches.
      for (const [streamId, entry] of this.streams) {
        if (entry.senderId === senderId) {
          this.cancel(streamId);
        }
      }
      this.destroyedListeners.delete(senderId);
    });
  }

  private unregisterDestroyedListener(senderId: number): void {
    this.destroyedListeners.delete(senderId);
  }
}

export const defaultRegistry = new StreamRegistry();

function isTextDeltaChunk(chunk: StreamChunk): chunk is StreamChunk & { delta: { type: 'text_delta'; text: string } } {
  return chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && typeof chunk.delta.text === 'string';
}

function createSdkStreamIterator(
  payload: StreamStartPayload,
  controller: AbortController,
  getApiKey: () => string,
): AsyncIterator<StreamChunk> {
  const apiKey = getApiKey();
  const client = new Anthropic({ apiKey });
  const sdkStream = client.messages.stream(
    {
      model: payload.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: payload.maxTokens ?? 1024,
      ...(payload.system !== undefined ? { system: payload.system } : {}),
      messages: payload.messages,
    },
    { signal: controller.signal },
  );

  return sdkStream[Symbol.asyncIterator]() as AsyncIterator<StreamChunk>;
}

async function preflightStreamStart(
  firstChunkPromise: Promise<IteratorResult<StreamChunk>>,
): Promise<
  | { kind: 'ready'; firstChunk: IteratorResult<StreamChunk> }
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }
> {
  return Promise.race([
    firstChunkPromise
      .then((firstChunk) => ({ kind: 'ready', firstChunk }) as const)
      .catch((error: unknown) => ({ kind: 'error', error }) as const),
    new Promise<{ kind: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'pending' }), STREAM_START_PREFLIGHT_TIMEOUT_MS);
    }),
  ]);
}

function buildStreamStartError(err: unknown): StreamStartErrorPayload {
  const category = categorizeStreamError(err);
  return {
    error: STREAM_ERRORS.START_FAILED,
    category,
    message: streamErrorUserMessage(category),
  };
}

async function runStream(
  sender: WebContents,
  streamId: string,
  controller: AbortController,
  reg: StreamRegistry,
  iterator: AsyncIterator<StreamChunk>,
  firstChunk: Promise<IteratorResult<StreamChunk>> | IteratorResult<StreamChunk>,
): Promise<void> {
  try {
    let nextChunk = await firstChunk;

    while (!nextChunk.done) {
      const chunk = nextChunk.value;
      if (isTextDeltaChunk(chunk)) {
        const entry = reg.get(streamId);
        if (entry) {
          if (entry.pendingTokens >= MAX_PENDING_TOKENS) {
            await reg.waitForDrain(streamId);
            // Exit cleanly on cancel or destroyed renderer — AbortError follows from the SDK on next tick.
            if (controller.signal.aborted || sender.isDestroyed()) break;
          }

          const current = reg.get(streamId);
          if (current && !sender.isDestroyed()) {
            current.pendingTokens++;
            sender.send(STREAM_CHANNELS.STREAM_TOKEN, { streamId, token: chunk.delta.text });
          }
        }
      }

      nextChunk = await iterator.next();
    }

    if (!sender.isDestroyed()) {
      sender.send(STREAM_CHANNELS.STREAM_END, { streamId });
    }
  } catch (err: unknown) {
    const isAbort = (err as Error)?.name === 'AbortError';
    if (!sender.isDestroyed()) {
      if (isAbort) {
        sender.send(STREAM_CHANNELS.STREAM_END, { streamId });
      } else {
        // Log the raw SDK error in main process only — never forward to renderer.
        console.error(`[stream:error] streamId=${streamId} error=${(err as Error)?.message ?? 'Unknown'}`);
        const category = categorizeStreamError(err);
        sender.send(STREAM_CHANNELS.STREAM_ERROR, {
          streamId,
          category,
          message: streamErrorUserMessage(category),
        });
      }
    }
  } finally {
    reg.remove(streamId);
  }
}

export function registerStreamingHandlers(
  getApiKey: () => string,
  reg: StreamRegistry = defaultRegistry,
): void {
  ipcMain.handle(STREAM_CHANNELS.STREAM_START, async (event, payload: StreamStartPayload): Promise<StreamStartResponse> => {
    const senderId = event.sender.id;
    if (reg.countBySender(senderId) >= MAX_CONCURRENT_PER_SENDER) {
      return { error: STREAM_ERRORS.TOO_MANY_STREAMS };
    }

    // F19: validate payload before touching the SDK
    if (
      !payload ||
      Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES ||
      !Array.isArray(payload.messages) ||
      payload.messages.length === 0 ||
      payload.messages.some(
        (m) => (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string',
      ) ||
      (payload.model !== undefined && !MODEL_ALLOWLIST.has(payload.model)) ||
      (payload.maxTokens !== undefined &&
        (!Number.isInteger(payload.maxTokens) || payload.maxTokens < 1 || payload.maxTokens > MAX_TOKENS_CAP)) ||
      (payload.system !== undefined && payload.system.length > MAX_SYSTEM_LENGTH)
    ) {
      return { error: STREAM_ERRORS.INVALID_PAYLOAD };
    }

    const streamId = crypto.randomUUID();
    const controller = new AbortController();
    reg.start(streamId, controller, event.sender);

    let iterator: AsyncIterator<StreamChunk>;
    let firstChunkPromise: Promise<IteratorResult<StreamChunk>>;
    try {
      iterator = createSdkStreamIterator(payload, controller, getApiKey);
      firstChunkPromise = iterator.next();
      const preflight = await preflightStreamStart(firstChunkPromise);
      if (preflight.kind === 'error') {
        console.error(`[stream:start:error] streamId=${streamId} error=${(preflight.error as Error)?.message ?? 'Unknown'}`);
        reg.remove(streamId);
        return buildStreamStartError(preflight.error);
      }

      void runStream(
        event.sender,
        streamId,
        controller,
        reg,
        iterator,
        preflight.kind === 'ready' ? preflight.firstChunk : firstChunkPromise,
      );
    } catch (err: unknown) {
      console.error(`[stream:start:error] streamId=${streamId} error=${(err as Error)?.message ?? 'Unknown'}`);
      reg.remove(streamId);
      return buildStreamStartError(err);
    }

    return { streamId };
  });

  ipcMain.handle(STREAM_CHANNELS.STREAM_CANCEL, (_event, { streamId }: { streamId: string }) => {
    const cancelled = reg.cancel(streamId);
    return { cancelled };
  });

  ipcMain.on(STREAM_CHANNELS.STREAM_ACK, (_event, data: unknown) => {
    // F20: validate ack payload to prevent prototype-pollution or type confusion
    if (
      !data ||
      typeof (data as { streamId?: unknown }).streamId !== 'string' ||
      typeof (data as { count?: unknown }).count !== 'number' ||
      (data as { count: number }).count < 1
    ) return;
    const { streamId, count } = data as { streamId: string; count: number };
    reg.ack(streamId, count);
  });
}
