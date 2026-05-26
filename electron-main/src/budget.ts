// Auto-apply policy enforcement and rolling window budget tracking.
// Pure logic — no Electron imports, no module-level state; fully testable.

import type Database from 'better-sqlite3';
import { countSuggestionsInWindow, countTokensInWindow } from './db.js';

export interface AgentBudgetSettings {
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  maxTokensPerDay: number;
}

export interface AutoApplyResult {
  shouldAutoApply: boolean;
  budgetExceeded: boolean;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Evaluate whether a suggestion with the given confidence from sourceAgent
 * should be auto-applied, given the agent's policy settings and current DB state.
 *
 * Rules (in evaluation order):
 * 1. autoApply must be true — otherwise stay proposed, no budget check.
 * 2. confidence must be >= confidenceThreshold — otherwise stay proposed.
 * 3. Budget must not be exhausted — otherwise mark budgetExceeded and stay proposed.
 *    Checks: hourly suggestion count, hourly token count, daily token count.
 * 4. All checks pass → auto-apply.
 */
export function evaluateAutoApply(
  confidence: number,
  sourceAgent: string,
  settings: AgentBudgetSettings,
  db: Database.Database,
): AutoApplyResult {
  if (!settings.autoApply) {
    return { shouldAutoApply: false, budgetExceeded: false };
  }

  if (confidence < settings.confidenceThreshold) {
    return { shouldAutoApply: false, budgetExceeded: false };
  }

  const suggestionCount = countSuggestionsInWindowWithDb(db, sourceAgent, ONE_HOUR_MS);
  if (suggestionCount >= settings.maxSuggestionsPerHour) {
    return { shouldAutoApply: false, budgetExceeded: true };
  }

  const hourlyTokens = countTokensInWindowWithDb(db, sourceAgent, ONE_HOUR_MS);
  if (hourlyTokens >= settings.maxTokensPerHour) {
    return { shouldAutoApply: false, budgetExceeded: true };
  }

  const dailyTokens = countTokensInWindowWithDb(db, sourceAgent, ONE_DAY_MS);
  if (dailyTokens >= settings.maxTokensPerDay) {
    return { shouldAutoApply: false, budgetExceeded: true };
  }

  return { shouldAutoApply: true, budgetExceeded: false };
}

// Thin wrappers that accept db directly — used by tests and by the IPC handler.
// This avoids coupling budget.ts to the module-level _db singleton.

function countSuggestionsInWindowWithDb(
  db: Database.Database,
  sourceAgent: string,
  windowMs: number,
): number {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM suggestions WHERE source_agent = ? AND created_at >= ?`)
    .get(sourceAgent, windowStart) as { cnt: number };
  return row.cnt;
}

function countTokensInWindowWithDb(
  db: Database.Database,
  agent: string,
  windowMs: number,
): number {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)),0) as total
         FROM generation_log WHERE agent = ? AND created_at >= ?`,
    )
    .get(agent, windowStart) as { total: number };
  return row.total;
}

export interface CallBudgetResult {
  allowed: boolean;
  reason?: 'hourly_token_cap' | 'daily_token_cap' | 'requests_per_minute_cap';
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/**
 * Check whether an agent is allowed to make an Anthropic API call right now.
 * Called at the call site, before streaming starts.
 * Checks rolling 1-hour, 24-hour token windows, and per-minute request count.
 */
export function checkCallBudget(
  agent: string,
  settings: Pick<AgentBudgetSettings, 'maxTokensPerHour' | 'maxTokensPerDay'> & { requestsPerMinute?: number },
  db: Database.Database,
): CallBudgetResult {
  if (settings.requestsPerMinute !== undefined) {
    const recentRequests = countRequestsInWindowWithDb(db, agent, ONE_MINUTE_MS);
    if (recentRequests >= settings.requestsPerMinute) {
      return { allowed: false, reason: 'requests_per_minute_cap' };
    }
  }

  const hourlyTokens = countTokensInWindowWithDb(db, agent, ONE_HOUR_MS);
  if (hourlyTokens >= settings.maxTokensPerHour) {
    return { allowed: false, reason: 'hourly_token_cap' };
  }

  const dailyTokens = countTokensInWindowWithDb(db, agent, ONE_DAY_MS);
  if (dailyTokens >= settings.maxTokensPerDay) {
    return { allowed: false, reason: 'daily_token_cap' };
  }

  return { allowed: true };
}

/**
 * Throw if the agent is disabled in per-agent config.
 * Call this before any agent invocation so callers surface a clear error.
 */
export function assertAgentEnabled(agentName: string, enabled: boolean): void {
  if (!enabled) {
    throw new Error(`Agent "${agentName}" is disabled. Enable it in Settings > Agents to proceed.`);
  }
}

function countRequestsInWindowWithDb(
  db: Database.Database,
  agent: string,
  windowMs: number,
): number {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM generation_log WHERE agent = ? AND created_at >= ?`)
    .get(agent, windowStart) as { cnt: number };
  return row.cnt;
}

/**
 * Evaluate whether a proposed suggestion should be dropped (budget exceeded)
 * or downgraded (kept proposed) based on the autoApplyThreshold and daily budget.
 * Returns { drop: true } when the daily token budget is fully exhausted and the
 * suggestion should be silently discarded. Returns { drop: false, budgetExceeded }
 * otherwise so callers can mark the row and keep it proposed.
 */
export interface SuggestionEnforcementResult {
  drop: boolean;
  budgetExceeded: boolean;
}

export function enforceSuggestionBudget(
  confidence: number,
  sourceAgent: string,
  autoApplyThreshold: number,
  tokensPerDay: number,
  db: Database.Database,
): SuggestionEnforcementResult {
  const dailyTokens = countTokensInWindowWithDb(db, sourceAgent, ONE_DAY_MS);
  if (dailyTokens >= tokensPerDay) {
    // Daily budget exhausted — drop the suggestion entirely
    return { drop: true, budgetExceeded: true };
  }

  const aboveThreshold = confidence >= autoApplyThreshold;
  // Below threshold → keep proposed without budget penalty
  if (!aboveThreshold) return { drop: false, budgetExceeded: false };

  return { drop: false, budgetExceeded: false };
}

// Re-export the db-module helpers so callers don't need two imports.
export { countSuggestionsInWindow, countTokensInWindow };
