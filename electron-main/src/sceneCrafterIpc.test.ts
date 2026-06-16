// sceneCrafterIpc.test.ts (SKY-1758)
// Unit tests for Scene Crafter IPC handlers. Uses a real temp directory;
// no Electron mocks needed because handler functions are pure FS operations.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseBoardMarkdown, serializeBoardMarkdown, boardRelPath } from './sceneCrafterBoard.js';
import {
  handleGetBoard,
  handleCreateBoard,
  handleAddCard,
  handleMoveCard,
  handleToggleCardDone,
  handleDeleteCard,
  handleAddLane,
  handleRenameLane,
  handleDeleteLane,
  handleReorderLanes,
  resolveBrainstormLane,
} from './sceneCrafterIpc.js';

// ─── Test helpers ───

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mw-sc-ipc-'));
}

const STORY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const STORY_SLUG = 'the-lost-heir';

function seedBoard(root: string): void {
  handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
}

function readBoardDisk(root: string) {
  const p = path.join(root, boardRelPath(STORY_SLUG));
  return parseBoardMarkdown(fs.readFileSync(p, 'utf-8'));
}

// ─── §1  create-board ─────────────────────────────────────────────────────────

describe('§1 scene-crafter:create-board', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('creates a board file with 5 canonical lanes', () => {
    const board = handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    expect(board.lanes.map(l => l.name)).toEqual(['Idea', 'Outline', 'Draft', 'Revision', 'Done']);
  });

  it('sets storyId in frontmatter', () => {
    const board = handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    expect(board.storyId).toBe(STORY_ID);
  });

  it('writes the kanban:settings footer', () => {
    handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    const onDisk = readBoardDisk(root);
    expect(onDisk.kanbanSettings).toContain('kanban-plugin');
  });

  it('is idempotent — second call returns existing board without overwriting', () => {
    handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    // Manually add a card so we can verify the file was not reset
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/the-lost-heir/scene-1', title: 'Scene 1' } });
    handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    const onDisk = readBoardDisk(root);
    expect(onDisk.lanes[0].cards).toHaveLength(1);
  });

  it('round-trips: parseBoardMarkdown(serializeBoardMarkdown(board)) matches', () => {
    const board = handleCreateBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    const reserialized = serializeBoardMarkdown(parseBoardMarkdown(serializeBoardMarkdown(board)));
    expect(reserialized).toBe(serializeBoardMarkdown(board));
  });
});

// ─── §2  get-board ────────────────────────────────────────────────────────────

describe('§2 scene-crafter:get-board', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns null when no board file exists', () => {
    const result = handleGetBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    expect(result).toBeNull();
  });

  it('returns the board after creation', () => {
    seedBoard(root);
    const result = handleGetBoard(root, { storyId: STORY_ID, storySlug: STORY_SLUG });
    expect(result).not.toBeNull();
    expect(result!.lanes).toHaveLength(5);
  });
});

// ─── §3  add-card ─────────────────────────────────────────────────────────────

describe('§3 scene-crafter:add-card', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); seedBoard(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('appends a card to the specified lane', () => {
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/the-lost-heir/tavern', title: 'The Tavern' } });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards).toHaveLength(1);
    expect(board.lanes[0].cards[0].title).toBe('The Tavern');
    expect(board.lanes[0].cards[0].wikilink).toBe('scenes/the-lost-heir/tavern');
    expect(board.lanes[0].cards[0].done).toBe(false);
  });

  it('defaults done=false and tags=[] when not provided', () => {
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/the-lost-heir/s1', title: 'S1' } });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards[0].done).toBe(false);
    expect(board.lanes[0].cards[0].tags).toEqual([]);
  });

  it('respects done=true when provided', () => {
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 4, card: { wikilink: 'scenes/the-lost-heir/done-scene', title: 'Done', done: true } });
    const board = readBoardDisk(root);
    expect(board.lanes[4].cards[0].done).toBe(true);
  });

  it('preserves tags', () => {
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/the-lost-heir/s', title: 'S', tags: ['act1', 'mystery'] } });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards[0].tags).toEqual(['act1', 'mystery']);
  });

  it('throws RangeError for an out-of-bounds lane index', () => {
    expect(() =>
      handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 99, card: { wikilink: 'x', title: 'X' } })
    ).toThrow(RangeError);
  });

  it('round-trips: serialized card survives parse→serialize', () => {
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/the-lost-heir/x', title: 'X', tags: ['tag1'] } });
    const board = readBoardDisk(root);
    const reserialized = serializeBoardMarkdown(parseBoardMarkdown(serializeBoardMarkdown(board)));
    expect(reserialized).toBe(serializeBoardMarkdown(board));
  });
});

// ─── §4  move-card ────────────────────────────────────────────────────────────

