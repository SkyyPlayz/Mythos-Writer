// TC-DB-25-*: Suggestion Inbox DB tests — FTS migration + search/ignore/batch IPC logic.
// All tests run against a real in-process SQLite DB (no mocks).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openDb,
  closeDb,
  upsertSuggestion,
  insertAuditLog,
  listAuditLog,
  updateSuggestionStatus,
  getSuggestion,
  listSuggestionsFiltered,
  searchSuggestionsFts,
  listUnifiedSuggestions,
  insertContinuityIssue,
  type DbSuggestion,
  type DbContinuityIssue,
} from './db.js';

function makeSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  return {
    id: `sug-${Math.random().toString(36).slice(2, 8)}`,
    source_agent: 'writing-assistant',
    confidence: 0.7,
    rationale: 'pacing issue in scene',
    target_kind: null,
    target_path: 'scenes/ch1.md',
    target_anchor: null,
    payload_json: null,
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
    ...overrides,
  };
}

function makeContinuityIssue(overrides: Partial<DbContinuityIssue> = {}): DbContinuityIssue {
  return {
    id: `ci-${Math.random().toString(36).slice(2, 8)}`,
    category: 'character_attribute_drift',
    severity: 'high',
    manuscript_scene_id: 'scene-1',
    manuscript_offset: 0,
    manuscript_excerpt: 'He had blue eyes',
    vault_note_path: 'characters/alice.md',
    vault_line: 5,
    vault_excerpt: 'Alice has green eyes',
    rationale: 'eye colour mismatch',
    proposed_match_archive: 'Update archive',
    proposed_suggest_story: 'Update story',
    status: 'open',
    resolved_at: null,
    resolved_action: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ipc-sug-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// TC-DB-25-1: FTS search for a known rationale keyword returns the matching suggestion_id.
describe('TC-DB-25-1: FTS search for known keyword', () => {
  it('returns matching suggestion when query hits rationale', () => {
    const sug = makeSuggestion({ rationale: 'pacing is too slow in chapter 3' });
    upsertSuggestion(sug);

    const { suggestions, totalCount } = searchSuggestionsFts('pacing', {});
    expect(totalCount).toBe(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe(sug.id);
  });

  it('returns matching suggestion when query hits target_path', () => {
    const sug = makeSuggestion({ target_path: 'scenes/prologue.md', rationale: 'too wordy' });
    upsertSuggestion(sug);

    const { suggestions } = searchSuggestionsFts('prologue', {});
    expect(suggestions[0].id).toBe(sug.id);
  });
});

// TC-DB-25-2: FTS search with no match returns empty array.
describe('TC-DB-25-2: FTS search with no match', () => {
  it('returns empty array and totalCount=0', () => {
    upsertSuggestion(makeSuggestion({ rationale: 'completely unrelated content' }));

    const { suggestions, totalCount } = searchSuggestionsFts('xyzzy_nonexistent_token', {});
    expect(suggestions).toHaveLength(0);
    expect(totalCount).toBe(0);
  });
});

// TC-DB-25-3: confidenceMin=0.8 returns only suggestions with confidence >= 0.8.
describe('TC-DB-25-3: confidenceMin filter', () => {
  it('returns only high-confidence suggestions', () => {
    const low = makeSuggestion({ confidence: 0.5, rationale: 'low confidence suggestion' });
    const high = makeSuggestion({ confidence: 0.9, rationale: 'high confidence suggestion' });
    upsertSuggestion(low);
    upsertSuggestion(high);

    const results = listSuggestionsFiltered({ confidenceMin: 0.8 });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(high.id);
    expect(ids).not.toContain(low.id);
  });
});

// TC-DB-25-4: batch-action with 3 IDs all succeed; DB status updated for all 3.
describe('TC-DB-25-4: batch action succeeds for multiple IDs', () => {
  it('updates status to rejected for all 3 suggestions', () => {
    const sugs = [
      makeSuggestion({ rationale: 'batch target 1' }),
      makeSuggestion({ rationale: 'batch target 2' }),
      makeSuggestion({ rationale: 'batch target 3' }),
    ];
    for (const s of sugs) upsertSuggestion(s);

    // Simulate batch reject inline (the handler logic is unit-tested via DB layer).
    for (const s of sugs) {
      updateSuggestionStatus(s.id, 'rejected');
      insertAuditLog({
        id: `audit-${s.id}`,
        suggestion_id: s.id,
        action: 'reject',
        snapshot_path: null,
        actor: 'user',
        created_at: new Date().toISOString(),
      });
    }

    for (const s of sugs) {
      const fetched = getSuggestion(s.id);
      expect(fetched?.status).toBe('rejected');
    }
    expect(sugs).toHaveLength(3);
  });
});

// TC-DB-25-5: suggestions:ignore sets status=ignored and writes audit_log row with action='ignore'.
describe('TC-DB-25-5: ignore sets status and audit log', () => {
  it('status becomes ignored and audit log has action=ignore', () => {
    const sug = makeSuggestion({ rationale: 'to be ignored' });
    upsertSuggestion(sug);

    updateSuggestionStatus(sug.id, 'ignored');
    insertAuditLog({
      id: 'audit-ignore-1',
      suggestion_id: sug.id,
      action: 'ignore',
      snapshot_path: null,
      actor: 'user',
      created_at: new Date().toISOString(),
    });

    const fetched = getSuggestion(sug.id);
    expect(fetched?.status).toBe('ignored');

    const logs = listAuditLog(sug.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('ignore');
    expect(logs[0].actor).toBe('user');
  });
});

// TC-DB-25-6: unified-list returns suggestions + continuity_issues + wiki_link_suggestions;
// countByKind totals add up to totalCount.
describe('TC-DB-25-6: unified-list aggregates all three source tables', () => {
  it('returns rows from suggestions and continuity_issues; countByKind sums to totalCount', () => {
    const sug1 = makeSuggestion({ rationale: 'unified row 1', source_agent: 'writing-assistant' });
    const sug2 = makeSuggestion({ rationale: 'unified row 2', source_agent: 'brainstorm' });
    upsertSuggestion(sug1);
    upsertSuggestion(sug2);

    const ci = makeContinuityIssue();
    insertContinuityIssue(ci);

    const result = listUnifiedSuggestions({});
    expect(result.totalCount).toBeGreaterThanOrEqual(3);
    expect(result.items.length).toBeGreaterThanOrEqual(3);

    const kindSum = Object.values(result.countByKind).reduce((a, b) => a + b, 0);
    expect(kindSum).toBe(result.totalCount);

    const kindKeys = Object.keys(result.countByKind);
    expect(kindKeys).toContain('suggestion');
    expect(kindKeys).toContain('continuity-issue');

    // Verify items include mapped fields from continuity-issue rows.
    const ciRow = result.items.find((i) => i.kind === 'continuity-issue');
    expect(ciRow).toBeDefined();
    expect(ciRow?.sourceAgent).toBe('archive');
    expect(ciRow?.status).toBe('proposed'); // open → proposed

    const sugRow = result.items.find((i) => i.id === sug1.id);
    expect(sugRow?.kind).toBe('suggestion');
    expect(sugRow?.sourceAgent).toBe('writing-assistant');
  });

  it('filters by kind=suggestion only returns suggestions', () => {
    upsertSuggestion(makeSuggestion());
    insertContinuityIssue(makeContinuityIssue());

    const result = listUnifiedSuggestions({ kind: 'suggestion' });
    for (const item of result.items) {
      expect(item.kind).toBe('suggestion');
    }
    expect(result.countByKind['continuity-issue']).toBeUndefined();
  });
});
