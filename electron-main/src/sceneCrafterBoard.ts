// Scene Crafter board IPC handler — dedicated read/write for Kanban boards.
// Boards are Obsidian-Kanban-compatible markdown files stored in the vault.
// Using dedicated channels (kanban:read / kanban:write) rather than generic
// vault channels keeps board operations explicit and allows the handler to
// register the board path in manifest.boardReferences.
import { readVaultFile, writeVaultFile } from './vault.js';
import type { Manifest } from './ipc.js';

export interface BoardReadResult {
  content: string;
  path: string;
}

export interface BoardWriteResult {
  path: string;
  bytes: number;
}

export function readBoard(vaultRoot: string, boardPath: string): BoardReadResult | null {
  try {
    return readVaultFile(vaultRoot, boardPath);
  } catch {
    return null;
  }
}

export function writeBoard(
  vaultRoot: string,
  boardPath: string,
  content: string,
  manifest?: Manifest,
): BoardWriteResult {
  const result = writeVaultFile(vaultRoot, boardPath, content);
  if (manifest && !manifest.boardReferences.includes(boardPath)) {
    manifest.boardReferences.push(boardPath);
  }
  return result;
}
