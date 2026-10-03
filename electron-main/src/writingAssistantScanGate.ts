import type { DatabaseSync } from 'node:sqlite';
import type { AppSettings } from './ipc.js';
import { checkCallBudget } from './budget.js';
import { AI_DISABLED_MESSAGE } from './provider.js';

const WRITING_COACH_DISABLED_MESSAGE = 'Writing Coach is disabled in settings.';

function budgetCapMessage(reason: 'hourly_token_cap' | 'daily_token_cap' | 'requests_per_minute_cap'): string {
  const capLabel =
    reason === 'daily_token_cap'
      ? 'daily token cap'
      : reason === 'requests_per_minute_cap'
        ? 'per-minute request cap'
        : 'hourly token cap';
  return `Writing Coach paused: ${capLabel} reached. Try again next window.`;
}

/**
 * Refuse manual Writing Assistant scans when AI is off, the coach is off, or the budget is spent.
 * Pure and Electron-free; `getDb` is only invoked after both switch checks succeed.
 */
export function assertWritingAssistantScanAllowed(
  settings: AppSettings,
  getDb: () => DatabaseSync,
): void {
  if (settings.ai?.enabled === false) {
    throw new Error(AI_DISABLED_MESSAGE);
  }
  if (settings.agents?.writingAssistant?.enabled !== true) {
    throw new Error(WRITING_COACH_DISABLED_MESSAGE);
  }
  const budgetCheck = checkCallBudget('writing-assistant', settings.agents.writingAssistant, getDb());
  if (!budgetCheck.allowed) {
    throw new Error(budgetCapMessage(budgetCheck.reason ?? 'hourly_token_cap'));
  }
}
