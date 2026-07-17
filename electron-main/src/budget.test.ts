// Auto-apply policy enforcement tests — real in-memory DB, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, upsertSuggestion, insertGenerationLog, pruneGenerationLog } from './db.js';
import { evaluateAutoApply, checkCallBudget, HARD_EXCLUDED_PAYLOAD_KINDS, type AgentBudgetSettings } from './budget.js';
import type { DatabaseSync } from 'node:sqlite';

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
    category: null,
  };
}

describe('evaluateAutoApply', () => {
  let tmpDir: string;
  let db: DatabaseSync;

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

  // ─── SKY-908 — per-category gating ───

  it('auto-applies every category when autoApplyCategories is undefined (back-compat)', () => {
    for (const category of ['punctuation', 'spelling', 'grammar', 'sentence-structure', 'style-tone', 'other'] as const) {
      const result = evaluateAutoApply(0.9, 'writing-assistant', BASE_SETTINGS, db, category);
      expect(result.shouldAutoApply).toBe(true);
    }
  });

  it('blocks auto-apply when the suggestion category is disabled in the map', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        'punctuation': true,
        'spelling': false,
        'grammar': true,
        'sentence-structure': true,
        'style-tone': true,
        'other': true,
      },
    };
    const result = evaluateAutoApply(0.95, 'writing-assistant', settings, db, 'spelling');
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('still auto-applies an enabled category when other categories are disabled', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        'punctuation': true,
        'spelling': false,
        'grammar': false,
        'sentence-structure': false,
        'style-tone': false,
        'other': false,
      },
    };
    const result = evaluateAutoApply(0.95, 'writing-assistant', settings, db, 'punctuation');
    expect(result.shouldAutoApply).toBe(true);
  });

  it('honours the master autoApply kill-switch even when every category is enabled', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApply: false,
      autoApplyCategories: {
        'punctuation': true, 'spelling': true, 'grammar': true,
        'sentence-structure': true, 'style-tone': true, 'other': true,
      },
    };
    const result = evaluateAutoApply(0.99, 'writing-assistant', settings, db, 'punctuation');
    expect(result.shouldAutoApply).toBe(false);
  });

  it('treats missing keys in an explicit map as enabled (forward-compat)', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        'punctuation': true,
        'spelling': true,
        'grammar': true,
        'sentence-structure': true,
        // 'style-tone' omitted
        'other': true,
      },
    };
    const result = evaluateAutoApply(0.95, 'writing-assistant', settings, db, 'style-tone');
    expect(result.shouldAutoApply).toBe(true);
  });

  it('coerces null/undefined category to "other" and honours the "other" toggle', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        'punctuation': true, 'spelling': true, 'grammar': true,
        'sentence-structure': true, 'style-tone': true,
        'other': false,
      },
    };
    expect(evaluateAutoApply(0.95, 'writing-assistant', settings, db, null).shouldAutoApply).toBe(false);
    expect(evaluateAutoApply(0.95, 'writing-assistant', settings, db).shouldAutoApply).toBe(false);
  });

  it('coerces an unknown category string to "other"', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        'punctuation': true, 'spelling': true, 'grammar': true,
        'sentence-structure': true, 'style-tone': true,
        'other': false,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = evaluateAutoApply(0.95, 'writing-assistant', settings, db, 'no-such-cat' as any);
    expect(result.shouldAutoApply).toBe(false);
  });

  // ─── Beta 4 M28 (B4-8) — per-category certainty thresholds ───

  it('B4-8: uses the per-category threshold when set (below → stays proposed)', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS, // confidenceThreshold 0.8
      autoApplyThresholds: { grammar: 0.95 },
    };
    // 0.9 clears the agent-wide 0.8 but not grammar's 0.95 → inbox.
    const below = evaluateAutoApply(0.9, 'writing-assistant', settings, db, 'grammar');
    expect(below.shouldAutoApply).toBe(false);
    expect(below.budgetExceeded).toBe(false);
    // At/above the per-category threshold → auto-apply.
    const at = evaluateAutoApply(0.95, 'writing-assistant', settings, db, 'grammar');
    expect(at.shouldAutoApply).toBe(true);
  });

  it('B4-8: a lower per-category threshold can admit what the global would block', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS, // confidenceThreshold 0.8
      autoApplyThresholds: { spelling: 0.5 },
    };
    const result = evaluateAutoApply(0.6, 'writing-assistant', settings, db, 'spelling');
    expect(result.shouldAutoApply).toBe(true);
  });

  it('B4-8: categories without an explicit threshold fall back to confidenceThreshold', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyThresholds: { grammar: 0.95 },
    };
    // 'style-tone' has no explicit threshold → global 0.8 applies.
    expect(evaluateAutoApply(0.85, 'writing-assistant', settings, db, 'style-tone').shouldAutoApply).toBe(true);
    expect(evaluateAutoApply(0.75, 'writing-assistant', settings, db, 'style-tone').shouldAutoApply).toBe(false);
  });

  it('B4-8: null/unknown categories coerce to "other" for threshold lookup', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyThresholds: { other: 0.99 },
    };
    expect(evaluateAutoApply(0.9, 'writing-assistant', settings, db, null).shouldAutoApply).toBe(false);
    expect(evaluateAutoApply(0.99, 'writing-assistant', settings, db, null).shouldAutoApply).toBe(true);
  });

  it('B4-8: a disabled category toggle still blocks regardless of thresholds', () => {
    const settings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        punctuation: true, spelling: false, grammar: true,
        'sentence-structure': true, 'style-tone': true, other: true,
      },
      autoApplyThresholds: { spelling: 0 },
    };
    const result = evaluateAutoApply(1.0, 'writing-assistant', settings, db, 'spelling');
    expect(result.shouldAutoApply).toBe(false);
  });

  // ─── [BUILD-GATE] scene_crafter_card hard-exclusion ───

  it('[BUILD-GATE] scene_crafter_card never auto-applies at confidence 1.0 with unlimited budget', () => {
    const unlimitedSettings: AgentBudgetSettings = {
      autoApply: true,
      confidenceThreshold: 0,
      maxSuggestionsPerHour: Number.MAX_SAFE_INTEGER,
      maxTokensPerHour: Number.MAX_SAFE_INTEGER,
      maxTokensPerDay: Number.MAX_SAFE_INTEGER,
    };
    const result = evaluateAutoApply(1.0, 'brainstorm', unlimitedSettings, db, null, 'scene_crafter_card');
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('[BUILD-GATE] scene_crafter_card blocked even with permissive per-category settings', () => {
    const permissiveSettings: AgentBudgetSettings = {
      ...BASE_SETTINGS,
      autoApplyCategories: {
        punctuation: true,
        spelling: true,
        grammar: true,
        'sentence-structure': true,
        'style-tone': true,
        other: true,
      },
    };
    const result = evaluateAutoApply(0.99, 'archive', permissiveSettings, db, 'other', 'scene_crafter_card');
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('[BUILD-GATE] HARD_EXCLUDED_PAYLOAD_KINDS contains scene_crafter_card', () => {
    expect(HARD_EXCLUDED_PAYLOAD_KINDS.has('scene_crafter_card')).toBe(true);
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
  let db: DatabaseSync;

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

// ─── Budget correctness after generation_log retention pruning (perf audit P2) ───

describe('checkCallBudget after pruneGenerationLog', () => {
  let tmpDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-call-budget-prune-'));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pruning rows older than 7 days does not change budget decisions', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    // Rows outside every budget window (minute / hour / day) — prunable.
    insertGenerationLog(makeGenLog({ tokens_in: 900_000, tokens_out: 0, created_at: tenDaysAgo }));
    insertGenerationLog(makeGenLog({ tokens_in: 900_000, tokens_out: 0, created_at: tenDaysAgo }));
    // Recent row inside all windows.
    insertGenerationLog(makeGenLog({ tokens_in: 300, tokens_out: 100 }));

    const settings = { ...CALL_SETTINGS, requestsPerMinute: 5 };
    const before = checkCallBudget('brainstorm', settings, db);

    const deleted = pruneGenerationLog(db, 7);
    expect(deleted).toBe(2);

    const after = checkCallBudget('brainstorm', settings, db);
    expect(after).toEqual(before);
    expect(after.allowed).toBe(true);
  });

  it('still blocks on hourly cap after pruning', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    insertGenerationLog(makeGenLog({ tokens_in: 1, tokens_out: 1, created_at: tenDaysAgo }));
    insertGenerationLog(makeGenLog({ tokens_in: 600, tokens_out: 500 })); // 1100 > 1000

    pruneGenerationLog(db, 7);

    const result = checkCallBudget('brainstorm', CALL_SETTINGS, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_token_cap');
  });
});
