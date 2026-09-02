// Model-agnostic AI provider abstraction.
// Supports: Anthropic Claude (cloud), OpenAI (cloud), Ollama (local),
// LM Studio (local), and custom OpenAI-compatible endpoints.
//
// All providers emit tokens via the same AsyncIterable<string> interface so
// streaming.ts and agents can stay provider-unaware.

import Anthropic from '@anthropic-ai/sdk';
import { SafeIpcError } from './ipcErrors.js';

// ─── Provider config ─────────────────────────────────────────────────────────

// Beta 4 M28 (B4-10): 'llamacpp' — llama.cpp's llama-server speaks the OpenAI
// chat-completions dialect at http://127.0.0.1:8080/v1, so it rides the same
// OpenAI-compatible transport as ollama/lmstudio/custom.
export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'llamacpp' | 'custom';

export interface ProviderConfig {
  kind: ProviderKind;
  /** API key — required for anthropic / openai; ignored for local providers */
  apiKey?: string;
  /** Base URL override. Defaults are set per-kind if omitted. */
  baseUrl?: string;
  /** Model identifier, e.g. 'claude-haiku-4-5-20251001', 'gpt-4o-mini', 'llama3', etc. */
  model: string;
  /**
   * Optional STT/TTS capability hints.
   * When absent, defaults are inferred from provider kind:
   * - openai and custom (with baseUrl set): treated as { transcribe: true, speak: true }
   * - all other kinds: no voice capability
   */
  capabilities?: { transcribe?: boolean; speak?: boolean };
}

// ─── Default base URLs ────────────────────────────────────────────────────────

export const DEFAULT_BASE_URLS: Record<ProviderKind, string | undefined> = {
  anthropic: undefined, // SDK resolves its own default
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  llamacpp: 'http://127.0.0.1:8080/v1',
  custom: undefined,
};

// ─── Token budget & reasoning headroom (SKY-11276) ───────────────────────────

/**
 * Answer-budget default when a caller doesn't specify `maxTokens`. This is the
 * budget for the *answer* only — reasoning headroom (below) is added on top for
 * models that think before they answer.
 */
export const DEFAULT_ANSWER_MAX_TOKENS = 1024;

/**
 * Extra `max_tokens` granted to local runtimes on top of the answer budget so a
 * reasoning model can spend tokens *thinking* without eating the answer.
 *
 * SKY-11276 (follow-up to SKY-11220): reasoning models (qwen3, DeepSeek-R1,
 * gpt-oss on LM Studio) emit a long chain-of-thought before their first answer
 * token. Sending the caller's small answer budget verbatim as the server's
 * `max_tokens` meant the model exhausted the budget mid-thought and returned
 * `finish_reason: "length"` with zero content — an empty answer. Verified live:
 * DeepSeek-R1-8B on LM Studio at `max_tokens: 1024` produced 0 content tokens
 * and ~680 reasoning tokens before being cut off. Adding this reserve gives
 * thinking its own room so the answer budget is preserved for the answer.
 *
 * This is a heuristic ceiling, not a target: a non-reasoning model stops at its
 * natural stop token and is unaffected. If a model's thinking still overruns
 * even this reserve, the stream surfaces TokenBudgetExhaustedError so the user
 * gets a specific, actionable message rather than silence.
 */
export const REASONING_TOKEN_RESERVE = 8192;

/**
 * Provider kinds that are unconditionally a local runtime on the user's own
 * machine. Tokens are free there and reasoning models are common, so they get
 * the thinking reserve by default. `custom` is deliberately NOT here — it is
 * handled separately because a custom OpenAI-compatible endpoint is often a
 * paid cloud aggregator (OpenRouter / Together / Groq), not localhost.
 */
const ALWAYS_LOCAL_PROVIDER_KINDS = new Set<ProviderKind>(['ollama', 'lmstudio', 'llamacpp']);

/** True when the URL targets loopback (127.0.0.0/8, ::1, localhost). */
export function isLoopbackUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const raw = parsed.hostname.toLowerCase();
  const host = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/**
 * Whether a request to this provider should receive the reasoning-token reserve.
 *
 * lmstudio / ollama / llamacpp are always local. `custom` qualifies ONLY when
 * its baseUrl is loopback — a remote custom endpoint may be a paid aggregator,
 * and silently raising its token ceiling by REASONING_TOKEN_RESERVE could
 * inflate a bill for a verbose/runaway model (SKY-11276 review). Cloud kinds
 * (anthropic / openai) never qualify: their tokens are billed and the caller
 * sizes `maxTokens` deliberately.
 */