describe('§4 scene-crafter:move-card', () => {
  let root: string;
  beforeEach(() => {
    root = tmpDir();
    seedBoard(root);
    // seed: lane 0 has [A, B], lane 1 has [C]
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/a', title: 'A' } });
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/b', title: 'B' } });
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 1, card: { wikilink: 'scenes/s/c', title: 'C' } });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('moves a card from one lane to another', () => {
    handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 0, toLane: 1, toIndex: 1 });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards.map(c => c.title)).toEqual(['B']);
    expect(board.lanes[1].cards.map(c => c.title)).toEqual(['C', 'A']);
  });

  it('moves within the same lane', () => {
    handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 0, toLane: 0, toIndex: 1 });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards.map(c => c.title)).toEqual(['B', 'A']);
  });

  it('appends to end of destination lane (toIndex = length)', () => {
    handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 0, toLane: 1, toIndex: 1 });
    const board = readBoardDisk(root);
    expect(board.lanes[1].cards).toHaveLength(2);
    expect(board.lanes[1].cards[1].title).toBe('A');
  });

  it('preserves all other cards', () => {
    handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 0, toLane: 2, toIndex: 0 });
    const board = readBoardDisk(root);
    const allTitles = board.lanes.flatMap(l => l.cards.map(c => c.title));
    expect(allTitles.sort()).toEqual(['A', 'B', 'C'].sort());
  });

  it('throws RangeError for invalid fromIndex', () => {
    expect(() =>
      handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 99, toLane: 1, toIndex: 0 })
    ).toThrow(RangeError);
  });

  it('throws RangeError for invalid toIndex', () => {
    expect(() =>
      handleMoveCard(root, { storySlug: STORY_SLUG, fromLane: 0, fromIndex: 0, toLane: 1, toIndex: 99 })
    ).toThrow(RangeError);
  });
});

// ─── §5  toggle-card-done ─────────────────────────────────────────────────────

describe('§5 scene-crafter:toggle-card-done', () => {
  let root: string;
  beforeEach(() => {
    root = tmpDir();
    seedBoard(root);
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/a', title: 'A' } });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('toggles done from false to true', () => {
    handleToggleCardDone(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 0 });
    expect(readBoardDisk(root).lanes[0].cards[0].done).toBe(true);
  });

  it('toggles done from true back to false', () => {
    handleToggleCardDone(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 0 });
    handleToggleCardDone(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 0 });
    expect(readBoardDisk(root).lanes[0].cards[0].done).toBe(false);
  });

  it('serializes the updated checkbox correctly', () => {
    handleToggleCardDone(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 0 });
    const p = path.join(root, boardRelPath(STORY_SLUG));
    const raw = fs.readFileSync(p, 'utf-8');
    expect(raw).toContain('[x]');
  });

  it('throws RangeError for out-of-bounds cardIndex', () => {
    expect(() =>
      handleToggleCardDone(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 99 })
    ).toThrow(RangeError);
  });
});

// ─── §6  delete-card ─────────────────────────────────────────────────────────

describe('§6 scene-crafter:delete-card', () => {
  let root: string;
  beforeEach(() => {
    root = tmpDir();
    seedBoard(root);
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/a', title: 'A' } });
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/b', title: 'B' } });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('removes the card at the given index', () => {
    handleDeleteCard(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 0 });
    const board = readBoardDisk(root);
    expect(board.lanes[0].cards).toHaveLength(1);
    expect(board.lanes[0].cards[0].title).toBe('B');
  });

  it('throws RangeError for out-of-bounds cardIndex', () => {
    expect(() =>
      handleDeleteCard(root, { storySlug: STORY_SLUG, laneIndex: 0, cardIndex: 99 })
    ).toThrow(RangeError);
  });
});

// ─── §7  add-lane ─────────────────────────────────────────────────────────────

describe('§7 scene-crafter:add-lane', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); seedBoard(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('appends a new lane at the end', () => {
    handleAddLane(root, { storySlug: STORY_SLUG, name: 'Archived' });
    const board = readBoardDisk(root);
    expect(board.lanes).toHaveLength(6);
    expect(board.lanes[5].name).toBe('Archived');
  });

  it('new lane starts with no cards', () => {
    handleAddLane(root, { storySlug: STORY_SLUG, name: 'Parking Lot' });
    const board = readBoardDisk(root);
    expect(board.lanes[5].cards).toHaveLength(0);
  });
});

// ─── §8  rename-lane ──────────────────────────────────────────────────────────

