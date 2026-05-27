/**
 * agentConfig.test.ts (MYT-343)
 *
 * Unit tests for per-agent settings enforcement:
 *   §1  assertAgentEnabled — throws on disabled, passes on enabled
 *   §2  requestsPerMinute cap — checkCallBudget blocks when over limit
 *   §3  enforceSuggestionBudget — drops on exhausted daily budget, keeps below threshold
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, insertGenerationLog } from './db.js';
import {
  assertAgentEnabled,
  checkCallBudget,
  enforceSuggestionBudget,
} from './budget.js';
import type Database from 'better-sqlite3';

let tmpDir: string;
let db: Database.Database;

function makeGenLog(agent: string, tokens_in: number, createdAt: string, id?: string) {
  insertGenerationLog({
    id: id ?? `gen-${Math.random().toString(36).slice(2)}`,
    agent,
    model: 'claude-haiku-4-5-20251001',
    endpoint: 'messages',
    request_id: null,
    tokens_in,
    tokens_out: 0,
    latency_ms: 100,
    error: null,
    created_at: createdAt,
    payload_digest: null,
    prompt_text: null,
    response_text: null,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-agentcfg-'));
  db = openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── §1 assertAgentEnabled ────────────────────────────────────────────────────

describe('assertAgentEnabled (§1)', () => {
  it('passes when enabled=true', () => {
    expect(() => assertAgentEnabled('writingAssistant', true)).not.toThrow();
  });

  it('throws when enabled=false', () => {
    expect(() => assertAgentEnabled('brainstorm', false)).toThrow(
      /brainstorm.*disabled/i,
    );
  });

  it('error message names the agent', () => {
    expect(() => assertAgentEnabled('archive', false)).toThrow(/archive/i);
  });
});

// ─── §2 requestsPerMinute cap ─────────────────────────────────────────────────

describe('checkCallBudget requestsPerMinute (§2)', () => {
  const BASE = { maxTokensPerHour: 1_000_000, maxTokensPerDay: 10_000_000 };

  it('allows when no requests have been made', () => {
    const result = checkCallBudget('writing-assistant', { ...BASE, requestsPerMinute: 5 }, db);
    expect(result.allowed).toBe(true);
  });

  it('blocks when requests in last minute equals the cap', () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) makeGenLog('writing-assistant', 10, now);
    const result = checkCallBudget('writing-assistant', { ...BASE, requestsPerMinute: 3 }, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('requests_per_minute_cap');
  });

  it('does not count requests older than 1 minute', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) makeGenLog('writing-assistant', 10, twoMinutesAgo);
    const result = checkCallBudget('writing-assistant', { ...BASE, requestsPerMinute: 5 }, db);
    expect(result.allowed).toBe(true);
  });

  it('does not count requests from a different agent', () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 10; i++) makeGenLog('brainstorm', 10, now);
    const result = checkCallBudget('writing-assistant', { ...BASE, requestsPerMinute: 5 }, db);
    expect(result.allowed).toBe(true);
  });

  it('falls through to hourly cap when requestsPerMinute is not set', () => {
    const now = new Date().toISOString();
    makeGenLog('archive', 1_000_001, now);
    const result = checkCallBudget('archive', { maxTokensPerHour: 1_000_000, maxTokensPerDay: 10_000_000 }, db);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_token_cap');
  });
});

// ─── §3 enforceSuggestionBudget ───────────────────────────────────────────────

describe('enforceSuggestionBudget (§3)', () => {
  it('allows suggestion when budget is clear and confidence >= threshold', () => {
    const result = enforceSuggestionBudget(0.9, 'writing-assistant', 0.85, 500_000, db);
    expect(result.drop).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('allows suggestion (keeps proposed) when confidence < threshold', () => {
    const result = enforceSuggestionBudget(0.7, 'writing-assistant', 0.85, 500_000, db);
    expect(result.drop).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it('drops suggestion when daily token budget is exhausted', () => {
    // Insert tokens beyond the daily budget (but outside 1-hour window)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    makeGenLog('archive', 500_001, twoHoursAgo);
    const result = enforceSuggestionBudget(0.95, 'archive', 0.85, 500_000, db);
    expect(result.drop).toBe(true);
    expect(result.budgetExceeded).toBe(true);
  });

  it('does not drop tokens attributed to a different agent', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    makeGenLog('brainstorm', 999_999, twoHoursAgo);
    const result = enforceSuggestionBudget(0.95, 'writing-assistant', 0.85, 500_000, db);
    expect(result.drop).toBe(false);
  });

  it('daily budget resets once tokens fall outside 24-hour window', () => {
    const twoDaysAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    makeGenLog('writing-assistant', 999_999, twoDaysAgo);
    const result = enforceSuggestionBudget(0.95, 'writing-assistant', 0.85, 500_000, db);
    expect(result.drop).toBe(false);
  });
});