export function isLocalReserveEligible(kind: ProviderKind, baseUrl: string | undefined): boolean {
  if (ALWAYS_LOCAL_PROVIDER_KINDS.has(kind)) return true;
  if (kind === 'custom') return isLoopbackUrl(baseUrl ?? DEFAULT_BASE_URLS.custom);
  return false;
}

/**
 * Effective `max_tokens` to send to the server for a given answer budget.
 *
 * Eligible local runtimes (see isLocalReserveEligible) get
 * `answerBudget + REASONING_TOKEN_RESERVE` so thinking tokens don't consume the
 * answer budget (SKY-11276). `applyReserve=false` opts out entirely — used by
 * liveness probes (the connection test) that deliberately request a 1-token
 * budget and abort on the first token, where the reserve would turn a quick
 * ping into a multi-thousand-token thinking session.
 */
export function effectiveMaxTokens(
  kind: ProviderKind,
  answerBudget: number,
  baseUrl: string | undefined,
  applyReserve = true,
): number {
  return applyReserve && isLocalReserveEligible(kind, baseUrl)
    ? answerBudget + REASONING_TOKEN_RESERVE
    : answerBudget;
}

// ─── SSRF guard (SKY-739) ─────────────────────────────────────────────────────

/**
 * Validates that a base URL is safe for outbound HTTP fetch calls (SSRF prevention).
 * Returns null if the URL is acceptable, or an error string if it should be rejected.
 *
 * Allow: http/https schemes; loopback (127.0.0.0/8, ::1, localhost).
 * Block: non-http(s) schemes; link-local/APIPA (169.254.x.x, fe80::); 0.0.0.0;
 *        RFC-1918 private ranges (10.x, 172.16-31.x, 192.168.x).
 */
export function validateBaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL: cannot parse.';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `URL scheme "${parsed.protocol.replace(':', '')}" is not allowed — only http and https are permitted.`;
  }

  // WHATWG URL API includes brackets for IPv6 hosts (e.g. "[::1]") — strip them before matching.
  const raw = parsed.hostname.toLowerCase();
  const host = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;

  // IPv4-mapped IPv6: WHATWG URL normalizes e.g. ::ffff:192.168.1.1 → ::ffff:c0a8:101.
  // Decode the embedded IPv4 and re-run all guards (SKY-752).
  const v4mapped = host.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
  if (v4mapped) {
    const hi = parseInt(v4mapped[1], 16);
    const lo = parseInt(v4mapped[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return validateBaseUrl(`http://${ipv4}`);
  }

  // Allow loopback — Ollama (127.0.0.1:11434) and LM Studio (127.0.0.1:1234) live here.
  if (host === 'localhost' || host === '::1') return null;
  if (/^127\./.test(host)) return null;

  // Block link-local / APIPA (AWS/GCP/Azure IMDS lives at 169.254.169.254).
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host)) {
    return 'URL targets a link-local address — not allowed.';
  }

  // Block unspecified address.
  if (host === '0.0.0.0') {
    return 'URL targets 0.0.0.0 — not allowed.';
  }

  // Block RFC-1918 private ranges.
  if (/^10\./.test(host)) {
    return 'URL targets an RFC-1918 private address (10.0.0.0/8) — not allowed.';
  }
  if (/^192\.168\./.test(host)) {
    return 'URL targets an RFC-1918 private address (192.168.0.0/16) — not allowed.';
  }
  const m172 = host.match(/^172\.(\d+)\./);
  if (m172) {
    const second = parseInt(m172[1], 10);
    if (second >= 16 && second <= 31) {
      return 'URL targets an RFC-1918 private address (172.16.0.0/12) — not allowed.';
    }
  }

  return null;
}

// ─── Model listing (SKY-1499) ─────────────────────────────────────────────────

export interface ListModelsPayload {
  kind: ProviderKind;
  /** Provider base URL. Falls back to DEFAULT_BASE_URLS[kind] when absent. */
  baseUrl?: string;
  /** API key — forwarded as Bearer token when present. */
  apiKey?: string;
}

export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

/**
 * Fetch the model list from a provider endpoint.
 *
 * Routing:
 *   - ollama  → GET {origin}/api/tags   → models[].name
 *   - others  → GET {baseUrl}/models    → data[].id
 *
 * The timeout is enforced via AbortController — local runtimes get a longer
 * budget because a cold LM Studio / Ollama / llama.cpp can take several seconds
 * to load a model on the first call (SKY-11240 AC1). validateBaseUrl is called
 * before any fetch to block SSRF targets.
 */
