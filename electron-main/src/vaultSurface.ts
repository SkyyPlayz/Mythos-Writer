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
  /** Directory count directly inside the Mythos vault root. Story + Notes = 2. */
  innerCount: number;
}

/**
 * Count the inner vault directories for the Mythos-vault 2-confirm dialog.
 * Does not recurse — only direct children of `mythosVaultRoot` that are dirs.
 */
export function getBlastRadius(mythosVaultRoot: string): BlastRadius {
  const vaultName = path.basename(mythosVaultRoot);
  let innerCount = 0;
  try {
    const entries = fs.readdirSync(mythosVaultRoot, { withFileTypes: true });
    innerCount = entries.filter((e) => e.isDirectory()).length;
  } catch {
    // Unreadable dir — report 0; UI still shows the confirm dialog.
  }
  return { vaultName, innerCount };
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
