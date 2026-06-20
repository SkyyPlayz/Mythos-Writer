import { useState, useRef, useCallback, useEffect } from 'react';
import type { OutlineNode, OutlineData, Story, Scene, Chapter } from './types';
import './OutlinePlanningPanel.css';

const MAX_DEPTH = 5;
const SAVE_DEBOUNCE_MS = 500;

let _nodeSeq = 0;
function newNodeId(): string {
  return `opl-${Date.now()}-${++_nodeSeq}`;
}

function makeNode(title = ''): OutlineNode {
  return { id: newNodeId(), title, children: [] };
}

// ─── Pure tree operations ────────────────────────────────────────────────────

function findNodeDeep(
  nodes: OutlineNode[],
  id: string,
): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeDeep(n.children, id);
    if (found) return found;
  }
  return null;
}

function removeNode(
  nodes: OutlineNode[],
  id: string,
): { tree: OutlineNode[]; removed: OutlineNode | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const removed = nodes[idx];
    return { tree: nodes.filter((_, i) => i !== idx), removed };
  }
  let removed: OutlineNode | null = null;
  const tree = nodes.map((n) => {
    const r = removeNode(n.children, id);
    if (r.removed) {
      removed = r.removed;
      return { ...n, children: r.tree };
    }
    return n;
  });
  return { tree, removed };
}

function updateNode(
  nodes: OutlineNode[],
  id: string,
  updater: (n: OutlineNode) => OutlineNode,
): OutlineNode[] {
  return nodes.map((n) => {
    if (n.id === id) return updater(n);
    const children = updateNode(n.children, id, updater);
    if (children === n.children) return n;
    return { ...n, children };
  });
}

function insertAfter(
  nodes: OutlineNode[],
  afterId: string,
  newNode: OutlineNode,
): OutlineNode[] {
  const idx = nodes.findIndex((n) => n.id === afterId);
  if (idx !== -1) {
    const result = [...nodes];
    result.splice(idx + 1, 0, newNode);
    return result;
  }
  return nodes.map((n) => {
    const children = insertAfter(n.children, afterId, newNode);
    if (children === n.children) return n;
    return { ...n, children };
  });
}

function insertBefore(
  nodes: OutlineNode[],
  beforeId: string,
  newNode: OutlineNode,
): OutlineNode[] {
  const idx = nodes.findIndex((n) => n.id === beforeId);
  if (idx !== -1) {
    const result = [...nodes];
    result.splice(idx, 0, newNode);
    return result;
  }
  return nodes.map((n) => {
    const children = insertBefore(n.children, beforeId, newNode);
    if (children === n.children) return n;
    return { ...n, children };
  });
}

function getNodeDepth(nodes: OutlineNode[], id: string, depth = 0): number {
  for (const n of nodes) {
    if (n.id === id) return depth;
    const d = getNodeDepth(n.children, id, depth + 1);
    if (d !== -1) return d;
  }
  return -1;
}

function findParentId(nodes: OutlineNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.children.some((c) => c.id === id)) return n.id;
    const deeper = findParentId(n.children, id);
    if (deeper) return deeper;
  }
  return null;
}

function findPrevSiblingId(nodes: OutlineNode[], id: string): string | null {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx > 0) return nodes[idx - 1].id;
  for (const n of nodes) {
    const r = findPrevSiblingId(n.children, id);
    if (r) return r;
  }
  return null;
}

function indentNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  const depth = getNodeDepth(nodes, id);
  if (depth < 0 || depth >= MAX_DEPTH - 1) return nodes;
  const prevSibId = findPrevSiblingId(nodes, id);
  if (!prevSibId) return nodes;
  const found = findNodeDeep(nodes, id);
  if (!found) return nodes;
  const { tree } = removeNode(nodes, id);
  return updateNode(tree, prevSibId, (n) => ({
    ...n,
    children: [...n.children, found],
  }));
}

function promoteNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  const parentId = findParentId(nodes, id);
  if (!parentId) return nodes;
  const found = findNodeDeep(nodes, id);
  if (!found) return nodes;
  const { tree } = removeNode(nodes, id);
  return insertAfter(tree, parentId, found);
}

function flattenVisible(
  nodes: OutlineNode[],
  collapsed: Set<string>,
  depth = 0,
): Array<{ node: OutlineNode; depth: number }> {
  const result: Array<{ node: OutlineNode; depth: number }> = [];
  for (const n of nodes) {
    result.push({ node: n, depth });
    if (!collapsed.has(n.id)) {
      result.push(...flattenVisible(n.children, collapsed, depth + 1));
    }
  }
  return result;
}

// ─── Scene helpers ────────────────────────────────────────────────────────────

