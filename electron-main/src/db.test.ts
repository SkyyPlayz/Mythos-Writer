// SQLite persistence layer tests — real DB in a temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
} from './db.js';

function makeSuggestion(overrides: Partial<Parameters<typeof upsertSuggestion>[0]> = {}) {
  return {
    id: 'sug-1',
    source_agent: 'vault-agent',
    confidence: 0.9,
    rationale: 'Timeline mismatch',
    target_path: 'scenes/scene-1.md',
    target_anchor: null,
    payload_json: null,
    status: 'proposed' as const,
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
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

  it('sets user_version to 1 on first open', () => {
    const db = openDb(tmpDir);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('migration is idempotent — re-open leaves user_version at 1', () => {
    openDb(tmpDir);
    closeDb();
    const db = openDb(tmpDir);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
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