export async function listModels(payload: ListModelsPayload): Promise<ListModelsResult> {
  if (!aiMasterGate()) return { ok: false, error: AI_DISABLED_MESSAGE };
  const { kind, baseUrl, apiKey } = payload;

  let resolvedBase: string;
  if (kind === 'ollama') {
    // Native Ollama /api/tags lives at the origin, not under /v1.
    // We extract just the origin so a /v1 suffix in the user's config doesn't break the path.
    const configured = baseUrl ?? 'http://127.0.0.1:11434';
    try {
      resolvedBase = new URL(configured).origin;
    } catch {
      return { ok: false, error: 'Invalid Ollama base URL.' };
    }
  } else {
    const fallback = DEFAULT_BASE_URLS[kind];
    resolvedBase = (baseUrl ?? fallback ?? '').replace(/\/$/, '');
    if (!resolvedBase) {
      return { ok: false, error: `Provider kind "${kind}" requires a baseUrl.` };
    }
  }

  const guardError = validateBaseUrl(resolvedBase);
  if (guardError) {
    return { ok: false, error: guardError };
  }

  // Local runtimes (LM Studio / Ollama / llama.cpp / a self-hosted custom
  // endpoint) may still be loading a model on the first request; give them
  // warmup headroom. Cloud APIs answer /models instantly, so keep them snappy.
  const localKinds = new Set<ProviderKind>(['ollama', 'lmstudio', 'llamacpp', 'custom']);
  const timeoutMs = localKinds.has(kind) ? 15_000 : 5_000;
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = kind === 'ollama'
      ? `${resolvedBase}/api/tags`
      : `${resolvedBase}/models`;

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      return {
        ok: false,
        error: `${PROVIDER_LABELS[kind]} at ${resolvedBase} returned HTTP ${res.status}. Check the endpoint and try again.`,
      };
    }

    const json: unknown = await res.json();

    let models: string[];
    if (kind === 'ollama') {
      const resp = json as { models?: Array<{ name?: string }> };
      models = (resp.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    } else {
      const resp = json as { data?: Array<{ id?: string }> };
      models = (resp.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }

    return { ok: true, models };
  } catch (err) {
    const label = PROVIDER_LABELS[kind];
    if ((err as { name?: string }).name === 'AbortError') {
      return {
        ok: false,
        error: `${label} at ${resolvedBase} did not respond within ${timeoutSeconds} seconds — if it is still loading a model, wait a moment and try again.`,
      };
    }
    const msg = ((err as Error).message ?? '').toLowerCase();
    if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('network')) {
      return { ok: false, error: `Network error reaching ${label} at ${resolvedBase} — check that the server is running and reachable.` };
    }
    return { ok: false, error: `Failed to list ${label} models at ${resolvedBase} — check the provider configuration.` };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Token stream interface ───────────────────────────────────────────────────

export interface StreamRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Thinking-mode hint, honored by providers/models that support it (currently
   * Anthropic only; ignored by OpenAI-compatible providers).
   *
   * - 'adaptive' — request adaptive thinking on models that support it
   *   (interactive chat surfaces, where reasoning quality matters and the
   *   caller has budgeted maxTokens headroom for thinking tokens).
   * - omitted — thinking off. Scan-style calls with small token budgets and
   *   strict output contracts rely on this; on models that would otherwise
   *   run thinking by default an explicit disabled config is sent so thinking
   *   tokens can't eat the output budget.
   */
  thinking?: 'adaptive';
  /**
   * When `false`, suppress the local reasoning-token reserve (SKY-11276) so the
   * server receives exactly `maxTokens`. Used by liveness probes (the Settings
   * connection test) that send a 1-token budget and abort on the first token —
   * there the reserve would turn a quick ping into a long thinking session.
   * Defaults to applying the reserve for eligible local runtimes.
   */
  reserveThinkingTokens?: boolean;
}

export interface StreamResult {
  /** Async iterable of text tokens emitted by the model */
  tokens: AsyncIterable<string>;
  /** Populated after the stream ends; may be null for providers that don't report usage */
  usage?: { inputTokens: number; outputTokens: number } | null;
}

// ─── Capability types ─────────────────────────────────────────────────────────

/** Voice capabilities a provider adapter may declare. */
export type ProviderCapability = 'stt' | 'tts';

/** Options for audio-to-text transcription. */
export interface TranscribeOptions {
  /** BCP-47 language tag (e.g. 'en'). Omit to let the provider auto-detect. */
  language?: string;
  /** Context hint to guide transcription style or spelling. */
  prompt?: string;
}

/** Options for text-to-audio synthesis. */
export interface SpeakOptions {
  /** Voice identifier understood by the provider (e.g. 'alloy', 'echo', 'shimmer'). */
  voice?: string;
  /** Playback speed multiplier (0.25–4.0); provider default if omitted. */
  speed?: number;
}

