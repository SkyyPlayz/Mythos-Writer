export interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

// ─── W0.1 (GAP #1): notes-tree hygiene ───
// The main process already filters story-vault internals out of the
// notesVault:list IPC (electron-main/src/notesListing.ts). These mirrors are
// renderer-side defense in depth so a stale main build or a mocked listing
// can never paint scene-UUID folders into the Notes tree.

/** 8-4-4-4-12 hex — the id shape produced by crypto.randomUUID(). */
export const UUID_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the item is story-vault-internal and must not render in the
 * Notes tree: dot-segment paths (incl. children of filtered dot-dirs, which
 * buildTree would otherwise promote to root rows) and UUID-named directories
 * plus everything below them.
 */
export function isStoryInternalTreeItem(item: {
  path: string;
  isDirectory: boolean;
}): boolean {
  const segs = item.path.split(/[\\/]/).filter((s) => s.length > 0);
  if (segs.some((s) => s.startsWith('.'))) return true;
  const dirSegs = item.isDirectory ? segs : segs.slice(0, -1);
  return dirSegs.some((s) => UUID_NAME_RE.test(s));
}

/**
 * W0.1 (GAP #1): display-map UUID-named entries to their story/scene titles
 * anywhere they legitimately appear. `titleById` maps manifest ids
 * (story/chapter/scene) to titles; unknown UUIDs are left untouched.
 */
export function mapUuidNamesToTitles(
  items: VaultListItem[],
  titleById: ReadonlyMap<string, string>,
): VaultListItem[] {
  if (titleById.size === 0) return items;
  return items.map((item) => {
    const base = item.isDirectory ? item.name : item.name.replace(/\.md$/i, '');
    if (!UUID_NAME_RE.test(base)) return item;
    const title = titleById.get(base.toLowerCase());
    if (!title) return item;
    return { ...item, name: item.isDirectory ? title : `${title}.md` };
  });
}

export interface TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children: TreeNode[];
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
}

export function buildTree(items: VaultListItem[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  for (const item of items) {
    nodeMap.set(item.path, {
      path: item.path,
      name: item.name,
      isDirectory: item.isDirectory,
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const item of items) {
    const node = nodeMap.get(item.path)!;
    const lastSlash = item.path.lastIndexOf('/');
    const parentPath = lastSlash > 0 ? item.path.slice(0, lastSlash) : null;
    if (parentPath && nodeMap.has(parentPath)) {
      nodeMap.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) if (n.isDirectory) sortNodes(n.children);
}

export function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  selected: string | null,
  depth = 0,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const isExpanded = node.isDirectory && expanded.has(node.path);
    rows.push({ node, depth, isExpanded, isSelected: selected === node.path });
    if (isExpanded) {
      rows.push(...flattenTree(node.children, expanded, selected, depth + 1));
    }
  }
  return rows;
}
