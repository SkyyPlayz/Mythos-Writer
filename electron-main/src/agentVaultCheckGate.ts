import type { DatabaseSync } from 'node:sqlite';
import type { AppSettings } from './ipc.js';
import { checkCallBudget, type AgentBudgetSettings } from './budget.js';
import { settingsLoadUsedParseFallbackOnLastRead } from './appSettingsLoad.js';
import { AI_DISABLED_MESSAGE } from './provider.js';

export const ARCHIVE_AGENT_DISABLED_MESSAGE = 'Archive agent is disabled in settings.';
export const SETTINGS_UNREADABLE_MESSAGE =
  'App settings could not be read. Fix or restore app-settings.json and try again.';
export const ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE =
  'Archive Agent budget settings are invalid. Check Settings and try again.';

/** Must match `generation_log.agent` for vault-check streams in `main.ts`. */
export const VAULT_CHECK_BUDGET_LOG_AGENT = 'vault-agent';

/** Shared Archive budget pool: chat (`archive`) + vault-check (`vault-agent`) rows. */
export const ARCHIVE_BUDGET_AGENTS = ['archive', VAULT_CHECK_BUDGET_LOG_AGENT] as const;

function archiveBudgetCapMessage(
  reason: 'hourly_token_cap' | 'daily_token_cap' | 'requests_per_minute_cap',
): string {
  const capLabel =
    reason === 'daily_token_cap'
      ? 'daily token cap'
      : reason === 'requests_per_minute_cap'
        ? 'per-minute request cap'
        : 'hourly token cap';
  return `Archive Agent paused: ${capLabel} reached. Try again next window.`;
}

export type AgentVaultCheckGateOptions = {
  onBudgetCap?: (reason: 'hourly_token_cap' | 'daily_token_cap') => void;
};

function assertArchiveBudgetSettingsFinite(
  archive: AppSettings['agents']['archive'] | undefined,
): asserts archive is AppSettings['agents']['archive'] {
  if (!archive) {
    throw new Error(ARCHIVE_AGENT_DISABLED_MESSAGE);
  }
  if (
    !Number.isFinite(archive.maxTokensPerHour) ||
    !Number.isFinite(archive.maxTokensPerDay)
  ) {
    throw new Error(ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE);
  }
  if (
    (archive as AgentBudgetSettings & { requestsPerMinute?: number }).requestsPerMinute !==
      undefined &&
    !Number.isFinite(
      (archive as AgentBudgetSettings & { requestsPerMinute?: number }).requestsPerMinute,
    )
  ) {
    throw new Error(ARCHIVE_BUDGET_SETTINGS_INVALID_MESSAGE);
  }
}

/**
 * Refuse AGENT_VAULT_CHECK when AI is off, Archive is off, settings are unreadable,
 * budget settings are invalid, or the shared Archive budget is spent.
 * Pure and Electron-free; `getDb` runs only after switch checks succeed.
 */
export function assertAgentVaultCheckAllowed(
  settings: AppSettings,
  getDb: () => DatabaseSync,
  options?: AgentVaultCheckGateOptions,
): void {
  if (settingsLoadUsedParseFallbackOnLastRead()) {
    throw new Error(SETTINGS_UNREADABLE_MESSAGE);
  }
  if (settings.ai != null && 'enabled' in settings.ai && settings.ai.enabled !== true) {
    throw new Error(AI_DISABLED_MESSAGE);
  }
  if (settings.agents?.archive?.enabled !== true) {
    throw new Error(ARCHIVE_AGENT_DISABLED_MESSAGE);
  }
  assertArchiveBudgetSettingsFinite(settings.agents.archive);
  const budgetCheck = checkCallBudget(
    ARCHIVE_BUDGET_AGENTS,
    settings.agents.archive,
    getDb(),
  );
  if (!budgetCheck.allowed) {
    const reason = budgetCheck.reason ?? 'hourly_token_cap';
    if (reason === 'hourly_token_cap' || reason === 'daily_token_cap') {
      options?.onBudgetCap?.(reason);
    }
    throw new Error(archiveBudgetCapMessage(reason));
  }
}
