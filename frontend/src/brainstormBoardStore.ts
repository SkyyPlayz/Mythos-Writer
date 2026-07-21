// Beta 4 / M20 — brainstorm board persistence (M5 files-first storage).
//
// Same convention as the Scene Crafter board store: a plain JSON file inside
// the Notes Vault, written through the SKY-9 vault CRUD IPC bridge. The vault
// IPC extension allow-list admits `.md` / `.json` only, and `.mythos/` is
// reserved for main-process internals, so the board lives at a vault-visible
// path — it survives vault copy / Dropbox sync and restarts (M20 acceptance:
// positions survive restart).

import { parseBoardFile, type BrainstormBoardData } from './brainstormBoard';

export const BRAINSTORM_BOARD_PATH = 'Boards/brainstorm.board.json';

/** Read the unified board file. `null` = no board yet (or unreadable). */
export async function loadBrainstormBoard(): Promise<BrainstormBoardData | null> {
  const api = window.api;
  if (typeof api?.readNotesVault !== 'function') return null;
  try {
    const read = await api.readNotesVault(BRAINSTORM_BOARD_PATH);
    if ('error' in read) return null;
    return parseBoardFile(read.content);
  } catch {
    return null;
  }
}

/** Serialize + write the board. Returns false when the vault is unavailable. */
export async function saveBrainstormBoard(board: BrainstormBoardData): Promise<boolean> {
  const api = window.api;
  if (typeof api?.writeNotesVault !== 'function') return false;
  try {
    const result = await api.writeNotesVault(
      BRAINSTORM_BOARD_PATH,
      JSON.stringify(board, null, 2),
    );
    return !('error' in result);
  } catch {
    return false;
  }
}
