// F3 — per-action provider gate (Ivy privacy + Probe P4).
// Coach / Beta Read / Writer Scan / Full Analysis each use THEIR agent slot's
// provider. Shared partner thread only stores result text — never provider
// config or keys. Refuse before any request when the action's provider cannot
// resolve. NEVER quietly fall back to the brainstorm provider.

import type { ProviderKind } from '../components/SettingsPanel/settingsPanelTypes';

export type PartnerLlmAgent = 'writingAssistant' | 'betaReader' | 'brainstorm';

const LOCAL_KINDS = new Set<string>(['ollama', 'lmstudio', 'llamacpp']);

export function isLocalProviderKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return LOCAL_KINDS.has(kind);
}

export function isCloudProviderKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return kind === 'anthropic' || kind === 'openai';
}

interface AgentProviderSlice {
  enabled?: boolean;
  model?: string;
  provider?: { kind?: string; model?: string; apiKey?: string; baseUrl?: string } | null;
}

/** Resolve the effective provider kind/model for an agent slot (override → global). */
export function resolveAgentProvider(
  settings: AppSettings | null | undefined,
  agent: PartnerLlmAgent,
): { kind: string; model: string } | null {
  if (!settings) return null;
  const slot: AgentProviderSlice | undefined =
    agent === 'betaReader'
      ? (settings.agents as { betaReader?: AgentProviderSlice }).betaReader
      : settings.agents?.[agent];
  if (slot && slot.enabled === false) return null;
  const override = slot?.provider;
  if (override?.kind && (override.model || slot?.model)) {
    return { kind: override.kind, model: override.model || slot?.model || '' };
  }
  const global = settings.provider;
  if (global?.kind && global.model) {
    return { kind: global.kind, model: slot?.model || global.model };
  }
  return null;
}

export class PartnerProviderRefuseError extends Error {
  readonly code = 'partner-provider-refuse' as const;
  constructor(agent: PartnerLlmAgent, detail: string) {
    super(`Cannot run this action — ${detail} (agent: ${agent}). No request was sent.`);
    this.name = 'PartnerProviderRefuseError';
  }
}

/**
 * Refuse before IPC when the action's provider cannot be resolved.
 * Does NOT fall back to brainstorm.
 */
export function assertAgentProviderReady(
  settings: AppSettings | null | undefined,
  agent: PartnerLlmAgent,
): { kind: string; model: string } {
  const resolved = resolveAgentProvider(settings, agent);
  if (!resolved || !resolved.kind || !resolved.model) {
    throw new PartnerProviderRefuseError(
      agent,
      'no provider is configured for this hand. Set a provider under Settings › Agents',
    );
  }
  return resolved;
}

/** True when `kind` is a known ProviderKind string (narrow for tests). */
export function asProviderKind(kind: string): ProviderKind | null {
  const known: ProviderKind[] = ['anthropic', 'openai', 'ollama', 'lmstudio', 'llamacpp', 'custom'];
  return (known as string[]).includes(kind) ? (kind as ProviderKind) : null;
}
