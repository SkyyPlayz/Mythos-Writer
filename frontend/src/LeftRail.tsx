import { useState, useEffect, useCallback, useRef } from 'react';
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

interface VaultTreeNodeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function VaultTreeNode({ node, depth, expanded, selected, onToggle, onOpenFile }: VaultTreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;

  if (node.isDirectory) {
    return (
      <div className="vt-dir">
        <div
          className="vt-row vt-dir-row"
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onToggle(node.path)}
          title={node.path}
        >
          <span className="vt-chevron">{isExpanded ? '▾' : '▸'}</span>
          <span className="vt-icon vt-icon-dir">{isExpanded ? '📂' : '📁'}</span>
          <span className="vt-name">{node.name}</span>
        </div>
        {isExpanded && node.children.map((child) => (
          <VaultTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    );
  }

  const isMd = node.name.endsWith('.md');
  return (
    <div
      className={`vt-row vt-file-row${isSelected ? ' vt-selected' : ''}${isMd ? ' vt-md' : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={() => isMd && onOpenFile(node.path)}
      title={node.path}
      draggable={isMd}
      onDragStart={isMd ? (e) => { e.dataTransfer.setData('text/plain', node.path); e.dataTransfer.effectAllowed = 'copy'; } : undefined}
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
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div className="vault-tree">
      {tree.map((node) => (
        <VaultTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selected={selected}
          onToggle={toggleDir}
          onOpenFile={handleOpenFile}
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
  onOpenAuditTrail?: (agent: 'writing-assistant' | 'brainstorm' | 'archive') => void;
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
  onOpenAuditTrail,
}: Props) {
  return (
    <div className="left-rail">
      <div className="rail-tabs">
        <button
          className={`rail-tab${activeTab === 'stories' ? ' active' : ''}`}
          onClick={() => onTabChange('stories')}
        >
          Stories
        </button>
        <button
          className={`rail-tab${activeTab === 'entities' ? ' active' : ''}`}
          onClick={() => onTabChange('entities')}
        >
          Entities
        </button>
        <button
          className={`rail-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => onTabChange('vault')}
        >
          Vault
        </button>
        <button
          className={`rail-tab${activeTab === 'review' ? ' active' : ''}`}
          onClick={() => onTabChange('review')}
          aria-label="Suggestion Review inbox"
        >
          Review
        </button>
      </div>
      <div className="rail-content">
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
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} onOpenAuditTrail={onOpenAuditTrail} />}
      </div>
    </div>
  );
}
