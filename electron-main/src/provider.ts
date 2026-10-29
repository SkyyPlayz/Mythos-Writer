// Model-agnostic AI provider abstraction.
// Supports: Anthropic Claude (cloud), OpenAI (cloud), Ollama (local),
// LM Studio (local), and custom OpenAI-compatible endpoints.
//
// All providers emit tokens via the same AsyncIterable<string> interface so
// streaming.ts and agents can stay provider-unaware.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
// Electron's global fetch routes through Chromium's networking layer (proxy, session) and can
// fail for plain-HTTP localhost calls (e.g. LM Studio on 127.0.0.1:1234) even when Node's
// undici stack reaches the same URL without issue (SKY-11225). Import undici's fetch explicitly
// to keep all main-process HTTP calls on Node's networking path.
import { Agent, fetch as nodeFetch } from 'undici';
import {
  excludeGoogleModelIds,
  isOpenRouterEndpoint,
  withOpenRouterGuards,
  type OpenRouterProviderBlock,
} from '@mythos-writer/shared/openRouterPolicy';
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

/**
 * True when the URL targets loopback: an IPv4 literal in 127.0.0.0/8, ::1, or
 * localhost. A hostname that only starts with "127." (127.example.com) is not.
 */
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
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
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
 * answer budget (SKY-11276). `applyReserve=false` opts out entirely — for a
 * liveness probe that deliberately requests a 1-token budget and aborts on the
 * first token, where the reserve would turn a quick ping into a
 * multi-thousand-token thinking session. (Settings "Test connection" no longer
 * streams; it is a GET /models probe, PLAN-AI-MODES M-1.)
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

/**
 * A URL as safe text for an error message: origin + path only, so userinfo
 * (user:pass@), a query (?token=) or a hash never reaches the renderer. An
 * unparsable input is never echoed.
 */
export function displayUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '<invalid URL>';
  }
  // Non-http(s) schemes have an opaque "null" origin.
  const origin = parsed.origin !== 'null' ? parsed.origin : `${parsed.protocol}//${parsed.host}`;
  return `${origin}${parsed.pathname}`.replace(/\/+$/, '');
}

// ─── Guarded GET (PLAN-AI-MODES M-1 review) ──────────────────────────────────
// validateBaseUrl only sees the URL text. The model-list and key-check GETs
// also refuse redirects, cap the body, and re-check every address DNS returns
// at connect time, so a name that rebinds to 169.254.169.254 or a LAN host
// after validation is still refused.

/** Largest model-list / key-check body read; a bigger one is refused unparsed. */
export const MAX_GUARDED_BODY_BYTES = 1024 * 1024;

const BLOCKED_ADDRESS_CODE = 'ERR_MYTHOS_BLOCKED_ADDRESS';

