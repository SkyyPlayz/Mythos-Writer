// Beta 3 M23 — unit tests for the flags→comments bridge pure helpers.
//
// Coverage:
//   §1  confirmActionToResolution verb mapping (M11 comment buttons →
//       SKY-1684 continuity resolution verbs)
//   §2  dedupeScanItems — re-scans must not duplicate open/ignored flags;
//       resolved rows do not block a re-flag; intra-batch dupes collapse.

import { describe, it, expect } from 'vitest';
import {
  confirmActionToResolution,
  continuityDedupeKey,
  dedupeScanItems,
  normalizeExcerpt,
} from './archiveCommentBridge.js';
import type { DbContinuityIssue } from './db.js';
import type { InconsistencyItem } from './ipc.js';

function mkItem(overrides: Partial<InconsistencyItem> & { id: string }): InconsistencyItem {
  return {
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'scene-1', offset: 0, excerpt: 'her eyes were green' },
    vaultAnchor: { notePath: 'Characters/Elara.md', line: 3, excerpt: 'eyes: storm-grey' },
    rationale: 'Eye color drifts from the vault.',
    proposedResolution: { matchArchiveToStory: 'set green', suggestStoryChange: 'make grey' },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

function mkRow(overrides: Partial<DbContinuityIssue> & { id: string }): DbContinuityIssue {
  return {
    category: 'character_attribute_drift',
    severity: 'high',
    manuscript_scene_id: 'scene-1',
    manuscript_offset: 0,
    manuscript_excerpt: 'her eyes were green',
    vault_note_path: 'Characters/Elara.md',
    vault_line: 3,
    vault_excerpt: 'eyes: storm-grey',
    rationale: 'Eye color drifts from the vault.',
    proposed_match_archive: 'set green',
    proposed_suggest_story: 'make grey',
    status: 'open',
    resolved_at: null,
    resolved_action: null,
    created_at: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

// ─── §1 Action mapping ───────────────────────────────────────────────────────

describe('confirmActionToResolution', () => {
  it('maps match_archive → match_archive_to_story', () => {
    expect(confirmActionToResolution('match_archive')).toBe('match_archive_to_story');
  });

  it('passes suggest_story_change through', () => {
    expect(confirmActionToResolution('suggest_story_change')).toBe('suggest_story_change');
  });

  it('passes ignore through', () => {
    expect(confirmActionToResolution('ignore')).toBe('ignore');
  });
});

// ─── §2 Scan dedupe ─────────────────────────────────────────────────────────

describe('normalizeExcerpt / continuityDedupeKey', () => {
  it('collapses whitespace and case-folds', () => {
    expect(normalizeExcerpt('  Her  Eyes\nwere GREEN ')).toBe('her eyes were green');
  });

  it('keys differ across scene, category, and excerpt', () => {
    const base = continuityDedupeKey('scene-1', 'factual_contradiction', 'abc');
    expect(continuityDedupeKey('scene-2', 'factual_contradiction', 'abc')).not.toBe(base);
    expect(continuityDedupeKey('scene-1', 'character_attribute_drift', 'abc')).not.toBe(base);
    expect(continuityDedupeKey('scene-1', 'factual_contradiction', 'xyz')).not.toBe(base);
  });
});

describe('dedupeScanItems', () => {
  it('drops a fresh finding that duplicates an existing open row', () => {
    const fresh = [mkItem({ id: 'new-1' })];
    expect(dedupeScanItems(fresh, [mkRow({ id: 'old-1' })])).toEqual([]);
  });

  it('drops a fresh finding that duplicates an ignored row (AC-CC-07 owns re-surfacing)', () => {
    const fresh = [mkItem({ id: 'new-1' })];
    expect(dedupeScanItems(fresh, [mkRow({ id: 'old-1', status: 'ignored' })])).toEqual([]);
  });

  it('keeps a fresh finding that duplicates only a RESOLVED row (genuine re-flag)', () => {
    const fresh = [mkItem({ id: 'new-1' })];
    const out = dedupeScanItems(fresh, [mkRow({ id: 'old-1', status: 'resolved' })]);
    expect(out.map((i) => i.id)).toEqual(['new-1']);
  });

  it('matches modulo whitespace and case in the excerpt', () => {
    const fresh = [
      mkItem({
        id: 'new-1',
        manuscriptAnchor: { sceneId: 'scene-1', offset: 4, excerpt: '  HER eyes  were green' },
      }),
    ];
    expect(dedupeScanItems(fresh, [mkRow({ id: 'old-1' })])).toEqual([]);
  });

  it('keeps findings for a different scene, category, or excerpt', () => {
    const fresh = [
      mkItem({ id: 'a', manuscriptAnchor: { sceneId: 'scene-2', offset: 0, excerpt: 'her eyes were green' } }),
      mkItem({ id: 'b', category: 'factual_contradiction' }),
      mkItem({ id: 'c', manuscriptAnchor: { sceneId: 'scene-1', offset: 0, excerpt: 'the lantern was oil-lit' } }),
    ];
    const out = dedupeScanItems(fresh, [mkRow({ id: 'old-1' })]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('collapses intra-batch duplicates (first one wins)', () => {
    const fresh = [mkItem({ id: 'a' }), mkItem({ id: 'b' })];
    const out = dedupeScanItems(fresh, []);
    expect(out.map((i) => i.id)).toEqual(['a']);
  });

  it('returns everything when there is nothing to dedupe against', () => {
    const fresh = [mkItem({ id: 'a' })];
    expect(dedupeScanItems(fresh, [])).toHaveLength(1);
  });
});
