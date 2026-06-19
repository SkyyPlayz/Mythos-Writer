/**
 * waSettingsMigration.test.ts (SKY-2627)
 *
 * Unit tests for Writing Assistant AppSettings extension:
 *   §1  Fresh config gets wa* default values
 *   §2  Migration back-fills wa* from agents.writingAssistant.* for existing installs
 *   §3  Migration is idempotent — applying twice gives the same result
 *   §4  waEnabled=false propagates through syncedWa → disables scan gate
 */

import { describe, it, expect } from 'vitest';
import type { AppSettings } from './ipc.js';

// ─── Inline migration helper (mirrors main.ts logic for isolation) ─────────────

const AGENT_BUDGET_DEFAULTS = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  autoApplyThreshold: 0.85,
  requestsPerMinute: 60,
  autoApplyCategories: {} as Record<string, boolean>,
};

const WA_DEFAULTS = {
  enabled: true,
  model: 'claude-sonnet-4-6',
  scanIntervalSeconds: 60,
  cadenceTrigger: 'on_save' as const,
  idleHeartbeatConstantInterval: false,
  idleDebounceSeconds: 30,
  ...AGENT_BUDGET_DEFAULTS,
};

const SETTINGS_DEFAULTS: AppSettings = {
  apiKey: '',
  waScanInterval: 'on-save',
  waEnabled: true,
  waModel: null,
  waCadenceTrigger: 'on_save',
  waIdleHeartbeatConstantInterval: false,
  waIdleDebounceSeconds: 30,
  agents: {
    writingAssistant: { ...WA_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...AGENT_BUDGET_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...AGENT_BUDGET_DEFAULTS },
  },
  theme: 'dark',
};

/**
 * Inline migration matching main.ts loadAppSettings() logic for SKY-2627 fields.
 * Takes a raw partial settings object (as stored on disk) and returns a fully-merged AppSettings.
 */
function migrateRawSettings(raw: Record<string, unknown> | AppSettings): AppSettings {
  const rawAgents = (raw.agents as Partial<AppSettings['agents']> | undefined) ?? {};
  const base: AppSettings = {
    ...SETTINGS_DEFAULTS,
    ...(raw as Partial<AppSettings>),
    agents: {
      writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, ...(rawAgents.writingAssistant ?? {}) },
      brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, ...(rawAgents.brainstorm ?? {}) },
      archive: { ...SETTINGS_DEFAULTS.agents.archive, ...(rawAgents.archive ?? {}) },
    },
  };

  // AC-CAD-12 migration: existing installs without cadenceTrigger use idle_heartbeat
  if (rawAgents.writingAssistant && !('cadenceTrigger' in (rawAgents.writingAssistant as unknown as Record<string, unknown>))) {
    base.agents.writingAssistant.cadenceTrigger = 'idle_heartbeat';
    base.agents.writingAssistant.idleHeartbeatConstantInterval = true;
  }

  // SKY-2627 migration: back-fill flat wa* from agents.writingAssistant.* when absent from disk.
  // waModel is intentionally NOT back-filled: null means "use global model" — the spec default.
  if (!('waEnabled' in raw)) base.waEnabled = base.agents.writingAssistant.enabled;
  if (!('waCadenceTrigger' in raw)) base.waCadenceTrigger = base.agents.writingAssistant.cadenceTrigger ?? 'on_save';
  if (!('waIdleHeartbeatConstantInterval' in raw)) base.waIdleHeartbeatConstantInterval = base.agents.writingAssistant.idleHeartbeatConstantInterval ?? false;
  if (!('waIdleDebounceSeconds' in raw)) base.waIdleDebounceSeconds = base.agents.writingAssistant.idleDebounceSeconds ?? 30;

  return base;
}

/**
 * Inline sync matching main.ts settings:set syncedWa logic.
 * Keeps flat wa* fields in sync with agents.writingAssistant.* on every settings:set.
 */
function syncWaFields(settings: AppSettings): AppSettings {
  return {
    ...settings,
    waEnabled: settings.agents.writingAssistant.enabled,
    waModel: settings.waModel ?? null,
    waCadenceTrigger: settings.agents.writingAssistant.cadenceTrigger ?? 'on_save',
    waIdleHeartbeatConstantInterval: settings.agents.writingAssistant.idleHeartbeatConstantInterval ?? false,
    waIdleDebounceSeconds: settings.agents.writingAssistant.idleDebounceSeconds ?? 30,
  };
}

