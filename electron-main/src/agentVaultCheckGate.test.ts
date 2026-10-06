/**
 * PLAN-058 Lane 2b — AGENT_VAULT_CHECK guard (red-on-revert).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DatabaseSync } from 'node:sqlite';
import type { AppSettings } from './ipc.js';
import { SETTINGS_DEFAULTS } from './appSettingsLoad.js';
import {
  assertAgentVaultCheckAllowed,
  ARCHIVE_AGENT_DISABLED_MESSAGE,
} from './agentVaultCheckGate.js';
import { AI_DISABLED_MESSAGE } from './provider.js';
import * as budget from './budget.js';

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
  const fakeDb = {} as DatabaseSync;
  let getDbTracked: () => DatabaseSync;

  beforeEach(() => {
    vi.restoreAllMocks();
    getDbTracked = vi.fn(() => fakeDb) as () => DatabaseSync;
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
