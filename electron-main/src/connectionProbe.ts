// Settings "Test connection": a no-AI GET /models probe (PLAN-AI-MODES M-1, audit row 1).
//
// Replaces the 1-token streamFromProvider ping. The probe makes exactly one
// GET through listModels, so it spends no tokens and rides the same SSRF guard
// and master AI gate as every other provider call.

import {
  DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
  validateBaseUrl,
  type ListModelsPayload,
  type ListModelsResult,
  type ProviderKind,
} from './provider.js';
import { isMaskedPreview } from './settings-masking.js';

export interface ProbeProvider {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

/** The stored provider a saved key belongs to. */
export interface StoredProviderKey {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}

export interface ProbeDeps {
  listModels: (payload: ListModelsPayload) => Promise<ListModelsResult>;
  now?: () => number;
  /** Read lazily, only when the renderer echoed a masked key preview. */
  storedKey?: () => StoredProviderKey | undefined;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Which provider the saved `provider` key belongs to. The renderer only echoes
 * a masked preview of `provider.apiKey`, so that is the only key it can stand
 * for; the legacy top-level `apiKey` is never swapped in.
 */
export function storedProviderKey(settings: {
  provider?: { kind: ProviderKind; baseUrl?: string; apiKey?: string };
}): StoredProviderKey | undefined {
  const p = settings.provider;
  if (!p) return undefined;
  return { kind: p.kind, baseUrl: p.baseUrl, apiKey: p.apiKey || undefined };
}

function sameHost(kind: ProviderKind, a: string | undefined, b: string | undefined): boolean {
  // listModels sends an Anthropic key only to the SDK's own host, whatever baseUrl says.
  if (kind === 'anthropic') return true;
  const norm = (url: string | undefined): string => {
    const raw = url || DEFAULT_BASE_URLS[kind] || '';
    try {
      return new URL(raw).href.replace(/\/+$/, '');
    } catch {
      return raw.replace(/\/+$/, '');
    }
  };
  return norm(a) === norm(b);
}

// A masked preview (sk-ant-...XXXX) is never a real key. Swap in the stored
// key only when it was saved for this same kind and host; otherwise send none,
// so one provider's key never reaches another provider's server.
function resolveKey(provider: ProbeProvider, deps: ProbeDeps): string | undefined {
  const key = provider.apiKey || undefined;
  if (!key || !isMaskedPreview(key)) return key;
  const stored = deps.storedKey?.();
  if (!stored?.apiKey || isMaskedPreview(stored.apiKey)) return undefined;
  if (stored.kind !== provider.kind) return undefined;
  if (!sameHost(provider.kind, stored.baseUrl, provider.baseUrl)) return undefined;
  return stored.apiKey;
}

export async function probeConnection(provider: ProbeProvider, deps: ProbeDeps): Promise<ProbeResult> {
  // SSRF guard: validate before any network call (SKY-739).
  if (provider.baseUrl) {
    const urlError = validateBaseUrl(provider.baseUrl);
    if (urlError) return { ok: false, latencyMs: 0, error: 'Invalid provider URL.' };
  }
  const now = deps.now ?? Date.now;
  const apiKey = resolveKey(provider, deps);
  const t0 = now();
  let result: ListModelsResult;
  try {
    result = await deps.listModels({
      kind: provider.kind,
      baseUrl: provider.baseUrl || undefined,
      apiKey,
    });
  } catch {
    return { ok: false, latencyMs: now() - t0, error: 'Connection test failed.' };
  }
  const latencyMs = now() - t0;
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    return {
      ok: false,
      latencyMs,
      error: `${PROVIDER_LABELS[provider.kind]} rejected the API key (HTTP ${result.status}). Check your API key in Settings.`,
    };
  }
  if (!result.ok) return { ok: false, latencyMs, error: result.error };
  if (result.models.length === 0) {
    return {
      ok: false,
      latencyMs,
      error: `${PROVIDER_LABELS[provider.kind]} answered, but it lists no models. Load or install a model, then test again.`,
    };
  }
  return { ok: true, latencyMs };
}
