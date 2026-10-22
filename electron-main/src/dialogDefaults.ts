// In-memory last folder for native dialogs (Electron 43+).
//
// When defaultPath is omitted, Electron opens Downloads and the OS no longer
// restores the previous folder. Two buckets so an image import cannot move
// where Open Vault starts. Nothing here is written to disk, and no path is
// taken from renderer input.

import path from 'node:path';

export type DialogDefaultKind = 'vault' | 'import';

const lastFolder = new Map<DialogDefaultKind, string>();

export function resetDialogDefaultsForTests(): void {
  lastFolder.clear();
}

/** Remember the parent of a non-cancelled pick. Cancel and empty results no-op. */
export function rememberFrom(
  kind: DialogDefaultKind,
  result: { canceled?: boolean; filePaths?: readonly string[] },
): void {
  if (result.canceled) return;
  const picked = result.filePaths?.[0];
  if (!picked) return;
  lastFolder.set(kind, path.dirname(picked));
}

export function defaultFor(kind: DialogDefaultKind): string | undefined {
  return lastFolder.get(kind);
}

/**
 * Open Vault's starting folder: parent of the current vault root when one is
 * set, otherwise the last vault pick, otherwise unset (Electron's Downloads).
 */
export function vaultOpenDefaultPath(vaultRoot: string | null | undefined): string | undefined {
  if (vaultRoot) return path.dirname(vaultRoot);
  return defaultFor('vault');
}
