import type { DatabaseSync } from 'node:sqlite';
import type { AppSettings } from './ipc.js';
import { checkCallBudget } from './budget.js';
import { AI_DISABLED_MESSAGE } from './provider.js';

export const ARCHIVE_AGENT_DISABLED_MESSAGE = 'Archive agent is disabled in settings.';
export const WRITING_COACH_DISABLED_MESSAGE = 'Writing Coach is disabled in settings.';

/** Must match `generation_log.agent` for vault-check streams in `main.ts`. */
export const VAULT_CHECK_BUDGET_LOG_AGENT = 'vault-agent';

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

/**
 * Refuse AGENT_VAULT_CHECK when AI is off, Writing Coach is off, Archive is off, or budget is spent.
 * Pure and Electron-free; `getDb` runs only after switch checks succeed.
 */
export function assertAgentVaultCheckAllowed(
  settings: AppSettings,
  getDb: () => DatabaseSync,
  options?: AgentVaultCheckGateOptions,
): void {
  if (settings.ai?.enabled === false) {
    throw new Error(AI_DISABLED_MESSAGE);
  }
  if (settings.agents?.writingAssistant?.enabled !== true) {
    throw new Error(WRITING_COACH_DISABLED_MESSAGE);
  }
  if (!settings.agents?.archive?.enabled) {
    throw new Error(ARCHIVE_AGENT_DISABLED_MESSAGE);
  }
  const budgetCheck = checkCallBudget(
    VAULT_CHECK_BUDGET_LOG_AGENT,
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
