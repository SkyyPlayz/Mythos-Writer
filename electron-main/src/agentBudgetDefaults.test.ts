/**
 * Pins AGENT_BUDGET_DEFAULTS (appSettingsLoad.ts) so a changed default goes red,
 * and proves the loader back-fills a missing per-agent requestsPerMinute.
 * Expected values are written out on purpose — do not derive them from the
 * constant under test. Saved-file cases include slice2AutonomyOffMigrated,
 * the on-disk state after the slice-2 autonomy-off migration.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AGENT_BUDGET_DEFAULTS, SETTINGS_DEFAULTS, loadAppSettingsFrom } from './appSettingsLoad.js';
import { SecretsStore } from './secrets/index.js';

const AGENT_KEYS = [
  'writingAssistant',
  'brainstorm',
  'archive',
  'betaReader',
  'alphaReader',
  'storylineConsultant',
  'lineEditor',
] as const;

const EXPECTED_BUDGET_DEFAULTS = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  autoApplyThreshold: 0.85,
  requestsPerMinute: 60,
  autoApplyCategories: {
    punctuation: false,
    spelling: false,
    grammar: false,
    'sentence-structure': false,
    'style-tone': false,
    other: false,
  },
};

// requestsPerMinute is not declared on AgentBudgetSettings, so read it untyped.
function rpm(agent: object | undefined): unknown {
  return (agent as Record<string, unknown> | undefined)?.requestsPerMinute;
}

/**
 * One agent as the slice-2 migration writes it (appSettingsLoad.ts):
 * autoApply forced off and autoApplyCategories replaced with the all-off map.
 * requestsPerMinute is stripped so a later load has to back-fill it — the
 * slice2AutonomyOffMigrated flag stops that migration from running again.
 */
function agentAfterSlice2AutonomyOff(saved: Record<string, unknown>): Record<string, unknown> {
  const agent: Record<string, unknown> = {
    ...saved,
    autoApply: false,
    autoApplyCategories: { ...EXPECTED_BUDGET_DEFAULTS.autoApplyCategories },
  };
  delete agent.requestsPerMinute;
  return agent;
}

/** Saved settings file that already went through the slice-2 autonomy-off migration. */
const slice2AutonomyOffMigrated = {
  slice2AutonomyOffMigrated: true,
  agents: {
    writingAssistant: agentAfterSlice2AutonomyOff({ enabled: true }),
    brainstorm: agentAfterSlice2AutonomyOff({ enabled: true }),
    archive: agentAfterSlice2AutonomyOff({ enabled: true, model: 'saved-model' }),
    betaReader: agentAfterSlice2AutonomyOff({ enabled: true }),
    alphaReader: agentAfterSlice2AutonomyOff({ enabled: false }),
    storylineConsultant: agentAfterSlice2AutonomyOff({ enabled: false }),
    lineEditor: agentAfterSlice2AutonomyOff({ enabled: false }),
  },
};

const tempDirs: string[] = [];

function mkSettingsStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-budget-defaults-'));
  tempDirs.push(dir);
  const settingsPath = path.join(dir, 'app-settings.json');
  const store = new SecretsStore({
    filePath: path.join(dir, 'secrets.json'),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf-8'),
      decryptString: (b: Buffer) => b.toString('utf-8'),
    },
  });
  return { settingsPath, store };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AGENT_BUDGET_DEFAULTS', () => {
  it('equals the pinned literal, value for value', () => {
    expect(AGENT_BUDGET_DEFAULTS).toEqual(EXPECTED_BUDGET_DEFAULTS);
  });

  it('pins requestsPerMinute to 60', () => {
    expect(AGENT_BUDGET_DEFAULTS.requestsPerMinute).toBe(60);
  });
});

describe('SETTINGS_DEFAULTS.agents budget keys', () => {
  it.each(AGENT_KEYS)('%s carries every budget default', (key) => {
    const agent = SETTINGS_DEFAULTS.agents[key];
    expect(agent).toBeDefined();
    expect(rpm(agent)).toBe(60);
    expect(agent).toMatchObject(EXPECTED_BUDGET_DEFAULTS);
  });
});

describe('loadAppSettingsFrom — requestsPerMinute back-fill', () => {
  it.each(AGENT_KEYS)('fills a missing requestsPerMinute for %s with 60', (key) => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, JSON.stringify({ agents: { [key]: { enabled: true } } }));

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(rpm(loaded.agents[key])).toBe(60);
    expect(loaded.agents[key]).toMatchObject(EXPECTED_BUDGET_DEFAULTS);
  });

  it('fills requestsPerMinute for archive and another agent in one saved file', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        agents: {
          archive: { enabled: true, model: 'saved-model' },
          brainstorm: { enabled: false },
        },
      }),
    );

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(rpm(loaded.agents.archive)).toBe(60);
    expect(rpm(loaded.agents.brainstorm)).toBe(60);
    // Saved values still win over defaults.
    expect(loaded.agents.archive.model).toBe('saved-model');
    expect(loaded.agents.brainstorm.enabled).toBe(false);
  });

  it('fills requestsPerMinute when there is no settings file at all', () => {
    const { settingsPath, store } = mkSettingsStore();
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const key of AGENT_KEYS) {
      expect(rpm(loaded.agents[key])).toBe(60);
    }
  });

  it('keeps a saved requestsPerMinute of 5 instead of the default', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        agents: {
          archive: { enabled: true, requestsPerMinute: 5 },
          brainstorm: { enabled: true },
        },
      }),
    );

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(rpm(loaded.agents.archive)).toBe(5);
    // A sibling agent without the field still gets the default.
    expect(rpm(loaded.agents.brainstorm)).toBe(60);
  });

  it('back-fills requestsPerMinute and budget defaults for a slice2AutonomyOffMigrated file', () => {
    const { settingsPath, store } = mkSettingsStore();
    const raw = JSON.stringify(slice2AutonomyOffMigrated);
    fs.writeFileSync(settingsPath, raw);

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    // Flag stays set, and this load must not re-run the migration write.
    expect(loaded.slice2AutonomyOffMigrated).toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(raw);
    for (const key of AGENT_KEYS) {
      expect(rpm(loaded.agents[key]), key).toBe(60);
      expect(loaded.agents[key], key).toMatchObject(EXPECTED_BUDGET_DEFAULTS);
    }
    expect(loaded.agents.archive.model).toBe('saved-model');
  });
});
