// Beta 4 / M20 — brainstorm board store (Notes-Vault JSON via the SKY-9 CRUD
// IPC bridge). Mirrors the SceneCrafter crafterBoardStore conventions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBoard, migrateDraftFactsToBoard } from './brainstormBoard';
import {
  BRAINSTORM_BOARD_PATH,
  loadBrainstormBoard,
  saveBrainstormBoard,
} from './brainstormBoardStore';

const mockRead = vi.fn();
const mockWrite = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    readNotesVault: mockRead,
    writeNotesVault: mockWrite,
  };
});

describe('brainstormBoardStore', () => {
  it('persists to a vault-visible .json path (M5 files-first storage)', () => {
    expect(BRAINSTORM_BOARD_PATH).toBe('Boards/brainstorm.board.json');
  });

  it('save → load round-trips the board through the vault IPC', async () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), [
      { id: 'f1', type: 'character', name: 'Mira', content: 'Protagonist', createdAt: 1 },
    ]);
    mockWrite.mockResolvedValue({ path: BRAINSTORM_BOARD_PATH, bytes: 1 });

    expect(await saveBrainstormBoard(board)).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith(BRAINSTORM_BOARD_PATH, expect.any(String));

    const written = mockWrite.mock.calls[0][1] as string;
    mockRead.mockResolvedValue({ content: written, path: BRAINSTORM_BOARD_PATH });
    expect(await loadBrainstormBoard()).toEqual(board);
  });

  it('returns null when the board file is missing or unreadable', async () => {
    mockRead.mockResolvedValue({ error: 'ENOENT' });
    expect(await loadBrainstormBoard()).toBeNull();

    mockRead.mockResolvedValue({ content: 'not json', path: BRAINSTORM_BOARD_PATH });
    expect(await loadBrainstormBoard()).toBeNull();

    mockRead.mockRejectedValue(new Error('ipc down'));
    expect(await loadBrainstormBoard()).toBeNull();
  });

  it('degrades silently when the vault bridge is absent (no window.api)', async () => {
    (window as unknown as { api: unknown }).api = {};
    expect(await loadBrainstormBoard()).toBeNull();
    expect(await saveBrainstormBoard(createEmptyBoard())).toBe(false);
  });

  it('reports write failures instead of throwing', async () => {
    mockWrite.mockResolvedValue({ error: 'disk full' });
    expect(await saveBrainstormBoard(createEmptyBoard())).toBe(false);
    mockWrite.mockRejectedValue(new Error('ipc down'));
    expect(await saveBrainstormBoard(createEmptyBoard())).toBe(false);
  });
});