// `local` is set for the local kinds only: they may reach loopback, and the
// carrier-grade NAT and benchmarking ranges a Tailscale or lab runtime uses,
// which validateBaseUrl (and so the chat path) has always allowed.
function isBlockedIpv4(octets: number[], local: boolean): boolean {
  const [a, b] = octets;
  if (a === 127) return !local;
  if (a === 0 || a === 10) return true; // 0.0.0.0/8, 10/8
  if (a === 100 && b >= 64 && b <= 127) return !local; // 100.64/10 carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return !local; // 198.18/15 benchmarking
  return a >= 224; // multicast and reserved
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const split = text.split('::');
  const head = split[0] ? split[0].split(':') : [];
  const rest = split.length > 1 && split[1] ? split[1].split(':') : [];
  const fill = split.length > 1 ? new Array<string>(8 - head.length - rest.length).fill('0') : [];
  const groups = [...head, ...fill, ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Whether an outbound GET may connect to this resolved address. Blocks the
 * unspecified, private, CGNAT, link-local, benchmarking, multicast and
 * reserved IPv4 ranges, the IPv6 unspecified, ULA (fc00::/7), link-local
 * (fe80::/10) and multicast (ff00::/8) ranges, and the IPv4 ranges again in
 * every IPv6 form that embeds an IPv4 address (mapped, compatible, RFC 6145
 * translated, NAT64 64:ff9b::/96, 6to4 2002::/16). With `local`, which only
 * the local kinds get, loopback (127/8, ::1), CGNAT and 198.18/15 pass.
 * Anything that does not parse as an IP address is blocked.
 */
export function isBlockedAddress(
  address: string,
  family: number | string | undefined,
  local: boolean,
): boolean {
  const version = isIP(address.split('%')[0]);
  const declared = family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : undefined;
  if (version === 0 || (declared !== undefined && declared !== version)) return true;
  if (version === 4) return isBlockedIpv4(address.split('.').map(Number), local);
  const g = ipv6Groups(address);
  if (!g) return true;
  const zeroPrefix = (n: number): boolean => g.slice(0, n).every((x) => x === 0);
  const v4 = (hi: number, lo: number): number[] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const embeddedV4 = v4(g[6], g[7]);
  if (zeroPrefix(8)) return true; // ::
  if (zeroPrefix(7) && g[7] === 1) return !local; // ::1
  if (zeroPrefix(5) && g[5] === 0xffff) return isBlockedIpv4(embeddedV4, local); // ::ffff:a.b.c.d
  if (zeroPrefix(6)) return isBlockedIpv4(embeddedV4, local); // ::a.b.c.d
  if (zeroPrefix(4) && g[4] === 0xffff && g[5] === 0) return isBlockedIpv4(embeddedV4, local); // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIpv4(embeddedV4, local); // 64:ff9b::a.b.c.d (NAT64)
  }
  if (g[0] === 0x2002) return isBlockedIpv4(v4(g[1], g[2]), local); // 2002:aabb:ccdd:: (6to4)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  return (g[0] & 0xff00) === 0xff00; // ff00::/8
}

// Node's net.connect skips the lookup for an IP-literal host, so the guarded
// GET checks literals itself before fetching.
function literalHostBlocked(url: string, local: boolean): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return true;
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return isIP(host) !== 0 && isBlockedAddress(host, undefined, local);
}

function guardedLookup(local: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '', undefined);
        return;
      }
      const list = addresses as LookupAddress[];
      const refused =
        list.length === 0 || list.some((a) => isBlockedAddress(a.address, a.family, local));
      if (refused) {
        const blocked = Object.assign(new Error(`${hostname} resolves to a blocked address.`), {
          code: BLOCKED_ADDRESS_CODE,
        });
        callback(blocked, '', undefined);
        return;
      }
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

// Built on first use (and cached per flavor) so test files that mock undici
// can still import this module.
const guardedDispatchers = new Map<boolean, Agent>();
function guardedDispatcher(local: boolean): Agent {
  let dispatcher = guardedDispatchers.get(local);
  if (!dispatcher) {
    dispatcher = new Agent({ connect: { lookup: guardedLookup(local) } });
    guardedDispatchers.set(local, dispatcher);
  }
  return dispatcher;
}

type GuardedGetOutcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'http'; status: number }
  | { kind: 'blocked' }
  | { kind: 'redirect' }
  | { kind: 'too-large' }
  | { kind: 'timeout' }
  | { kind: 'network'; code: string }
  | { kind: 'failed' };

interface GuardedGetOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  /**
   * Local kinds only (ollama, lmstudio, llamacpp, custom), plus Anthropic at a
   * loopback ANTHROPIC_BASE_URL: see isBlockedAddress.
   */
  local: boolean;
  /** Parse a 2xx body as JSON. When false the body is discarded unread. */
  parseJson: boolean;
}

type GuardedResponse = Awaited<ReturnType<typeof nodeFetch>>;