function getAllScenes(story: Story): Array<{ scene: Scene; chapter: Chapter }> {
  const result: Array<{ scene: Scene; chapter: Chapter }> = [];
  for (const chapter of story.chapters) {
    const sorted = [...chapter.scenes].sort((a, b) => a.order - b.order);
    for (const scene of sorted) result.push({ scene, chapter });
  }
  return result;
}

function getSceneName(story: Story, sceneId: string): string | null {
  for (const chapter of story.chapters) {
    const s = chapter.scenes.find((sc) => sc.id === sceneId);
    if (s) return s.title;
  }
  return null;
}

// ─── Drop target indicator ────────────────────────────────────────────────────

interface DropTarget {
  nodeId: string;
  position: 'before' | 'after';
}

// ─── Single node row ──────────────────────────────────────────────────────────

interface NodeRowProps {
  node: OutlineNode;
  depth: number;
  isCollapsed: boolean;
  activeNodeId: string | null;
  inputRef?: (el: HTMLInputElement | null) => void;
  dropTarget: DropTarget | null;
  dragNodeId: string | null;
  story: Story | null;
  linkPickerNodeId: string | null;
  onActivate: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onKeyDown: (id: string, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggleFold: (id: string) => void;
  onOpenLinkPicker: (id: string) => void;
  onCloseLinkPicker: () => void;
  onLinkScene: (nodeId: string, sceneId: string) => void;
  onUnlinkScene: (nodeId: string) => void;
  onSceneNavigate: (sceneId: string) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragOver: (id: string, e: React.DragEvent) => void;
  onDragLeave: (id: string) => void;
  onDrop: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function NodeRow({
  node,
  depth,
  isCollapsed,
  activeNodeId,
  inputRef,
  dropTarget,
  dragNodeId,
  story,
  linkPickerNodeId,
  onActivate,
  onTitleChange,
  onKeyDown,
  onToggleFold,
  onOpenLinkPicker,
  onCloseLinkPicker,
  onLinkScene,
  onUnlinkScene,
  onSceneNavigate,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: NodeRowProps) {
  const isActive = activeNodeId === node.id;
  const isDragging = dragNodeId === node.id;
  const isDropBefore = dropTarget?.nodeId === node.id && dropTarget.position === 'before';
  const isDropAfter = dropTarget?.nodeId === node.id && dropTarget.position === 'after';
  const sceneName = story && node.linkedSceneId ? getSceneName(story, node.linkedSceneId) : null;
  const allScenes = story ? getAllScenes(story) : [];
  const isLinkPickerOpen = linkPickerNodeId === node.id;

  return (
    <div
      className={[
        'opl-node-wrapper',
        isDragging ? 'opl-dragging' : '',
        isDropBefore ? 'opl-drop-before' : '',
        isDropAfter ? 'opl-drop-after' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--opl-depth': depth } as React.CSSProperties}
      draggable
      onDragStart={(e) => onDragStart(node.id, e)}
      onDragOver={(e) => onDragOver(node.id, e)}
      onDragLeave={() => onDragLeave(node.id)}
      onDrop={(e) => onDrop(node.id, e)}
      onDragEnd={onDragEnd}
      data-testid={`opl-node-${node.id}`}
      data-node-id={node.id}
    >
      <div
        className={`opl-node-row${isActive ? ' opl-node-active' : ''}`}
        onClick={() => onActivate(node.id)}
      >
        <span className="opl-drag-handle" aria-hidden="true">⠿</span>

        {node.children.length > 0 ? (
          <button
            className="opl-fold-btn"
            aria-label={isCollapsed ? `Expand node (${node.children.length} children)` : 'Collapse node'}
            aria-expanded={!isCollapsed}
            onClick={(e) => { e.stopPropagation(); onToggleFold(node.id); }}
          >
            <span className={`opl-fold-chevron${isCollapsed ? ' collapsed' : ''}`}>›</span>
            {isCollapsed && (
              <span className="opl-child-count">{node.children.length}</span>
            )}
          </button>
        ) : (
          <span className="opl-fold-spacer" aria-hidden="true" />
        )}

        <input
          ref={inputRef}
          className="opl-title-input"
          value={node.title}
          placeholder="Outline node…"
          aria-label={`Outline node title: ${node.title || 'empty'}`}
          onChange={(e) => onTitleChange(node.id, e.target.value)}
          onFocus={() => onActivate(node.id)}
          onKeyDown={(e) => onKeyDown(node.id, e)}
        />

        <div className="opl-link-wrapper">
          <button
            className={`opl-link-btn${node.linkedSceneId ? ' opl-link-btn-active' : ''}`}
            aria-label={node.linkedSceneId ? 'Change linked scene' : 'Link scene'}
            aria-haspopup="listbox"
            aria-expanded={isLinkPickerOpen}
            onClick={(e) => {
              e.stopPropagation();
              if (isLinkPickerOpen) {
                onCloseLinkPicker();
              } else {
                onOpenLinkPicker(node.id);
              }
            }}
          >
            🔗
          </button>
          {isLinkPickerOpen && (
            <div
              className="opl-link-picker"
              role="listbox"
              aria-label="Select scene to link"
            >
              {node.linkedSceneId && (
                <div
                  className="opl-link-option opl-link-unlink"
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onUnlinkScene(node.id); onCloseLinkPicker(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { onUnlinkScene(node.id); onCloseLinkPicker(); } }}
                >
                  Remove link
                </div>
              )}
              {allScenes.length === 0 ? (
                <div className="opl-link-empty">No scenes in this story</div>
              ) : (
                allScenes.map(({ scene, chapter }) => (
                  <div
                    key={scene.id}
                    className={`opl-link-option${scene.id === node.linkedSceneId ? ' opl-link-selected' : ''}`}
                    role="option"
                    aria-selected={scene.id === node.linkedSceneId}
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onLinkScene(node.id, scene.id); onCloseLinkPicker(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { onLinkScene(node.id, scene.id); onCloseLinkPicker(); } }}
                    title={`${chapter.title} › ${scene.title}`}
                  >
                    <span className="opl-link-chapter">{chapter.title}</span>
                    <span className="opl-link-scene-title">{scene.title}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {sceneName && (
        <button
          className="opl-scene-chip"
          aria-label={`Linked scene: ${sceneName}. Click to navigate.`}
          onClick={(e) => { e.stopPropagation(); if (node.linkedSceneId) onSceneNavigate(node.linkedSceneId); }}
          style={{ marginLeft: `calc(${depth} * 16px + 48px)` }}
        >
          <span className="opl-scene-chip-icon">↗</span>
          {sceneName}
        </button>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  story: Story | null;
  onSelectScene?: (scene: Scene, chapter: Chapter) => void;
}

export default function OutlinePlanningPanel({ story, onSelectScene }: Props) {
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [linkPickerNodeId, setLinkPickerNodeId] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef<OutlineNode[]>([]);
  const storyIdRef = useRef<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  nodesRef.current = nodes;

  // ── Load on story change ────────────────────────────────────────────────────
  useEffect(() => {
    if (!story) {
      setNodes([]);
      storyIdRef.current = null;
      return;
    }
    if (story.id === storyIdRef.current) return;
    storyIdRef.current = story.id;
    setNodes([]);
    setActiveNodeId(null);
    setCollapsed(new Set());

    window.api.outline
      .load(story.path)
      .then((data: OutlineData | null) => {
        if (storyIdRef.current !== story.id) return;
        setNodes(data?.nodes ?? []);
      })
      .catch(() => {});
  }, [story]);

  // ── Cleanup save timer on unmount ───────────────────────────────────────────
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // ── Debounced save ──────────────────────────────────────────────────────────
  const scheduleSave = useCallback(
    (nextNodes: OutlineNode[]) => {
      if (!story) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const data: OutlineData = {
          storyId: story.id,
          schemaVersion: 1,
          nodes: nextNodes,
        };
        window.api.outline.save(story.path, data).catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    },
    [story],
  );

  const applyNodes = useCallback(
    (next: OutlineNode[]) => {
      setNodes(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // ── Focus helper ────────────────────────────────────────────────────────────
  const focusNode = useCallback((id: string) => {
    setActiveNodeId(id);
    setTimeout(() => {
      const el = inputRefs.current.get(id);
      if (el) { el.focus(); el.select(); }
    }, 0);
  }, []);

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (id: string, e: React.KeyboardEvent<HTMLInputElement>) => {
      const current = nodesRef.current;
      const flat = flattenVisible(current, collapsed);
      const curIdx = flat.findIndex((f) => f.node.id === id);

      if (e.key === 'Enter') {
        e.preventDefault();
        const newNode = makeNode('');
        applyNodes(insertAfter(current, id, newNode));
        focusNode(newNode.id);
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        applyNodes(indentNode(current, id));
        // Focus stays on same node
        setTimeout(() => inputRefs.current.get(id)?.focus(), 0);
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        applyNodes(promoteNode(current, id));
        setTimeout(() => inputRefs.current.get(id)?.focus(), 0);
      } else if (e.key === 'Backspace') {
        const node = findNodeDeep(current, id);
        if (node && node.title === '' && node.children.length === 0) {
          e.preventDefault();
          const { tree } = removeNode(current, id);
          applyNodes(tree);
          // Focus previous node
          if (curIdx > 0) {
            const prevId = flat[curIdx - 1].node.id;
            focusNode(prevId);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
        setActiveNodeId(null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (curIdx > 0) focusNode(flat[curIdx - 1].node.id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (curIdx < flat.length - 1) focusNode(flat[curIdx + 1].node.id);
      }
    },
    [collapsed, applyNodes, focusNode],
  );

  // ── Title change ────────────────────────────────────────────────────────────
  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      applyNodes(updateNode(nodesRef.current, id, (n) => ({ ...n, title })));
    },
    [applyNodes],
  );

  // ── Fold / unfold ───────────────────────────────────────────────────────────
  const handleToggleFold = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Scene linking ───────────────────────────────────────────────────────────
  const handleLinkScene = useCallback(
    (nodeId: string, sceneId: string) => {
      applyNodes(updateNode(nodesRef.current, nodeId, (n) => ({ ...n, linkedSceneId: sceneId })));
    },
    [applyNodes],
  );

  const handleUnlinkScene = useCallback(
    (nodeId: string) => {
      applyNodes(
        updateNode(nodesRef.current, nodeId, (n) => {
          const { linkedSceneId: _removed, ...rest } = n;
          return { ...rest, children: n.children };
        }),
      );
    },
    [applyNodes],
  );

  const handleSceneNavigate = useCallback(
    (sceneId: string) => {
      if (!story || !onSelectScene) return;
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((s) => s.id === sceneId);
        if (scene) { onSelectScene(scene, chapter); return; }
      }
    },
    [story, onSelectScene],
  );

  // ── Close link picker on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!linkPickerNodeId) return;
    const handler = () => setLinkPickerNodeId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [linkPickerNodeId]);

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    setDragNodeId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === dragNodeId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropTarget({ nodeId: id, position: e.clientY < midY ? 'before' : 'after' });
  }, [dragNodeId]);

  const handleDragLeave = useCallback((id: string) => {
    setDropTarget((prev) => (prev?.nodeId === id ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (id: string, e: React.DragEvent) => {
      e.preventDefault();
      const dragId = e.dataTransfer.getData('text/plain');
      if (!dragId || dragId === id || !dropTarget) return;

      const current = nodesRef.current;
      const { tree, removed } = removeNode(current, dragId);
      if (!removed) return;

      let next: OutlineNode[];
      if (dropTarget.position === 'before') {
        next = insertBefore(tree, id, removed);
      } else {
        next = insertAfter(tree, id, removed);
      }
      applyNodes(next);
      setDragNodeId(null);
      setDropTarget(null);
    },
    [dropTarget, applyNodes],
  );

  const handleDragEnd = useCallback(() => {
    setDragNodeId(null);
    setDropTarget(null);
  }, []);

  // ── Add first node (empty state action) ────────────────────────────────────
  const handleAddFirstNode = useCallback(() => {
    const newNode = makeNode('');
    applyNodes([newNode]);
    focusNode(newNode.id);
  }, [applyNodes, focusNode]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!story) {
    return (
      <div className="sidebar-empty" data-testid="opl-no-story">
        <div className="sidebar-empty-icon">🗒️</div>
        <p>Select a story to use the Outline planner.</p>
      </div>
    );
  }

  const flat = flattenVisible(nodes, collapsed);

  return (
    <div className="opl-panel" data-testid="opl-panel" aria-label="Outline planning panel">
      <div className="opl-header">
        <span className="opl-header-title">Outline</span>
        <button
          className="opl-add-root-btn"
          aria-label="Add root outline node"
          onClick={handleAddFirstNode}
        >
          +
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="opl-empty" data-testid="opl-empty-state">
          <p className="opl-empty-prompt">No outline yet — press Enter to start planning</p>
          <button
            className="opl-empty-start-btn"
            onClick={handleAddFirstNode}
            data-testid="opl-start-btn"
          >
            Start planning
          </button>
        </div>
      ) : (
        <div
          className="opl-tree"
          role="tree"
          aria-label="Outline nodes"
          data-testid="opl-tree"
        >
          {flat.map(({ node, depth }) => (
            <NodeRow
              key={node.id}
              node={node}
              depth={depth}
              isCollapsed={collapsed.has(node.id)}
              activeNodeId={activeNodeId}
              inputRef={(el) => {
                if (el) inputRefs.current.set(node.id, el);
                else inputRefs.current.delete(node.id);
              }}
              dropTarget={dropTarget}
              dragNodeId={dragNodeId}
              story={story}
              linkPickerNodeId={linkPickerNodeId}
              onActivate={setActiveNodeId}
              onTitleChange={handleTitleChange}
              onKeyDown={handleKeyDown}
              onToggleFold={handleToggleFold}
              onOpenLinkPicker={setLinkPickerNodeId}
              onCloseLinkPicker={() => setLinkPickerNodeId(null)}
              onLinkScene={handleLinkScene}
              onUnlinkScene={handleUnlinkScene}
              onSceneNavigate={handleSceneNavigate}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