/** Raw audio data chunk emitted by a speak stream. */
export interface AudioChunk {
  /** Raw audio bytes (format determined by provider/negotiation). */
  data: Buffer;
  /** MIME type for the bytes, e.g. 'audio/opus', 'audio/mp3'. */
  mimeType: string;
}

// ─── Provider object interface ────────────────────────────────────────────────

/**
 * A Provider wraps a ProviderConfig and exposes the adapter's capabilities
 * alongside the streaming and (for OpenAI-compatible adapters) voice methods.
 */
export interface Provider {
  readonly config: ProviderConfig;
  /** Capabilities declared by this adapter. */
  readonly capabilities: ReadonlyArray<ProviderCapability>;
  /** Stream text tokens from the LLM. */
  stream(req: StreamRequest): AsyncIterable<string>;
  /** Returns true if this adapter declares support for the given capability. */
  supportsCapability(cap: ProviderCapability): boolean;
  /** Transcribe audio to text. Present only when capabilities includes 'stt'. */
  transcribe?(audio: Buffer | Blob, opts?: TranscribeOptions): Promise<string>;
  /** Synthesise speech from text. Present only when capabilities includes 'tts'. */
  speak?(text: string, opts?: SpeakOptions): AsyncIterable<AudioChunk>;
}

// ─── Capability declarations ──────────────────────────────────────────────────

/**
 * Declared capabilities for each provider kind.
 * OpenAI-compatible endpoints expose /audio/transcriptions and /audio/speech;
 * implementation is wired in a follow-up child issue.
 */
export const PROVIDER_CAPABILITIES: Record<ProviderKind, ReadonlyArray<ProviderCapability>> = {
  anthropic: [],
  openai: ['stt', 'tts'],
  ollama: ['stt', 'tts'],
  lmstudio: ['stt', 'tts'],
  // llama-server exposes chat completions only — no /audio/* endpoints.
  llamacpp: [],
  custom: ['stt', 'tts'],
};

// ─── Anthropic implementation ─────────────────────────────────────────────────

/**
 * Anthropic models that accept `thinking: {type: 'adaptive'}` (the 4.6 family
 * and newer). Haiku 4.5 predates adaptive thinking and rejects it with a 400,
 * so it must stay out of this set.
 */
export const ANTHROPIC_ADAPTIVE_THINKING_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-5',
]);

/**
 * Anthropic models that run adaptive thinking when the `thinking` parameter is
 * omitted (Claude Sonnet 5 and newer Sonnets). Requests that want thinking off
 * must send an explicit disabled config on these models — otherwise thinking
 * tokens count against max_tokens and can truncate small structured-output
 * scans (JSON-per-line contracts) into unparseable fragments.
 */
export const ANTHROPIC_THINKING_ON_BY_DEFAULT_MODELS = new Set(['claude-sonnet-5']);

/**
 * Build the `thinking` request fragment for an Anthropic Messages call.
 * Shared by the streaming path and the non-streaming extraction side-call so
 * both apply the same model gating.
 */
export function anthropicThinkingParam(
  model: string,
  mode: 'adaptive' | undefined,
): { thinking: Anthropic.Messages.ThinkingConfigParam } | Record<string, never> {
  if (mode === 'adaptive' && ANTHROPIC_ADAPTIVE_THINKING_MODELS.has(model)) {
    return { thinking: { type: 'adaptive' } };
  }
  if (ANTHROPIC_THINKING_ON_BY_DEFAULT_MODELS.has(model)) {
    return { thinking: { type: 'disabled' } };
  }
  return {};
}

async function* runAnthropicStream(
  config: ProviderConfig,
  req: StreamRequest,
): AsyncIterable<string> {
  if (!config.apiKey) throw new Error('Anthropic provider requires an API key.');
  const client = new Anthropic({ apiKey: config.apiKey });
  const maxTokens = req.maxTokens ?? DEFAULT_ANSWER_MAX_TOKENS;
  const sdkStream = client.messages.stream(
    {
      model: config.model,
      max_tokens: maxTokens,
      ...anthropicThinkingParam(config.model, req.thinking),
      ...(req.system !== undefined ? { system: req.system } : {}),
      messages: req.messages,
    },
    { signal: req.signal },
  );
  let yieldedText = false;
  let stopReason: string | null = null;
  for await (const chunk of sdkStream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yieldedText = true;
      yield chunk.delta.text;
    } else if (chunk.type === 'message_delta') {
      stopReason = chunk.delta.stop_reason ?? stopReason;
    }
  }

  // Adaptive thinking counts against max_tokens on Anthropic. If the budget ran
  // out while the model was thinking, it ends with stop_reason 'max_tokens' and
  // no text — same failure class as the local reasoning path (SKY-11276). Guard
  // on whether adaptive thinking was ACTUALLY applied (the request asked for it
  // AND the model supports it) — otherwise a max_tokens truncation on a model
  // where thinking is off (e.g. Haiku 4.5) would throw a misleading "still
  // thinking" error. Scan-style calls (thinking off / disabled) keep their
  // existing empty-output handling untouched.
  const adaptiveThinkingApplied =
    req.thinking === 'adaptive' && ANTHROPIC_ADAPTIVE_THINKING_MODELS.has(config.model);
  if (!yieldedText && stopReason === 'max_tokens' && adaptiveThinkingApplied) {
    const address = (client as { baseURL?: string }).baseURL ?? 'https://api.anthropic.com';
    throw new TokenBudgetExhaustedError('anthropic', address, maxTokens);
  }
}