/** The body as text, or null once it passes MAX_GUARDED_BODY_BYTES. */
async function readCappedText(res: GuardedResponse, controller: AbortController): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_GUARDED_BODY_BYTES) {
    controller.abort();
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_GUARDED_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      controller.abort();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One GET with no redirects, a 1 MiB body cap and the connect-time address
 * check. Callers run validateBaseUrl first and map the outcome to their own copy.
 */
async function guardedGet(url: string, opts: GuardedGetOptions): Promise<GuardedGetOutcome> {
  if (literalHostBlocked(url, opts.local)) return { kind: 'blocked' };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await nodeFetch(url, {
      headers: opts.headers,
      signal: controller.signal,
      redirect: 'error',
      dispatcher: guardedDispatcher(opts.local),
    });
    if (!res.ok || !opts.parseJson) {
      void res.body?.cancel().catch(() => undefined);
      return res.ok ? { kind: 'ok', body: undefined } : { kind: 'http', status: res.status };
    }
    const text = await readCappedText(res, controller);
    if (text === null) return { kind: 'too-large' };
    return { kind: 'ok', body: JSON.parse(text) as unknown };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return { kind: 'timeout' };
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code === BLOCKED_ADDRESS_CODE) return { kind: 'blocked' };
    if (cause?.message === 'unexpected redirect') return { kind: 'redirect' };
    const msg = ((err as Error).message ?? '').toLowerCase();
    const causeCode = cause?.code ?? '';
    if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('network') || causeCode) {
      return { kind: 'network', code: causeCode };
    }
    return { kind: 'failed' };
  } finally {
    clearTimeout(timeoutId);
  }
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
  /** `status` is set when the endpoint answered with a non-2xx HTTP status. */
  | { ok: false; error: string; status?: number };

/** REST base for Anthropic's GET /models when ANTHROPIC_BASE_URL is unset. */
export const ANTHROPIC_REST_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * The host the Anthropic SDK chat path talks to, as a REST base: the SDK reads
 * ANTHROPIC_BASE_URL (blank = unset) and never a configured baseUrl
 * (runAnthropicStream), so the model list does the same.
 */
export function anthropicRestBaseUrl(): string {
  const env = process.env.ANTHROPIC_BASE_URL?.trim();
  return env ? `${env.replace(/\/+$/, '')}/v1` : ANTHROPIC_REST_BASE_URL;
}

