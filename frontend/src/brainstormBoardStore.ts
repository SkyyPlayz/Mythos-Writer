// Beta 4 / M20 — brainstorm board persistence.
//
// SKY-11360 (owner ruling `agent-vault-third-vault-ruling`, 2026-09-02): the
// board is agent state, not user writing, so it must NOT live in the Notes
// Vault where its raw JSON showed up in the user's notes tree. It now persists
// in the Agent Vault via a dedicated main-process bridge — the renderer never
// names the path; the main process owns `Boards/brainstorm.board.json` under
// the Agent Vault root and migrates any pre-existing notes-vault file on open.

import { parseBoardFile, type BrainstormBoardData } from './brainstormBoard';

/** Read the unified board file. `null` = no board yet (or unreadable). */
export async function loadBrainstormBoard(): Promise<BrainstormBoardData | null> {
  const api = window.api;
  if (typeof api?.brainstormBoard?.read !== 'function') return null;
  try {
    const read = await api.brainstormBoard.read();
    if ('error' in read) return null;
    return parseBoardFile(read.content);
  } catch {
    return null;
  }
}

/** Serialize + write the board. Returns false when the vault is unavailable. */
export async function saveBrainstormBoard(board: BrainstormBoardData): Promise<boolean> {
  const api = window.api;
  if (typeof api?.brainstormBoard?.write !== 'function') return false;
  try {
    const result = await api.brainstormBoard.write(JSON.stringify(board, null, 2));
    return !('error' in result);
  } catch {
    return false;
  }
}
