import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Story, Chapter, Scene, EntityEntry } from './types';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import './LeftRail.css';

type Tab = 'stories' | 'vault' | 'entities' | 'review';

interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

interface TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children: TreeNode[];
}

function buildTree(items: VaultListItem[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  for (const item of items) {
    nodeMap.set(item.path, { path: item.path, name: item.name, isDirectory: item.isDirectory, children: [] });
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
  // Sort: directories first, then files, both alphabetically
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.isDirectory) sortNodes(n.children);
  }
  sortNodes(roots);
  return roots;
}

function getVisibleNodes(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.isDirectory && expanded.has(node.path)) {
      result.push(...getVisibleNodes(node.children, expanded));
    }
  }
  return result;
}

interface VaultTreeNodeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  focusedPath: string | null;
  onMoveFocus: (path: string) => void;
  visibleNodes: TreeNode[];
  parentPath: string | null;
  registerNode: (path: string, el: HTMLElement | null) => void;
}

function VaultTreeNode({
  node, depth, expanded, selected, onToggle, onOpenFile,
  focusedPath, onMoveFocus, visibleNodes, parentPath, registerNode,
}: VaultTreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const isFocused = focusedPath === node.path;
  const isMd = !node.isDirectory && node.name.endsWith('.md');

  const rowRef = useCallback((el: HTMLElement | null) => {
    registerNode(node.path, el);
  }, [node.path, registerNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (node.isDirectory) onToggle(node.path);
        else if (isMd) onOpenFile(node.path);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node.isDirectory) {
          if (!isExpanded) {
            onToggle(node.path);
          } else if (node.children.length > 0) {
            onMoveFocus(node.children[0].path);
          }
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (node.isDirectory && isExpanded) {
          onToggle(node.path);
        } else if (parentPath) {
          onMoveFocus(parentPath);
        }
        break;
      case 'ArrowDown': {
        e.preventDefault();
        const idx = visibleNodes.findIndex(n => n.path === node.path);
        if (idx < visibleNodes.length - 1) onMoveFocus(visibleNodes[idx + 1].path);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const idx = visibleNodes.findIndex(n => n.path === node.path);
        if (idx > 0) onMoveFocus(visibleNodes[idx - 1].path);
        break;
      }
    }
  }, [node, isMd, isExpanded, parentPath, visibleNodes, onToggle, onOpenFile, onMoveFocus]);

  if (node.isDirectory) {
    return (
      <div
        ref={rowRef as React.RefCallback<HTMLDivElement>}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-level={depth + 1}
        tabIndex={isFocused ? 0 : -1}
        className="vt-dir"
        title={node.path}
        onKeyDown={handleKeyDown}
        onFocus={(e) => { if (e.target === e.currentTarget) onMoveFocus(node.path); }}
      >
        <div
          className="vt-row vt-dir-row"
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onToggle(node.path)}
        >
          <span className="vt-chevron">{isExpanded ? '▾' : '▸'}</span>
          <span className="vt-icon vt-icon-dir">{isExpanded ? '📂' : '📁'}</span>
          <span className="vt-name">{node.name}</span>
        </div>
        {isExpanded && (
          <div role="group">
            {node.children.map((child) => (
              <VaultTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                focusedPath={focusedPath}
                onMoveFocus={onMoveFocus}
                visibleNodes={visibleNodes}
                parentPath={node.path}
                registerNode={registerNode}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={rowRef as React.RefCallback<HTMLDivElement>}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      className={`vt-row vt-file-row${isSelected ? ' vt-selected' : ''}${isMd ? ' vt-md' : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={() => isMd && onOpenFile(node.path)}
      onKeyDown={handleKeyDown}
      onFocus={() => onMoveFocus(node.path)}
      title={node.path}
    >
      <span className="vt-chevron" />
      <span className="vt-icon vt-icon-file">{isMd ? '📄' : '·'}</span>
      <span className="vt-name">{isMd ? node.name.slice(0, -3) : node.name}</span>
    </div>
  );
}

interface VaultBrowserProps {
  onOpenPath?: (path: string) => void;
}

function VaultBrowser({ onOpenPath }: VaultBrowserProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerNode = useCallback((path: string, el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(path, el);
    else nodeRefs.current.delete(path);
  }, []);

  const onMoveFocus = useCallback((path: string) => {
    setFocusedPath(path);
    nodeRefs.current.get(path)?.focus();
  }, []);

  const loadTree = useCallback(async () => {
    try {
      const result = await window.api.listVault();
      const nodes = buildTree(result.items ?? []);
      setTree(nodes);
      // Auto-expand top-level directories on first load
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const n of nodes) {
          if (n.isDirectory) next.add(n.path);
        }
        return next;
      });
    } catch {
      // vault not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Start vault watcher and load tree
    window.api.startVaultWatch?.().catch(() => {});
    loadTree();

    const unsubscribe = window.api.onVaultFileChanged?.(() => {
      // Debounce refresh to stay well within the 500ms acceptance criterion
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => loadTree(), 150);
    });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsubscribe?.();
    };
  }, [loadTree]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    setSelected(path);
    onOpenPath?.(path);
  }, [onOpenPath]);

  const visibleNodes = useMemo(() => getVisibleNodes(tree, expanded), [tree, expanded]);

  if (loading) return <div className="vault-loading">Loading vault…</div>;

  if (tree.length === 0) {
    return (
      <div className="vault-empty">
        <div className="vault-empty-icon">🗄️</div>
        <p>Your vault is empty.</p>
        <p className="vault-empty-sub">Markdown files you create or import will appear here.</p>
      </div>
    );
  }

  const effectiveFocusedPath = focusedPath ?? visibleNodes[0]?.path ?? null;

  return (
    <div className="vault-tree" role="tree" aria-label="Vault files">
      {tree.map((node) => (
        <VaultTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selected={selected}
          onToggle={toggleDir}
          onOpenFile={handleOpenFile}
          focusedPath={effectiveFocusedPath}
          onMoveFocus={onMoveFocus}
          visibleNodes={visibleNodes}
          parentPath={null}
          registerNode={registerNode}
        />
      ))}
    </div>
  );
}

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  stories: Story[];
  selectedSceneId: string | null;
  selectedEntityId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectEntity: (entity: EntityEntry) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  onOpenVaultPath?: (path: string) => void;
}

export default function LeftRail({
  activeTab,
  onTabChange,
  stories,
  selectedSceneId,
  selectedEntityId,
  onSelectScene,
  onSelectEntity,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
  onOpenVaultPath,
}: Props) {
  return (
    <div className="left-rail">
      <div className="rail-tabs" role="tablist" aria-label="Primary navigation">
        <button
          id="leftrail-tab-stories"
          role="tab"
          aria-selected={activeTab === 'stories'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'stories' ? ' active' : ''}`}
          onClick={() => onTabChange('stories')}
        >
          Stories
        </button>
        <button
          id="leftrail-tab-entities"
          role="tab"
          aria-selected={activeTab === 'entities'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'entities' ? ' active' : ''}`}
          onClick={() => onTabChange('entities')}
        >
          Entities
        </button>
        <button
          id="leftrail-tab-vault"
          role="tab"
          aria-selected={activeTab === 'vault'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => onTabChange('vault')}
        >
          Vault
        </button>
        <button
          id="leftrail-tab-review"
          role="tab"
          aria-selected={activeTab === 'review'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'review' ? ' active' : ''}`}
          onClick={() => onTabChange('review')}
          aria-label="Suggestion Review inbox"
        >
          Review
        </button>
      </div>
      <div
        className="rail-content"
        id="leftrail-tabpanel"
        role="tabpanel"
        aria-labelledby={`leftrail-tab-${activeTab}`}
      >
        {activeTab === 'stories' && (
          <StoryNavigator
            stories={stories}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            onCreateStory={onCreateStory}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
            onReorderScenes={onReorderScenes}
          />
        )}
        {activeTab === 'entities' && (
          <EntityBrowser
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId}
          />
        )}
        {activeTab === 'vault' && <VaultBrowser onOpenPath={onOpenVaultPath} />}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
      </div>
    </div>
  );
}