// ─── §1 Fresh config defaults ──────────────────────────────────────────────────

describe('WA settings — fresh config (§1)', () => {
  it('applies waEnabled default true', () => {
    const s = migrateRawSettings({});
    expect(s.waEnabled).toBe(true);
  });

  it('applies waModel default null', () => {
    const s = migrateRawSettings({});
    expect(s.waModel).toBeNull();
  });

  it('applies waCadenceTrigger default on_save', () => {
    const s = migrateRawSettings({});
    expect(s.waCadenceTrigger).toBe('on_save');
  });

  it('applies waIdleHeartbeatConstantInterval default false', () => {
    const s = migrateRawSettings({});
    expect(s.waIdleHeartbeatConstantInterval).toBe(false);
  });

  it('applies waIdleDebounceSeconds default 30', () => {
    const s = migrateRawSettings({});
    expect(s.waIdleDebounceSeconds).toBe(30);
  });

  it('applies waScanInterval default on-save', () => {
    const s = migrateRawSettings({});
    expect(s.waScanInterval).toBe('on-save');
  });
});

// ─── §2 Migration back-fill from agents.writingAssistant.* ────────────────────

describe('WA settings — migration back-fill (§2)', () => {
  it('copies enabled=false from agents.writingAssistant when waEnabled absent', () => {
    const raw = {
      agents: {
        writingAssistant: { ...WA_DEFAULTS, enabled: false },
        brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm },
        archive: { ...SETTINGS_DEFAULTS.agents.archive },
      },
    };
    const s = migrateRawSettings(raw);
    expect(s.waEnabled).toBe(false);
  });

  it('preserves explicit waEnabled when already present on disk', () => {
    const raw = {
      waEnabled: false,
      agents: {
        writingAssistant: { ...WA_DEFAULTS, enabled: true },
        brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm },
        archive: { ...SETTINGS_DEFAULTS.agents.archive },
      },
    };
    const s = migrateRawSettings(raw);
    expect(s.waEnabled).toBe(false);
  });
});

// ─── §3 Migration idempotency ─────────────────────────────────────────────────

describe('WA settings — migration idempotency (§3)', () => {
  it('running migration twice gives the same result', () => {
    const raw = {
      agents: {
        writingAssistant: { ...WA_DEFAULTS, enabled: false, model: 'claude-haiku-4-5-20251001' },
        brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm },
        archive: { ...SETTINGS_DEFAULTS.agents.archive },
      },
    };
    const first = migrateRawSettings(raw);
    const second = migrateRawSettings(first);
    expect(second.waEnabled).toBe(first.waEnabled);
    expect(second.waModel).toBe(first.waModel);
    expect(second.waCadenceTrigger).toBe(first.waCadenceTrigger);
    expect(second.waIdleHeartbeatConstantInterval).toBe(first.waIdleHeartbeatConstantInterval);
    expect(second.waIdleDebounceSeconds).toBe(first.waIdleDebounceSeconds);
  });

  it('idempotent on fresh-default output', () => {
    const first = migrateRawSettings({});
    const second = migrateRawSettings(first);
    expect(second).toMatchObject({
      waEnabled: first.waEnabled,
      waModel: first.waModel,
      waCadenceTrigger: first.waCadenceTrigger,
      waIdleHeartbeatConstantInterval: first.waIdleHeartbeatConstantInterval,
      waIdleDebounceSeconds: first.waIdleDebounceSeconds,
    });
  });
});

// ─── §4 waEnabled=false disables scan gate ────────────────────────────────────

describe('WA settings — waEnabled=false scan gate (§4)', () => {
  it('syncWaFields propagates agents.writingAssistant.enabled=false → waEnabled=false', () => {
    const settings: AppSettings = {
      ...SETTINGS_DEFAULTS,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    };
    const synced = syncWaFields(settings);
    expect(synced.waEnabled).toBe(false);
  });

  it('scan gate check (agents.writingAssistant.enabled) returns false when waEnabled=false', () => {
    const settings: AppSettings = {
      ...SETTINGS_DEFAULTS,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
      waEnabled: false,
    };
    const synced = syncWaFields(settings);
    // The scheduler checks agents.writingAssistant.enabled; confirm it matches waEnabled
    expect(synced.agents.writingAssistant.enabled).toBe(false);
    expect(synced.waEnabled).toBe(false);
  });
});
