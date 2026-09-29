/**
 * F1 H5 — when should Boards left-nav bump `navTreeVersion` (re-walk
 * `listNotesVault('')`)? Topology only: board/folder create, rename, delete.
 * Note content saves must NEVER trigger a full vault walk.
 */

/** Collect every folder path in a boards nav tree. */
export function collectBoardsNavFolderPaths(
  nodes: ReadonlyArray<{ path: string; children: ReadonlyArray<{ path: string; children: readonly unknown[] }> }>,
): Set<string> {
  const out = new Set<string>();
  const walk = (list: typeof nodes) => {
    for (const n of list) {
      out.add(n.path);
      walk(n.children as typeof nodes);
    }
  };
  walk(nodes);
  return out;
}

/**
 * True when a `vault:notes-updated` payload should refresh the boards folder tree.
 *
 * - Note paths (`*.md`) → false (content save / note rename — tree unchanged).
 * - Missing / empty path → false (rely on explicit create/rename/trash call sites).
 * - Directory (board) path → true when new/missing from the known tree, or always
 *   for any non-note path (create / rename / trash of boards).
 */
export function shouldBumpNavTreeOnVaultEvent(
  path: string | undefined,
  knownDirPaths: ReadonlySet<string>,
): boolean {
  if (!path || !path.trim()) return false;
  const norm = path.replace(/\\/g, '/');
  if (/\.md$/i.test(norm)) return false;
  // Board/folder path — topology. "New/missing" covers first sight of a folder;
  // known dirs still bump (rename/delete notifications reuse the folder path).
  if (!knownDirPaths.has(norm)) return true;
  return true;
}
