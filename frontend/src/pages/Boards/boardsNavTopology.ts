/**
 * F1 H5 — when should Boards left-nav bump `navTreeVersion` (re-walk
 * `listNotesVault('')`)? Topology only. Note content / asset saves must NEVER
 * trigger a full vault walk (Critic A / Forge).
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
 * Bump on: untargeted event (no path), known-folder path, or extension-less path.
 * Never on `.md` or other asset paths (`.png`, etc.).
 */
export function shouldBumpNavTreeOnVaultEvent(
  path: string | undefined,
  knownDirPaths: ReadonlySet<string>,
): boolean {
  if (!path || !path.trim()) return true; // untargeted — topology may have changed off-canvas
  const norm = path.replace(/\\/g, '/');
  if (/\.md$/i.test(norm)) return false;
  if (knownDirPaths.has(norm)) return true;
  const base = norm.split('/').pop() ?? '';
  if (/\.[a-z0-9]+$/i.test(base)) return false; // asset with extension
  return true; // extension-less → board/folder path
}
