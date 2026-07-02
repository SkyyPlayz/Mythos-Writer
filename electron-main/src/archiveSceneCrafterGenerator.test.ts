// Build-gating tests for SKY-3200 (Part E · E4b) — Archive → Scene Crafter generator.
// Enforces the owner-locked Beta 2 contract: Archive suggests, never mutates the board.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('./db.js', () => ({
  upsertSuggestion: vi.fn(),
  listSuggestions: vi.fn(() => []),
}));

import { generateSceneCrafterSuggestions } from './archiveSceneCrafterGenerator.js';
import { upsertSuggestion, listSuggestions } from './db.js';
import type { ArchiveIndex, VaultEntityRecord } from './archiveAgent.js';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';
import type { DbSuggestion } from './db.js';
import type { SceneCrafterCardSuggestionData } from './sceneCrafterSuggestions.js';

const NOW = '2026-07-02T00:00:00.000Z';

function makeEntity(overrides: Partial<VaultEntityRecord> & { id: string; name: string }): VaultEntityRecord {
  return {
    type: 'character',
    aliases: [],
    properties: {},
    prose: '',
    ...overrides,
  };
}

function makeIndex(entities: VaultEntityRecord[]): ArchiveIndex {
  return { entities, builtAt: NOW };
}

function makeBoard(cardTitles: string[]): SceneCrafterBoard {
  return {
    storyId: 'story-1',
    lastModified: NOW,
    lanes: [{ name: 'Idea', cards: cardTitles.map((title) => ({
      wikilink: title, title, done: false, tags: [], raw: `- [ ] [[${title}]]`,
    })) }],
    extraFrontmatter: {},
    kanbanSettings: '{"kanban-plugin":"board"}',
  };
}

const upsertSuggestionMock = vi.mocked(upsertSuggestion);
const listSuggestionsMock = vi.mocked(listSuggestions);

beforeEach(() => {
  upsertSuggestionMock.mockClear();
  listSuggestionsMock.mockReset();
  listSuggestionsMock.mockReturnValue([]);
});

// ─── CONTRACT 1: behavioral — proposes gaps, never touches the board ────────

describe('CONTRACT: generateSceneCrafterSuggestions', () => {
  it('proposes cards only for entities missing from the board, above threshold', () => {
    const strongEntity = makeEntity({
      id: 'e1', name: 'Elara', type: 'character', aliases: ['El'],
      properties: { role: 'protagonist', age: '24' },
      prose: 'Elara grew up in the coastal village and later crossed paths with Marcus during the siege.',
    });
    const onBoardEntity = makeEntity({
      id: 'e2', name: 'Marcus', type: 'character',
      properties: { role: 'antagonist', age: '40' },
      prose: 'Marcus commands the northern garrison.',
    });
    const weakEntity = makeEntity({ id: 'e3', name: 'Unnamed Relic', type: 'item' });

    const index = makeIndex([strongEntity, onBoardEntity, weakEntity]);
    const board = makeBoard(['Marcus']);

    const count = generateSceneCrafterSuggestions(index, board, 'my-story', NOW);

    expect(count).toBe(1);
    expect(upsertSuggestionMock).toHaveBeenCalledTimes(1);

    const written = upsertSuggestionMock.mock.calls[0][0] as DbSuggestion;
    expect(written.source_agent).toBe('archive');
    expect(written.status).toBe('proposed');

    const data = JSON.parse(written.payload_json ?? '{}') as SceneCrafterCardSuggestionData;
    expect(data.kind).toBe('scene_crafter_card');
    expect(data.source).toBe('archive');
    expect(data.status).toBe('proposed');
    expect(data.payload.title).toBe('Elara');
    expect(data.target.storySlug).toBe('my-story');
  });

  it('never writes a status other than proposed and caps output at 5 per run', () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      makeEntity({
        id: `e${i}`, name: `Entity ${i}`, type: 'character', aliases: ['x'],
        properties: { a: '1', b: '2' },
        prose: 'A'.repeat(60),
      }),
    );
    const index = makeIndex(entities);

    const count = generateSceneCrafterSuggestions(index, null, 'my-story', NOW);

    expect(count).toBe(5);
    expect(upsertSuggestionMock).toHaveBeenCalledTimes(5);
    for (const call of upsertSuggestionMock.mock.calls) {
      const written = call[0] as DbSuggestion;
      expect(written.status).toBe('proposed');
    }
  });

  it('never mutates the board — only side effect is upsertSuggestion', () => {
    const board = makeBoard([]);
    const boardSnapshotBefore = JSON.stringify(board);

    generateSceneCrafterSuggestions(
      makeIndex([makeEntity({ id: 'e1', name: 'Elara', properties: { a: '1', b: '2' }, prose: 'A'.repeat(60) })]),
      board,
      'my-story',
      NOW,
    );

    expect(JSON.stringify(board)).toBe(boardSnapshotBefore);
  });
});

// ─── CONTRACT 2: static — no forbidden board-write import ──────────────────

describe('CONTRACT: no board-write import in archiveSceneCrafterGenerator.ts', () => {
  it('does not import board-mutating modules or exports', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'archiveSceneCrafterGenerator.ts'), 'utf-8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');

    const forbidden = [
      "'./sceneCrafterIpc.js'",
      "'./sceneCrafterWatcher.js'",
      'addCardToBoard',
      'createBoard',
      'removeCard',
      'moveCard',
      'reorderLanes',
      'deleteLane',
    ];
    for (const token of forbidden) {
      expect(importLines).not.toContain(token);
    }
  });
});

// ─── CONTRACT 3: deduplication ───────────────────────────────────────────────

describe('CONTRACT: deduplication', () => {
  it('does not re-propose an entity that already has a proposed archive suggestion', () => {
    const existingSuggestionData: SceneCrafterCardSuggestionData = {
      kind: 'scene_crafter_card',
      source: 'archive',
      confidence: 0.85,
      rationale: 'existing',
      timestamp: NOW,
      target: { boardId: 'my-story', storySlug: 'my-story', laneId: 'Idea' },
      payload: { title: 'Elara' },
      status: 'proposed',
    };
    listSuggestionsMock.mockReturnValue([
      {
        id: 'sug-1',
        source_agent: 'archive',
        confidence: 0.85,
        rationale: 'existing',
        target_kind: null,
        target_path: null,
        target_anchor: null,
        payload_json: JSON.stringify(existingSuggestionData),
        status: 'proposed',
        created_at: NOW,
        applied_at: null,
        applied_run_id: null,
        budget_exceeded: 0,
        category: null,
      } satisfies DbSuggestion,
    ]);

    const index = makeIndex([
      makeEntity({
        id: 'e1', name: 'Elara', type: 'character', aliases: ['El'],
        properties: { a: '1', b: '2' }, prose: 'A'.repeat(60),
      }),
    ]);

    const count = generateSceneCrafterSuggestions(index, makeBoard([]), 'my-story', NOW);

    expect(count).toBe(0);
    expect(upsertSuggestionMock).not.toHaveBeenCalled();
  });
});
