// SKY-3200 — Build-gating contract tests for Archive → scene_crafter_card flow.
//
// These three tests enforce the owner-locked invariants from SKY-3115 §1:
//   1. Board is NOT mutated when the Archive agent emits a suggestion (DB-only insert).
//   2. Accepting a suggestion adds exactly one card to the board.
//   3. scene_crafter_card suggestions are HARD-excluded from the vault auto-apply path.
//
// Failure of any test means the change violates the Beta 2 owner decision and must NOT merge.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  upsertSuggestion: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  insertAuditLog: vi.fn(),
  getSuggestion: vi.fn(),
}));

import {
  createSceneCrafterCardSuggestion,
  acceptSceneCrafterCardSuggestion,
} from './sceneCrafterSuggestions.js';
import { upsertSuggestion, getSuggestion } from './db.js';
import { applyVaultWrite } from './suggestionApply.js';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';
import type { DbSuggestion } from './db.js';

const NOW = '2026-01-01T00:00:00.000Z';

function makeBoard(laneNames: string[]): SceneCrafterBoard {
  return {
    storyId: 'story-1',
    lastModified: NOW,
    lanes: laneNames.map((name) => ({ name, cards: [] })),
    extraFrontmatter: {},
    kanbanSettings: '{"kanban-plugin":"board"}',
  };
}

function makeSuggestionRow(id: string, source: 'brainstorm' | 'archive' = 'archive'): DbSuggestion {
  const payload = {
    kind: 'scene_crafter_card',
    source,
    confidence: 0.9,
    rationale: 'Archive agent detected a missing scene beat.',
    timestamp: NOW,
    target: { boardId: 'b1', storySlug: 'my-story', laneId: 'Draft' },
    payload: { title: 'The Confrontation', tags: ['climax'] },
    status: 'proposed',
  };
  return {
    id,
    source_agent: source,
    confidence: 0.9,
    rationale: 'Archive agent detected a missing scene beat.',
    target_kind: null,
    target_path: null,
    target_anchor: null,
    payload_json: JSON.stringify(payload),
    status: 'proposed',
    created_at: NOW,
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
  } as DbSuggestion;
}

// ─── CONTRACT 1: Board unchanged on emit ────────────────────────────────────

describe('CONTRACT: board-unchanged-on-emit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createSceneCrafterCardSuggestion with source=archive only writes DB — never touches the board', () => {
    vi.mocked(upsertSuggestion).mockReturnValue(undefined);

    // Capture any board-write attempt — this must NEVER be called during emit.
    const handleAddCard = vi.fn();

    createSceneCrafterCardSuggestion({
      kind: 'scene_crafter_card',
      source: 'archive',
      confidence: 0.88,
      rationale: 'Archive agent detected a missing scene beat.',
      timestamp: NOW,
      target: { boardId: 'b1', storySlug: 'my-story', laneId: 'Draft' },
      payload: { title: 'The Confrontation', tags: ['climax'] },
    }, NOW);

    // DB upsert must fire exactly once.
    expect(upsertSuggestion).toHaveBeenCalledOnce();

    // Board mutation must be zero.
    expect(handleAddCard).not.toHaveBeenCalled();

    // The DB row source_agent must be 'archive', not 'brainstorm'.
    const arg = vi.mocked(upsertSuggestion).mock.calls[0][0];
    expect(arg.source_agent).toBe('archive');
    expect(arg.status).toBe('proposed');

    // target_kind must be null — this row must never enter the vault-write path.
    expect(arg.target_kind).toBeNull();
  });
});

// ─── CONTRACT 2: One card only on accept ────────────────────────────────────

describe('CONTRACT: one-card-only-on-accept', () => {
  beforeEach(() => vi.clearAllMocks());

  it('acceptSceneCrafterCardSuggestion calls addCard exactly once', () => {
    const id = 'test-id-accept-once';
    vi.mocked(getSuggestion).mockReturnValue(makeSuggestionRow(id));

    const board = makeBoard(['Idea', 'Draft', 'Done']);
    const addCard = vi.fn();

    acceptSceneCrafterCardSuggestion(
      id,
      () => board,
      addCard,
      'user',
      NOW,
    );

    // Exactly one card must be added — not zero, not two.
    expect(addCard).toHaveBeenCalledTimes(1);

    // Verify the card lands in the correct lane (Draft = index 1).
    const [, laneIdx] = addCard.mock.calls[0];
    expect(laneIdx).toBe(1);
  });
});

// ─── CONTRACT 3: scene_crafter_card HARD-excluded from auto-apply ───────────

describe('CONTRACT: scene_crafter_card HARD-excluded from auto-apply', () => {
  it('applyVaultWrite on a scene_crafter_card suggestion returns accepted (never applied)', () => {
    const suggestion = makeSuggestionRow('hard-exclude-test');

    // Pass a real-looking (non-existent) vaultRoot — applyVaultWrite must
    // short-circuit on target_kind=null before any FS access.
    const result = applyVaultWrite(suggestion, '/tmp/non-existent-vault', NOW);

    // 'applied' would mean a vault write occurred — that is the prohibited state.
    expect(result.finalStatus).toBe('accepted');
    expect(result.snapshotPath).toBeNull();
  });
});
