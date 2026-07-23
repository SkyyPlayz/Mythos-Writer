// W0.1 (Beta 4 "Refine", GAP-REPORT-v2 P0 #1) — Notes-tree hygiene.
//
// The shipped beta leaked Story-Vault internals into the Notes Vault tree:
// scene-UUID folders, `Manuscript/`, `versions/<sceneId>/` draft dirs, and
// manifest bookkeeping all rendered as notes when the configured roots
// overlapped (notes root pointed at — or above — a story vault) or when
// history had strewn story internals into the notes root. FULL-SPEC §2 makes
// the rule hard: "Story-internal folders (scene UUIDs) must never appear in
// the Notes tree."
//
// This module filters the NOTES_VAULT_LIST result at the source (main
// process) so every consumer — VaultBrowser, VaultSidebar, Scene Crafter,
// Timeline, Kanban — sees a clean tree:
//   1. dot-segment paths (.obsidian/, .snapshots/, .mythos-seeded, …) AND
//      their children — the renderer's tree-builder promotes orphaned
//      children of filtered parents to root rows, so subtrees must go whole;
//   2. UUID-named directories and everything below them (scene/story/chapter
//      ids from crypto.randomUUID());
//   3. the story vault subtree whenever the configured story root sits at or
//      inside the listed notes root (mis-scoped roots), including the
//      same-root case where `Manuscript/`, `versions/`, `drafts/` and
//      manifest files are the story vault's own internals.
//
// Pure Node (path only) — unit-testable without Electron.

import path from 'node:path';

export interface NotesListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

/** 8-4-4-4-12 hex — the id shape produced by crypto.randomUUID(). */
export const UUID_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Story-vault top-level internals, only meaningful in the same-root case. */
const STORY_INTERNAL_DIRS = new Set(['Manuscript', 'versions', 'drafts']);
const STORY_INTERNAL_FILES = new Set(['manifest.json', 'manifest.json.bak']);

/**
 * If the story vault root sits at or inside `listedRoot`, return its
 * POSIX-style relative prefix ('' when the roots are the same directory).
 * Returns null when the story vault lives elsewhere (the healthy layout).
 */
export function storyVaultRelPrefix(
  listedRoot: string,
  storyVaultRoot: string,
): string | null {
  const rel = path.relative(path.resolve(listedRoot), path.resolve(storyVaultRoot));
  if (rel === '') return '';
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return null;
}

/** Split a listing path into segments regardless of platform separator. */
function segmentsOf(itemPath: string): string[] {
  return itemPath.split(/[\\/]/).filter((s) => s.length > 0);
}

/**
 * True when the item is Story-Vault-internal (or app bookkeeping) and must
 * not appear in the Notes tree. `storyRelPrefix` comes from
 * storyVaultRelPrefix() for the listed root.
 */
export function isStoryInternalNotesPath(
  item: Pick<NotesListItem, 'path' | 'isDirectory'>,
  storyRelPrefix: string | null,
): boolean {
  const segs = segmentsOf(item.path);
  const posixPath = segs.join('/');

  // 1. Dotfile/dot-dir segments — internal bookkeeping; children go with them.
  if (segs.some((s) => s.startsWith('.'))) return true;

  // 2. UUID-named directories (scene/story/chapter ids) and their subtrees.
  //    For a file, only ancestor segments count — a UUID-named .md note is a
  //    file the user could conceivably own; UUID *folders* never are.
  //    Carve-out: `Boards/<uuid>/` is Scene Crafter's own Notes-Vault-owned
  //    board storage (crafterBoardStore.ts, boardsDirForStory()) — the UUID
  //    there is the story id used only as a namespacing key, not a
  //    Story-Vault internal, so it must stay visible to listNotesVault() or
  //    saved boards vanish on reload. Scoped to exactly the segment right
  //    after `Boards/`; anything deeper still goes through the normal rule.
  const dirSegs = item.isDirectory ? segs : segs.slice(0, -1);
  const boardsStorySlugIdx = segs[0] === 'Boards' ? 1 : -1;
  if (dirSegs.some((s, idx) => idx !== boardsStorySlugIdx && UUID_NAME_RE.test(s))) return true;

  // 3. Manifest bookkeeping never belongs to a notes listing at any root.
  if (STORY_INTERNAL_FILES.has(posixPath)) return true;

  // 4. Story vault subtree when the roots overlap.
  if (storyRelPrefix !== null) {
    if (storyRelPrefix === '') {
      if (segs.length > 0 && STORY_INTERNAL_DIRS.has(segs[0])) return true;
    } else if (
      posixPath === storyRelPrefix ||
      posixPath.startsWith(`${storyRelPrefix}/`)
    ) {
      return true;
    }
  }

  return false;
}

/** Filter a raw listVaultFiles() result down to legitimate notes entries. */
export function filterNotesListing(
  items: NotesListItem[],
  storyRelPrefix: string | null,
): NotesListItem[] {
  return items.filter((item) => !isStoryInternalNotesPath(item, storyRelPrefix));
}
