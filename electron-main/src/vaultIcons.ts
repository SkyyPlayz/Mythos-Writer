// SKY-9310 (M8 spec item 6, Iconize-style icons): path-keyed icon assignments
// for the Notes Vault tree, stored at `.mythos/icons.json` (notes vault root).
//
// Shape: Record<relPath, iconValue>, where `relPath` is the item's relative
// POSIX path (works for both files and directories — unlike the pre-existing
// per-note frontmatter `icon:` field, which only files can carry) and
// `iconValue` is either an emoji/character or a `pack:<packName>/<iconName>`
// reference (see IconPicker.tsx). Icons are never encoded into the filename,
// so rename/move never touches the on-disk name — only this sidecar.
//
// `.mythos/` is a dot-segment, already excluded from the Notes tree by
// notesListing.ts rule 1, and from `.vb-order.json`'s sibling directory
// choice — kept as its own subdirectory (vs. a bare dot-file) so this can grow
// to hold other vault-metadata sidecars per the plan's `.mythos/` naming.
//
// Pure Node (fs/path only) — unit-testable without Electron.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './vault.js';

export const ICONS_DIR_NAME = '.mythos';
export const ICONS_FILE_NAME = 'icons.json';

export type VaultIconMap = Record<string, string>;

function iconsFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, ICONS_DIR_NAME, ICONS_FILE_NAME);
}

/**
 * Read the icon store, tolerating a missing file, malformed JSON, or a
 * wrong-shaped payload — a corrupt store degrades to "no custom icons",
 * never breaks the tree.
 */
export function readIconMap(vaultRoot: string): VaultIconMap {
  let raw: string;
  try {
    raw = fs.readFileSync(iconsFilePath(vaultRoot), 'utf-8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const map: VaultIconMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) map[key] = value;
  }
  return map;
}

export function writeIconMap(vaultRoot: string, map: VaultIconMap): void {
  writeFileAtomic(iconsFilePath(vaultRoot), JSON.stringify(map, null, 2));
}

/**
 * Set (or, when `icon` is null/empty, clear) one path's icon and persist.
 * Returns the updated map.
 */
export function setIcon(vaultRoot: string, relPath: string, icon: string | null): VaultIconMap {
  const map = readIconMap(vaultRoot);
  if (icon) {
    map[relPath] = icon;
  } else {
    delete map[relPath];
  }
  writeIconMap(vaultRoot, map);
  return map;
}

/**
 * Rewrite the icon map after a successful move/rename of `fromPath` to
 * `toPath` (both relative POSIX paths). Returns the updated map, or null when
 * nothing referenced the moved entry (callers skip the disk write).
 *
 * Every key equal to `fromPath` or nested under `fromPath + '/'` has that
 * prefix replaced with `toPath` — so a renamed/moved folder's icon and its
 * descendants' icons all move with it, matching vaultOrder.ts's rewrite rule.
 */
export function rewriteIconsOnMove(
  map: VaultIconMap,
  fromPath: string,
  toPath: string,
): VaultIconMap | null {
  let changed = false;
  const next: VaultIconMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === fromPath || key.startsWith(fromPath + '/')) {
      changed = true;
      next[toPath + key.slice(fromPath.length)] = value;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : null;
}

/**
 * Remove icon entries for a deleted path (exact match or nested under it).
 * Returns the updated map, or null when nothing referenced the path.
 */
export function removeIconsUnderPath(map: VaultIconMap, targetPath: string): VaultIconMap | null {
  let changed = false;
  const next: VaultIconMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === targetPath || key.startsWith(targetPath + '/')) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : null;
}