/**
 * Fetch the model list from a provider endpoint.
 *
 * Routing:
 *   - ollama    → GET {origin}/api/tags   → models[].name
 *   - anthropic → GET {SDK host}/v1/models → data[].id (x-api-key + anthropic-version; baseUrl ignored)
 *   - others    → GET {baseUrl}/models    → data[].id
 *
 * The timeout is enforced via AbortController — local runtimes get a longer
 * budget because a cold LM Studio / Ollama / llama.cpp can take several seconds
 * to load a model on the first call (SKY-11240 AC1). validateBaseUrl is called
 * before any fetch to block SSRF targets, and the GET itself goes through
 * guardedGet (no redirects, 1 MiB body cap, connect-time address check).
 * Error copy names the address via displayUrl, never the raw base.
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
  } else if (kind === 'anthropic') {
    // DEFAULT_BASE_URLS.anthropic stays undefined (the SDK resolves its own),
    // so the REST model list resolves the SDK's host itself (PLAN-AI-MODES M-1).
    // A caller baseUrl is ignored: the key only ever goes where chat sends it.
    resolvedBase = anthropicRestBaseUrl();
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
  // Only the local kinds may connect to loopback. Anthropic's base never comes
  // from the renderer (see above), so a loopback ANTHROPIC_BASE_URL gateway
  // (a local LiteLLM proxy) is reached as the SDK chat path reaches it.
  const localKinds = new Set<ProviderKind>(['ollama', 'lmstudio', 'llamacpp', 'custom']);
  const isLocal = localKinds.has(kind);
  const localAddress = isLocal || (kind === 'anthropic' && isLoopbackUrl(resolvedBase));
  const timeoutMs = isLocal ? 15_000 : 5_000;
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  const label = PROVIDER_LABELS[kind];
  const shown = displayUrl(resolvedBase);

  const url = kind === 'ollama'
    ? `${resolvedBase}/api/tags`
    : `${resolvedBase}/models`;

  const headers: Record<string, string> = {};
  if (kind === 'anthropic') {
    // Anthropic authenticates with x-api-key plus a pinned API version, not Bearer.
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
    if (apiKey) headers['x-api-key'] = apiKey;
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const outcome = await guardedGet(url, { headers, timeoutMs, local: localAddress, parseJson: true });
  const failed = { ok: false as const, error: `Failed to list ${label} models at ${shown} — check the provider configuration.` };
  switch (outcome.kind) {
    case 'ok':
      break;
    case 'http':
      return {
        ok: false,
        error: `${label} at ${shown} returned HTTP ${outcome.status}. Check the endpoint and try again.`,
        status: outcome.status,
      };
    case 'blocked':
      return { ok: false, error: `${label} at ${shown} points to a private or reserved address — not allowed.` };
    case 'redirect':
      return { ok: false, error: `${label} at ${shown} answered with a redirect. Redirects are not followed; enter the final address.` };
    case 'too-large':
      return { ok: false, error: `${label} at ${shown} sent a model list larger than 1 MiB — refused.` };
    case 'timeout':
      return {
        ok: false,
        error: `${label} at ${shown} did not respond within ${timeoutSeconds} seconds — if it is still loading a model, wait a moment and try again.`,
      };
    case 'network': {
      const detail = outcome.code ? ` (${outcome.code})` : '';
      return { ok: false, error: `Network error reaching ${label} at ${shown}${detail} — check that the server is running and reachable.` };
    }
    default:
      return failed;
  }

  try {
    const json = outcome.body;
    let models: string[];
    if (kind === 'ollama') {
      const resp = json as { models?: Array<{ name?: string }> };
      models = (resp.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    } else {
      const resp = json as { data?: Array<{ id?: string }> };
      models = (resp.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }

    // OpenRouter's catalog includes google/* models. Drop them before the
    // picker can select one. Comparison is on the lowercased id. A local
    // runtime may legitimately have a model with that name, so only the
    // OpenRouter host is filtered.
    if (isOpenRouterEndpoint(resolvedBase)) {
      models = excludeGoogleModelIds(models);
    }

    return { ok: true, models };
  } catch {
    // A body that parsed but is not the expected shape.
    return failed;
  }
}

export type VerifyOpenRouterKeyResult =
  | { ok: true }
  /** `status` is set when OpenRouter answered with a non-2xx HTTP status. */
  | { ok: false; error: string; status?: number };

/**
 * Check an OpenRouter key without spending tokens: GET
 * https://{host}/api/v1/key with the key as Bearer, through the same master
 * gate, SSRF guard and guarded GET as listModels. Only an OpenRouter host is
 * ever sent the key, and always over https, whatever scheme the base names.
 */
