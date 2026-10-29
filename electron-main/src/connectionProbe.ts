// Settings "Test connection": a no-AI key and reachability probe (PLAN-AI-MODES M-1, audit row 1).
//
// Replaces the 1-token streamFromProvider ping. The probe makes at most one
// GET, so it spends no tokens and rides the same SSRF guard and master AI gate
// as every other provider call. Which GET depends on the endpoint: a public
// model list can't prove a key, so OpenRouter is checked at its key endpoint
// and any other remote endpoint whose list may be public is reported as unverified.

import { isOpenRouterEndpoint } from '@mythos-writer/shared/openRouterPolicy';
import {
  DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
  displayUrl,
  isLoopbackUrl,
  validateBaseUrl,
  type ListModelsPayload,
  type ListModelsResult,
  type ProviderKind,
} from './provider.js';
import { isMaskedPreview, maskApiKey } from './settings-masking.js';

export interface ProbeProvider {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export type VerifyKeyResult = { ok: true } | { ok: false; error: string; status?: number };

export interface ProbeDeps {
  listModels: (payload: ListModelsPayload) => Promise<ListModelsResult>;
  /** Authenticated GET {origin}/api/v1/key; OpenRouter's /models is public. */
  verifyOpenRouterKey: (payload: { baseUrl: string; apiKey: string }) => Promise<VerifyKeyResult>;
  now?: () => number;
  /**
   * The saved global key for this kind and host (resolveGlobalStoredApiKey).
   * Read lazily, only when the renderer sent a masked preview or no key.
   */
  storedKey?: (kind: ProviderKind, baseUrl: string | undefined) => string | undefined;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ─── Stored key resolution ───────────────────────────────────────────────────

interface StoredProvider {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}

/** The settings fields resolveStoredApiKey reads. AppSettings fits this shape. */
export interface StoredKeySettings {
  apiKey?: string;
  provider?: StoredProvider;
  agents?: Partial<Record<string, { provider?: StoredProvider } | undefined>>;
}

// origin + path, trailing slash trimmed; undefined when there is no usable URL,
// so two missing or unparsable URLs never count as the same host.
function endpointId(kind: ProviderKind, url: string | undefined): string | undefined {
  const raw = url || DEFAULT_BASE_URLS[kind];
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function sameEndpoint(kind: ProviderKind, a: string | undefined, b: string | undefined): boolean {
  // listModels sends an Anthropic key only to the SDK's own host, whatever baseUrl says.
  if (kind === 'anthropic') return true;
  const idA = endpointId(kind, a);
  return idA !== undefined && idA === endpointId(kind, b);
}

/** A stored value that is a real key: non-empty and never a masked preview. */
function realKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  return key && !isMaskedPreview(key) ? key : undefined;
}

/**
 * The saved key for a provider `kind` at `baseUrl`, or undefined. Matches the
 * global provider, then each per-agent provider override, on the same kind and
 * the same host, so a key saved for another kind or host is never returned.
 * For anthropic only (host pinned to the SDK's), falls back to the legacy
 * top-level apiKey and then ANTHROPIC_API_KEY. Used by PROVIDER_LIST_MODELS;
 * Test connection uses resolveGlobalStoredApiKey.
 */
export function resolveStoredApiKey(
  settings: StoredKeySettings,
  kind: ProviderKind,
  baseUrl: string | undefined,
): string | undefined {
  const candidates = [settings.provider, ...Object.values(settings.agents ?? {}).map((a) => a?.provider)];
  for (const p of candidates) {
    if (!p || p.kind !== kind) continue;
    const key = realKey(p.apiKey);
    if (key && sameEndpoint(kind, p.baseUrl, baseUrl)) return key;
  }
  if (kind !== 'anthropic') return undefined;
  return realKey(settings.apiKey) ?? realKey(process.env.ANTHROPIC_API_KEY);
}

/**
 * The saved key Test connection may use: the key global chat would send
 * (buildGlobalProviderConfig). That is the global provider's own key, on the
 * same kind and host; per-agent overrides are not read, since the probe tests
 * the global provider. The anthropic legacy apiKey / ANTHROPIC_API_KEY
 * fallback applies only when no provider block is saved, as in chat.
 */
export function resolveGlobalStoredApiKey(
  settings: StoredKeySettings,
  kind: ProviderKind,
  baseUrl: string | undefined,
): string | undefined {
  const p = settings.provider;
  if (p) {
    const key = p.kind === kind ? realKey(p.apiKey) : undefined;
    return key && sameEndpoint(kind, p.baseUrl, baseUrl) ? key : undefined;
  }
  if (kind !== 'anthropic') return undefined;
  return realKey(settings.apiKey) ?? realKey(process.env.ANTHROPIC_API_KEY);
}

// ─── Probe ───────────────────────────────────────────────────────────────────

// How the probe checks the key:
//   key-endpoint  - OpenRouter: GET /api/v1/key (its /models is public)
//   auth-models   - /models requires auth, so 2xx proves the key
//   local         - local runtime, no key needed
//   public-models - other remote endpoint; /models may be public, so 2xx
//                   proves reachability only
type ProbeMode = 'key-endpoint' | 'auth-models' | 'local' | 'public-models';

const LOCAL_RUNTIME_KINDS = new Set<ProviderKind>(['ollama', 'lmstudio', 'llamacpp']);

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function probeMode(kind: ProviderKind, base: string | undefined): ProbeMode {
  // listModels ignores baseUrl for Anthropic and the SDK host requires auth.
  if (kind === 'anthropic') return 'auth-models';
  if (isOpenRouterEndpoint(base)) return 'key-endpoint';
  if (LOCAL_RUNTIME_KINDS.has(kind)) return 'local';
  if (kind === 'custom' && isLoopbackUrl(base)) return 'local';
  // OpenAI's /models requires auth whichever kind points at it.
  if (hostOf(base) === 'api.openai.com') return 'auth-models';
  return 'public-models';
}

const REENTER_KEY_MESSAGE = "Your saved key isn't for this provider. Re-enter the API key, then test again.";

function keyRejected(label: string, status: number): string {
  return `${label} rejected the API key (HTTP ${status}). Check your API key in Settings.`;
}

export async function probeConnection(provider: ProbeProvider, deps: ProbeDeps): Promise<ProbeResult> {
  // SSRF guard: validate before any network call (SKY-739).
  if (provider.baseUrl) {
    const urlError = validateBaseUrl(provider.baseUrl);
    if (urlError) return { ok: false, latencyMs: 0, error: 'Invalid provider URL.' };
  }
  const { kind } = provider;
  const baseUrl = provider.baseUrl || undefined;
  const base = baseUrl ?? DEFAULT_BASE_URLS[kind];
  const mode = probeMode(kind, base);
  const label = PROVIDER_LABELS[kind];

  // A masked preview (sk-ant-...XXXX) is never a real key, and an empty key
  // means "use the saved one". Either way only a key saved for this same kind
  // and host is swapped in, so one provider's key never reaches another's server.
  // A preview stands for one key: the saved key is used only if it masks to it,
  // and with no such key the user re-enters it (a local runtime included).
  const sent = provider.apiKey || undefined;
  const masked = isMaskedPreview(sent);
  let apiKey = sent && !masked ? sent : deps.storedKey?.(kind, baseUrl);
  if (masked && apiKey && maskApiKey(apiKey) !== sent) apiKey = undefined;
  if (masked && !apiKey) return { ok: false, latencyMs: 0, error: REENTER_KEY_MESSAGE };
  if (!apiKey && mode !== 'local') {
    return { ok: false, latencyMs: 0, error: `Enter an API key for ${label}, then test again.` };
  }

  const now = deps.now ?? Date.now;
  const t0 = now();

  if (mode === 'key-endpoint') {
    let verified: VerifyKeyResult;
    try {
      verified = await deps.verifyOpenRouterKey({ baseUrl: base as string, apiKey: apiKey as string });
    } catch {
      return { ok: false, latencyMs: now() - t0, error: 'Connection test failed.' };
    }
    const latencyMs = now() - t0;
    if (verified.ok) return { ok: true, latencyMs };
    if (verified.status === 401 || verified.status === 403) {
      return { ok: false, latencyMs, error: keyRejected('OpenRouter', verified.status) };
    }
    return { ok: false, latencyMs, error: verified.error };
  }

  let result: ListModelsResult;
  try {
    result = await deps.listModels({ kind, baseUrl, apiKey });
  } catch {
    return { ok: false, latencyMs: now() - t0, error: 'Connection test failed.' };
  }
  const latencyMs = now() - t0;
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    return { ok: false, latencyMs, error: keyRejected(label, result.status) };
  }
  if (!result.ok) return { ok: false, latencyMs, error: result.error };
  if (mode === 'public-models') {
    return {
      ok: false,
      latencyMs,
      error: `Reached ${displayUrl(base ?? '')}, but the API key wasn't verified: this endpoint's model list may be public.`,
    };
  }
  if (result.models.length === 0) {
    return {
      ok: false,
      latencyMs,
      error: `${label} answered, but it lists no models. Load or install a model, then test again.`,
    };
  }
  return { ok: true, latencyMs };
}
