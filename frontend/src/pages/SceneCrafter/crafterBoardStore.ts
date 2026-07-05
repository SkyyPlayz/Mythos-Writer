// Beta 3 / M18 — Scene Crafter canvas-board persistence.
//
// Thin wrapper over the existing Notes-Vault CRUD IPC (SKY-9 bridge:
// window.api.writeNotesVault / readNotesVault / listNotesVault). Boards live
// under `Boards/<storySlug>/` in the Notes Vault and their payload is exactly
// Obsidian-canvas JSON (M17 `boardToCanvasJson`). The vault IPC extension
// allow-list only admits `.md` / `.json` (electron-main/src/vault/
// safeVaultJoin.ts, VAULT_IPC_ALLOWED_EXTENSIONS), so files are written as
// `<name>.canvas.json` — rename to `.canvas` and Obsidian opens them as-is.

import type { CanvasBoardData, ObsidianCanvasJson } from '../../canvas/canvasTypes';
import { boardToCanvasJson, canvasJsonToBoard } from '../../canvas/canvasTypes';
import { normalizeVaultPath, type VaultListItem } from './crafterState';

export const BOARDS_FOLDER = 'Boards';
export const BOARD_FILE_SUFFIX = '.canvas.json';

export function boardsDirForStory(storySlug: string): string {
  return `${BOARDS_FOLDER}/${storySlug}`;
}

/** Filesystem-safe board file name: reserved characters collapse to `-`. */
export function boardFileName(boardName: string): string {
  const safe = boardName
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${safe || 'board'}${BOARD_FILE_SUFFIX}`;
}

export function boardFilePath(storySlug: string, boardName: string): string {
  return `${boardsDirForStory(storySlug)}/${boardFileName(boardName)}`;
}

/** Serialize + write a board. Throws on IPC-reported write errors. */
export async function saveCrafterBoard(
  storySlug: string,
  board: CanvasBoardData,
): Promise<{ path: string }> {
  const path = boardFilePath(storySlug, board.name);
  const content = JSON.stringify(boardToCanvasJson(board), null, 2);
  const result = await window.api.writeNotesVault(path, content);
  if ('error' in result) throw new Error(result.error);
  return { path };
}

/**
 * Load every saved board for a story. Callers that already hold a vault
 * listing pass it via `items` to skip the extra list round-trip. Unreadable
 * or malformed board files are skipped — one bad file must not hide the rest.
 */
export async function loadCrafterBoards(
  storySlug: string,
  items?: VaultListItem[],
): Promise<CanvasBoardData[]> {
  let list = items;
  if (!list) {
    const listing = await window.api.listNotesVault();
    if ('error' in listing) return [];
    list = listing.items;
  }
  const prefix = `${boardsDirForStory(storySlug)}/`;
  const files = list
    .filter((item) => !item.isDirectory)
    .map((item) => ({ name: item.name, path: normalizeVaultPath(item.path) }))
    .filter((item) => item.path.startsWith(prefix) && item.path.endsWith(BOARD_FILE_SUFFIX))
    .sort((a, b) => a.path.localeCompare(b.path));

  const boards: CanvasBoardData[] = [];
  for (const file of files) {
    try {
      const read = await window.api.readNotesVault(file.path);
      if ('error' in read) continue;
      const json = JSON.parse(read.content) as ObsidianCanvasJson;
      if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) continue;
      boards.push(canvasJsonToBoard(json, {
        id: file.path,
        name: file.name.slice(0, -BOARD_FILE_SUFFIX.length),
      }));
    } catch {
      // Skip malformed board JSON; the remaining boards still load.
    }
  }
  return boards;
}