export async function verifyOpenRouterKey(payload: { baseUrl: string; apiKey: string }): Promise<VerifyOpenRouterKeyResult> {
  if (!aiMasterGate()) return { ok: false, error: AI_DISABLED_MESSAGE };
  const guardError = validateBaseUrl(payload.baseUrl);
  if (guardError) return { ok: false, error: guardError };
  if (!isOpenRouterEndpoint(payload.baseUrl)) {
    return { ok: false, error: 'Not an OpenRouter address — the key check only runs against openrouter.ai.' };
  }
  const origin = `https://${new URL(payload.baseUrl).hostname}`;
  const shown = displayUrl(origin);
  const outcome = await guardedGet(`${origin}/api/v1/key`, {
    headers: { Authorization: `Bearer ${payload.apiKey}` },
    timeoutMs: 5_000,
    local: false,
    parseJson: false,
  });
  switch (outcome.kind) {
    case 'ok':
      return { ok: true };
    case 'http':
      return {
        ok: false,
        error: `OpenRouter at ${shown} returned HTTP ${outcome.status} for the key check.`,
        status: outcome.status,
      };
    case 'blocked':
      return { ok: false, error: `OpenRouter at ${shown} points to a private or reserved address — not allowed.` };
    case 'redirect':
      return { ok: false, error: `OpenRouter at ${shown} answered the key check with a redirect, which is not followed.` };
    case 'timeout':
      return { ok: false, error: `OpenRouter at ${shown} did not respond within 5 seconds.` };
    case 'network': {
      const detail = outcome.code ? ` (${outcome.code})` : '';
      return { ok: false, error: `Network error reaching OpenRouter at ${shown}${detail}.` };
    }
    default:
      return { ok: false, error: `The OpenRouter key check at ${shown} failed.` };
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
   * server receives exactly `maxTokens`. For liveness probes that send a
   * 1-token budget and abort on the first token — there the reserve would turn
   * a quick ping into a long thinking session.
   * Defaults to applying the reserve for eligible local runtimes.
   */
  reserveThinkingTokens?: boolean;
  /**
   * SKY-11220: invoked with each non-empty reasoning delta the model streams
   * *before* (or instead of) visible answer content. Local reasoning models
   * (qwen3, DeepSeek-R1, gpt-oss on LM Studio) can think for minutes, emitting
   * `reasoning_content` the whole time while `content` stays empty — those
   * chunks are buffered here and never yielded, so a caller watching only the
   * yielded token stream sees total silence and reads a live thinking phase as a
   * hung stream. This callback surfaces that the stream is *alive* so the caller
   * can keep a stall/hard timeout from aborting it (BrainstormPage's timers).
   * The delta is the model's private chain-of-thought — it is a liveness
   * heartbeat, NOT for display, so CoT stays hidden.
   */
  onReasoning?: (delta: string) => void;
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
 * Used by the streaming path; exported so any non-streaming Anthropic call
 * applies the same model gating.
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

export interface OpenAiCompatibleChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  stream: true;
  provider?: OpenRouterProviderBlock;
}

/**
 * JSON body for an OpenAI-compatible chat completion.
 * OpenRouter hosts also get the provider block (Google providers ignored,
 * zdr on, data collection denied). A google/* model id on OpenRouter throws
 * before any bytes are sent.
 */
export function buildOpenAiCompatibleChatBody(
  config: ProviderConfig,
  req: StreamRequest,
  baseUrl: string,
): OpenAiCompatibleChatBody {
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

  return withOpenRouterGuards(baseUrl, {
    model: config.model,
    messages,
    max_tokens: maxTokensToSend,
    stream: true as const,
  });
}

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

  const chatBody = buildOpenAiCompatibleChatBody(config, req, baseUrl);
  const maxTokensToSend = chatBody.max_tokens;
  const body = JSON.stringify(chatBody);

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
          } else {
            // Content arrived but the strip held all of it back — the model is
            // emitting private `<think>…</think>` reasoning inline. No visible
            // token is yielded, so surface it as a thinking heartbeat too
            // (SKY-11220) or an inline-CoT model reads as a hung stream.
            req.onReasoning?.(content);
          }
          continue;
        }

        // No content on this chunk — accumulate any reasoning text as a fallback.
        // Buffered unconditionally; it is only surfaced below if the stream never
        // produced usable content. It also drives the thinking heartbeat so a
        // caller can tell a still-reasoning stream from a hung one (SKY-11220).
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          reasoningBuffer += reasoning;
          req.onReasoning?.(reasoning);
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
  'AI features are off — every tool is manual. Turn them back on in Settings → Model & keys.';

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

