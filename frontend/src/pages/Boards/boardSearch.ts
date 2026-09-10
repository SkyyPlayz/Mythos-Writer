/**
 * SKY-11191 (Notes Board 8/9): cross-board search — the pure half.
 *
 * The ticket scopes this to a NAME index over the whole vault: "matches on
 * name, each hit navigates to the containing board and selects the item.
 * A name index is sufficient server-side; content search is explicitly a
 * separate feature."
 *
 * There is no server-side index to add, because one already exists:
 * `listNotesVault('')` is recursive (vault.ts/listVaultFiles walks the whole
 * subtree), so a single call from the vault root is the name index. Adding a
 * second one in main would be a second source of truth for "what is in the
 * vault" — exactly the Store A / Store B split notesBoard.ts warns about.
 *
 * Everything below is a pure function of that listing, so the ranking and the
 * board/item split are unit-testable without a vault, a canvas or Electron.
 */

/** One row of the recursive vault listing (`listNotesVault('')`). */
export interface VaultIndexEntry {
  /** Vault-relative POSIX path. `listVaultFiles` always emits '/' (SKY-8881). */
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface BoardSearchHit {
  /** Vault-relative path of the board (folder) that CONTAINS the hit. '' is Home. */
  boardPath: string;
  /** Path relative to `boardPath` — the same key BoardCanvas selects items by. */
  itemPath: string;
  /** Display name: a note without its `.md`, a folder as-is. */
  name: string;
  kind: 'note' | 'folder';
  /** Vault-relative path of the hit itself — a stable React key. */
  vaultPath: string;
  /** Breadcrumb-ish trail of the containing board, for disambiguating same-named hits. */
  boardLabel: string;
}

/** How many hits the result list shows. A name search is a jump-to, not a report. */
export const SEARCH_RESULT_LIMIT = 20;

function splitParent(vaultPath: string): { boardPath: string; itemPath: string } {
  const slash = vaultPath.lastIndexOf('/');
  if (slash === -1) return { boardPath: '', itemPath: vaultPath };
  return { boardPath: vaultPath.slice(0, slash), itemPath: vaultPath.slice(slash + 1) };
}

/**
 * Match rank, best first. Exact beats prefix beats substring, so typing a
 * full note name puts that note at the top even in a vault where 40 other
 * names contain it. Returns null when the name does not match at all.
 */
function matchRank(name: string, query: string): number | null {
  const haystack = name.toLowerCase();
  if (haystack === query) return 0;
  if (haystack.startsWith(query)) return 1;
  return haystack.includes(query) ? 2 : null;
}

/**
 * Rank every vault entry whose NAME matches `query` (case-insensitive).
 *
 * Ordering: match quality, then depth (a hit two boards down beats one eight
 * boards down — the shallower one is the one the user can place), then name,
 * then path. The last two make the order total, so the list does not shuffle
 * between renders of the same vault.
 *
 * Only notes (`.md`) and folders are searchable: they are exactly what a
 * board renders, so every hit has somewhere to navigate to. A hit for an
 * image or a sidecar would land on a board that does not show it.
 */
export function searchVaultIndex(
  entries: readonly VaultIndexEntry[],
  query: string,
  limit: number = SEARCH_RESULT_LIMIT,
): BoardSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const ranked: Array<{ hit: BoardSearchHit; rank: number; depth: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory && !/\.md$/i.test(entry.name)) continue;
    const name = entry.isDirectory ? entry.name : entry.name.replace(/\.md$/i, '');
    const rank = matchRank(name, needle);
    if (rank === null) continue;

    const { boardPath, itemPath } = splitParent(entry.path);
    ranked.push({
      rank,
      depth: boardPath ? boardPath.split('/').length : 0,
      hit: {
        boardPath,
        itemPath,
        name,
        kind: entry.isDirectory ? 'folder' : 'note',
        vaultPath: entry.path,
        boardLabel: boardPath ? boardPath.split('/').join(' / ') : 'Home',
      },
    });
  }

  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.depth - b.depth ||
      a.hit.name.localeCompare(b.hit.name) ||
      a.hit.vaultPath.localeCompare(b.hit.vaultPath),
  );
  return ranked.slice(0, limit).map((r) => r.hit);
}
