// Scene Crafter IPC handler logic — no Electron imports.
// Each handler takes notesVaultRoot as the first argument to allow unit testing.
import * as fs from 'fs';
import * as path from 'path';
import {
  parseBoardMarkdown,
  serializeBoardMarkdown,
  createBoard as createBoardModel,
  boardRelPath,
  type SceneCrafterBoard,
  type BoardCard,
} from './sceneCrafterBoard.js';
import { writeFileAtomic } from './vault.js';
import { beginBoardWrite, endBoardWrite } from './sceneCrafterWatcher.js';

// How long to keep the write-lock after a successful write, in milliseconds.
// Must exceed the chokidar awaitWriteFinish stabilityThreshold (300 ms) so the
// watcher event for our own write is suppressed rather than treated as an
// external edit.
const WRITE_LOCK_HOLD_MS = 600;
import type {
  SceneCrafterGetBoardPayload,
  SceneCrafterCreateBoardPayload,
  SceneCrafterAddCardPayload,
  SceneCrafterMoveCardPayload,
  SceneCrafterToggleCardDonePayload,
  SceneCrafterDeleteCardPayload,
  SceneCrafterAddLanePayload,
  SceneCrafterRenameLanePayload,
  SceneCrafterDeleteLanePayload,
  SceneCrafterReorderLanesPayload,
} from './ipc.js';

// ─── Internal helpers ───

function absPath(notesVaultRoot: string, storySlug: string): string {
  return path.join(notesVaultRoot, boardRelPath(storySlug));
}

function readBoard(notesVaultRoot: string, storySlug: string): SceneCrafterBoard | null {
  const p = absPath(notesVaultRoot, storySlug);
  if (!fs.existsSync(p)) return null;
  return parseBoardMarkdown(fs.readFileSync(p, 'utf-8'));
}

function writeBoard(notesVaultRoot: string, storySlug: string, board: SceneCrafterBoard): void {
  const p = absPath(notesVaultRoot, storySlug);
  beginBoardWrite(p);
  try {
    board.lastModified = new Date().toISOString();
    writeFileAtomic(p, serializeBoardMarkdown(board));
  } finally {
    // Release write-lock after chokidar's awaitWriteFinish window passes so the
    // watcher event for this write is suppressed, not treated as an external edit.
    setTimeout(() => endBoardWrite(p), WRITE_LOCK_HOLD_MS);
  }
}

function validateLaneIndex(board: SceneCrafterBoard, laneIndex: number): void {
  if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= board.lanes.length) {
    throw new RangeError(`Lane index ${laneIndex} out of bounds (lanes: ${board.lanes.length})`);
  }
}

function validateCardIndex(board: SceneCrafterBoard, laneIndex: number, cardIndex: number): void {
  validateLaneIndex(board, laneIndex);
  const cards = board.lanes[laneIndex].cards;
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= cards.length) {
    throw new RangeError(`Card index ${cardIndex} out of bounds (cards: ${cards.length})`);
  }
}

function requireBoard(notesVaultRoot: string, storySlug: string): SceneCrafterBoard {
  const board = readBoard(notesVaultRoot, storySlug);
  if (!board) throw new Error(`Board file not found for story slug: ${storySlug}`);
  return board;
}

// ─── Exported handlers ───

export function handleGetBoard(
  notesVaultRoot: string,
  payload: SceneCrafterGetBoardPayload
): SceneCrafterBoard | null {
  return readBoard(notesVaultRoot, payload.storySlug);
}

export function handleCreateBoard(
  notesVaultRoot: string,
  payload: SceneCrafterCreateBoardPayload
): SceneCrafterBoard {
  const existing = readBoard(notesVaultRoot, payload.storySlug);
  if (existing) return existing;
  const board = createBoardModel(payload.storyId);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return readBoard(notesVaultRoot, payload.storySlug)!;
}

export function handleAddCard(
  notesVaultRoot: string,
  payload: SceneCrafterAddCardPayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateLaneIndex(board, payload.laneIndex);
  const card: BoardCard = {
    wikilink: payload.card.wikilink,
    title: payload.card.title,
    done: payload.card.done ?? false,
    tags: payload.card.tags ?? [],
    raw: '', // empty → serializer regenerates the markdown line
  };
  board.lanes[payload.laneIndex].cards.push(card);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleMoveCard(
  notesVaultRoot: string,
  payload: SceneCrafterMoveCardPayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateCardIndex(board, payload.fromLane, payload.fromIndex);
  validateLaneIndex(board, payload.toLane);
  const destCards = board.lanes[payload.toLane].cards;
  if (!Number.isInteger(payload.toIndex) || payload.toIndex < 0 || payload.toIndex > destCards.length) {
    throw new RangeError(`toIndex ${payload.toIndex} out of bounds for destination lane (cards: ${destCards.length})`);
  }
  const [card] = board.lanes[payload.fromLane].cards.splice(payload.fromIndex, 1);
  board.lanes[payload.toLane].cards.splice(payload.toIndex, 0, card);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleToggleCardDone(
  notesVaultRoot: string,
  payload: SceneCrafterToggleCardDonePayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateCardIndex(board, payload.laneIndex, payload.cardIndex);
  const card = board.lanes[payload.laneIndex].cards[payload.cardIndex];
  card.done = !card.done;
  card.raw = ''; // clear so serializer rebuilds the checkbox line
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleDeleteCard(
  notesVaultRoot: string,
  payload: SceneCrafterDeleteCardPayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateCardIndex(board, payload.laneIndex, payload.cardIndex);
  board.lanes[payload.laneIndex].cards.splice(payload.cardIndex, 1);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleAddLane(
  notesVaultRoot: string,
  payload: SceneCrafterAddLanePayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  board.lanes.push({ name: payload.name, cards: [] });
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleRenameLane(
  notesVaultRoot: string,
  payload: SceneCrafterRenameLanePayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateLaneIndex(board, payload.laneIndex);
  board.lanes[payload.laneIndex].name = payload.name;
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

export function handleDeleteLane(
  notesVaultRoot: string,
  payload: SceneCrafterDeleteLanePayload
): { ok: boolean; cardCount: number } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateLaneIndex(board, payload.laneIndex);
  const cardCount = board.lanes[payload.laneIndex].cards.length;
  if (cardCount > 0 && !payload.force) {
    return { ok: false, cardCount };
  }
  board.lanes.splice(payload.laneIndex, 1);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true, cardCount };
}

export function handleReorderLanes(
  notesVaultRoot: string,
  payload: SceneCrafterReorderLanesPayload
): { ok: true } {
  const board = requireBoard(notesVaultRoot, payload.storySlug);
  validateLaneIndex(board, payload.fromIndex);
  validateLaneIndex(board, payload.toIndex);
  const [lane] = board.lanes.splice(payload.fromIndex, 1);
  board.lanes.splice(payload.toIndex, 0, lane);
  writeBoard(notesVaultRoot, payload.storySlug, board);
  return { ok: true };
}

/**
 * Maps a brainstorm suggestion to a lane index.
 * When laneId is absent or no matching lane exists, defaults to the first lane
 * named "Idea" (CEO-confirmed default). Falls back to index 0 if no Idea lane.
 */
export function resolveBrainstormLane(board: SceneCrafterBoard, laneId?: string): number {
  if (laneId !== undefined) {
    const idx = board.lanes.findIndex(l => l.name === laneId);
    if (idx >= 0) return idx;
  }
  const ideaIdx = board.lanes.findIndex(l => l.name === 'Idea');
  return ideaIdx >= 0 ? ideaIdx : 0;
}
