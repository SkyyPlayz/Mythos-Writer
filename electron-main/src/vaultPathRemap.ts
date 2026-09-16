/**
 * SKY-11154 — pure helpers for the "Vaults folder" Move… flow.
 *
 * When the user relocates the parent folder that holds every Mythos vault
 * (VAULT_SURFACE_MOVE_VAULTS_PARENT), every persisted absolute path that
 * lived under the old parent must be rewritten to live under the new one.
 * Kept here, side-effect-free, so the remap logic is unit-testable without
 * touching the filesystem or Electron.
 */

import path from 'node:path';

/**
 * Rewrite `targetPath` so that it lives under `newPrefix` instead of
 * `oldPrefix`, when (and only when) `targetPath` is `oldPrefix` itself or is
 * nested inside it. Paths outside `oldPrefix` are returned unchanged.
 */
export function remapPathUnderPrefix(
  targetPath: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedOld = path.resolve(oldPrefix);
  const resolvedNew = path.resolve(newPrefix);

  if (resolvedTarget === resolvedOld) return resolvedNew;

  const oldWithSep = resolvedOld.endsWith(path.sep) ? resolvedOld : resolvedOld + path.sep;
  if (!resolvedTarget.startsWith(oldWithSep)) return targetPath;

  const relative = resolvedTarget.slice(oldWithSep.length);
  return path.join(resolvedNew, relative);
}

/** Minimal shape of the persisted settings fields the move flow remaps. */
export interface RemappableVaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
  vaultsParentPath?: string;
  recentProjects?: Array<{ vaultRoot: string; notesVaultRoot?: string }>;
  hiddenVaultRoots?: string[];
}

/**
 * Remap every absolute path in a VaultSettings-shaped object that lives
 * under `oldPrefix` to live under `newPrefix`. Fields outside `oldPrefix`
 * (or absent) are left untouched. Returns a new object — never mutates the
 * input.
 */
export function remapVaultSettingsPaths<T extends RemappableVaultSettings>(
  settings: T,
  oldPrefix: string,
  newPrefix: string,
): T & { vaultsParentPath: string } {
  const remap = (p: string) => remapPathUnderPrefix(p, oldPrefix, newPrefix);

  // Cast at the boundary: the object we build only claims to satisfy the
  // RemappableVaultSettings shape structurally; TS cannot verify a spread of
  // a generic T plus overrides is still exactly T, so we assert it here
  // instead of losing type safety for every caller of this function.
  return {
    ...settings,
    ...(settings.vaultRoot ? { vaultRoot: remap(settings.vaultRoot) } : {}),
    ...(settings.notesVaultRoot ? { notesVaultRoot: remap(settings.notesVaultRoot) } : {}),
    vaultsParentPath: newPrefix,
    ...(settings.recentProjects
      ? {
          recentProjects: settings.recentProjects.map((p) => ({
            ...p,
            vaultRoot: remap(p.vaultRoot),
            ...(p.notesVaultRoot ? { notesVaultRoot: remap(p.notesVaultRoot) } : {}),
          })),
        }
      : {}),
    ...(settings.hiddenVaultRoots
      ? { hiddenVaultRoots: settings.hiddenVaultRoots.map(remap) }
      : {}),
  } as T & { vaultsParentPath: string };
}
