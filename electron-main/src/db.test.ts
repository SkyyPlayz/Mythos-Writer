// SQLite persistence layer tests — real DB in a temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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
  upsertTimelineEntry,
  listTimelineEntries,
  insertGenerationLog,
  listGenerationLog,
  getGenerationLogEntry,
  truncateGenerationLogBody,
  countSuggestionsInWindow,
  countTokensInWindow,
  insertProvenance,
  getProvenance,
  listProvenanceForEntity,
  listProvenance,
  upsertEntityIndex,
  getEntityIndex,
  listEntityIndex,
  deleteEntityIndex,
  insertEntityRelationship,
  listEntityRelationships,
  deleteEntityRelationship,
  insertSceneEntityLink,
  listSceneEntityLinks,
  deleteSceneEntityLinks,
  upsertEntityFts,
  searchEntityFts,
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
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    expect(row?.user_version ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('migration is idempotent — re-open keeps user_version stable', () => {
    const db1 = openDb(tmpDir);
    const r1 = db1.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    const v1 = r1?.user_version ?? 0;
    closeDb();
    const db2 = openDb(tmpDir);
    const r2 = db2.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    expect(r2?.user_version ?? 0).toBe(v1);
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

  it('listGenerationLog paginates via offset', () => {
    const base = { model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, payload_digest: null };
    // Insert 5 rows with distinct created_at so ORDER BY is stable
    for (let i = 0; i < 5; i++) {
      const ts = new Date(1_000_000 + i * 1000).toISOString();
      insertGenerationLog({ id: `pg${i}`, agent: 'brainstorm', created_at: ts, ...base });
    }
    const page0 = listGenerationLog({ limit: 2, offset: 0 });
    const page1 = listGenerationLog({ limit: 2, offset: 2 });
    const page2 = listGenerationLog({ limit: 2, offset: 4 });
    expect(page0).toHaveLength(2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    // All ids distinct across pages
    const ids = [...page0, ...page1, ...page2].map(r => r.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('listGenerationLog agentFilter returns only matching agent rows', () => {
    const now = new Date().toISOString();
    const base = { model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, created_at: now, payload_digest: null };
    insertGenerationLog({ id: 'af1', agent: 'writing-assistant', ...base });
    insertGenerationLog({ id: 'af2', agent: 'writing-assistant', ...base });
    insertGenerationLog({ id: 'af3', agent: 'archive', ...base });
    const wa = listGenerationLog({ agent: 'writing-assistant' });
    const arc = listGenerationLog({ agent: 'archive' });
    expect(wa).toHaveLength(2);
    expect(wa.every(r => r.agent === 'writing-assistant')).toBe(true);
    expect(arc).toHaveLength(1);
    expect(arc[0].agent).toBe('archive');
  });

  it('truncateGenerationLogBody trims prompt_text and response_text to 10 KB in list rows', () => {
    const bigText = 'x'.repeat(12 * 1024); // 12 KB
    const now = new Date().toISOString();
    insertGenerationLog({ id: 'trunc-1', agent: 'writing-assistant', model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, created_at: now, payload_digest: null, prompt_text: bigText, response_text: bigText });
    const [raw] = listGenerationLog();
    const truncated = truncateGenerationLogBody(raw);
    expect(Buffer.byteLength(truncated.prompt_text!, 'utf8')).toBeLessThanOrEqual(10 * 1024 + 4); // +4 for ellipsis char
    expect(Buffer.byteLength(truncated.response_text!, 'utf8')).toBeLessThanOrEqual(10 * 1024 + 4);
    expect(truncated.prompt_text).toMatch(/…$/);
    expect(truncated.response_text).toMatch(/…$/);
  });

  it('truncateGenerationLogBody leaves short texts unchanged', () => {
    const now = new Date().toISOString();
    insertGenerationLog({ id: 'trunc-2', agent: 'brainstorm', model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, created_at: now, payload_digest: null, prompt_text: 'short prompt', response_text: null });
    const [raw] = listGenerationLog();
    const truncated = truncateGenerationLogBody(raw);
    expect(truncated.prompt_text).toBe('short prompt');
    expect(truncated.response_text).toBeNull();
  });

  it('getGenerationLogEntry returns full body without truncation', () => {
    const bigText = 'y'.repeat(12 * 1024);
    const now = new Date().toISOString();
    insertGenerationLog({ id: 'full-get', agent: 'brainstorm', model: 'm', endpoint: 'e', request_id: null, tokens_in: null, tokens_out: null, latency_ms: 1, error: null, created_at: now, payload_digest: null, prompt_text: bigText, response_text: null });
    const row = getGenerationLogEntry('full-get');
    expect(row).not.toBeNull();
    expect(row!.prompt_text).toBe(bigText);
    expect(row!.prompt_text!.length).toBe(12 * 1024);
  });
});

// ─── getSuggestion + budget helpers ───

describe('getSuggestion and budget helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getSuggestion returns null for unknown id', () => {
    expect(getSuggestion('no-such-id')).toBeNull();
  });

  it('getSuggestion returns the row after insert', () => {
    upsertSuggestion(makeSuggestion({ id: 'sug-get' }));
    const row = getSuggestion('sug-get');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('sug-get');
  });

  it('updateSuggestionBudgetExceeded sets flag', () => {
    upsertSuggestion(makeSuggestion({ id: 'sug-budget', budget_exceeded: 0 }));
    updateSuggestionBudgetExceeded('sug-budget', true);
    expect(getSuggestion('sug-budget')!.budget_exceeded).toBe(1);
    updateSuggestionBudgetExceeded('sug-budget', false);
    expect(getSuggestion('sug-budget')!.budget_exceeded).toBe(0);
  });

  it('countSuggestionsInWindow counts rows within window', () => {
    const now = new Date().toISOString();
    upsertSuggestion(makeSuggestion({ id: 'sw-1', source_agent: 'archive', created_at: now }));
    upsertSuggestion(makeSuggestion({ id: 'sw-2', source_agent: 'archive', created_at: now }));
    upsertSuggestion(makeSuggestion({ id: 'sw-3', source_agent: 'brainstorm', created_at: now }));
    expect(countSuggestionsInWindow('archive', 60_000)).toBe(2);
    expect(countSuggestionsInWindow('brainstorm', 60_000)).toBe(1);
  });

  it('countSuggestionsInWindow excludes rows outside window', () => {
    const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    upsertSuggestion(makeSuggestion({ id: 'sw-old', source_agent: 'archive', created_at: old }));
    expect(countSuggestionsInWindow('archive', 60_000)).toBe(0);
  });

  it('countTokensInWindow sums tokens from generation_log', () => {
    const now = new Date().toISOString();
    insertGenerationLog({ id: 'tw-1', agent: 'archive', model: 'm', endpoint: 'e', request_id: null, tokens_in: 100, tokens_out: 200, latency_ms: 1, error: null, created_at: now, payload_digest: null });
    insertGenerationLog({ id: 'tw-2', agent: 'archive', model: 'm', endpoint: 'e', request_id: null, tokens_in: 50, tokens_out: 75, latency_ms: 1, error: null, created_at: now, payload_digest: null });
    expect(countTokensInWindow('archive', 60_000)).toBe(425);
  });

  it('countTokensInWindow returns 0 when no rows', () => {
    expect(countTokensInWindow('archive', 60_000)).toBe(0);
  });
});

// ─── Provenance CRUD ───

describe('provenance', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and retrieves a provenance entry by id', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'prov-1', entity_id: 'sug-abc', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: 'run-42', created_at: now });
    const row = getProvenance('prov-1');
    expect(row).not.toBeNull();
    expect(row!.entity_id).toBe('sug-abc');
    expect(row!.entity_kind).toBe('suggestion');
    expect(row!.agent_id).toBe('archive');
    expect(row!.run_id).toBe('run-42');
  });

  it('getProvenance returns null for unknown id', () => {
    expect(getProvenance('no-such-prov')).toBeNull();
  });

  it('stores null run_id', () => {
    insertProvenance({ id: 'prov-norun', entity_id: 'sug-x', entity_kind: 'suggestion', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: new Date().toISOString() });
    expect(getProvenance('prov-norun')!.run_id).toBeNull();
  });

  it('listProvenanceForEntity returns entries matching entity_id', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'p1', entity_id: 'ent-A', entity_kind: 'entity', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    insertProvenance({ id: 'p2', entity_id: 'ent-B', entity_kind: 'entity', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    insertProvenance({ id: 'p3', entity_id: 'ent-A', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    expect(listProvenanceForEntity('ent-A')).toHaveLength(2);
    expect(listProvenanceForEntity('ent-B')).toHaveLength(1);
  });

  it('listProvenanceForEntity filters by entity_kind', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'pk1', entity_id: 'ent-C', entity_kind: 'entity', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    insertProvenance({ id: 'pk2', entity_id: 'ent-C', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    expect(listProvenanceForEntity('ent-C', 'entity')).toHaveLength(1);
    expect(listProvenanceForEntity('ent-C', 'entity')[0].id).toBe('pk1');
    expect(listProvenanceForEntity('ent-C', 'suggestion')).toHaveLength(1);
  });

  it('listProvenance returns all entries', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'la1', entity_id: 'e1', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    insertProvenance({ id: 'la2', entity_id: 'e2', entity_kind: 'entity', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    expect(listProvenance()).toHaveLength(2);
  });

  it('listProvenance filters by agent_id', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'ag1', entity_id: 'e1', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    insertProvenance({ id: 'ag2', entity_id: 'e2', entity_kind: 'suggestion', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    insertProvenance({ id: 'ag3', entity_id: 'e3', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    const arc = listProvenance({ agentId: 'archive' });
    expect(arc).toHaveLength(2);
    expect(arc.every(r => r.agent_id === 'archive')).toBe(true);
  });

  it('listProvenance filters by entity_kind', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'ek1', entity_id: 'e1', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    insertProvenance({ id: 'ek2', entity_id: 'e2', entity_kind: 'entity', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    expect(listProvenance({ entityKind: 'suggestion' })).toHaveLength(1);
    expect(listProvenance({ entityKind: 'entity' })).toHaveLength(1);
  });

  it('listProvenance filters by both agent_id and entity_kind', () => {
    const now = new Date().toISOString();
    insertProvenance({ id: 'both1', entity_id: 'e1', entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    insertProvenance({ id: 'both2', entity_id: 'e2', entity_kind: 'entity', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    insertProvenance({ id: 'both3', entity_id: 'e3', entity_kind: 'suggestion', agent_id: 'brainstorm', agent_type: 'brainstorm', run_id: null, created_at: now });
    expect(listProvenance({ agentId: 'archive', entityKind: 'suggestion' })).toHaveLength(1);
    expect(listProvenance({ agentId: 'archive', entityKind: 'suggestion' })[0].id).toBe('both1');
  });

  it('listProvenance respects limit', () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      insertProvenance({ id: `lim${i}`, entity_id: `e${i}`, entity_kind: 'suggestion', agent_id: 'archive', agent_type: 'archive', run_id: null, created_at: now });
    }
    expect(listProvenance({ limit: 3 })).toHaveLength(3);
  });
});

// ─── World DB migration (v14) ───

describe('world DB migration — entity tables', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-entity-'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets user_version to 16 on fresh vault', () => {
    const db = openDb(tmpDir);
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(16);
  });

  it('entity_index table exists with expected columns', () => {
    const db = openDb(tmpDir);
    const cols = db.prepare('PRAGMA table_info(entity_index)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('type');
    expect(names).toContain('name');
    expect(names).toContain('status');
    expect(names).toContain('file_path');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('entity_relationships table exists', () => {
    const db = openDb(tmpDir);
    const cols = db.prepare('PRAGMA table_info(entity_relationships)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('from_entity_id');
    expect(names).toContain('to_entity_id');
    expect(names).toContain('label');
  });

  it('scene_entity_links table exists', () => {
    const db = openDb(tmpDir);
    const cols = db.prepare('PRAGMA table_info(scene_entity_links)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('scene_id');
    expect(names).toContain('entity_id');
    expect(names).toContain('link_kind');
  });

  it('entity_fts virtual table exists', () => {
    const db = openDb(tmpDir);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_fts'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('entity_fts');
  });

  it('migration is idempotent — close/reopen keeps user_version at 16', () => {
    openDb(tmpDir);
    closeDb();
    const db2 = openDb(tmpDir);
    const row = db2.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(16);
  });

  it('upgrading from v13 reaches v16 with all entity tables and writing_log', () => {
    const mythosDir = path.join(tmpDir, '.mythos');
    fs.mkdirSync(mythosDir, { recursive: true });
    const dbPath = path.join(mythosDir, 'state.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec('PRAGMA journal_mode = WAL');
    seed.exec(`
      CREATE TABLE IF NOT EXISTS project_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS item_tags (item_id TEXT NOT NULL, item_kind TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (item_id, item_kind, tag_id));
    `);
    seed.exec('PRAGMA user_version = 13');
    seed.close();

    const db = openDb(tmpDir);
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(16);
    const cols = db.prepare('PRAGMA table_info(entity_index)').all() as Array<{ name: string }>;
    expect(cols.length).toBeGreaterThan(0);
    const wlCols = db.prepare('PRAGMA table_info(writing_log)').all() as Array<{ name: string }>;
    expect(wlCols.map((c) => c.name)).toContain('log_date');
  });
});

// ─── Entity index CRUD ───

describe('entity_index CRUD', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-ei-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntity(overrides: Partial<Parameters<typeof upsertEntityIndex>[0]> = {}) {
    return {
      id: 'ent-1',
      type: 'character',
      name: 'Aria',
      aliases: null,
      tags: null,
      status: 'active' as const,
      core_fields: null,
      custom_fields: null,
      notes_text: null,
      file_path: 'entities/characters/ent-1.md',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('upserts and retrieves entity by id', () => {
    upsertEntityIndex(makeEntity());
    const row = getEntityIndex('ent-1');
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Aria');
    expect(row!.type).toBe('character');
    expect(row!.status).toBe('active');
  });

  it('getEntityIndex returns null for unknown id', () => {
    expect(getEntityIndex('no-such')).toBeNull();
  });

  it('listEntityIndex returns all entries', () => {
    upsertEntityIndex(makeEntity({ id: 'e1', name: 'Aria', type: 'character' }));
    upsertEntityIndex(makeEntity({ id: 'e2', name: 'Thornfeld', type: 'location', file_path: 'entities/locations/e2.md' }));
    expect(listEntityIndex()).toHaveLength(2);
  });

  it('listEntityIndex filters by type — includes faction and event', () => {
    upsertEntityIndex(makeEntity({ id: 'e1', name: 'Aria', type: 'character' }));
    upsertEntityIndex(makeEntity({ id: 'e2', name: 'Thornfeld', type: 'location', file_path: 'entities/locations/e2.md' }));
    upsertEntityIndex(makeEntity({ id: 'e3', name: 'Iron Hand', type: 'faction', file_path: 'entities/factions/e3.md' }));
    upsertEntityIndex(makeEntity({ id: 'e4', name: 'The Fall', type: 'event', file_path: 'entities/events/e4.md' }));
    expect(listEntityIndex('character')).toHaveLength(1);
    expect(listEntityIndex('faction')).toHaveLength(1);
    expect(listEntityIndex('event')).toHaveLength(1);
  });

  it('deleteEntityIndex removes the row', () => {
    upsertEntityIndex(makeEntity());
    deleteEntityIndex('ent-1');
    expect(getEntityIndex('ent-1')).toBeNull();
  });
});

// ─── Entity relationships CRUD ───

describe('entity_relationships CRUD', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-er-'));
    openDb(tmpDir);
    const now = new Date().toISOString();
    upsertEntityIndex({ id: 'e-a', type: 'character', name: 'Aria', aliases: null, tags: null, status: 'active', core_fields: null, custom_fields: null, notes_text: null, file_path: 'entities/characters/e-a.md', created_at: now, updated_at: now });
    upsertEntityIndex({ id: 'e-b', type: 'location', name: 'Thornfeld', aliases: null, tags: null, status: 'active', core_fields: null, custom_fields: null, notes_text: null, file_path: 'entities/locations/e-b.md', created_at: now, updated_at: now });
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and lists relationships', () => {
    insertEntityRelationship({ id: 'rel-1', from_entity_id: 'e-a', to_entity_id: 'e-b', label: 'lives_in', created_at: new Date().toISOString() });
    const rows = listEntityRelationships('e-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('lives_in');
  });

  it('ignores duplicate (from, to, label) inserts', () => {
    const now = new Date().toISOString();
    insertEntityRelationship({ id: 'rel-1', from_entity_id: 'e-a', to_entity_id: 'e-b', label: 'lives_in', created_at: now });
    insertEntityRelationship({ id: 'rel-2', from_entity_id: 'e-a', to_entity_id: 'e-b', label: 'lives_in', created_at: now });
    expect(listEntityRelationships('e-a')).toHaveLength(1);
  });

  it('deleteEntityRelationship removes the row', () => {
    insertEntityRelationship({ id: 'rel-1', from_entity_id: 'e-a', to_entity_id: 'e-b', label: 'ally', created_at: new Date().toISOString() });
    deleteEntityRelationship('rel-1');
    expect(listEntityRelationships('e-a')).toHaveLength(0);
  });
});

// ─── Scene entity links CRUD ───

describe('scene_entity_links CRUD', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-sel-'));
    openDb(tmpDir);
    const now = new Date().toISOString();
    upsertEntityIndex({ id: 'ent-x', type: 'character', name: 'X', aliases: null, tags: null, status: 'active', core_fields: null, custom_fields: null, notes_text: null, file_path: 'entities/characters/ent-x.md', created_at: now, updated_at: now });
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts and lists scene links', () => {
    insertSceneEntityLink({ id: 'lnk-1', scene_id: 'scene-abc', entity_id: 'ent-x', link_kind: 'mention', created_at: new Date().toISOString() });
    const rows = listSceneEntityLinks('scene-abc');
    expect(rows).toHaveLength(1);
    expect(rows[0].link_kind).toBe('mention');
  });

  it('ignores duplicate (scene_id, entity_id, link_kind)', () => {
    const now = new Date().toISOString();
    insertSceneEntityLink({ id: 'lnk-1', scene_id: 's1', entity_id: 'ent-x', link_kind: 'mention', created_at: now });
    insertSceneEntityLink({ id: 'lnk-2', scene_id: 's1', entity_id: 'ent-x', link_kind: 'mention', created_at: now });
    expect(listSceneEntityLinks('s1')).toHaveLength(1);
  });

  it('deleteSceneEntityLinks removes all links for a scene', () => {
    insertSceneEntityLink({ id: 'lnk-1', scene_id: 'sc1', entity_id: 'ent-x', link_kind: 'mention', created_at: new Date().toISOString() });
    deleteSceneEntityLinks('sc1');
    expect(listSceneEntityLinks('sc1')).toHaveLength(0);
  });
});

// ─── Entity FTS ───

describe('entity_fts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-db-fts-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts and searches entity FTS', () => {
    upsertEntityFts('ent-1', 'Aria Voss', 'Aria', 'A powerful sorceress', null);
    const results = searchEntityFts('sorceress');
    expect(results.map((r) => r.entity_id)).toContain('ent-1');
  });

  it('upsert replaces existing FTS row (no duplicates)', () => {
    upsertEntityFts('ent-1', 'Aria', null, 'old notes', null);
    upsertEntityFts('ent-1', 'Aria Voss', null, 'new notes about magic', null);
    expect(searchEntityFts('magic').map((r) => r.entity_id)).toContain('ent-1');
    expect(searchEntityFts('old').map((r) => r.entity_id)).not.toContain('ent-1');
  });
});
