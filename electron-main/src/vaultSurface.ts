/**
 * SKY-11153 — Vault surface delete/hide (Recycle Bin semantics).
 *
 * Single source of truth for:
 *   - trashVaultFolder(): shell.trashItem ONLY, never fs.rm, no fallback.
 *   - getBlastRadius(): count inner vaults for the 2-confirm Mythos flow.
 *   - VAULT_SURFACE_COPY: all user-visible confirm/error strings.
 *
 * The Settings-page ticket (SKY-11153) wires UI to the IPC handlers in
 * main.ts; this module owns the logic those handlers call.
 */

import { shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { isMythosV2Root } from './mythosFormat/mythosJson.js';
import { ensureNotesVaultRegistry } from './mythosFormat/notesVaultRegistry.js';
import { ensureStoryVaultRegistry } from './mythosFormat/storyVaultRegistry.js';
import type { ProjectEntry } from './ipc.js';

// ─── User-visible copy strings ────────────────────────────────────────────────
// Centralised so the Settings UI can import without touching this logic.

export const VAULT_SURFACE_COPY = {
  // 1-confirm: inner vault (notes vault or story vault card)
  innerVaultTrashTitle: 'Move to Recycle Bin?',
  innerVaultTrashBody: (vaultName: string) =>
    `"${vaultName}" will be moved to the Recycle Bin. You can restore it from there if you change your mind.`,
  innerVaultTrashConfirm: 'Move to Recycle Bin',

  // 2-confirm first step: Mythos vault — names vault + blast radius
  mythosTrashTitle1: 'Move Mythos Vault to Recycle Bin?',
  mythosTrashBody1: (vaultName: string, innerCount: number) =>
    `"${vaultName}" contains ${innerCount} inner vault${innerCount !== 1 ? 's' : ''} ` +
    `(story + notes). Everything inside will be moved to the Recycle Bin together.`,
  mythosTrashConfirm1: 'Continue',

  // 2-confirm second step: final gate
  mythosTrashTitle2: 'This cannot be undone from within Mythos Writer.',
  mythosTrashBody2: (vaultName: string, innerCount: number) =>
    `"${vaultName}" and its ${innerCount} inner vault${innerCount !== 1 ? 's' : ''} will be moved to the Recycle Bin. ` +
    `You can restore them from the Recycle Bin if you change your mind.`,
  mythosTrashConfirm2: 'Move to Recycle Bin',

  // Hide — single confirm
  hideTitle: 'Hide vault?',
  hideBody: (vaultName: string) =>
    `"${vaultName}" will be hidden from this list. The folder stays exactly where it is — ` +
    `it won't be moved or deleted, and syncing continues if active.`,
  // Variant for a notes vault that is paired with a story vault
  hideBodyPairedNotes: (vaultName: string, linkedStoryVaultName: string) =>
    `"${vaultName}" is linked to "${linkedStoryVaultName}". ` +
    `Hiding it won't break the link — the story vault will show a "target hidden" indicator, ` +
    `syncing continues, and the folder stays exactly where it is.`,
  hideConfirm: 'Hide',

  // Errors
  trashFailedTitle: 'Could not move to Recycle Bin',
  trashFailedBody: (vaultName: string, reason: string) =>
    `"${vaultName}" could not be moved to the Recycle Bin: ${reason}\n\n` +
    `The folder has not been modified.`,
} as const;

// ─── Blast radius ─────────────────────────────────────────────────────────────

export interface BlastRadius {
  vaultName: string;
  /** Registered notes-vault count + story-vault count. Matches the card's own
   *  `notesVaultCount`/`storyVaultCount` stats (projectStats.ts). */
  innerCount: number;
}

/**
 * Count the inner vault directories for the Mythos-vault 2-confirm dialog.
 *
 * For a v2 vault, reads the notes/story vault registries — the same source
 * of truth `collectProjectStats` uses for the card's displayed count
 * (SKY-11322) — rather than a raw directory listing, which over-counts any
 * non-vault directory the default scaffold happens to write alongside them.
 *
 * A legacy (pre-v2, no mythos.json) root reports the implicit 1 story + 1
 * notes vault, matching `countInnerVaults`'s fallback — and, critically,
 * never calls the `ensure*VaultRegistry` writers on a legacy root, which
 * would otherwise plant new v2 registry files inside a vault folder that
 * was never migrated, just from opening the delete menu.
 *
 * A registry read/write failure on a genuine v2 root also falls back to the
 * implicit 1+1 pair rather than 0 — mirroring `countInnerVaults`'s own
 * try/catch exactly, so the delete dialog and the card never disagree.
 */
export function getBlastRadius(mythosVaultRoot: string): BlastRadius {
  const vaultName = path.basename(mythosVaultRoot);
  let innerCount = 0;
  try {
    if (isMythosV2Root(mythosVaultRoot)) {
      try {
        const notesCount = ensureNotesVaultRegistry(mythosVaultRoot).vaults.length;
        const storyCount = ensureStoryVaultRegistry(mythosVaultRoot).vaults.length;
        innerCount = notesCount + storyCount;
      } catch {
        innerCount = 2;
      }
    } else if (fs.existsSync(mythosVaultRoot)) {
      innerCount = 2;
    }
  } catch {
    // Unreadable/malformed vault — report 0; UI still shows the confirm dialog.
  }
  return { vaultName, innerCount };
}

// ─── recentProjects cleanup on trash (SKY-11202) ─────────────────────────────

/**
 * Compute the `recentProjects` list after trashing `vaultPath` at `level`.
 *
 * recentProjects entries are keyed by Story Vault `vaultRoot`, with an
 * optional `notesVaultRoot` pointing at the paired Notes Vault. The three
 * trash levels need different surgery so no entry is left pointing at a
 * path that `shell.trashItem` just removed:
 *   - 'mythos': the trashed path is a Mythos Vault root — drop every entry
 *     whose vaultRoot is that root or nested under it (story + notes both
 *     live inside it, so the whole entry goes).
 *   - 'story': the trashed path IS an entry's vaultRoot — drop that entry.
 *   - 'notes': the trashed path is only ever referenced via an entry's
 *     `notesVaultRoot` field, never its `vaultRoot`. The paired Story
 *     Vault entry must survive (it still exists on disk) but its
 *     `notesVaultRoot` pointer must be cleared — otherwise it dangles at a
 *     now-nonexistent folder and later blocks re-switching into that
 *     project (PROJECT_SWITCH validates notesVaultRoot against this field
 *     and then checks the path still exists on disk).
 */
export function pruneRecentProjectsForTrash(
  recentProjects: ProjectEntry[],
  vaultPath: string,
  level: 'mythos' | 'notes' | 'story',
): ProjectEntry[] {
  const resolved = path.resolve(vaultPath);

  if (level === 'mythos') {
    return recentProjects.filter((p) => {
      const r = path.resolve(p.vaultRoot);
      return r !== resolved && !r.startsWith(resolved + path.sep);
    });
  }

  if (level === 'story') {
    return recentProjects.filter((p) => path.resolve(p.vaultRoot) !== resolved);
  }

  // level === 'notes': keep every entry, but clear a dangling notesVaultRoot.
  return recentProjects.map((p) => {
    if (p.notesVaultRoot != null && path.resolve(p.notesVaultRoot) === resolved) {
      const { notesVaultRoot: _drop, ...rest } = p;
      return rest;
    }
    return p;
  });
}

// ─── Trash (shell.trashItem ONLY) ────────────────────────────────────────────

export interface TrashResult {
  trashed: boolean;
  /** Present on failure — human-readable OS error message. */
  error?: string;
}

/**
 * Move `vaultPath` to the OS Recycle Bin / Trash via `shell.trashItem`.
 *
 * NEVER falls back to `fs.rm` / `rmSync` under any circumstance.
 * If trashing fails (network path, permissions, trash disabled, Windows
 * delete-pending ghost), the error is returned and the folder is left
 * entirely untouched. Recycle-Bin recoverability is the safety guarantee
 * this whole API exists to provide.
 *
 * Callers MUST stop any file watchers and close any DB handles for the
 * vault before calling this — see main.ts handlers for the stop sequence.
 */
export async function trashVaultFolder(vaultPath: string): Promise<TrashResult> {
  try {
    await shell.trashItem(vaultPath);
    return { trashed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { trashed: false, error: message };
  }
}
