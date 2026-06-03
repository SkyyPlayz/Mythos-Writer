// Model-agnostic AI provider abstraction.
// Supports: Anthropic Claude (cloud), OpenAI (cloud), Ollama (local),
// LM Studio (local), and custom OpenAI-compatible endpoints.
//
// All providers emit tokens via the same AsyncIterable<string> interface so
// streaming.ts and agents can stay provider-unaware.

import Anthropic from '@anthropic-ai/sdk';

// ─── Provider config ─────────────────────────────────────────────────────────

export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';

export interface ProviderConfig {
  kind: ProviderKind;
  /** API key — required for anthropic / openai; ignored for local providers */
  apiKey?: string;
  /** Base URL override. Defaults are set per-kind if omitted. */
  baseUrl?: string;
  /** Model identifier, e.g. 'claude-haiku-4-5-20251001', 'gpt-4o-mini', 'llama3', etc. */
  model: string;
}

// ─── Default base URLs ────────────────────────────────────────────────────────

export const DEFAULT_BASE_URLS: Record<ProviderKind, string | undefined> = {
  anthropic: undefined, // SDK resolves its own default
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: undefined,
};

// ─── Token stream interface ───────────────────────────────────────────────────

export interface StreamRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StreamResult {
  /** Async iterable of text tokens emitted by the model */
  tokens: AsyncIterable<string>;
  /** Populated after the stream ends; may be null for providers that don't report usage */
  usage?: { inputTokens: number; outputTokens: number } | null;
}

// ─── Anthropic implementation ─────────────────────────────────────────────────

async function* runAnthropicStream(
  config: ProviderConfig,
  req: StreamRequest,
): AsyncIterable<string> {
  if (!config.apiKey) throw new Error('Anthropic provider requires an API key.');
  const client = new Anthropic({ apiKey: config.apiKey });
  const sdkStream = client.messages.stream(
    {
      model: config.model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system !== undefined ? { system: req.system } : {}),
      messages: req.messages,
    },
    { signal: req.signal },
  );
  for await (const chunk of sdkStream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
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

  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: req.maxTokens ?? 1024,
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

        const delta = (parsed as { choices?: Array<{ delta?: { content?: string } }> })?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Allowlist of valid model IDs for the Anthropic provider. */
export const ANTHROPIC_MODEL_ALLOWLIST = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

/**
 * Validates that a base URL is safe for outbound HTTP fetch calls (SSRF prevention, SKY-739).
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
