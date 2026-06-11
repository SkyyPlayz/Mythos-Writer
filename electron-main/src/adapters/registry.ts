// Adapter registry — SKY-463 / GH#210
//
// Tracks which ProviderKinds have a concrete adapter implementation.
// The settings UI reads this to gate per-agent model selectors: a provider
// whose kind is absent cannot serve inference and must render as disabled.
//
// Currently only Anthropic is wrapped in a typed adapter.  The OpenAI-compatible
// path (openai / ollama / lmstudio / custom) works at the transport layer in
// provider.ts but is not yet behind the ProviderAdapter interface — that
// migration is deferred to the follow-up issue.

import type { ProviderKind } from '../provider.js';

export type { ProviderKind };

/** Provider kinds that have a registered, conforming ProviderAdapter. */
export const REGISTERED_ADAPTER_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'anthropic',
]);

/** Returns true when the given kind has a registered adapter. */
export function isAdapterRegistered(kind: ProviderKind): boolean {
  return REGISTERED_ADAPTER_KINDS.has(kind);
}