// ─── Human-readable provider labels ──────────────────────────────────────────
// Used in user-facing error messages so a failure names the provider + address
// the user actually configured, never a bare kind string (SKY-11240 AC3).

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  llamacpp: 'llama.cpp',
  custom: 'Custom endpoint',
};

/**
 * Raised when an OpenAI-compatible stream completes without ever yielding a
 * single usable token — no `content`, no `reasoning_content`/`reasoning`, and
 * nothing but `<think>` chain-of-thought. Rather than let the surface fall
 * silent (or show a generic "produced no content"), we throw a specific,
 * actionable error naming the provider and its address so every consumer
 * surface (chat, Quick Entry, both beta-read paths) reports the same thing
 * (SKY-11240 AC3).
 *
 * Extends SafeIpcError so the message — which names a user-configured endpoint
 * URL, not a filesystem path or secret — passes the IPC sanitizer verbatim
 * instead of being flattened to "Internal error." (the `http:/` in the URL
 * would otherwise trip the Windows-drive-letter path-leak heuristic).
 */
export class EmptyProviderResponseError extends SafeIpcError {
  readonly kind: ProviderKind;
  readonly address: string;
  constructor(kind: ProviderKind, address: string) {
    super(
      `${PROVIDER_LABELS[kind]} at ${address} returned an empty response — ` +
        `no content and no reasoning. Make sure a model is loaded on the server ` +
        `and try again.`,
    );
    this.name = 'EmptyProviderResponseError';
    this.kind = kind;
    this.address = address;
  }
}

/**
 * Raised when a stream ends because the model hit its `max_tokens` ceiling
 * (`finish_reason: "length"` / `stop_reason: "max_tokens"`) *before emitting a
 * single answer token* — i.e. a reasoning model spent the whole budget thinking
 * (SKY-11276, follow-up to SKY-11220).
 *
 * This is deliberately distinct from EmptyProviderResponseError: "nothing came
 * back at all" (model not loaded, dead endpoint) is a different failure from
 * "the model was mid-thought when the budget ran out." Surfacing it specifically
 * lets the user fix the real cause — raise the response token limit, or pick a
 * model that thinks less — instead of seeing a generic empty-response message or
 * having truncated chain-of-thought dumped in place of an answer.
 *
 * Extends SafeIpcError for the same reason as EmptyProviderResponseError: the
 * message names a user-configured endpoint URL, which must pass the IPC
 * sanitizer verbatim rather than being flattened to "Internal error."
 */
export class TokenBudgetExhaustedError extends SafeIpcError {
  readonly kind: ProviderKind;
  readonly address: string;
  readonly maxTokens: number;
  constructor(kind: ProviderKind, address: string, maxTokens: number) {
    super(
      `${PROVIDER_LABELS[kind]} at ${address} hit its ${maxTokens}-token response ` +
        `limit while the model was still thinking, so no answer was produced. This ` +
        `model spends tokens reasoning before it answers — raise the response token ` +
        `limit or choose a model that thinks less, then try again.`,
    );
    this.name = 'TokenBudgetExhaustedError';
    this.kind = kind;
    this.address = address;
    this.maxTokens = maxTokens;
  }
}

// ─── Inline chain-of-thought (<think>) stripping (SKY-11240) ──────────────────
// Some local reasoning models don't split their thinking into a separate
// `reasoning_content` field — they emit literal `<think>…</think>` blocks
// *inside* `content`. Left untouched, that private reasoning lands verbatim in
// the manuscript/notes. We strip complete `<think>…</think>` spans from the
// emitted text.

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Longest suffix of `buf` that is a prefix of `tag`. Those trailing chars might
 * be the start of `tag` split across the SSE chunk boundary, so the streaming
 * stripper holds them back until the next chunk disambiguates.
 */
