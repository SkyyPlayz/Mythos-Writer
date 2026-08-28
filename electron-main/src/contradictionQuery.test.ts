// Global contradiction query tests (M12.3, SKY-10770) — real temp-dir SQLite
// via openDb/closeDb, negative-control-first (Ivy's standing rule).
//
// ACs pinned here:
//   AC3 — the query is global: a contradiction flagged in a scene OUTSIDE any
//         scan scope still surfaces (the query takes no scope by design).
//   AC4 — <500ms on a 1000-entity ledger, MEASURED (median of 3), not
//         eyeballed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'node:perf_hooks';
import {
  openDb,
  closeDb,
  insertContinuityIssue,
  upsertVaultIndexCacheRow,
  type DbContinuityIssue,
} from './db.js';
import { queryGlobalContradictions } from './contradictionQuery.js';

let tmpDir: string;

function issue(overrides: Partial<DbContinuityIssue> & { id: string }): DbContinuityIssue {
  return {
    scope: 'story_vault',
    category: 'factual_contradiction',
    severity: 'high',
    manuscript_scene_id: 'scene-a',
    manuscript_offset: 0,
    manuscript_excerpt: 'The gate fell in the third winter.',
    vault_note_path: 'lore/The Gate.md',
    vault_line: 4,
    vault_excerpt: 'The gate has never fallen.',
    rationale: 'Manuscript contradicts established lore.',
    proposed_match_archive: '',
    proposed_suggest_story: '',
    status: 'open',
    resolved_at: null,
    resolved_action: null,
    created_at: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contradiction-query-test-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('queryGlobalContradictions', () => {
  it('negative control: an empty ledger yields no contradictions', () => {
    expect(queryGlobalContradictions()).toEqual([]);
  });

  it('surfaces a contradiction from a scene OUTSIDE the last scan scope (AC3 — query is global)', () => {
    // Simulated state: the user just ran a scan scoped to scene-a only, but a
    // contradiction lives in scene-z. The query takes no scope parameter, so
    // there is nothing that COULD narrow it to scene-a — assert the cross-
    // scope row comes back anyway.
    insertContinuityIssue(issue({ id: 'in-scope', manuscript_scene_id: 'scene-a' }));
    insertContinuityIssue(issue({ id: 'cross-scope', manuscript_scene_id: 'scene-z', severity: 'critical' }));

    const rows = queryGlobalContradictions();
    expect(rows.map((r) => r.id).sort()).toEqual(['cross-scope', 'in-scope']);
    // Severity-first ordering: the critical cross-scope row leads.
    expect(rows[0].id).toBe('cross-scope');
    expect(rows[0].sceneId).toBe('scene-z');
  });

  it('returns only OPEN factual contradictions — resolved rows and drift categories stay out', () => {
    insertContinuityIssue(issue({ id: 'open-contradiction' }));
    insertContinuityIssue(issue({ id: 'resolved-contradiction', status: 'resolved' }));
    insertContinuityIssue(issue({ id: 'drift', category: 'character_attribute_drift' }));

    expect(queryGlobalContradictions().map((r) => r.id)).toEqual(['open-contradiction']);
  });

  it('enriches from the entity index when the flagged note has a cache row', () => {
    upsertVaultIndexCacheRow({
      file_path: 'lore/The Gate.md',
      content_hash: 'abc',
      name: 'The Gate',
      aliases_json: '[]',
      type: 'location',
      needs_rescan: 0,
      indexed_at: '2026-08-27T00:00:00.000Z',
    });
    insertContinuityIssue(issue({ id: 'enriched' }));
    insertContinuityIssue(issue({ id: 'bare', vault_note_path: 'lore/Unindexed.md' }));

    const byId = new Map(queryGlobalContradictions().map((r) => [r.id, r]));
    expect(byId.get('enriched')).toMatchObject({ entityName: 'The Gate', entityType: 'location' });
    expect(byId.get('bare')).toMatchObject({ entityName: null, entityType: null });
  });

  it('completes in <500ms on a 1000-entity ledger, measured median of 3 (AC4)', () => {
    for (let i = 0; i < 1000; i++) {
      upsertVaultIndexCacheRow({
        file_path: `lore/entity-${i}.md`,
        content_hash: `hash-${i}`,
        name: `Entity ${i}`,
        aliases_json: '[]',
        type: i % 2 === 0 ? 'character' : 'location',
        needs_rescan: 0,
        indexed_at: '2026-08-27T00:00:00.000Z',
      });
    }
    // Contradictions spread across many scenes, plus noise the query filters.
    for (let i = 0; i < 1000; i++) {
      insertContinuityIssue(issue({
        id: `flag-${i}`,
        manuscript_scene_id: `scene-${i % 50}`,
        vault_note_path: `lore/entity-${i}.md`,
        category: i % 4 === 0 ? 'factual_contradiction' : 'character_attribute_drift',
        status: i % 5 === 0 ? 'resolved' : 'open',
        created_at: `2026-08-27T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      }));
    }

    const timings: number[] = [];
    let rows: ReturnType<typeof queryGlobalContradictions> = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      rows = queryGlobalContradictions({ limit: 1000 });
      timings.push(performance.now() - t0);
    }
    const median = timings.sort((a, b) => a - b)[1];

    // Sanity: the measured query did real work (open contradictions joined
    // against the 1000-entity index, multiple scenes represented).
    expect(rows.length).toBeGreaterThan(100);
    expect(new Set(rows.map((r) => r.sceneId)).size).toBeGreaterThan(10);
    expect(rows.every((r) => r.entityName !== null)).toBe(true);

    expect(median).toBeLessThan(500);
  });
});
