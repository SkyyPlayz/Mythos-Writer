// SKY-11068 — per-vault icon collection/mutation for the story switcher and
// Settings > Mythos vaults. Mirrors projectStats.ts: pure-ish functions over
// an explicit list of vault roots, tolerant of missing/legacy (v0.4) vaults.
// SKY-11453 also puts vault-local rename here — same vault-root gate, same
// read/mutate/write-mythos.json shape as the icon setter below.
import {
  mythosRootForStoryVault,
  tryReadMythosFile,
  writeMythosFile,
  sanitizeVaultIcon,
} from './mythosFormat/mythosJson.js';
import {
  importVaultIconFile,
  readVaultIconAsDataUrl,
  removeVaultIconFiles,
} from './vaultIconFile.js';
import type {
  ProjectIconSetPayload,
  ProjectIconSetResponse,
  ProjectNameSetPayload,
  ProjectNameSetResponse,
  VaultIconEntry,
} from './ipc.js';

/** SKY-11453: cap + strip control chars — mirrors sanitizeVaultIcon's glyph
 *  guard. Generous length since this is a free-text display name, not a
 *  filesystem segment (mythos.json's `name` is never joined onto a path). */
function sanitizeVaultName(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\n\r\0]/g, '');
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

/**
 * Resolve the stored icon (if any) for each vault root. Roots that aren't a
 * v2 Mythos vault, or that have no icon set, come back with `kind: null` so
 * the renderer falls back to its initials-on-accent default.
 * Deduplicated by `vaultRoot` (first entry wins — callers pass the active
 * vault first; recents follow in stable registration order, SKY-11238).
 */
export async function collectProjectIcons(
  vaultRoots: Array<{ vaultRoot: string }>,
): Promise<VaultIconEntry[]> {
  const seen = new Set<string>();
  const uniqueRoots: string[] = [];
  for (const entry of vaultRoots) {
    if (!entry.vaultRoot || seen.has(entry.vaultRoot)) continue;
    seen.add(entry.vaultRoot);
    uniqueRoots.push(entry.vaultRoot);
  }
  // SKY-11108: resolve every root concurrently — each is an independent
  // async icon-file read, so there's no reason to serialize them.
  return Promise.all(uniqueRoots.map(resolveVaultIcon));
}

async function resolveVaultIcon(vaultRoot: string): Promise<VaultIconEntry> {
  const mythosRoot = mythosRootForStoryVault(vaultRoot);
  if (!mythosRoot) return { vaultRoot, kind: null };
  const mythosFile = tryReadMythosFile(mythosRoot);
  const icon = mythosFile?.icon;
  if (!icon) return { vaultRoot, kind: null };
  if (icon.kind === 'glyph') return { vaultRoot, kind: 'glyph', value: icon.value };
  const { dataUrl } = await readVaultIconAsDataUrl(mythosRoot, icon.file);
  if (!dataUrl) return { vaultRoot, kind: null };
  return { vaultRoot, kind: 'image', dataUrl };
}

/**
 * Set (or clear) a vault's icon. Vault-local: writes into the vault's own
 * mythos.json + (for images) a file at the mythos root, so the icon travels
 * with the vault on move/copy (SKY-10949).
 */
export async function setProjectIcon(payload: ProjectIconSetPayload): Promise<ProjectIconSetResponse> {
  const mythosRoot = mythosRootForStoryVault(payload.vaultRoot);
  if (!mythosRoot) return { ok: false, error: 'Not a Mythos vault (v0.4 legacy vaults cannot store an icon).' };
  const mythosFile = tryReadMythosFile(mythosRoot);
  if (!mythosFile) return { ok: false, error: 'Could not read this vault’s mythos.json.' };

  if (payload.icon === null) {
    removeVaultIconFiles(mythosRoot);
    const { icon: _icon, ...rest } = mythosFile;
    writeMythosFile(mythosRoot, rest);
    return { ok: true, icon: { vaultRoot: payload.vaultRoot, kind: null } };
  }

  if (payload.icon.kind === 'glyph') {
    const sanitized = sanitizeVaultIcon({ kind: 'glyph', value: payload.icon.value });
    if (!sanitized || sanitized.kind !== 'glyph') return { ok: false, error: 'Invalid glyph.' };
    removeVaultIconFiles(mythosRoot);
    writeMythosFile(mythosRoot, { ...mythosFile, icon: sanitized });
    return { ok: true, icon: { vaultRoot: payload.vaultRoot, kind: 'glyph', value: sanitized.value } };
  }

  // kind === 'image'
  const { file } = importVaultIconFile(mythosRoot, payload.icon.sourcePath);
  if (!file) return { ok: false, error: 'Could not import that image.' };
  const sanitized = sanitizeVaultIcon({ kind: 'image', file });
  if (!sanitized) return { ok: false, error: 'Invalid icon file.' };
  writeMythosFile(mythosRoot, { ...mythosFile, icon: sanitized });
  const { dataUrl } = await readVaultIconAsDataUrl(mythosRoot, file);
  return { ok: true, icon: { vaultRoot: payload.vaultRoot, kind: 'image', dataUrl: dataUrl ?? undefined } };
}

/**
 * SKY-11453: rename a vault in place — writes into the vault's own
 * mythos.json `name` field so the display name travels with the vault on
 * move/copy, instead of living only in this machine's app-settings.json.
 */
export async function setProjectName(payload: ProjectNameSetPayload): Promise<ProjectNameSetResponse> {
  const mythosRoot = mythosRootForStoryVault(payload.vaultRoot);
  if (!mythosRoot) return { ok: false, error: 'Not a Mythos vault (v0.4 legacy vaults cannot store a name).' };
  const mythosFile = tryReadMythosFile(mythosRoot);
  if (!mythosFile) return { ok: false, error: 'Could not read this vault’s mythos.json.' };

  const name = sanitizeVaultName(payload.name);
  if (!name) return { ok: false, error: 'Invalid name.' };

  writeMythosFile(mythosRoot, { ...mythosFile, name });
  return { ok: true, name };
}
