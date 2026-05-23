// SQLite persistence layer tests — real DB in a temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  openDb,
  closeDb,
  upsertSuggestion,
  updateSuggestionStatus,
  listSuggestions,
  insertAuditLog,
  listAuditLog,
  upsertTimelineEntry,
  listTimelineEntries,
  insertGenerationLog,
  listGenerationLog,
} from './db.js';

function makeSuggestion(overrides: Partial<Parameters<typeof upsertSuggestion>[0]> = {}) {
  return {
    id: 'sug-1',
    source_agent: 'vault-agent',
    confidence: 0.9,
    rationale: 'Timeline mismatch',
    target_kind: null as 'vault' | 'manuscript' | null,
    target_path: 'scenes/scene-1.md',
    target_anchor: null,
    payload_json: null,
    status: 'proposed' as const,
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    ...overrides,
  };
}

// ─── Lifecycle ───

describe('DB lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates state.db under <vault>/.mythos/', () => {
    openDb(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.mythos', 'state.db'))).toBe(true);
  });

  it('openDb is idempotent — returns same instance for same vault', () => {
    const db1 = openDb(tmpDir);
    const db2 = openDb(tmpDir);
    expect(db1).toBe(db2);
  });

  it('closeDb can be called multiple times without error', () => {
    openDb(tmpDir);
    closeDb();
    expect(() => closeDb()).not.toThrow();
  });
});

// ─── Migrations ───

describe('migrations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets user_version to latest on first open', () => {
    const db = openDb(tmpDir);
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2);
  });

  it('migration is idempotent — re-open keeps user_version stable', () => {
    const db1 = openDb(tmpDir);
    const v1 = db1.pragma('user_version', { simple: true }) as number;
    closeDb();
    const db2 = openDb(tmpDir);
    expect(db2.pragma('user_version', { simple: true })).toBe(v1);
    expect(listSuggestions()).toEqual([]);
  });
});

// ─── Suggestions CRUD ───

describe('suggestions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and lists a suggestion', () => {
    upsertSuggestion(makeSuggestion());
    const rows = listSuggestions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sug-1');
    expect(rows[0].status).toBe('proposed');
  });

  it('filters by status', () => {
    const now = new Date().toISOString();
    upsertSuggestion(makeSuggestion({ id: 'sug-a', status: 'proposed' }));
    upsertSuggestion(makeSuggestion({ id: 'sug-b', status: 'accepted', applied_at: now, applied_run_id: 'run-1' }));
    expect(listSuggestions('proposed')).toHaveLength(1);
    expect(listSuggestions('accepted')).toHaveLength(1);
  });

  it('upsert replaces existing row', () => {
    upsertSuggestion(makeSuggestion({ confidence: 0.5 }));
    upsertSuggestion(makeSuggestion({ confidence: 0.99 }));
    const rows = listSuggestions();
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(0.99);
  });

  it('updateSuggestionStatus transitions to accepted', () => {
    const now = new Date().toISOString();
    upsertSuggestion(makeSuggestion());
    updateSuggestionStatus('sug-1', 'accepted', now, 'run-42');
    const [row] = listSuggestions('accepted');
    expect(row.status).toBe('accepted');
    expect(row.applied_at).toBe(now);
    expect(row.applied_run_id).toBe('run-42');
  });

  it('updateSuggestionStatus transitions to rejected', () => {
    upsertSuggestion(makeSuggestion());
    updateSuggestionStatus('sug-1', 'rejected');
    expect(listSuggestions('rejected')).toHaveLength(1);
    expect(listSuggestions('proposed')).toHaveLength(0);
  });
});

// ─── Audit log CRUD ───

describe('audit_log', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and lists an audit entry', () => {
    insertAuditLog({
      id: 'audit-1',
      suggestion_id: 'sug-1',
      action: 'apply',
      snapshot_path: '.mythos/snapshots/snap-1.json',
      actor: 'user',
      created_at: new Date().toISOString(),
    });
    const rows = listAuditLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('apply');
    expect(rows[0].snapshot_path).toBe('.mythos/snapshots/snap-1.json');
  });

  it('filters by suggestion_id', () => {
    const now = new Date().toISOString();
    insertAuditLog({ id: 'a1', suggestion_id: 'sug-1', action: 'apply', snapshot_path: null, actor: 'user', created_at: now });
    insertAuditLog({ id: 'a2', suggestion_id: 'sug-2', action: 'reject', snapshot_path: null, actor: 'user', created_at: now });
    expect(listAuditLog('sug-1')).toHaveLength(1);
    expect(listAuditLog('sug-1')[0].id).toBe('a1');
    expect(listAuditLog('sug-2')[0].id).toBe('a2');
  });

  it('stores null snapshot_path', () => {
    insertAuditLog({ id: 'a3', suggestion_id: 'sug-3', action: 'rollback', snapshot_path: null, actor: 'agent', created_at: new Date().toISOString() });
    expect(listAuditLog('sug-3')[0].snapshot_path).toBeNull();
  });
});

