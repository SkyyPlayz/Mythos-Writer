// SKY-8891: persisted manual order for the Notes Vault tree.
//
// The store is a single dot-file at the notes vault root (`.vb-order.json`),
// which the notes listing already filters out at the source (notesListing.ts
// rule 1: dot-segment paths never reach the renderer). Shape:
//
//   Record<parentPath, string[]>
//
// where `parentPath` is '' for the vault root or the folder's relative POSIX
// path, and the value is the ordered array of that folder's immediate
// children as full relative POSIX paths. Children absent from the array fall
// back to a–z order in the renderer, appended after the ordered ones — so the
// store is advisory display data, never a source of truth about what exists.
//
// Pure Node (fs/path only) — unit-testable without Electron.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './vault.js';

export const ORDER_FILE_NAME = '.vb-order.json';

export type VaultOrderMap = Record<string, string[]>;

/** '' for root-level paths, else the POSIX parent of `p`. */
function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
}

/**
 * Read the order store, tolerating a missing file, malformed JSON, or a
 * wrong-shaped payload (a corrupt store must degrade to a–z fallback, never
 * break the tree). Non-conforming keys/values are dropped, not preserved.
 */
export function readOrderMap(vaultRoot: string): VaultOrderMap {
  const file = path.join(vaultRoot, ORDER_FILE_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
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
  const map: VaultOrderMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    map[key] = value.filter((v): v is string => typeof v === 'string');
  }
  return map;
}

export function writeOrderMap(vaultRoot: string, map: VaultOrderMap): void {
  writeFileAtomic(path.join(vaultRoot, ORDER_FILE_NAME), JSON.stringify(map, null, 2));
}

/**
 * Rewrite the order map after a successful move/rename of `fromPath` to
 * `toPath` (both relative POSIX paths). Returns the updated map, or null when
 * nothing referenced the moved entry (callers skip the disk write).
 *
 * - Every key and array entry equal to `fromPath` or under `fromPath + '/'`
 *   has that prefix replaced with `toPath`, so a renamed/moved folder's
 *   descendants keep their manual order.
 * - A same-parent rename keeps the entry's slot (pure prefix rewrite).
 * - A cross-parent move removes the entry from the old parent's array and
 *   appends `toPath` to the new parent's array — but only when that array
 *   already exists: creating one would pin the moved item ahead of its
 *   a–z-sorted new siblings in a folder the user never manually ordered.
 */
export function rewriteOrderOnMove(
  map: VaultOrderMap,
  fromPath: string,
  toPath: string,
): VaultOrderMap | null {
  let changed = false;
  const rewrite = (p: string): string => {
    if (p === fromPath || p.startsWith(fromPath + '/')) {
      changed = true;
      return toPath + p.slice(fromPath.length);
    }
    return p;
  };

  const next: VaultOrderMap = {};
  for (const [key, entries] of Object.entries(map)) {
    next[rewrite(key)] = entries.map(rewrite);
  }

  const fromParent = parentOf(fromPath);
  const toParent = parentOf(toPath);
  if (fromParent !== toParent) {
    const oldArr = next[fromParent];
    if (oldArr?.includes(toPath)) {
      const filtered = oldArr.filter((p) => p !== toPath);
      if (filtered.length > 0) next[fromParent] = filtered;
      else delete next[fromParent];
      changed = true;
    }
    const newArr = next[toParent];
    if (newArr && !newArr.includes(toPath)) {
      next[toParent] = [...newArr, toPath];
      changed = true;
    }
  }

  return changed ? next : null;
}
