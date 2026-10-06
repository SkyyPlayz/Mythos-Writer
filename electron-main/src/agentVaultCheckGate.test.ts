/**
 * PLAN-058 Lane 2b — AGENT_VAULT_CHECK guard (red-on-revert).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppSettings } from './ipc.js';
import { SETTINGS_DEFAULTS } from './appSettingsLoad.js';
import {
  assertAgentVaultCheckAllowed,
  ARCHIVE_AGENT_DISABLED_MESSAGE,
  VAULT_CHECK_BUDGET_LOG_AGENT,
  WRITING_COACH_DISABLED_MESSAGE,
} from './agentVaultCheckGate.js';
import { AI_DISABLED_MESSAGE } from './provider.js';
import * as budget from './budget.js';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

function enabledSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...SETTINGS_DEFAULTS,
    ai: { ...SETTINGS_DEFAULTS.ai, enabled: true },
    agents: {
      ...SETTINGS_DEFAULTS.agents,
      writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: true },
      archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: true },
    },
    ...overrides,
  };
}

describe('assertAgentVaultCheckAllowed — PLAN-058 Lane 2b', () => {
  const fakeDb = {} as DatabaseSyncType;
  let getDbTracked: () => DatabaseSyncType;

  beforeEach(() => {
    vi.restoreAllMocks();
    getDbTracked = vi.fn(() => fakeDb) as () => DatabaseSyncType;
    vi.spyOn(budget, 'checkCallBudget').mockReturnValue({ allowed: true });
  });

  it('refuses when archive agent is disabled', () => {
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: true },
        archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: false },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
      ARCHIVE_AGENT_DISABLED_MESSAGE,
    );
    expect(getDbTracked).not.toHaveBeenCalled();
  });

  it('refuses when hourly token budget is exhausted', () => {
    const settings = enabledSettings();
    vi.spyOn(budget, 'checkCallBudget').mockReturnValue({
      allowed: false,
      reason: 'hourly_token_cap',
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
      /Archive Agent paused: hourly token cap/,
    );
    expect(getDbTracked).toHaveBeenCalledOnce();
  });

  it('refuses when AI master is off', () => {
    const settings = enabledSettings({
      ai: { ...SETTINGS_DEFAULTS.ai, enabled: false },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(AI_DISABLED_MESSAGE);
    expect(getDbTracked).not.toHaveBeenCalled();
  });

  it('refuses when Writing Coach is disabled', () => {
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
        archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: true },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
      WRITING_COACH_DISABLED_MESSAGE,
    );
    expect(getDbTracked).not.toHaveBeenCalled();
  });

  it('allows happy path when switches are on and budget remains', () => {
    const settings = enabledSettings();
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).not.toThrow();
    expect(getDbTracked).toHaveBeenCalledOnce();
  });

  it('invokes onBudgetCap before throwing on budget miss', () => {
    const settings = enabledSettings();
    vi.spyOn(budget, 'checkCallBudget').mockReturnValue({
      allowed: false,
      reason: 'daily_token_cap',
    });
    const onBudgetCap = vi.fn();
    expect(() =>
      assertAgentVaultCheckAllowed(settings, getDbTracked, { onBudgetCap }),
    ).toThrow(/daily token cap/);
    expect(onBudgetCap).toHaveBeenCalledWith('daily_token_cap');
  });

  it('does not invoke onBudgetCap for per-minute request cap (error only)', () => {
    const settings = enabledSettings();
    vi.spyOn(budget, 'checkCallBudget').mockReturnValue({
      allowed: false,
      reason: 'requests_per_minute_cap',
    });
    const onBudgetCap = vi.fn();
    expect(() =>
      assertAgentVaultCheckAllowed(settings, getDbTracked, { onBudgetCap }),
    ).toThrow(/per-minute request cap/);
    expect(onBudgetCap).not.toHaveBeenCalled();
  });

  it('budget check uses vault-agent generation_log key (red-on-revert)', () => {
    const settings = enabledSettings();
    const budgetSpy = vi.spyOn(budget, 'checkCallBudget');
    assertAgentVaultCheckAllowed(settings, getDbTracked);
    expect(budgetSpy).toHaveBeenCalledWith(
      VAULT_CHECK_BUDGET_LOG_AGENT,
      settings.agents.archive,
      fakeDb,
    );
  });
});

function generationLogOnlyDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE generation_log (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('assertAgentVaultCheckAllowed — vault-agent generation_log (red-on-revert)', () => {
  it('refuses when prior vault-check rows exhaust archive hourly token cap', () => {
    const db = generationLogOnlyDb();
    db.prepare(
      `INSERT INTO generation_log (id, agent, tokens_in, tokens_out, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('vault-prior-1', VAULT_CHECK_BUDGET_LOG_AGENT, 600, 500, new Date().toISOString());
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: true },
        archive: {
          ...SETTINGS_DEFAULTS.agents.archive,
          enabled: true,
          maxTokensPerHour: 1000,
          maxTokensPerDay: 50_000,
        },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, () => db)).toThrow(
      /Archive Agent paused: hourly token cap/,
    );
  });

  it('would allow if budget key reverted to archive (red-on-revert)', () => {
    const db = generationLogOnlyDb();
    db.prepare(
      `INSERT INTO generation_log (id, agent, tokens_in, tokens_out, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('vault-prior-1', VAULT_CHECK_BUDGET_LOG_AGENT, 600, 500, new Date().toISOString());
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: true },
        archive: {
          ...SETTINGS_DEFAULTS.agents.archive,
          enabled: true,
          maxTokensPerHour: 1000,
          maxTokensPerDay: 50_000,
        },
      },
    });
    expect(budget.checkCallBudget('archive', settings.agents.archive, db).allowed).toBe(true);
  });
});

describe('PLAN-058 Lane 2b — no renderer caller for agent:vault-check', () => {
  it('frontend src has no agentVaultCheck invoke (preload-only surface)', () => {
    const frontendSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx?|jsx?)$/.test(name)) continue;
        const text = fs.readFileSync(full, 'utf-8');
        if (/\bagentVaultCheck\b/.test(text)) {
          hits.push(path.relative(frontendSrc, full));
        }
      }
    };
    walk(frontendSrc);
    expect(hits).toEqual(['global.d.ts']);
  });
});

describe('PLAN-058 Lane 2b source pin', () => {
  it('AGENT_VAULT_CHECK handler calls assertAgentVaultCheckAllowed before vault I/O', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const handler = mainSrc.match(
      /IPC_CHANNELS\.AGENT_VAULT_CHECK,[\s\S]*?async \(event, payload: VaultCheckPayload\) => \{([\s\S]*?)\n  \}\)\);/,
    );
    const body = handler?.[1] ?? '';
    expect(body).toMatch(/assertAgentVaultCheckAllowed\(/);
    const guardIdx = body.indexOf('assertAgentVaultCheckAllowed');
    const vaultIoIdx = body.indexOf('ensureVaultDir');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(vaultIoIdx).toBeGreaterThan(guardIdx);
  });
});
