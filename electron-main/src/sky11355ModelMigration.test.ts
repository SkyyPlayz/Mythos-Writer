/**
 * sky11355ModelMigration.test.ts (SKY-11355)
 *
 * Pre-fix installs could have 'claude-sonnet-4-6' (the old hardcoded agent
 * default) baked into app-settings.json. That value only works on Anthropic —
 * on any other effective provider it silently broke the agent. Migration:
 * reset it to '' (== use the provider's Default model) unless the value is
 * actually correct for that agent's effective provider.
 *
 * Mirrors the migration block added to loadAppSettings() in main.ts, in
 * isolation from Electron boot (same approach as waSettingsMigration.test.ts).
 */

import { describe, it, expect } from 'vitest';

const AGENT_KEYS = ['writingAssistant', 'brainstorm', 'archive', 'betaReader'] as const;
type AgentKey = (typeof AGENT_KEYS)[number];

interface RawAgent { model?: string; provider?: { kind?: string } }
interface RawSettings { provider?: { kind?: string }; agents?: Partial<Record<AgentKey, RawAgent>> }

/** Mirrors the SKY-11355 migration block in main.ts's loadAppSettings(). */
function migrateAgentModels(raw: RawSettings, base: Record<AgentKey, { model: string }>): void {
  const rawAgents = raw.agents ?? {};
  for (const agentKey of AGENT_KEYS) {
    const rawAgent = rawAgents[agentKey];
    if (rawAgent?.model !== 'claude-sonnet-4-6') continue;
    const effectiveKind = rawAgent.provider?.kind ?? raw.provider?.kind ?? 'anthropic';
    if (effectiveKind !== 'anthropic') {
      base[agentKey].model = '';
    }
  }
}

function makeBase(model: string): Record<AgentKey, { model: string }> {
  return {
    writingAssistant: { model },
    brainstorm: { model },
    archive: { model },
    betaReader: { model },
  };
}

describe('SKY-11355 agent model migration', () => {
  it('leaves the hardcoded default alone when the global provider is Anthropic', () => {
    const raw: RawSettings = {
      provider: { kind: 'anthropic' },
      agents: { brainstorm: { model: 'claude-sonnet-4-6' } },
    };
    const base = makeBase('claude-sonnet-4-6');
    migrateAgentModels(raw, base);
    expect(base.brainstorm.model).toBe('claude-sonnet-4-6');
  });

  it('leaves the hardcoded default alone when no provider is saved (legacy path defaults to Anthropic)', () => {
    const raw: RawSettings = {
      agents: { writingAssistant: { model: 'claude-sonnet-4-6' } },
    };
    const base = makeBase('claude-sonnet-4-6');
    migrateAgentModels(raw, base);
    expect(base.writingAssistant.model).toBe('claude-sonnet-4-6');
  });

  it('migrates the hardcoded default to "" (Default) when the global provider is LM Studio', () => {
    const raw: RawSettings = {
      provider: { kind: 'lmstudio' },
      agents: { brainstorm: { model: 'claude-sonnet-4-6' } },
    };
    const base = makeBase('claude-sonnet-4-6');
    migrateAgentModels(raw, base);
    expect(base.brainstorm.model).toBe('');
  });

  it('migrates when the agent has its own non-Anthropic provider override, even if the global provider is Anthropic', () => {
    const raw: RawSettings = {
      provider: { kind: 'anthropic' },
      agents: { archive: { model: 'claude-sonnet-4-6', provider: { kind: 'ollama' } } },
    };
    const base = makeBase('claude-sonnet-4-6');
    migrateAgentModels(raw, base);
    expect(base.archive.model).toBe('');
  });

  it('never touches a model the user explicitly set, regardless of provider', () => {
    const raw: RawSettings = {
      provider: { kind: 'lmstudio' },
      agents: { betaReader: { model: 'qwen/qwen3.6-35b-a3b' } },
    };
    const base = makeBase('qwen/qwen3.6-35b-a3b');
    migrateAgentModels(raw, base);
    expect(base.betaReader.model).toBe('qwen/qwen3.6-35b-a3b');
  });

  it('is idempotent — applying twice gives the same result', () => {
    const raw: RawSettings = {
      provider: { kind: 'lmstudio' },
      agents: { writingAssistant: { model: 'claude-sonnet-4-6' } },
    };
    const base = makeBase('claude-sonnet-4-6');
    migrateAgentModels(raw, base);
    migrateAgentModels(raw, base);
    expect(base.writingAssistant.model).toBe('');
  });
});
