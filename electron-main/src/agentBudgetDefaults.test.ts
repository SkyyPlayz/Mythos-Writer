/**
 * Pins AGENT_BUDGET_DEFAULTS so any changed default (in particular
 * requestsPerMinute: 60) fails this file, and proves loadAppSettingsFrom
 * fills a missing per-agent requestsPerMinute from that default.
 * Expected values are written out — no snapshot.
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENT_BUDGET_DEFAULTS,
  SETTINGS_DEFAULTS,
  loadAppSettingsFrom,
} from './appSettingsLoad.js';
import { SecretsStore } from './secrets/index.js';

const EXPECTED_BUDGET = {
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

const BUDGET_KEYS = [
  'autoApply',
  'confidenceThreshold',
  'maxTokensPerHour',
  'maxSuggestionsPerHour',
  'heartbeatIntervalMinutes',
  'maxTokensPerDay',
  'autoApplyThreshold',
  'requestsPerMinute',
  'autoApplyCategories',
] as const;

function budgetOf(agent: object): Record<(typeof BUDGET_KEYS)[number], unknown> {
  const record = agent as Record<string, unknown>;
  return {
    autoApply: record.autoApply,
    confidenceThreshold: record.confidenceThreshold,
    maxTokensPerHour: record.maxTokensPerHour,
    maxSuggestionsPerHour: record.maxSuggestionsPerHour,
    heartbeatIntervalMinutes: record.heartbeatIntervalMinutes,
    maxTokensPerDay: record.maxTokensPerDay,
    autoApplyThreshold: record.autoApplyThreshold,
    requestsPerMinute: record.requestsPerMinute,
    autoApplyCategories: record.autoApplyCategories,
  };
}

function requireAgent(name: string, agent: object | undefined): object {
  if (agent == null) {
    throw new Error(`${name} is missing from SETTINGS_DEFAULTS.agents`);
  }
  return agent;
}

const dirs: string[] = [];

function mkSettingsStore(): { settingsPath: string; store: SecretsStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-budget-defaults-'));
  dirs.push(dir);
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
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AGENT_BUDGET_DEFAULTS', () => {
  it('equals the locked budget literal', () => {
    expect(AGENT_BUDGET_DEFAULTS).toEqual(EXPECTED_BUDGET);
  });

  it('every settings agent carries the locked budget, including requestsPerMinute 60', () => {
    const agents = SETTINGS_DEFAULTS.agents;
    const named: Array<[string, object | undefined]> = [
      ['writingAssistant', agents.writingAssistant],
      ['brainstorm', agents.brainstorm],
      ['archive', agents.archive],
      ['betaReader', agents.betaReader],
      ['alphaReader', agents.alphaReader],
      ['storylineConsultant', agents.storylineConsultant],
      ['lineEditor', agents.lineEditor],
    ];
    for (const [name, agent] of named) {
      const present = requireAgent(name, agent);
      expect(budgetOf(present).requestsPerMinute, name).toBe(60);
      expect(budgetOf(present), name).toEqual(EXPECTED_BUDGET);
    }
  });
});

describe('loadAppSettingsFrom requestsPerMinute fill', () => {
  it('fills a missing requestsPerMinute with 60 for archive and brainstorm', () => {
    const { settingsPath, store } = mkSettingsStore();
    const saved = {
      slice2AutonomyOffMigrated: true,
      agents: {
        archive: { enabled: true, model: '' },
        brainstorm: { enabled: true, model: '' },
      },
    };
    expect('requestsPerMinute' in saved.agents.archive).toBe(false);
    expect('requestsPerMinute' in saved.agents.brainstorm).toBe(false);
    fs.writeFileSync(settingsPath, JSON.stringify(saved));

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(budgetOf(loaded.agents.archive).requestsPerMinute).toBe(60);
    expect(budgetOf(loaded.agents.brainstorm).requestsPerMinute).toBe(60);
  });

  it('keeps a saved requestsPerMinute of 5', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        slice2AutonomyOffMigrated: true,
        agents: {
          archive: { enabled: true, model: '', requestsPerMinute: 5 },
        },
      }),
    );

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(budgetOf(loaded.agents.archive).requestsPerMinute).toBe(5);
  });
});
