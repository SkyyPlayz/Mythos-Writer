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
  // Provider rejected before the first chunk — surfaced in startHandler return, not via IPC.
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

// Typed error categories sent over IPC. These are safe for the renderer —
// no URLs, trace IDs, retry counts, or other main-process environment details.
export const STREAM_ERROR_CATEGORIES = {
  RATE_LIMITED: 'rate_limited',
  AUTH: 'auth',
  NETWORK: 'network',
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
    if (status === 404) return STREAM_ERROR_CATEGORIES.INVALID_REQUEST;
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
  if (msg.includes('rate') || msg.includes('limit') || msg.includes('429')) return STREAM_ERROR_CATEGORIES.RATE_LIMITED;
  if (msg.includes('auth') || msg.includes('key') || msg.includes('permission')) return STREAM_ERROR_CATEGORIES.AUTH;
  if (msg.includes('network') || msg.includes('connect') || msg.includes('timeout') || msg.includes('dns')) return STREAM_ERROR_CATEGORIES.NETWORK;
  return STREAM_ERROR_CATEGORIES.UNKNOWN;
}

// Returns a generic, user-facing error message for a given category.
// Never includes raw SDK details (URLs, trace IDs, retry counts, etc.).
export function streamErrorUserMessage(category: StreamErrorCategory): string {
  switch (category) {
    case STREAM_ERROR_CATEGORIES.RATE_LIMITED:
      return 'Rate limit reached — try again shortly.';
    case STREAM_ERROR_CATEGORIES.AUTH:
      return 'Authentication error — check your API key in Settings.';
    case STREAM_ERROR_CATEGORIES.NETWORK:
      return 'Network error — check your connection and try again.';
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

// Internal result passed to the onReady callback in runStream.
// ok:true  — stream is open, tokens will follow via IPC.
// ok:false — provider rejected before the first chunk; caller surfaces this as a handler return error.
type ReadyResult =
  | { ok: true }
  | { ok: false; category: StreamErrorCategory; message: string };

// Runs the Anthropic stream for a given IPC request.
//
// onReady is called exactly once:
//   - {ok:true}  when the first chunk is received (stream is confirmed open)
//   - {ok:false} when the provider rejects before any chunk arrives
//
// After onReady({ok:true}), execution yields (await Promise.resolve()) so the
// startHandler's continuation runs and the renderer receives the streamId before
// any STREAM_TOKEN events are dispatched — matching the behaviour of an HTTP
// server that flushes the status line before the body.
//
// Mid-stream errors (after onReady) continue to emit STREAM_ERROR via IPC so the
// renderer can surface them on an already-open stream.
async function runStream(
  sender: WebContents,
  streamId: string,
  payload: StreamStartPayload,
  controller: AbortController,
  getApiKey: () => string,
  reg: StreamRegistry,
  onReady: (result: ReadyResult) => void,
): Promise<void> {
  let readySignaled = false;
  try {
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

    for await (const chunk of sdkStream) {
      if (!readySignaled) {
        readySignaled = true;
        onReady({ ok: true });
        // Yield so the startHandler's microtask continuation runs before we push
        // any STREAM_TOKEN events — renderer gets streamId before first token.
        await Promise.resolve();
      }

      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const entry = reg.get(streamId);
        if (!entry) continue;

        if (entry.pendingTokens >= MAX_PENDING_TOKENS) {
          await reg.waitForDrain(streamId);
          // Exit cleanly on cancel or destroyed renderer — AbortError follows from the SDK on next tick.
          if (controller.signal.aborted || sender.isDestroyed()) break;
        }

        const current = reg.get(streamId);
        if (!current || sender.isDestroyed()) continue;

        current.pendingTokens++;
        sender.send(STREAM_CHANNELS.STREAM_TOKEN, { streamId, token: chunk.delta.text });
      }
    }

    if (!readySignaled) {
      // Stream completed with zero chunks (empty response) — not a provider error.
      readySignaled = true;
      onReady({ ok: true });
    }

    if (!sender.isDestroyed()) {
      sender.send(STREAM_CHANNELS.STREAM_END, { streamId });
    }
  } catch (err: unknown) {
    if (!readySignaled) {
      // Provider rejected before the first chunk.  Signal the error back to the
      // startHandler so it can return a proper error response instead of a streamId.
      // No IPC events are emitted at this point — the renderer has not committed to
      // the stream yet.
      readySignaled = true;
      const category = categorizeStreamError(err);
      onReady({ ok: false, category, message: streamErrorUserMessage(category) });
    } else {
      // Error after the stream was already open — emit a structured IPC event so
      // the renderer can surface it on the in-progress stream.
      const isAbort = (err as Error)?.name === 'AbortError';
      if (!sender.isDestroyed()) {
        if (isAbort) {
          sender.send(STREAM_CHANNELS.STREAM_END, { streamId });
        } else {
          // Log raw SDK details in main process only — never forward to renderer.
          console.error(`[stream:error][mid-stream] streamId=${streamId} error=${(err as Error)?.message ?? 'Unknown'}`);
          const category = categorizeStreamError(err);
          sender.send(STREAM_CHANNELS.STREAM_ERROR, {
            streamId,
            category,
            message: streamErrorUserMessage(category),
          });
        }
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
  ipcMain.handle(STREAM_CHANNELS.STREAM_START, async (event, payload: StreamStartPayload) => {
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

    // Await the ready signal: runStream calls onReady once the provider confirms the
    // stream is open (first chunk received) or rejects it (pre-flush error).
    // This ensures the handler returns an accurate result — streamId on success,
    // or a PROVIDER_ERROR on rejection — before any STREAM_TOKEN events are sent.
    const ready = await new Promise<ReadyResult>((resolve) => {
      void runStream(event.sender, streamId, payload, controller, getApiKey, reg, resolve);
    });

    if (!ready.ok) {
      return { error: STREAM_ERRORS.PROVIDER_ERROR, category: ready.category, message: ready.message };
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
