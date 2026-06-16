// Tests for SKY-1764 scene crafter card suggestion accept/reject flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Mock db before importing module under test
vi.mock('./db.js', () => ({
  upsertSuggestion: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  insertAuditLog: vi.fn(),
  getSuggestion: vi.fn(),
}));

import {
  createSceneCrafterCardSuggestion,
  acceptSceneCrafterCardSuggestion,
  rejectSceneCrafterCardSuggestion,
} from './sceneCrafterSuggestions.js';
import { upsertSuggestion, updateSuggestionStatus, insertAuditLog, getSuggestion } from './db.js';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';

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

function makeSuggestionRow(id: string, overrides: Record<string, unknown> = {}) {
  const payload = {
    kind: 'scene_crafter_card',
    source: 'brainstorm',
    confidence: 0.9,
    rationale: 'The agent thinks this scene fits.',
    timestamp: NOW,
    target: { boardId: 'b1', storySlug: 'my-story', laneId: 'Draft' },
    payload: { title: 'The Battle', tags: ['action'] },
    status: 'proposed',
  };
  return {
    id,
    source_agent: 'brainstorm',
    confidence: 0.9,
    rationale: 'The agent thinks this scene fits.',
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
    ...overrides,
  };
}

describe('createSceneCrafterCardSuggestion', () => {
  it('calls upsertSuggestion with correct fields', () => {
    vi.mocked(upsertSuggestion).mockReturnValue(undefined);
    const id = createSceneCrafterCardSuggestion({
      kind: 'scene_crafter_card',
      source: 'brainstorm',
      confidence: 0.85,
      rationale: 'Needs a battle scene',
      timestamp: NOW,
      target: { boardId: 'b1', storySlug: 'slug1' },
      payload: { title: 'Ambush', tags: ['action'] },
    }, NOW);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(upsertSuggestion).toHaveBeenCalledOnce();
    const arg = vi.mocked(upsertSuggestion).mock.calls[0][0];
    expect(arg.source_agent).toBe('brainstorm');
    expect(arg.status).toBe('proposed');
    const parsed = JSON.parse(arg.payload_json!);
    expect(parsed.kind).toBe('scene_crafter_card');
    expect(parsed.status).toBe('proposed');
  });
});

describe('acceptSceneCrafterCardSuggestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds card to named lane and writes audit log (AC-SC-08)', () => {
    const id = randomUUID();
    vi.mocked(getSuggestion).mockReturnValue(makeSuggestionRow(id) as ReturnType<typeof getSuggestion>);

    const board = makeBoard(['Idea', 'Draft', 'Done']);
    const getBoard = vi.fn(() => board);
    const addCard = vi.fn();

    const result = acceptSceneCrafterCardSuggestion(id, getBoard, addCard, 'user', NOW);

    expect(addCard).toHaveBeenCalledOnce();
    const [slug, laneIdx, card] = addCard.mock.calls[0];
    expect(slug).toBe('my-story');
    expect(laneIdx).toBe(1); // 'Draft' is index 1
    expect(card.title).toBe('The Battle');
    expect(card.raw).toContain(`<!-- mythos-provenance: ${id} -->`);
    expect(card.tags).toEqual(['action']);

    expect(updateSuggestionStatus).toHaveBeenCalledWith(id, 'applied', NOW);
    expect(insertAuditLog).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(insertAuditLog).mock.calls[0][0];
    expect(auditArg.suggestion_id).toBe(id);
    expect(auditArg.action).toBe('apply');
    expect(auditArg.actor).toBe('user');
    expect(result.laneUsed).toBe('Draft');
    expect(result.auditId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back to Idea lane when laneId is absent', () => {
    const id = randomUUID();
    const row = makeSuggestionRow(id);
    const data = JSON.parse(row.payload_json);
    delete data.target.laneId;
    row.payload_json = JSON.stringify(data);
    vi.mocked(getSuggestion).mockReturnValue(row as ReturnType<typeof getSuggestion>);

    const board = makeBoard(['Idea', 'Draft']);
    const addCard = vi.fn();

    const result = acceptSceneCrafterCardSuggestion(id, () => board, addCard, 'user', NOW);
    expect(result.laneUsed).toBe('Idea');
    expect(result.laneIndex).toBe(0);
  });

  it('falls back to first lane when named lane not found', () => {
    const id = randomUUID();
    const row = makeSuggestionRow(id);
    const data = JSON.parse(row.payload_json);
    data.target.laneId = 'NonExistent';
    row.payload_json = JSON.stringify(data);
    vi.mocked(getSuggestion).mockReturnValue(row as ReturnType<typeof getSuggestion>);

    const board = makeBoard(['Only Lane']);
    const addCard = vi.fn();

    const result = acceptSceneCrafterCardSuggestion(id, () => board, addCard, 'user', NOW);
    expect(result.laneIndex).toBe(0);
  });

  it('throws when suggestion not found', () => {
    vi.mocked(getSuggestion).mockReturnValue(null);
    expect(() =>
      acceptSceneCrafterCardSuggestion('missing', () => null, vi.fn(), 'user', NOW)
    ).toThrow('Suggestion not found');
  });

  it('throws when board not found', () => {
    const id = randomUUID();
    vi.mocked(getSuggestion).mockReturnValue(makeSuggestionRow(id) as ReturnType<typeof getSuggestion>);
    expect(() =>
      acceptSceneCrafterCardSuggestion(id, () => null, vi.fn(), 'user', NOW)
    ).toThrow('Board not found');
  });
});

describe('rejectSceneCrafterCardSuggestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks suggestion rejected and writes audit log (AC-SC-09)', () => {
    const id = randomUUID();
    vi.mocked(getSuggestion).mockReturnValue(makeSuggestionRow(id) as ReturnType<typeof getSuggestion>);

    const result = rejectSceneCrafterCardSuggestion(id, 'user', NOW);

    expect(updateSuggestionStatus).toHaveBeenCalledWith(id, 'rejected');
    expect(insertAuditLog).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(insertAuditLog).mock.calls[0][0];
    expect(auditArg.suggestion_id).toBe(id);
    expect(auditArg.action).toBe('reject');
    expect(auditArg.snapshot_path).toBeNull();
    expect(result.auditId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('throws when suggestion not found', () => {
    vi.mocked(getSuggestion).mockReturnValue(null);
    expect(() => rejectSceneCrafterCardSuggestion('missing', 'user', NOW)).toThrow('Suggestion not found');
  });
});