describe('§8 scene-crafter:rename-lane', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); seedBoard(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('renames the lane heading', () => {
    handleRenameLane(root, { storySlug: STORY_SLUG, laneIndex: 0, name: 'Ideas' });
    const board = readBoardDisk(root);
    expect(board.lanes[0].name).toBe('Ideas');
  });

  it('preserves other lane names', () => {
    handleRenameLane(root, { storySlug: STORY_SLUG, laneIndex: 2, name: 'Writing' });
    const board = readBoardDisk(root);
    expect(board.lanes[0].name).toBe('Idea');
    expect(board.lanes[2].name).toBe('Writing');
    expect(board.lanes[4].name).toBe('Done');
  });

  it('throws RangeError for out-of-bounds laneIndex', () => {
    expect(() =>
      handleRenameLane(root, { storySlug: STORY_SLUG, laneIndex: 99, name: 'X' })
    ).toThrow(RangeError);
  });
});

// ─── §9  delete-lane ─────────────────────────────────────────────────────────

describe('§9 scene-crafter:delete-lane', () => {
  let root: string;
  beforeEach(() => {
    root = tmpDir();
    seedBoard(root);
    // lane 0 (Idea) gets a card; all others stay empty
    handleAddCard(root, { storySlug: STORY_SLUG, laneIndex: 0, card: { wikilink: 'scenes/s/a', title: 'A' } });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns { ok: false, cardCount: N } when lane has cards and force is absent', () => {
    const result = handleDeleteLane(root, { storySlug: STORY_SLUG, laneIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.cardCount).toBe(1);
  });

  it('does NOT remove the lane when ok: false', () => {
    handleDeleteLane(root, { storySlug: STORY_SLUG, laneIndex: 0 });
    expect(readBoardDisk(root).lanes).toHaveLength(5);
  });

  it('deletes an empty lane and returns { ok: true, cardCount: 0 }', () => {
    const result = handleDeleteLane(root, { storySlug: STORY_SLUG, laneIndex: 1 });
    expect(result).toEqual({ ok: true, cardCount: 0 });
    expect(readBoardDisk(root).lanes).toHaveLength(4);
  });

  it('force-deletes a lane with cards when force=true', () => {
    const result = handleDeleteLane(root, { storySlug: STORY_SLUG, laneIndex: 0, force: true });
    expect(result).toEqual({ ok: true, cardCount: 1 });
    expect(readBoardDisk(root).lanes).toHaveLength(4);
  });

  it('throws RangeError for out-of-bounds laneIndex', () => {
    expect(() =>
      handleDeleteLane(root, { storySlug: STORY_SLUG, laneIndex: 99 })
    ).toThrow(RangeError);
  });
});

// ─── §10  reorder-lanes ───────────────────────────────────────────────────────

describe('§10 scene-crafter:reorder-lanes', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); seedBoard(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('moves a lane from one position to another', () => {
    handleReorderLanes(root, { storySlug: STORY_SLUG, fromIndex: 0, toIndex: 4 });
    const board = readBoardDisk(root);
    expect(board.lanes.map(l => l.name)).toEqual(['Outline', 'Draft', 'Revision', 'Done', 'Idea']);
  });

  it('moves backward (from later to earlier position)', () => {
    handleReorderLanes(root, { storySlug: STORY_SLUG, fromIndex: 4, toIndex: 0 });
    const board = readBoardDisk(root);
    expect(board.lanes.map(l => l.name)).toEqual(['Done', 'Idea', 'Outline', 'Draft', 'Revision']);
  });

  it('preserves all lane names after reorder', () => {
    handleReorderLanes(root, { storySlug: STORY_SLUG, fromIndex: 1, toIndex: 3 });
    const board = readBoardDisk(root);
    expect(board.lanes.map(l => l.name).sort()).toEqual(['Done', 'Draft', 'Idea', 'Outline', 'Revision'].sort());
  });

  it('throws RangeError for out-of-bounds fromIndex', () => {
    expect(() =>
      handleReorderLanes(root, { storySlug: STORY_SLUG, fromIndex: 99, toIndex: 0 })
    ).toThrow(RangeError);
  });
});

// ─── §11  resolveBrainstormLane ───────────────────────────────────────────────

describe('§11 resolveBrainstormLane', () => {
  let root: string;
  beforeEach(() => { root = tmpDir(); seedBoard(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns the Idea lane index (0) when laneId is absent', () => {
    const board = readBoardDisk(root);
    expect(resolveBrainstormLane(board)).toBe(0);
  });

  it('returns the index of the named lane when laneId matches', () => {
    const board = readBoardDisk(root);
    expect(resolveBrainstormLane(board, 'Draft')).toBe(2);
  });

  it('falls back to Idea lane when laneId does not match any lane', () => {
    const board = readBoardDisk(root);
    expect(resolveBrainstormLane(board, 'NonExistent')).toBe(0);
  });

  it('falls back to index 0 when no Idea lane exists', () => {
    handleRenameLane(root, { storySlug: STORY_SLUG, laneIndex: 0, name: 'Brainstorm' });
    const board = readBoardDisk(root);
    expect(resolveBrainstormLane(board)).toBe(0);
  });
});
