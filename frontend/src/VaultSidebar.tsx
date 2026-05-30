import { useState, useEffect, useCallback, useRef } from 'react';
import type { Story, Chapter, Scene } from './types';
import './VaultSidebar.css';

// ─── Shared tree types ───

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

// ─── Section header ───

interface SectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
}

function SectionHeader({ label, open, onToggle, onAdd, addLabel = 'New' }: SectionHeaderProps) {
  return (
    <div className="vs-section-header">
      <button
        className="vs-section-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      >
        <span className="vs-section-chevron">{open ? '▾' : '▸'}</span>
        <span className="vs-section-label">{label}</span>
      </button>
      {onAdd && (
        <button
          className="vs-section-add"
          onClick={onAdd}
          title={addLabel}
          aria-label={addLabel}
        >
          +
        </button>
      )}
    </div>
  );
}

// ─── Story Vault ───

interface StoryVaultProps {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
}

function StoryVault({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
}: StoryVaultProps) {
  const [open, setOpen] = useState(true);
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // Auto-expand single story on first load
  useEffect(() => {
    if (stories.length === 1) {
      setExpandedStories(new Set([stories[0].id]));
    }
  }, [stories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStory = useCallback((id: string) => {
    setExpandedStories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleChapter = useCallback((id: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="vs-section vs-story-section">
      <SectionHeader
        label="Story Vault"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={onCreateStory}
        addLabel="New Story"
      />
      {open && (
        <div className="vs-section-content">
          {stories.length === 0 ? (
            <div className="vs-empty">No stories yet. Click + to create one.</div>
          ) : (
            stories.map((story) => {
              const storyExpanded = expandedStories.has(story.id);
              return (
                <div key={story.id} className="vs-story">
                  <div className="vs-item-row">
                    <button
                      className="vs-item-toggle"
                      onClick={() => toggleStory(story.id)}
                      aria-expanded={storyExpanded}
                    >
                      <span className="vs-chevron">{storyExpanded ? '▾' : '▸'}</span>
                      <span className="vs-icon">📖</span>
                      <span className="vs-name" title={story.title}>{story.title}</span>
                    </button>
                    <button
                      className="vs-item-add"
                      onClick={() => onCreateChapter(story.id)}
                      title="New Chapter"
                      aria-label={`New chapter in ${story.title}`}
                    >
                      +
                    </button>
                  </div>
                  {storyExpanded && [...story.chapters]
                    .sort((a, b) => a.order - b.order)
                    .map((chapter) => {
                      const chapterExpanded = expandedChapters.has(chapter.id);
                      return (
                        <div key={chapter.id} className="vs-chapter">
                          <div className="vs-item-row vs-chapter-row">
                            <button
                              className="vs-item-toggle"
                              style={{ paddingLeft: 20 }}
                              onClick={() => toggleChapter(chapter.id)}
                              aria-expanded={chapterExpanded}
                            >
                              <span className="vs-chevron">{chapterExpanded ? '▾' : '▸'}</span>
                              <span className="vs-icon">📑</span>
                              <span className="vs-name" title={chapter.title}>{chapter.title}</span>
                            </button>
                            <button
                              className="vs-item-add"
                              onClick={() => onCreateScene(story.id, chapter.id)}
                              title="New Scene"
                              aria-label={`New scene in ${chapter.title}`}
                            >
                              +
                            </button>
                          </div>
                          {chapterExpanded && [...chapter.scenes]
                            .sort((a, b) => a.order - b.order)
                            .map((scene) => (
                              <div
                                key={scene.id}
                                className={`vs-scene-row${selectedSceneId === scene.id ? ' vs-selected' : ''}`}
                                style={{ paddingLeft: 36 }}
                                role="button"
                                tabIndex={0}
                                onClick={() => onSelectScene(scene, chapter, story)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectScene(scene, chapter, story);
                                  }
                                }}
                                aria-pressed={selectedSceneId === scene.id}
                                aria-label={scene.title}
                                title={scene.title}
                              >
                                <span className="vs-chevron" />
                                <span className="vs-icon">📄</span>
                                <span className="vs-name">{scene.title}</span>
                              </div>
                            ))}
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Notes Vault tree node ───

interface NotesTreeNodeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelectNode?: (path: string, isDirectory: boolean) => void;
}

function NotesTreeNode({ node, depth, expanded, selected, onToggle, onOpenFile, onSelectNode }: NotesTreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const indent = 8 + depth * 14;

  if (node.isDirectory) {
    return (
      <div>
        <div
          className="vs-notes-dir-row"
          style={{ paddingLeft: indent }}
          role="button"
          tabIndex={0}
          onClick={() => { onToggle(node.path); onSelectNode?.(node.path, true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle(node.path);
              onSelectNode?.(node.path, true);
            }
          }}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
          title={node.path}
        >
          <span className="vs-chevron">{isExpanded ? '▾' : '▸'}</span>
          <span className="vs-icon">{isExpanded ? '📂' : '📁'}</span>
          <span className="vs-name">{node.name}</span>
        </div>
        {isExpanded && node.children.map((child) => (
          <NotesTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
    );
  }

  const isMd = node.name.endsWith('.md');
  return (
    <div
      className={`vs-notes-file-row${isSelected ? ' vs-selected' : ''}${isMd ? ' vs-md' : ''}`}
      style={{ paddingLeft: indent }}
      role={isMd ? 'button' : undefined}
      tabIndex={isMd ? 0 : undefined}
      onClick={() => isMd && (onOpenFile(node.path), onSelectNode?.(node.path, false))}
      onKeyDown={
        isMd
          ? (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onOpenFile(node.path);
                onSelectNode?.(node.path, false);
              }
            }
          : undefined
      }
      title={node.path}
    >
      <span className="vs-chevron" />
      <span className="vs-icon">{isMd ? '📄' : '·'}</span>
      <span className="vs-name">{isMd ? node.name.slice(0, -3) : node.name}</span>
    </div>
  );
}

// ─── Notes Vault ───

const MANUSCRIPT_PREFIX = 'Manuscript';
const INTERNAL_FILES = new Set(['manifest.json', 'manifest.json.bak']);
const INTERNAL_PREFIXES = ['.versions', '.snapshots', '.git'];

function isNotesItem(item: VaultListItem): boolean {
  if (item.name.startsWith('.')) return false;
  if (INTERNAL_FILES.has(item.path)) return false;
  if (item.path === MANUSCRIPT_PREFIX || item.path.startsWith(MANUSCRIPT_PREFIX + '/')) return false;
  for (const prefix of INTERNAL_PREFIXES) {
    if (item.path === prefix || item.path.startsWith(prefix + '/')) return false;
  }
  return true;
}

interface NotesVaultProps {
  onOpenPath?: (path: string) => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
}

function NotesVault({ onOpenPath, onContextChange }: NotesVaultProps) {
  const [open, setOpen] = useState(true);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTree = useCallback(async () => {
    try {
      const result = await window.api.listVault();
      const filtered = (result.items ?? []).filter(isNotesItem);
      const nodes = buildTree(filtered);
      setTree(nodes);
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
    window.api.startVaultWatch?.().catch(() => {});
    loadTree();

    const unsubscribe = window.api.onVaultFileChanged?.(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => loadTree(), 150);
    });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsubscribe?.();
    };
  }, [loadTree]);

  const handleCreateNote = useCallback(async () => {
    const name = prompt('Note name (without .md):');
    if (!name?.trim()) return;
    const slug = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
    const path = `${slug || 'note'}.md`;
    try {
      await window.api.writeVault(
        path,
        `---\ntitle: "${name.trim()}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n`,
      );
      await loadTree();
      setSelected(path);
      onOpenPath?.(path);
    } catch (e) {
      console.error('Failed to create note:', e);
    }
  }, [loadTree, onOpenPath]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleSelectNode = useCallback(
    (_path: string, isDirectory: boolean) => {
      onContextChange?.(isDirectory ? 'folder' : 'file');
    },
    [onContextChange],
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      setSelected(path);
      onOpenPath?.(path);
    },
    [onOpenPath],
  );

  return (
    <div className="vs-section vs-notes-section">
      <SectionHeader
        label="Notes Vault"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={handleCreateNote}
        addLabel="New Note"
      />
      {open && (
        <div className="vs-section-content">
          {loading ? (
            <div className="vs-empty">Loading…</div>
          ) : tree.length === 0 ? (
            <div className="vs-empty">No notes yet. Click + to create one.</div>
          ) : (
            tree.map((node) => (
              <NotesTreeNode
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                selected={selected}
                onToggle={toggleDir}
                onOpenFile={handleOpenFile}
                onSelectNode={handleSelectNode}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───

export interface VaultSidebarProps {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onOpenVaultPath?: (path: string) => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
}

export default function VaultSidebar({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenVaultPath,
  onContextChange,
}: VaultSidebarProps) {
  return (
    <div className="vault-sidebar">
      <StoryVault
        stories={stories}
        selectedSceneId={selectedSceneId}
        onSelectScene={onSelectScene}
        onCreateStory={onCreateStory}
        onCreateChapter={onCreateChapter}
        onCreateScene={onCreateScene}
      />
      <div className="vs-divider" aria-hidden="true" />
      <NotesVault onOpenPath={onOpenVaultPath} onContextChange={onContextChange} />
    </div>
  );
}
