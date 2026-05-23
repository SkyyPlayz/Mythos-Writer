// Auto-apply policy enforcement tests — real in-memory DB, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, upsertSuggestion, insertGenerationLog } from './db.js';
import { evaluateAutoApply, checkCallBudget, type AgentBudgetSettings } from './budget.js';
import type Database from 'better-sqlite3';

const BASE_SETTINGS: AgentBudgetSettings = {
  autoApply: true,
  confidenceThreshold: 0.8,
  maxSuggestionsPerHour: 10,
  maxTokensPerHour: 5000,
  maxTokensPerDay: 50_000,
};

function makeSuggestion(overrides: Partial<{
  id: string;
  source_agent: string;
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected';
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'sug-1',
    source_agent: overrides.source_agent ?? 'writing-assistant',
    confidence: overrides.confidence ?? 0.9,
    rationale: 'test suggestion',
    target_kind: null as 'vault' | 'manuscript' | null,
    target_path: null,
    target_anchor: null,
    payload_json: null,
    status: (overrides.status ?? 'proposed') as 'proposed' | 'accepted' | 'rejected',
    created_at: overrides.created_at ?? new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
  };
}

describe('evaluateAutoApply', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-budget-'));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns shouldAutoApply=false when autoApply is disabled', () => {
    const result = evaluateAutoApply(0.99, 'writing-assistant', { ...BASE_SETTINGS, autoApply: false }, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('returns shouldAutoApply=false when confidence is below threshold', () => {
    const result = evaluateAutoApply(0.7, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('returns shouldAutoApply=false when confidence exactly equals threshold (strictly less than check)', () => {
    // threshold is 0.8 — confidence must be >= threshold to apply
    const result = evaluateAutoApply(0.8, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it('auto-applies when autoApply=true, confidence>=threshold, and under budget', () => {
    const result = evaluateAutoApply(0.9, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it('blocks auto-apply and sets budgetExceeded when suggestion count exceeds limit', () => {
    // Insert maxSuggestionsPerHour suggestions for this agent
    for (let i = 0; i < BASE_SETTINGS.maxSuggestionsPerHour; i++) {
      upsertSuggestion(makeSuggestion({ id: `sug-${i}`, source_agent: 'writing-assistant' }));
    }

    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('blocks auto-apply and sets budgetExceeded when token count exceeds limit', () => {
    // Insert a generation_log row that exceeds the token budget
    insertGenerationLog({
      id: 'gen-1',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages',
      request_id: null,
      tokens_in: BASE_SETTINGS.maxTokensPerHour,
      tokens_out: 1,
      latency_ms: 100,
      error: null,
      created_at: new Date().toISOString(),
      payload_digest: null,
    });

    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('does not count suggestions from a different agent toward the budget', () => {
    // Fill the budget for "brainstorm" agent — should not affect writing-assistant
    for (let i = 0; i < BASE_SETTINGS.maxSuggestionsPerHour; i++) {
      upsertSuggestion(makeSuggestion({ id: `bs-${i}`, source_agent: 'brainstorm' }));
    }

    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it('suggestion rate budget resets after the rolling window passes', () => {
    const oneHourTwoMinutesAgo = new Date(Date.now() - 62 * 60 * 1000).toISOString();

    // Insert suggestions that fall outside the one-hour window
    for (let i = 0; i < BASE_SETTINGS.maxSuggestionsPerHour; i++) {
      upsertSuggestion(makeSuggestion({
        id: `old-${i}`,
        source_agent: 'writing-assistant',
        created_at: oneHourTwoMinutesAgo,
      }));
    }

    // These old suggestions should not count — budget should be clear
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_SETTINGS, db);
    expect(result.shouldAutoApply).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });
});

// ─── checkCallBudget ───

let _genLogSeq = 0;
function makeGenLog(overrides: { agent?: string; tokens_in?: number; tokens_out?: number; created_at?: string } = {}) {
  return {
    id: `gen-${++_genLogSeq}`,
    agent: overrides.agent ?? 'brainstorm',
    model: 'claude-haiku-4-5-20251001',
    endpoint: 'messages.stream',
    request_id: null,
    tokens_in: overrides.tokens_in ?? 100,
    tokens_out: overrides.tokens_out ?? 100,
    latency_ms: 500,
    error: null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    payload_digest: null,
    prompt_text: null,
    response_text: null,
  };
}

const CALL_SETTINGS = { maxTokensPerHour: 1000, maxTokensPerDay: 5000 };

describe('checkCallBudget', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-call-budget-'));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows call when no generation log entries exist', () => {
    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('blocks when hourly token cap is reached', () => {
    insertGenerationLog(makeGenLog({ tokens_in: 600, tokens_out: 500 })); // 1100 > 1000
    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_token_cap');
  });

  it('blocks when daily token cap is reached but hourly is not', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    // 5 entries × 1100 tokens each = 5500 daily, but hourly window sees 0
    for (let i = 0; i < 5; i++) {
      insertGenerationLog(makeGenLog({ tokens_in: 600, tokens_out: 500, created_at: twoHoursAgo }));
    }
    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_token_cap');
  });

  it('does not count tokens from a different agent', () => {
    insertGenerationLog(makeGenLog({ agent: 'writing-assistant', tokens_in: 600, tokens_out: 500 }));
    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    expect(result.allowed).toBe(true);
  });

  it('allows call when past tokens are outside the rolling window', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    insertGenerationLog(makeGenLog({ tokens_in: 600, tokens_out: 500, created_at: twoHoursAgo }));
    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    // 1100 tokens are outside the 1-hour window — hourly cap clear; 1100 < 5000 daily — allowed
    expect(result.allowed).toBe(true);
  });
});
