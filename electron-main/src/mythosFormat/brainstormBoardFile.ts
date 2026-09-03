// SKY-11360 — brainstorm / idea board persistence in the Agent Vault.
//
// The board is machine state (auto-persisted card positions + a one-shot
// draft-migration flag), NOT user writing. It must never appear in the Notes
// Vault tree beside the user's own folders. Like agent chat sessions
// (SKY-10952), it lives under the third MythosVault sibling — the Agent Vault —
// so it survives vault copy / Dropbox sync without polluting the notes tree.
//
// Location: `Agent Vault/Boards/brainstorm.board.json`.
//
// SUPERSEDED 2026-09-02 (SKY-11360, owner ruling `agent-vault-third-vault-ruling`):
// the board originally lived at `Notes Vault/Boards/brainstorm.board.json`,
// where the raw JSON blob showed up in the user's notes tree.
// migrateBrainstormBoardToAgentVault() below moves any pre-existing file for
// vaults created before this change — it must never orphan a populated board.
//
// Root-agnostic read/write (the caller passes the Agent Vault root) except the
// migration, which knows both the Notes and Agent vault roots.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import {
  readVaultFileWithRetry,
  writeVaultFileAtomic,
  renameSyncWithRetry,
} from '../vault.js';
import { agentVaultRootFor, notesVaultRootFor } from './mythosJson.js';

/** Agent-Vault-relative path of the unified brainstorm board file. */
export const BRAINSTORM_BOARD_RELPATH = path.posix.join('Boards', 'brainstorm.board.json');

/** Read the board file. `{ error }` = no board yet (or unreadable). */
export function readBrainstormBoard(
  agentVaultRoot: string,
): { content: string } | { error: string } {
  try {
    const { content } = readVaultFileWithRetry(agentVaultRoot, BRAINSTORM_BOARD_RELPATH);
    return { content };
  } catch (err) {
    return { error: (err as NodeJS.ErrnoException).code ?? 'read failed' };
  }
}

/** Serialize the board to disk atomically. `{ error }` on failure. */
export function writeBrainstormBoard(
  agentVaultRoot: string,
  content: string,
): { bytes: number } | { error: string } {
  try {
    const { bytes } = writeVaultFileAtomic(agentVaultRoot, BRAINSTORM_BOARD_RELPATH, content);
    return { bytes };
  } catch (err) {
    return { error: (err as Error).message || 'write failed' };
  }
}

/** `name.json` → `name (2).json`, … until `dir` has no collision. */
function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

/**
 * SKY-11360 (owner ruling 2026-09-02): one-shot per-vault move of a
 * pre-existing `Notes Vault/Boards/brainstorm.board.json` onto the Agent
 * Vault. Safe to call on every vault open — a single existsSync check once
 * migrated. Never orphans a populated board:
 *  - If the Agent Vault has no board yet, the legacy file is moved as-is.
 *  - If one already exists (a newer build wrote first), the legacy file is
 *    parked beside it under a unique name rather than overwritten or dropped.
 * After the move, the now-empty `Notes Vault/Boards/` folder is removed so it
 * leaves the notes tree — but only when empty; Scene Crafter's user-created
 * `Boards/<storySlug>/` boards keep the folder alive and are left untouched.
 */
export function migrateBrainstormBoardToAgentVault(mythosRoot: string): { migrated: boolean } {
  const notesBoardsDir = path.join(notesVaultRootFor(mythosRoot), 'Boards');
  const legacyPath = path.join(notesBoardsDir, 'brainstorm.board.json');
  if (!fs.existsSync(legacyPath)) return { migrated: false };

  const destDir = path.join(agentVaultRootFor(mythosRoot), 'Boards');
  const destPath = path.join(destDir, 'brainstorm.board.json');
  fs.mkdirSync(destDir, { recursive: true });

  const target = fs.existsSync(destPath)
    ? path.join(destDir, uniqueName(destDir, 'brainstorm.board.legacy.json'))
    : destPath;

  try {
    renameSyncWithRetry(legacyPath, target);
  } catch {
    // Leave the legacy file in place rather than lose it — retried next open.
    return { migrated: false };
  }

  // AC4: drop the leaked `Boards/` folder from the notes tree once empty.
  // rmdir fails (harmlessly) when Scene Crafter boards still live there.
  try { fs.rmdirSync(notesBoardsDir); } catch { /* not empty, or already gone */ }
  return { migrated: true };
}
