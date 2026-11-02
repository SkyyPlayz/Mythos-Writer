// OpenRouter must never hand a Mythos Writer request to a Google provider.
// One definition so every request builder attaches the same block and the
// same model filter. Callers cannot weaken zdr or data_collection: the block
// is rebuilt on each call and overwrites any provider object on the body.

export const OPENROUTER_IGNORED_PROVIDERS = ['google-vertex', 'google-ai-studio'] as const;

export interface OpenRouterProviderBlock {
  ignore: ['google-vertex', 'google-ai-studio'];
  zdr: true;
  data_collection: 'deny';
}

export function openRouterProviderBlock(): OpenRouterProviderBlock {
  return {
    ignore: [OPENROUTER_IGNORED_PROVIDERS[0], OPENROUTER_IGNORED_PROVIDERS[1]],
    zdr: true,
    data_collection: 'deny',
  };
}

/**
 * True for openrouter.ai and its subdomains. Lookalike hosts
 * (openrouter.ai.evil.example, notopenrouter.ai) are not OpenRouter.
 */
export function isOpenRouterEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

/** google/* model ids, compared after trimming and lowercasing. */
export function isGoogleModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('google/');
}

export class GoogleModelExcludedError extends Error {
  readonly modelId: string;

  constructor(modelId: string) {
    super(`OpenRouter cannot use model "${modelId}". Google-hosted models are excluded.`);
    this.name = 'GoogleModelExcludedError';
    this.modelId = modelId;
  }
}

export function excludeGoogleModelIds(modelIds: readonly string[]): string[] {
  return modelIds.filter((id) => !isGoogleModelId(id));
}

/**
 * Pick a model for auto-routing / selection. google/* ids are ineligible.
 * Comparison for that exclusion is on the lowercased id; other matches stay
 * case-sensitive so a mixed-case alias is not treated as a listed model.
 * An ineligible preferred id falls back to the first remaining candidate,
 * or '' when every candidate is google/*.
 */
export function selectModelExcludingGoogle(
  candidates: readonly string[],
  preferred: string,
  fallbackIndex = 0,
): string {
  const eligible = excludeGoogleModelIds(candidates);
  if (preferred && !isGoogleModelId(preferred) && eligible.includes(preferred)) {
    return preferred;
  }
  const fallback = eligible[fallbackIndex] ?? eligible[0];
  if (fallback !== undefined) return fallback;
  return isGoogleModelId(preferred) ? '' : preferred;
}

export function assertOpenRouterModelAllowed(endpoint: string | undefined, model: string): void {
  if (isOpenRouterEndpoint(endpoint) && isGoogleModelId(model)) {
    throw new GoogleModelExcludedError(model);
  }
}

/**
 * Attach the OpenRouter provider block. Ignores any incoming `provider` value
 * so zdr cannot be turned off and data_collection cannot be set to allow.
 * Throws when `model` is a google/* id. Filters a `models` auto-route list.
 */
export function applyOpenRouterRequestPolicy<T extends Record<string, unknown>>(
  body: T,
): T & { provider: OpenRouterProviderBlock } {
  const model = body.model;
  if (typeof model === 'string' && isGoogleModelId(model)) {
    throw new GoogleModelExcludedError(model);
  }
  const next: Record<string, unknown> = {
    ...body,
    provider: openRouterProviderBlock(),
  };
  if (Array.isArray(body.models)) {
    next.models = excludeGoogleModelIds(
      body.models.filter((id): id is string => typeof id === 'string'),
    );
  }
  return next as T & { provider: OpenRouterProviderBlock };
}

/** Apply the policy only when `endpoint` is OpenRouter. Other hosts are unchanged. */
export function withOpenRouterGuards<T extends Record<string, unknown>>(
  endpoint: string | undefined,
  body: T,
): T | (T & { provider: OpenRouterProviderBlock }) {
  if (!isOpenRouterEndpoint(endpoint)) return body;
  return applyOpenRouterRequestPolicy(body);
}
