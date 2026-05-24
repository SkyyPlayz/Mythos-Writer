/**
 * suggestions.test.ts  (MYT-311)
 *
 * Agent API contract: suggestion payload schema, apply/reject logic, auto-apply policy.
 *
 * Strategy: we test the DB layer + policy engine directly (no Electron imports).
 * The IPC handlers in main.ts delegate entirely to these modules, so this gives
 * full contract coverage without needing a running Electron process.
 *
 * Coverage:
 *   §1  Payload schema — SuggestionRow field contract
 *   §2  Status transitions — proposed → accepted / applied / rejected / rolled_back
 *   §3  Audit log — every transition writes one row with correct action + actor
 *   §4  Auto-apply policy — evaluateAutoApply gate + daily token cap (new in Phase 3)
 *   §5  Budget enforcement — suggestion count cap, hourly token cap, daily token cap
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openDb,
  closeDb,
  upsertSuggestion,
  updateSuggestionStatus,
  updateSuggestionBudgetExceeded,
  getSuggestion,
  listSuggestions,
  insertAuditLog,
  listAuditLog,
  insertGenerationLog,
  type DbSuggestion,
  type SuggestionStatus,
} from './db.js';
import { evaluateAutoApply, type AgentBudgetSettings } from './budget.js';
import type Database from 'better-sqlite3';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;

function makeSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  const id = overrides.id ?? `sug-${++_seq}`;
  return {
    id,
    source_agent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'test rationale',
    target_kind: null,
    target_path: null,
    target_anchor: null,
    payload_json: null,
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    ...overrides,
  };
}

function makeVaultSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  return makeSuggestion({
    target_kind: 'vault',
    target_path: 'brainstorm/Aragorn.md',
    payload_json: JSON.stringify({ content: '# Aragorn\n\nHero of the North.' }),
    ...overrides,
  });
}

function makeManuscriptSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  return makeSuggestion({
    target_kind: 'manuscript',
    target_path: 'Chapter 1/Scene 1.md',
    target_anchor: '…rode into battle…',
    payload_json: JSON.stringify({
      type: 'inconsistency',
      entityName: 'Gandalf',
      propKey: 'hair',
      vaultValue: 'grey',
      scenePhrase: 'black hair',
    }),
    ...overrides,
  });
}

const BASE_POLICY: AgentBudgetSettings = {
  autoApply: true,
  confidenceThreshold: 0.8,
  maxSuggestionsPerHour: 10,
  maxTokensPerHour: 5_000,
  maxTokensPerDay: 20_000,
};

function makeAuditEntry(
  overrides: { suggestion_id: string; action: 'accept' | 'apply' | 'reject' | 'rollback'; actor?: string } & Partial<Parameters<typeof insertAuditLog>[0]>,
) {
  return {
    id: `audit-${++_seq}`,
    snapshot_path: null,
    actor: 'user',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

describe('Suggestion payload schema (§1)', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-schema-'));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a minimal (non-vault) suggestion through SQLite unchanged', () => {
    const s = makeSuggestion({ id: 'schema-1', confidence: 0.75, rationale: 'prose improvement' });
    upsertSuggestion(s);
    const got = getSuggestion('schema-1');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('schema-1');
    expect(got!.source_agent).toBe('writing-assistant');
    expect(got!.confidence).toBe(0.75);
    expect(got!.rationale).toBe('prose improvement');
    expect(got!.status).toBe('proposed');
    expect(got!.budget_exceeded).toBe(0);
    expect(got!.target_kind).toBeNull();
  });

  it('round-trips a vault suggestion with payload_json', () => {
    const s = makeVaultSuggestion({ id: 'schema-v1' });
    upsertSuggestion(s);
    const got = getSuggestion('schema-v1');
    expect(got!.target_kind).toBe('vault');
    expect(got!.target_path).toBe('brainstorm/Aragorn.md');
    const payload = JSON.parse(got!.payload_json!) as { content: string };
    expect(payload.content).toContain('Aragorn');
  });

  it('round-trips a manuscript suggestion with target_anchor', () => {
    const s = makeManuscriptSuggestion({ id: 'schema-m1' });
    upsertSuggestion(s);
    const got = getSuggestion('schema-m1');
    expect(got!.target_kind).toBe('manuscript');
    expect(got!.target_anchor).toBe('…rode into battle…');
  });

  it('upsert with same id overwrites the row', () => {
    const s = makeSuggestion({ id: 'schema-2', rationale: 'original' });
    upsertSuggestion(s);
    upsertSuggestion({ ...s, rationale: 'updated' });
    expect(getSuggestion('schema-2')!.rationale).toBe('updated');
  });
});

// ─── Status transitions (§2) ──────────────────────────────────────────────────

describe('Status transitions (§2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-status-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('proposed → accepted (non-vault accept)', () => {
    const s = makeSuggestion({ id: 'st-1' });
    upsertSuggestion(s);
    updateSuggestionStatus('st-1', 'accepted');
    expect(getSuggestion('st-1')!.status).toBe('accepted');
  });

  it('proposed → applied (vault apply)', () => {
    const s = makeVaultSuggestion({ id: 'st-2' });
    upsertSuggestion(s);
    const now = new Date().toISOString();
    updateSuggestionStatus('st-2', 'applied', now, 'run-abc');
    const got = getSuggestion('st-2')!;
    expect(got.status).toBe('applied');
    expect(got.applied_at).toBe(now);
    expect(got.applied_run_id).toBe('run-abc');
  });

  it('proposed → rejected', () => {
    const s = makeSuggestion({ id: 'st-3' });
    upsertSuggestion(s);
    updateSuggestionStatus('st-3', 'rejected');
    expect(getSuggestion('st-3')!.status).toBe('rejected');
  });

  it('applied → rolled_back', () => {
    const s = makeVaultSuggestion({ id: 'st-4' });
    upsertSuggestion(s);
    updateSuggestionStatus('st-4', 'applied', new Date().toISOString());
    updateSuggestionStatus('st-4', 'rolled_back');
    expect(getSuggestion('st-4')!.status).toBe('rolled_back');
  });

  it('listSuggestions filters by status', () => {
    upsertSuggestion(makeSuggestion({ id: 'ls-1', status: 'proposed' }));
    upsertSuggestion(makeSuggestion({ id: 'ls-2', status: 'proposed' }));
    const s3 = makeSuggestion({ id: 'ls-3' });
    upsertSuggestion(s3);
    updateSuggestionStatus('ls-3', 'rejected');

    const proposed = listSuggestions('proposed');
    const rejected = listSuggestions('rejected');
    expect(proposed.map((s) => s.id)).toContain('ls-1');
    expect(proposed.map((s) => s.id)).toContain('ls-2');
    expect(proposed.map((s) => s.id)).not.toContain('ls-3');
    expect(rejected.map((s) => s.id)).toContain('ls-3');
  });

  it('listSuggestions filters by source_agent', () => {
    upsertSuggestion(makeSuggestion({ id: 'ag-1', source_agent: 'writing-assistant' }));
    upsertSuggestion(makeSuggestion({ id: 'ag-2', source_agent: 'brainstorm' }));

    const waList = listSuggestions(undefined, 'writing-assistant');
    const bsList = listSuggestions(undefined, 'brainstorm');
    expect(waList.map((s) => s.id)).toContain('ag-1');
    expect(waList.map((s) => s.id)).not.toContain('ag-2');
    expect(bsList.map((s) => s.id)).toContain('ag-2');
  });
});

// ─── Audit log (§3) ───────────────────────────────────────────────────────────

describe('Audit log (§3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-audit-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accept writes an audit row with action=accept and actor=user', () => {
    const s = makeSuggestion({ id: 'au-1' });
    upsertSuggestion(s);
    updateSuggestionStatus('au-1', 'accepted');
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-1', action: 'accept', actor: 'user' }));

    const entries = listAuditLog('au-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('accept');
    expect(entries[0].actor).toBe('user');
    expect(entries[0].snapshot_path).toBeNull();
  });

  it('apply writes an audit row with action=apply and snapshot_path set', () => {
    const s = makeVaultSuggestion({ id: 'au-2' });
    upsertSuggestion(s);
    updateSuggestionStatus('au-2', 'applied', new Date().toISOString());
    insertAuditLog(makeAuditEntry({
      suggestion_id: 'au-2',
      action: 'apply',
      snapshot_path: '.mythos/suggestion-snapshots/au-2.json',
    }));

    const entries = listAuditLog('au-2');
    expect(entries[0].action).toBe('apply');
    expect(entries[0].snapshot_path).toBe('.mythos/suggestion-snapshots/au-2.json');
  });

  it('reject writes an audit row with action=reject', () => {
    const s = makeSuggestion({ id: 'au-3' });
    upsertSuggestion(s);
    updateSuggestionStatus('au-3', 'rejected');
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-3', action: 'reject' }));

    const entries = listAuditLog('au-3');
    expect(entries[0].action).toBe('reject');
  });

  it('auto_applied actor is recorded correctly', () => {
    const s = makeSuggestion({ id: 'au-4' });
    upsertSuggestion(s);
    updateSuggestionStatus('au-4', 'accepted', new Date().toISOString(), 'auto-apply');
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-4', action: 'accept', actor: 'auto_applied' }));

    const entries = listAuditLog('au-4');
    expect(entries[0].actor).toBe('auto_applied');
  });

  it('rollback writes an audit row with action=rollback', () => {
    const s = makeVaultSuggestion({ id: 'au-5' });
    upsertSuggestion(s);
    updateSuggestionStatus('au-5', 'applied', new Date().toISOString());
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-5', action: 'apply' }));
    updateSuggestionStatus('au-5', 'rolled_back');
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-5', action: 'rollback' }));

    const entries = listAuditLog('au-5');
    expect(entries).toHaveLength(2);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('apply');
    expect(actions).toContain('rollback');
  });

  it('listAuditLog without filter returns all entries', () => {
    upsertSuggestion(makeSuggestion({ id: 'au-all-1' }));
    upsertSuggestion(makeSuggestion({ id: 'au-all-2' }));
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-all-1', action: 'accept' }));
    insertAuditLog(makeAuditEntry({ suggestion_id: 'au-all-2', action: 'reject' }));

    const all = listAuditLog();
    const ids = all.map((e) => e.suggestion_id);
    expect(ids).toContain('au-all-1');
    expect(ids).toContain('au-all-2');
  });
});

// ─── Auto-apply policy (§4) ───────────────────────────────────────────────────

describe('Auto-apply policy (§4)', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-policy-'));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not auto-apply when autoApply=false regardless of confidence', () => {
    const result = evaluateAutoApply(0.99, 'archive', { ...BASE_POLICY, autoApply: false }, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('does not auto-apply when confidence < threshold', () => {
    const result = evaluateAutoApply(0.5, 'archive', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('auto-applies when confidence equals threshold (>= is inclusive)', () => {
    const result = evaluateAutoApply(0.8, 'archive', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(true);
  });

  it('auto-applies when all checks pass', () => {
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(true);
    expect(result.budgetExceeded).toBe(false);
  });

  it('blocks and sets budgetExceeded when hourly suggestion count is at cap', () => {
    for (let i = 0; i < BASE_POLICY.maxSuggestionsPerHour; i++) {
      upsertSuggestion(makeSuggestion({ source_agent: 'writing-assistant' }));
    }
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('blocks and sets budgetExceeded when hourly token count is at cap', () => {
    insertGenerationLog({
      id: 'gen-h1',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages',
      request_id: null,
      tokens_in: BASE_POLICY.maxTokensPerHour,
      tokens_out: 1,
      latency_ms: 100,
      error: null,
      created_at: new Date().toISOString(),
      payload_digest: null,
      prompt_text: null,
      response_text: null,
    });
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('blocks and sets budgetExceeded when daily token count is at cap (Phase 3 check)', () => {
    // Push tokens into the daily window but outside the hourly window
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    insertGenerationLog({
      id: 'gen-d1',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages',
      request_id: null,
      tokens_in: BASE_POLICY.maxTokensPerDay,
      tokens_out: 1,
      latency_ms: 100,
      error: null,
      created_at: twoHoursAgo,
      payload_digest: null,
      prompt_text: null,
      response_text: null,
    });
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('does not block on daily cap tokens from a different agent', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    insertGenerationLog({
      id: 'gen-d2',
      agent: 'brainstorm',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages',
      request_id: null,
      tokens_in: BASE_POLICY.maxTokensPerDay,
      tokens_out: 1,
      latency_ms: 100,
      error: null,
      created_at: twoHoursAgo,
      payload_digest: null,
      prompt_text: null,
      response_text: null,
    });
    // writing-assistant has no tokens — daily cap should be clear
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(true);
  });

  it('daily cap resets once tokens fall outside 24-hour window', () => {
    const twoDaysAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    insertGenerationLog({
      id: 'gen-d3',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages',
      request_id: null,
      tokens_in: BASE_POLICY.maxTokensPerDay,
      tokens_out: 1,
      latency_ms: 100,
      error: null,
      created_at: twoDaysAgo,
      payload_digest: null,
      prompt_text: null,
      response_text: null,
    });
    const result = evaluateAutoApply(0.95, 'writing-assistant', BASE_POLICY, db);
    expect(result.shouldAutoApply).toBe(true);
  });
});

// ─── Budget flag on suggestion row (§5) ───────────────────────────────────────

describe('Budget enforcement flag (§5)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-budget-flag-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('budget_exceeded defaults to 0 on insert', () => {
    const s = makeSuggestion({ id: 'bf-1' });
    upsertSuggestion(s);
    expect(getSuggestion('bf-1')!.budget_exceeded).toBe(0);
  });

  it('updateSuggestionBudgetExceeded sets the flag to 1', () => {
    const s = makeSuggestion({ id: 'bf-2' });
    upsertSuggestion(s);
    updateSuggestionBudgetExceeded('bf-2', true);
    expect(getSuggestion('bf-2')!.budget_exceeded).toBe(1);
  });

  it('updateSuggestionBudgetExceeded clears the flag back to 0', () => {
    const s = makeSuggestion({ id: 'bf-3', budget_exceeded: 1 });
    upsertSuggestion(s);
    updateSuggestionBudgetExceeded('bf-3', false);
    expect(getSuggestion('bf-3')!.budget_exceeded).toBe(0);
  });

  it('budget_exceeded flag does not change the suggestion status', () => {
    const s = makeSuggestion({ id: 'bf-4' });
    upsertSuggestion(s);
    updateSuggestionBudgetExceeded('bf-4', true);
    expect(getSuggestion('bf-4')!.status).toBe('proposed');
  });
});
