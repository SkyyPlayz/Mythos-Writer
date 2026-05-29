export interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
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
