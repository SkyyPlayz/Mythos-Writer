// SKY-11068 — per-vault icon collection/mutation for the story switcher and
// Settings > Mythos vaults. Mirrors projectStats.ts: pure-ish functions over
// an explicit list of vault roots, tolerant of missing/legacy (v0.4) vaults.
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
import type { ProjectIconSetPayload, ProjectIconSetResponse, VaultIconEntry } from './ipc.js';

/**
 * Resolve the stored icon (if any) for each vault root. Roots that aren't a
 * v2 Mythos vault, or that have no icon set, come back with `kind: null` so
 * the renderer falls back to its initials-on-accent default.
 * Deduplicated by `vaultRoot` (first entry wins — recents are newest-first).
 */
export function collectProjectIcons(
  vaultRoots: Array<{ vaultRoot: string }>,
): VaultIconEntry[] {
  const seen = new Set<string>();
  const out: VaultIconEntry[] = [];
  for (const entry of vaultRoots) {
    if (!entry.vaultRoot || seen.has(entry.vaultRoot)) continue;
    seen.add(entry.vaultRoot);
    out.push(resolveVaultIcon(entry.vaultRoot));
  }
  return out;
}

function resolveVaultIcon(vaultRoot: string): VaultIconEntry {
  const mythosRoot = mythosRootForStoryVault(vaultRoot);
  if (!mythosRoot) return { vaultRoot, kind: null };
  const mythosFile = tryReadMythosFile(mythosRoot);
  const icon = mythosFile?.icon;
  if (!icon) return { vaultRoot, kind: null };
  if (icon.kind === 'glyph') return { vaultRoot, kind: 'glyph', value: icon.value };
  const { dataUrl } = readVaultIconAsDataUrl(mythosRoot, icon.file);
  if (!dataUrl) return { vaultRoot, kind: null };
  return { vaultRoot, kind: 'image', dataUrl };
}

/**
 * Set (or clear) a vault's icon. Vault-local: writes into the vault's own
 * mythos.json + (for images) a file at the mythos root, so the icon travels
 * with the vault on move/copy (SKY-10949).
 */
export function setProjectIcon(payload: ProjectIconSetPayload): ProjectIconSetResponse {
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
  const { dataUrl } = readVaultIconAsDataUrl(mythosRoot, file);
  return { ok: true, icon: { vaultRoot: payload.vaultRoot, kind: 'image', dataUrl: dataUrl ?? undefined } };
}