function danglingTagPrefixLen(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let k = max; k >= 1; k--) {
    if (buf.slice(buf.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Stateful, streaming-safe `<think>` stripper. `push()` returns the text that
 * is safe to emit now (with any complete `<think>…</think>` spans removed and
 * any partial-tag / mid-think tail held back); `flush()` returns whatever
 * remains once the stream ends (dropping an unterminated `<think>` block).
 */
export function createThinkStripper(): { push(chunk: string): string; flush(): string } {
  let inside = false;
  let buf = '';

  function push(chunk: string): string {
    buf += chunk;
    let out = '';
    // Loop until we can make no further definite progress on the buffer.
    for (;;) {
      if (!inside) {
        const open = buf.indexOf(THINK_OPEN);
        if (open === -1) {
          // No complete open tag. Emit everything except a possible partial
          // `<think>` straddling the next chunk boundary.
          const hold = danglingTagPrefixLen(buf, THINK_OPEN);
          out += buf.slice(0, buf.length - hold);
          buf = buf.slice(buf.length - hold);
          break;
        }
        out += buf.slice(0, open);
        buf = buf.slice(open + THINK_OPEN.length);
        inside = true;
      } else {
        const close = buf.indexOf(THINK_CLOSE);
        if (close === -1) {
          // Still inside a think block. Discard everything except a possible
          // partial `</think>` straddling the next chunk boundary.
          const hold = danglingTagPrefixLen(buf, THINK_CLOSE);
          buf = buf.slice(buf.length - hold);
          break;
        }
        buf = buf.slice(close + THINK_CLOSE.length);
        inside = false;
      }
    }
    return out;
  }

  function flush(): string {
    // An unterminated `<think>` (inside === true) is dropped — its content is
    // private reasoning that never got closed. Otherwise the held-back tail was
    // ordinary text that merely looked like the start of a tag; emit it.
    const rest = inside ? '' : buf;
    buf = '';
    return rest;
  }

  return { push, flush };
}

/** One-shot `<think>…</think>` strip for non-streaming text (e.g. the reasoning fallback). */
export function stripThinkBlocks(text: string): string {
  const stripper = createThinkStripper();
  return stripper.push(text) + stripper.flush();
}

// ─── OpenAI-compatible SSE implementation ─────────────────────────────────────
// Used for OpenAI, Ollama, LM Studio, and custom endpoints.
// Avoids adding an openai npm dependency — uses the streaming REST API directly.

async function* runOpenAICompatibleStream(
  config: ProviderConfig,
  req: StreamRequest,
): AsyncIterable<string> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[config.kind] ?? '';
  if (!baseUrl) {
    throw new Error(`Provider "${config.kind}" requires a baseUrl.`);
  }

  // SSRF guard: validate before any outbound fetch (SKY-739).
  const urlError = validateBaseUrl(baseUrl);
  if (urlError) {
    throw new Error(urlError);
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Build messages: prepend system as a system role message when present
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }
  for (const m of req.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  // The caller's maxTokens is the ANSWER budget. Eligible local runtimes get a
  // thinking reserve added on top so a reasoning model can't exhaust the budget
  // mid-thought and return nothing (SKY-11276). Probes opt out via
  // reserveThinkingTokens:false. See effectiveMaxTokens.
  const answerBudget = req.maxTokens ?? DEFAULT_ANSWER_MAX_TOKENS;
  const maxTokensToSend = effectiveMaxTokens(
    config.kind,
    answerBudget,
    baseUrl,
    req.reserveThinkingTokens !== false,
  );

  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: maxTokensToSend,
    stream: true,
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body,
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status}: ${text}`), { status: res.status });
  }

  if (!res.body) throw new Error('Response body is null');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // SKY-11220: local reasoning models (e.g. qwen3 / DeepSeek-R1 / gpt-oss on LM
  // Studio) stream their answer in `delta.reasoning_content` (or `delta.reasoning`)
  // and — for the whole stream — leave `delta.content` empty. A parser that reads
  // only `delta.content` therefore emits zero tokens, making every AI surface look
  // silent even though the model responded. We stream `content` as before, but
  // buffer any reasoning text so that if the model never emits real content we can
  // fall back to it rather than yielding nothing. When content IS present the
  // reasoning (the model's private thinking) is discarded, so well-behaved
  // reasoning models keep hiding their chain-of-thought.
  //
  // SKY-11240: two further guarantees layered on top —
  //   • inline `<think>…</think>` blocks are stripped from emitted content so
  //     raw chain-of-thought never reaches saved manuscript/notes; and
  //   • a stream that ends with nothing usable (no content, no reasoning, only
  //     stripped `<think>`) throws EmptyProviderResponseError instead of ending
  //     silently, so every surface shows a specific, actionable message.
  const thinkStripper = createThinkStripper();
  let yieldedText = false;
  let reasoningBuffer = '';
  // Last non-null finish_reason seen. 'length' means the server stopped at the
  // max_tokens ceiling — the signal we use to distinguish "budget exhausted
  // mid-thinking" from "nothing came back at all" (SKY-11276).
  let finishReason: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const json = trimmed.slice(6);
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          continue;
        }

        const choice = (parsed as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string; reasoning?: string };
            finish_reason?: string | null;
          }>;
        })?.choices?.[0];
        const delta = choice?.delta;
        if (typeof choice?.finish_reason === 'string') {
          finishReason = choice.finish_reason;
        }

        const content = delta?.content;
        if (typeof content === 'string' && content.length > 0) {
          const clean = thinkStripper.push(content);
          if (clean.length > 0) {
            yieldedText = true;
            yield clean;
          }
          continue;
        }

        // No content on this chunk — accumulate any reasoning text as a fallback.
        // Buffered unconditionally; it is only surfaced below if the stream never
        // produced usable content.
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          reasoningBuffer += reasoning;
        }
      }
    }

    // Flush any text held back at a chunk boundary (a `<think>` that never
    // opened, or trailing content after the final `</think>`).
    const tail = thinkStripper.flush();
    if (tail.length > 0) {
      yieldedText = true;
      yield tail;
    }

    // Budget exhausted mid-thinking (SKY-11276): the server stopped at the
    // max_tokens ceiling (`finish_reason: "length"`) before emitting any answer
    // token. A reasoning buffer here is TRUNCATED thinking, not an answer, so we
    // do NOT surface it as the reasoning fallback would — that would dump partial
    // chain-of-thought in place of an answer. Throw the specific, actionable
    // error instead, distinct from "nothing came back at all" below.
    if (!yieldedText && finishReason === 'length') {
      throw new TokenBudgetExhaustedError(config.kind, baseUrl, maxTokensToSend);
    }

    // The model streamed reasoning but never emitted usable content AND finished
    // normally — it answered entirely in the reasoning field. Surface that text
    // (with any `<think>` blocks stripped) so the answer isn't silently dropped
    // (SKY-11220).
    if (!yieldedText && reasoningBuffer.length > 0) {
      const cleanedReasoning = stripThinkBlocks(reasoningBuffer);
      if (cleanedReasoning.length > 0) {
        yieldedText = true;
        yield cleanedReasoning;
      }
    }

    // Nothing usable at all — never end silently (SKY-11240 AC3).
    if (!yieldedText) {
      throw new EmptyProviderResponseError(config.kind, baseUrl);
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function makeAnthropicProvider(config: ProviderConfig): Provider {
  return {
    config,
    capabilities: PROVIDER_CAPABILITIES.anthropic,
    stream(req: StreamRequest): AsyncIterable<string> {
      return runAnthropicStream(config, req);
    },
    supportsCapability(_cap: ProviderCapability): boolean {
      return false;
    },
  };
}

function makeOpenAICompatibleProvider(config: ProviderConfig): Provider {
  const caps = PROVIDER_CAPABILITIES[config.kind];
  return {
    config,
    capabilities: caps,
    stream(req: StreamRequest): AsyncIterable<string> {
      return runOpenAICompatibleStream(config, req);
    },
    supportsCapability(cap: ProviderCapability): boolean {
      return caps.includes(cap);
    },
    async transcribe(_audio: Buffer | Blob, _opts?: TranscribeOptions): Promise<string> {
      throw new Error('transcribe: not yet implemented — wired in a follow-up child issue.');
    },
    async *speak(_text: string, _opts?: SpeakOptions): AsyncGenerator<AudioChunk> {
      throw new Error('speak: not yet implemented — wired in a follow-up child issue.');
    },
  };
}

/**
 * Create a Provider adapter from a ProviderConfig.
 * The returned Provider declares capabilities and exposes stub voice methods on
 * OpenAI-compatible adapters (implementation in a follow-up child issue).
 */
export function createProvider(config: ProviderConfig): Provider {
  if (config.kind === 'anthropic') {
    return makeAnthropicProvider(config);
  }
  return makeOpenAICompatibleProvider(config);
}

// ─── Public API ───────────────────────────────────────────────────────────────

// ─── M11a master AI gate (SKY-9160) ──────────────────────────────────────────
// Every provider network call funnels through streamFromProvider/listModels,
// so this single gate makes "Nothing is sent anywhere" a guarantee, not a
// convention. main.ts injects the real check at boot (reads ai.enabled from
// app settings); the default keeps this module usable standalone in tests.

/** Surfaced to the renderer when a call is rejected in manual mode. */
export const AI_DISABLED_MESSAGE =
  'AI features are off — every tool is manual. Turn them back on in Settings → AI Agents.';

export class AiDisabledError extends Error {
  constructor() {
    super(AI_DISABLED_MESSAGE);
    this.name = 'AiDisabledError';
  }
}

let aiMasterGate: () => boolean = () => true;

/** Inject the master `ai.enabled` check. Called once from main.ts at boot. */
export function setAiMasterGate(gate: () => boolean): void {
  aiMasterGate = gate;
}

/**
 * Read the master `ai.enabled` check without throwing. Lets non-LLM call
 * sites (e.g. voice.ts cloud STT/TTS) share the same gate as streamFromProvider
 * so "Nothing is sent anywhere" holds for every network path, not just LLM calls.
 */
export function isAiMasterOn(): boolean {
  return aiMasterGate();
}

/** Allowlist of valid model IDs for the Anthropic provider. */
export const ANTHROPIC_MODEL_ALLOWLIST = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
]);


/**
 * Validates a model name for a given provider kind.
 * Anthropic: must be in ANTHROPIC_MODEL_ALLOWLIST (security control).
 * All other providers: any non-empty string up to 128 chars (no canonical registry).
 */
export function isModelValid(model: string, kind: ProviderKind): boolean {
  if (!model || model.trim() === '') return false;
  if (kind === 'anthropic') return ANTHROPIC_MODEL_ALLOWLIST.has(model);
  return model.length <= 128;
}

/**
 * Stream tokens from any configured provider.
 * Returns an AsyncIterable<string> that emits text tokens until the response ends or is aborted.
 */
export async function* streamFromProvider(
  config: ProviderConfig,
  req: StreamRequest,
): AsyncIterable<string> {
  if (!aiMasterGate()) throw new AiDisabledError();
  if (config.kind === 'anthropic') {
    yield* runAnthropicStream(config, req);
  } else {
    yield* runOpenAICompatibleStream(config, req);
  }
}

/**
 * Validate a ProviderConfig at startup / settings-save time.
 * Returns null if valid; returns a human-readable error string if not.
 */
export function validateProviderConfig(cfg: ProviderConfig): string | null {
  if (!cfg.kind) return 'Provider kind is required.';
  if (!cfg.model || typeof cfg.model !== 'string' || cfg.model.trim() === '') {
    return 'Provider model is required.';
  }
  if (cfg.kind === 'anthropic' && !cfg.apiKey) {
    return 'Anthropic provider requires an API key.';
  }
  if (cfg.kind === 'openai' && !cfg.apiKey) {
    return 'OpenAI provider requires an API key.';
  }
  if ((cfg.kind === 'custom') && !cfg.baseUrl) {
    return 'Custom provider requires a baseUrl.';
  }
  return null;
}

/**
 * Return the active provider if it claims STT/TTS capability, otherwise null.
 *
 * Explicit capabilities take precedence. When absent, kind-based defaults apply:
 * - openai: always voice-capable (OpenAI /v1/audio/* endpoints)
 * - custom with a baseUrl: assumed voice-capable (OpenAI-compatible audio path)
 * - all other kinds: not voice-capable unless explicitly opted in
 *
 * The parameter is structurally compatible with AppSettings from ipc.ts.
 */
export function getVoiceProvider(settings: { provider?: ProviderConfig }): ProviderConfig | null {
  const p = settings.provider;
  if (!p) return null;
  if (p.capabilities?.transcribe || p.capabilities?.speak) return p;
  if (p.kind === 'openai') return p;
  if (p.kind === 'custom' && p.baseUrl) return p;
  return null;
}

/**
 * Build a ProviderConfig from AppSettings for a named agent slot.
 * When agentProviderOverride is supplied, it is returned as-is (full per-agent config).
 * When only agentModelOverride is supplied, it overrides the model on the global config.
 * Falls back to the global provider when neither override is present.
 */
export function providerConfigForAgent(
  globalProvider: ProviderConfig,
  agentModelOverride?: string,
  agentProviderOverride?: ProviderConfig,
): ProviderConfig {
  if (agentProviderOverride) {
    // PM spec §3: same kind + no agent-level API key → fall back to global key.
    // Lets users pick a different model for an agent without re-entering the global API key.
    if (!agentProviderOverride.apiKey && agentProviderOverride.kind === globalProvider.kind) {
      return { ...agentProviderOverride, apiKey: globalProvider.apiKey };
    }
    return agentProviderOverride;
  }
  if (!agentModelOverride) return globalProvider;
  return { ...globalProvider, model: agentModelOverride };
}

