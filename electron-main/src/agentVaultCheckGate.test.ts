/**
 * PLAN-058 Lane 2b — AGENT_VAULT_CHECK guard (red-on-revert).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { AppSettings } from './ipc.js';
import { SETTINGS_DEFAULTS, loadAppSettingsFrom } from './appSettingsLoad.js';
import * as appSettingsLoad from './appSettingsLoad.js';
import {
  assertAgentVaultCheckAllowed,
  ARCHIVE_AGENT_DISABLED_MESSAGE,
  ARCHIVE_BUDGET_AGENTS,
  ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE,
  SETTINGS_UNREADABLE_MESSAGE,
  VAULT_CHECK_BUDGET_LOG_AGENT,
} from './agentVaultCheckGate.js';
import { AI_DISABLED_MESSAGE } from './provider.js';
import * as budget from './budget.js';
import { checkCallBudget } from './budget.js';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { SecretsStore } from './secrets/index.js';

function mkSettingsStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gate-settings-'));
  const settingsPath = path.join(dir, 'app-settings.json');
  const store = new SecretsStore({
    filePath: path.join(dir, 'secrets.json'),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf-8'),
      decryptString: (b: Buffer) => b.toString('utf-8'),
    },
  });
  return { settingsPath, store, dir };
}

function enabledSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...SETTINGS_DEFAULTS,
    ai: { ...SETTINGS_DEFAULTS.ai, enabled: true },
    agents: {
      ...SETTINGS_DEFAULTS.agents,
      archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: true },
    },
    ...overrides,
  };
}

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

function insertGenRow(
  db: DatabaseSync,
  agent: string,
  tokensIn: number | null,
  tokensOut: number | null,
  id?: string,
): void {
  db.prepare(
    `INSERT INTO generation_log (id, agent, tokens_in, tokens_out, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id ?? `gen-${Math.random().toString(36).slice(2)}`, agent, tokensIn, tokensOut, new Date().toISOString());
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
        archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: false },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
      ARCHIVE_AGENT_DISABLED_MESSAGE,
    );
    expect(getDbTracked).not.toHaveBeenCalled();
  });

  it('refuses when archive.enabled is truthy non-boolean (red-on-revert)', () => {
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: 'false' as unknown as boolean },
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

  it('refuses when ai.enabled is present and not true (red-on-revert)', () => {
    const settings = enabledSettings({
      ai: { ...SETTINGS_DEFAULTS.ai, enabled: 'false' as unknown as boolean },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(AI_DISABLED_MESSAGE);
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

  it('budget check uses shared ARCHIVE_BUDGET_AGENTS pool (red-on-revert)', () => {
    const settings = enabledSettings();
    const budgetSpy = vi.spyOn(budget, 'checkCallBudget');
    assertAgentVaultCheckAllowed(settings, getDbTracked);
    expect(budgetSpy).toHaveBeenCalledWith(
      ARCHIVE_BUDGET_AGENTS,
      settings.agents.archive,
      fakeDb,
    );
  });

  it('refuses when archive budget caps are non-numeric (red-on-revert)', () => {
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        archive: {
          ...SETTINGS_DEFAULTS.agents.archive,
          enabled: true,
          maxTokensPerHour: '1000' as unknown as number,
        },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
      ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE,
    );
    expect(getDbTracked).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'maxTokensPerDay' as const, value: 'x' },
    { field: 'maxTokensPerDay' as const, value: Infinity },
    { field: 'requestsPerMinute' as const, value: 'x' },
    { field: 'requestsPerMinute' as const, value: null },
    { field: 'requestsPerMinute' as const, value: Infinity },
  ])(
    'refuses when archive $field is non-finite ($value) without calling getDb (Shield RF-2b)',
    ({ field, value }) => {
      const settings = enabledSettings({
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          archive: {
            ...SETTINGS_DEFAULTS.agents.archive,
            enabled: true,
            [field]: value as unknown as number,
          },
        },
      });
      expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).toThrow(
        ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE,
      );
      expect(getDbTracked).not.toHaveBeenCalled();
    },
  );

  it('allows when Writing Coach is off and Archive is on (N1)', () => {
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
        archive: { ...SETTINGS_DEFAULTS.agents.archive, enabled: true },
      },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, getDbTracked)).not.toThrow();
    expect(getDbTracked).toHaveBeenCalledOnce();
  });
});

describe('assertAgentVaultCheckAllowed — settings parse fallback (Shield RF-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it('refuses when loader used parse fallback without calling getDb', () => {
    vi.spyOn(appSettingsLoad, 'settingsLoadUsedParseFallbackOnLastRead').mockReturnValue(true);
    const getDb = vi.fn(() => ({}) as DatabaseSync);
    expect(() => assertAgentVaultCheckAllowed(enabledSettings(), getDb)).toThrow(
      SETTINGS_UNREADABLE_MESSAGE,
    );
    expect(getDb).not.toHaveBeenCalled();
  });

  it('allows when parse fallback flag is false (missing or valid settings file)', () => {
    vi.spyOn(appSettingsLoad, 'settingsLoadUsedParseFallbackOnLastRead').mockReturnValue(false);
    const db = generationLogOnlyDb();
    expect(() => assertAgentVaultCheckAllowed(enabledSettings(), () => db)).not.toThrow();
  });

  it('loadAppSettingsFrom sets parse fallback on malformed JSON and guard refuses', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, '{ not json');
    const settings = loadAppSettingsFrom(settingsPath, () => store);
    const getDb = vi.fn(() => ({}) as DatabaseSync);
    expect(() => assertAgentVaultCheckAllowed(settings, getDb)).toThrow(SETTINGS_UNREADABLE_MESSAGE);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('loadAppSettingsFrom sets parse fallback on null JSON and guard refuses', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, 'null');
    const settings = loadAppSettingsFrom(settingsPath, () => store);
    const getDb = vi.fn(() => ({}) as DatabaseSync);
    expect(() => assertAgentVaultCheckAllowed(settings, getDb)).toThrow(SETTINGS_UNREADABLE_MESSAGE);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('loadAppSettingsFrom missing file keeps fallback false and guard allows', () => {
    const { store, dir } = mkSettingsStore();
    const missingPath = path.join(dir, 'no-settings-yet.json');
    const settings = loadAppSettingsFrom(missingPath, () => store);
    expect(appSettingsLoad.settingsLoadUsedParseFallbackOnLastRead()).toBe(false);
    const db = generationLogOnlyDb();
    expect(() => assertAgentVaultCheckAllowed(settings, () => db)).not.toThrow();
  });

  it('malformed settings then valid read allows vault check (N2)', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, '{ not json');
    const getDb = vi.fn(() => ({}) as DatabaseSync);
    expect(() => assertAgentVaultCheckAllowed(loadAppSettingsFrom(settingsPath, () => store), getDb)).toThrow(
      SETTINGS_UNREADABLE_MESSAGE,
    );
    fs.writeFileSync(settingsPath, JSON.stringify(enabledSettings()));
    const db = generationLogOnlyDb();
    expect(() => assertAgentVaultCheckAllowed(loadAppSettingsFrom(settingsPath, () => store), () => db)).not.toThrow();
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('assertAgentVaultCheckAllowed — shared Archive budget pool (Critic H1)', () => {
  const archiveCaps: AppSettings['agents']['archive'] = {
    ...SETTINGS_DEFAULTS.agents.archive,
    enabled: true,
    maxTokensPerHour: 1000,
    maxTokensPerDay: 50_000,
    ...( { requestsPerMinute: 60 } as Partial<AppSettings['agents']['archive']> ),
  };

  it('H1(a): archive rows at cap refuse vault check (no vault rows)', () => {
    const db = generationLogOnlyDb();
    insertGenRow(db, 'archive', 600, 500);
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: { ...SETTINGS_DEFAULTS.agents, archive: { ...SETTINGS_DEFAULTS.agents.archive, ...archiveCaps } },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, () => db)).toThrow(
      /Archive Agent paused: hourly token cap/,
    );
  });

  it('H1(b): archive + vault rows together over cap refuse vault check', () => {
    const db = generationLogOnlyDb();
    insertGenRow(db, 'archive', 450, 50);
    insertGenRow(db, VAULT_CHECK_BUDGET_LOG_AGENT, 450, 50);
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: { ...SETTINGS_DEFAULTS.agents, archive: { ...SETTINGS_DEFAULTS.agents.archive, ...archiveCaps } },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, () => db)).toThrow(
      /Archive Agent paused: hourly token cap/,
    );
  });

  it('H1(c): vault rows at cap refuse AGENT_ARCHIVE budget check', () => {
    const db = generationLogOnlyDb();
    insertGenRow(db, VAULT_CHECK_BUDGET_LOG_AGENT, 600, 500);
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: { ...SETTINGS_DEFAULTS.agents, archive: { ...SETTINGS_DEFAULTS.agents.archive, ...archiveCaps } },
    });
    const result = checkCallBudget(ARCHIVE_BUDGET_AGENTS, settings.agents.archive, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_token_cap');
  });

  it('refuses when prior vault-check rows exhaust shared hourly token cap', () => {
    const db = generationLogOnlyDb();
    insertGenRow(db, VAULT_CHECK_BUDGET_LOG_AGENT, 600, 500);
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: { ...SETTINGS_DEFAULTS.agents, archive: { ...SETTINGS_DEFAULTS.agents.archive, ...archiveCaps } },
    });
    expect(() => assertAgentVaultCheckAllowed(settings, () => db)).toThrow(
      /Archive Agent paused: hourly token cap/,
    );
  });

  it('59 vault-agent rows with null tokens allowed, 60th trips per-minute cap (Shield fix batch)', () => {
    const db = generationLogOnlyDb();
    const now = new Date().toISOString();
    for (let i = 0; i < 59; i++) {
      db.prepare(
        `INSERT INTO generation_log (id, agent, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(`vault-null-${i}`, VAULT_CHECK_BUDGET_LOG_AGENT, null, null, now);
    }
    vi.restoreAllMocks();
    const settings = enabledSettings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        archive: {
          ...SETTINGS_DEFAULTS.agents.archive,
          enabled: true,
          maxTokensPerHour: 1_000_000,
          maxTokensPerDay: 10_000_000,
          ...({ requestsPerMinute: 60 } as Partial<AppSettings['agents']['archive']>),
        },
      },
    });
    expect(checkCallBudget(ARCHIVE_BUDGET_AGENTS, settings.agents.archive, db).allowed).toBe(true);
    insertGenRow(db, VAULT_CHECK_BUDGET_LOG_AGENT, null, null, 'vault-null-59');
    const blocked = checkCallBudget(ARCHIVE_BUDGET_AGENTS, settings.agents.archive, db);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('requests_per_minute_cap');
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

function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('PLAN-058 Lane 2b source pin (Shield RF-3, Probe P1–P3)', () => {
  const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts');
  let mainSrc: string;

  beforeEach(() => {
    mainSrc = fs.readFileSync(mainPath, 'utf-8');
  });

  it('AGENT_VAULT_CHECK handler guard is unconditional after isFromTopFrame and before vault I/O', () => {
    const handler = mainSrc.match(
      /IPC_CHANNELS\.AGENT_VAULT_CHECK,[\s\S]*?async\s*\(\s*event,\s*payload:\s*VaultCheckPayload\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)\);/,
    );
    const rawBody = handler?.[1] ?? '';
    const body = stripJsComments(rawBody);
    expect(body).toMatch(/assertAgentVaultCheckAllowed\s*\(\s*loadAppSettings\s*\(\s*\)/);
    expect(body).toMatch(
      /if\s*\(\s*!isFromTopFrame\(\s*event\s*\)\s*\)\s*return\s+UNTRUSTED_FRAME_REJECTION\s*;\s*assertAgentVaultCheckAllowed\(\s*loadAppSettings\(\s*\)\s*,/,
    );
    expect(body).not.toMatch(/try\s*\{[\s\S]*assertAgentVaultCheckAllowed/);
    expect(body).not.toMatch(/void\s+0\s*&&\s*assertAgentVaultCheckAllowed/);
    const frameIdx = body.indexOf('isFromTopFrame');
    const guardIdx = body.indexOf('assertAgentVaultCheckAllowed');
    const providerIdx = body.indexOf('getProviderConfigForAgent');
    const vaultIoIdx = body.indexOf('ensureVaultDir');
    expect(frameIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(frameIdx);
    expect(providerIdx).toBeGreaterThan(guardIdx);
    expect(vaultIoIdx).toBeGreaterThan(guardIdx);
  });

  it('insertGenerationLog uses VAULT_CHECK_BUDGET_LOG_AGENT constant (Probe P1)', () => {
    const handler = mainSrc.match(
      /IPC_CHANNELS\.AGENT_VAULT_CHECK,[\s\S]*?async\s*\(\s*event,\s*payload:\s*VaultCheckPayload\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)\);/,
    );
    const body = stripJsComments(handler?.[1] ?? '');
    expect(body).toMatch(
      /insertGenerationLog\(\{[\s\S]*?agent:\s*VAULT_CHECK_BUDGET_LOG_AGENT/,
    );
  });

  it('onBudgetCap wiring sends AGENT_BUDGET_CAP from main (Probe P2)', () => {
    const handler = mainSrc.match(
      /IPC_CHANNELS\.AGENT_VAULT_CHECK,[\s\S]*?async\s*\(\s*event,\s*payload:\s*VaultCheckPayload\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)\);/,
    );
    const body = stripJsComments(handler?.[1] ?? '');
    expect(body).toMatch(
      /onBudgetCap:[\s\S]*mainWindow\.webContents\.send\s*\(\s*IPC_CHANNELS\.AGENT_BUDGET_CAP/,
    );
  });

  it('AGENT_ARCHIVE budget check uses ARCHIVE_BUDGET_AGENTS shared pool', () => {
    const archiveHandler = mainSrc.match(
      /IPC_CHANNELS\.AGENT_ARCHIVE,[\s\S]*?async\s*\(\s*event,\s*payload:\s*AgentArchivePayload\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)\);/,
    );
    const body = stripJsComments(archiveHandler?.[1] ?? '');
    expect(body).toMatch(/checkCallBudget\s*\(\s*ARCHIVE_BUDGET_AGENTS/);
  });
});
