// Beta 3 M23 — flags→comments reconciliation tests.
//
// Coverage:
//   §1  open flags become kind:'archive' comments (anchor, text, suggestionId,
//       agent-label author) — and their agent actions report as LIVE
//   §2  dedupe: re-syncing the same flags creates nothing; a legacy duplicate
//       row (same scene+excerpt, different id) creates nothing
//   §3  scope: flags outside the story's scenes (note:-scoped keys) skipped;
//       empty excerpts skipped; long excerpts clipped to the M11 anchor cap
//   §4  reverse sync: non-open flags remove their comment;
//       removeCommentForResolvedFlag drops the card by flag id

import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ANCHOR_LENGTH, agentActionAvailability, commentsStore } from '../comments';
import type { InconsistencyItem } from '../InconsistencyCard';
import type { Story } from '../types';
import {
  continuityCommentAnchor,
  continuityCommentText,
  removeCommentForResolvedFlag,
  storySceneIds,
  syncContinuityFlagsToComments,
} from './continuityComments';

const NOW = '2026-07-07T00:00:00.000Z';

function mkStory(): Story {
  const scene = (id: string, order: number) => ({
    id,
    title: `Scene ${id}`,
    path: `stories/s1/ch1/${id}.md`,
    order,
    blocks: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
  return {
    id: 'story-1',
    title: 'The Broken Gate',
    path: 'stories/s1',
    chapters: [
      {
        id: 'ch-1',
        title: 'Chapter One',
        path: 'stories/s1/ch1',
        order: 0,
        scenes: [scene('scene-a', 0), scene('scene-b', 1)],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkFlag(overrides: Partial<InconsistencyItem> & { id: string }): InconsistencyItem {
  return {
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'scene-a', offset: 12, excerpt: 'her eyes were green' },
    vaultAnchor: { notePath: 'Characters/Elara.md', line: 3, excerpt: 'eyes: storm-grey' },
    rationale: 'Eye color drifts from the vault.',
    proposedResolution: { matchArchiveToStory: 'set green', suggestStoryChange: 'make grey' },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  commentsStore.reset();
});

// ─── §1 open flags → archive comments ───────────────────────────────────────

describe('syncContinuityFlagsToComments — creation', () => {
  it('creates a kind:archive comment with live agent actions for an open flag', () => {
    const story = mkStory();
    const result = syncContinuityFlagsToComments(story, [mkFlag({ id: 'flag-1' })], 'The Archivist');

    expect(result).toEqual({ created: 1, removed: 0 });
    const comments = commentsStore.list('story-1');
    expect(comments).toHaveLength(1);
    const c = comments[0];
    expect(c.kind).toBe('archive');
    expect(c.sceneId).toBe('scene-a');
    expect(c.anchor).toBe('her eyes were green');
    expect(c.suggestionId).toBe('flag-1');
    expect(c.author).toBe('The Archivist');
    expect(c.text).toContain('Eye color drifts from the vault.');
    expect(c.text).toContain('eyes: storm-grey');
    // suggestionId present + kind archive ⇒ the three M11 actions are LIVE.
    expect(agentActionAvailability(c)).toBe('live');
  });

  it('falls back to the default Archive author when no label is given', () => {
    syncContinuityFlagsToComments(mkStory(), [mkFlag({ id: 'flag-1' })]);
    expect(commentsStore.list('story-1')[0].author).toBe('Archive Agent');
  });
});

// ─── §2 dedupe ──────────────────────────────────────────────────────────────

describe('syncContinuityFlagsToComments — dedupe', () => {
  it('is idempotent: re-syncing the same flags creates nothing', () => {
    const story = mkStory();
    const flags = [mkFlag({ id: 'flag-1' }), mkFlag({ id: 'flag-2', manuscriptAnchor: { sceneId: 'scene-b', offset: 0, excerpt: 'the oil lantern' } })];
    expect(syncContinuityFlagsToComments(story, flags).created).toBe(2);
    expect(syncContinuityFlagsToComments(story, flags)).toEqual({ created: 0, removed: 0 });
    expect(commentsStore.list('story-1')).toHaveLength(2);
  });

  it('skips a legacy duplicate row (same scene + excerpt, different id)', () => {
    const story = mkStory();
    syncContinuityFlagsToComments(story, [mkFlag({ id: 'flag-1' })]);
    const dup = mkFlag({ id: 'flag-1-dup' });
    expect(syncContinuityFlagsToComments(story, [dup]).created).toBe(0);
    expect(commentsStore.list('story-1')).toHaveLength(1);
  });
});

// ─── §3 scope + anchors ─────────────────────────────────────────────────────

describe('syncContinuityFlagsToComments — scope and anchors', () => {
  it('skips note-scoped flags (noteAgentScanKey sceneIds) and unknown scenes', () => {
    const story = mkStory();
    const flags = [
      mkFlag({ id: 'f-note', manuscriptAnchor: { sceneId: 'note:Lore/Gates.md', offset: 0, excerpt: 'gate lore' } }),
      mkFlag({ id: 'f-other', manuscriptAnchor: { sceneId: 'scene-of-other-story', offset: 0, excerpt: 'elsewhere' } }),
    ];
    expect(syncContinuityFlagsToComments(story, flags)).toEqual({ created: 0, removed: 0 });
    expect(commentsStore.list('story-1')).toHaveLength(0);
  });

  it('skips flags with an empty excerpt (nothing to anchor on)', () => {
    const flags = [mkFlag({ id: 'f-1', manuscriptAnchor: { sceneId: 'scene-a', offset: 0, excerpt: '   ' } })];
    expect(syncContinuityFlagsToComments(mkStory(), flags).created).toBe(0);
  });

  it('clips over-long excerpts to the M11 anchor cap', () => {
    const long = 'x'.repeat(MAX_ANCHOR_LENGTH + 40);
    const flags = [mkFlag({ id: 'f-1', manuscriptAnchor: { sceneId: 'scene-a', offset: 0, excerpt: long } })];
    syncContinuityFlagsToComments(mkStory(), flags);
    expect(commentsStore.list('story-1')[0].anchor).toHaveLength(MAX_ANCHOR_LENGTH);
  });

  it('storySceneIds collects every scene of every chapter', () => {
    expect([...storySceneIds(mkStory())].sort()).toEqual(['scene-a', 'scene-b']);
  });

  it('continuityCommentText omits the vault quote when the excerpt is empty', () => {
    const flag = mkFlag({ id: 'f', vaultAnchor: { notePath: 'n.md', line: 0, excerpt: '' } });
    expect(continuityCommentText(flag)).toBe('Eye color drifts from the vault.');
  });

  it('continuityCommentAnchor trims whitespace', () => {
    const flag = mkFlag({ id: 'f', manuscriptAnchor: { sceneId: 'scene-a', offset: 0, excerpt: '  padded  ' } });
    expect(continuityCommentAnchor(flag)).toBe('padded');
  });
});

// ─── §4 reverse sync ────────────────────────────────────────────────────────

describe('flag resolution removes the gutter card', () => {
  it('reconciling a non-open flag resolves its comment', () => {
    const story = mkStory();
    syncContinuityFlagsToComments(story, [mkFlag({ id: 'flag-1' })]);
    const result = syncContinuityFlagsToComments(story, [
      mkFlag({ id: 'flag-1', status: 'resolved', resolvedAt: NOW, resolvedAction: 'match_archive_to_story' }),
    ]);
    expect(result).toEqual({ created: 0, removed: 1 });
    expect(commentsStore.list('story-1')).toHaveLength(0);
  });

  it('removeCommentForResolvedFlag drops exactly the flagged card', () => {
    const story = mkStory();
    syncContinuityFlagsToComments(story, [
      mkFlag({ id: 'flag-1' }),
      mkFlag({ id: 'flag-2', manuscriptAnchor: { sceneId: 'scene-b', offset: 0, excerpt: 'the oil lantern' } }),
    ]);
    expect(removeCommentForResolvedFlag('story-1', 'flag-1')).toBe(true);
    const left = commentsStore.list('story-1');
    expect(left).toHaveLength(1);
    expect(left[0].suggestionId).toBe('flag-2');
    // Unknown flag ids are a no-op.
    expect(removeCommentForResolvedFlag('story-1', 'flag-1')).toBe(false);
  });
});