// ─── Timeline entries CRUD ───

describe('timeline_entries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and lists a timeline entry', () => {
    upsertTimelineEntry({
      id: 'tl-1',
      scene_path: 'scenes/scene-1.md',
      inferred_time: 'Year 1, Day 1',
      confidence: 0.95,
      source: 'explicit_marker',
      notes_json: null,
      created_at: new Date().toISOString(),
    });
    const rows = listTimelineEntries();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tl-1');
    expect(rows[0].source).toBe('explicit_marker');
  });

  it('filters by scene_path', () => {
    const now = new Date().toISOString();
    upsertTimelineEntry({ id: 'tl-a', scene_path: 'scenes/a.md', inferred_time: 'Day 1', confidence: 0.8, source: 'prose', notes_json: null, created_at: now });
    upsertTimelineEntry({ id: 'tl-b', scene_path: 'scenes/b.md', inferred_time: 'Day 2', confidence: 0.7, source: 'prose', notes_json: null, created_at: now });
    expect(listTimelineEntries('scenes/a.md')).toHaveLength(1);
    expect(listTimelineEntries('scenes/a.md')[0].id).toBe('tl-a');
  });

  it('upsert replaces existing entry', () => {
    const now = new Date().toISOString();
    upsertTimelineEntry({ id: 'tl-c', scene_path: 'scenes/c.md', inferred_time: 'Day 1', confidence: 0.7, source: 'prose', notes_json: null, created_at: now });
    upsertTimelineEntry({ id: 'tl-c', scene_path: 'scenes/c.md', inferred_time: 'Day 1', confidence: 0.9, source: 'explicit_marker', notes_json: '{"note":"updated"}', created_at: now });
    const rows = listTimelineEntries('scenes/c.md');
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(0.9);
    expect(rows[0].source).toBe('explicit_marker');
    expect(rows[0].notes_json).toBe('{"note":"updated"}');
  });
});

// ─── Generation log CRUD ───

describe('generation_log', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts a success row and reads it back', () => {
    insertGenerationLog({
      id: 'gen-1',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages.stream',
      request_id: null,
      tokens_in: 150,
      tokens_out: 200,
      latency_ms: 1234,
      error: null,
      created_at: new Date().toISOString(),
      payload_digest: 'abc123hash',
    });
    const rows = listGenerationLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe('writing-assistant');
    expect(rows[0].tokens_in).toBe(150);
    expect(rows[0].tokens_out).toBe(200);
    expect(rows[0].error).toBeNull();
  });

  it('records a row when stream is cancelled (tokens null)', () => {
    insertGenerationLog({
      id: 'gen-cancel',
      agent: 'brainstorm',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages.stream',
      request_id: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: 500,
      error: null,
      created_at: new Date().toISOString(),
      payload_digest: 'somehash',
    });
    const rows = listGenerationLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens_in).toBeNull();
    expect(rows[0].tokens_out).toBeNull();
    expect(rows[0].error).toBeNull();
  });

  it('records a row with error field on upstream failure', () => {
    insertGenerationLog({
      id: 'gen-err',
      agent: 'vault-agent',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages.stream',
      request_id: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: 100,
      error: 'API key invalid',
      created_at: new Date().toISOString(),
      payload_digest: 'somehash',
    });
    const rows = listGenerationLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe('API key invalid');
  });

  it('payload_digest stores a hash, not the raw prompt text', () => {
    const rawPrompt = 'Top secret story prompt with sensitive content';
    const hash = crypto.createHash('sha256').update(rawPrompt).digest('hex');
    insertGenerationLog({
      id: 'gen-secret',
      agent: 'writing-assistant',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'messages.stream',
      request_id: null,
      tokens_in: 10,
      tokens_out: 20,
      latency_ms: 300,
      error: null,
      created_at: new Date().toISOString(),
      payload_digest: hash,
    });
    const rows = listGenerationLog();
    expect(rows[0].payload_digest).toBe(hash);
    expect(rows[0].payload_digest).not.toBe(rawPrompt);
    expect(rows[0].payload_digest).not.toContain('sensitive');
  });

  it('listGenerationLog filters by agent', () => {
    const now = new Date().toISOString();
    const base = { model: 'm', endpoint: 'e', request_id: null, tokens_in: 1, tokens_out: 1, latency_ms: 1, error: null, created_at: now, payload_digest: null };
    insertGenerationLog({ id: 'g1', agent: 'brainstorm', ...base });
    insertGenerationLog({ id: 'g2', agent: 'writing-assistant', ...base });
    expect(listGenerationLog({ agent: 'brainstorm' })).toHaveLength(1);
    expect(listGenerationLog({ agent: 'writing-assistant' })).toHaveLength(1);
    expect(listGenerationLog()).toHaveLength(2);
  });

  it('listGenerationLog respects limit', () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      insertGenerationLog({ id: `g${i}`, agent: 'brainstorm', model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, created_at: now, payload_digest: null });
    }
    expect(listGenerationLog({ limit: 3 })).toHaveLength(3);
  });
});
