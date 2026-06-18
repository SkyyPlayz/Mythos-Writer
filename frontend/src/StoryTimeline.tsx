import { useMemo, useState, useCallback } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Story, Scene, Chapter } from './types';
import './StoryTimeline.css';

// ─── Types ───

interface InferredPlacement {
  sceneId: string;
  scenePath: string;
  sceneTitle: string;
  inferredTime: string | null;
  confidence: number;
  source: 'explicit_marker' | 'prose' | null;
  cue: string | null;
}

type PlacementAction = 'matched' | 'suggested' | 'ignored';

interface PlacementState {
  action: PlacementAction;
  /** User-accepted inferred time (for 'matched') */
  acceptedTime?: string;
}

interface SceneWithContext {
  scene: Scene;
  chapter: Chapter;
  story: Story;
  fileOrder: number;
  placement: InferredPlacement | null;
  placementState: PlacementState | null;
}

// ─── Helpers ───

function collectScenes(story: Story): { scene: Scene; chapter: Chapter; fileOrder: number }[] {
  const result: { scene: Scene; chapter: Chapter; fileOrder: number }[] = [];
  const chapters = [...story.chapters].sort((a, b) => a.order - b.order);
  let globalOrder = 0;
  for (const chapter of chapters) {
    const scenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
    for (const scene of scenes) {
      result.push({ scene, chapter, fileOrder: globalOrder++ });
    }
  }
  return result;
}

function effectiveTime(item: SceneWithContext): string | null {
  if (item.placementState?.action === 'matched' && item.placementState.acceptedTime) {
    return item.placementState.acceptedTime;
  }
  // Fall back to scene.date if the type supports it (may be absent in base type)
  const anyScene = item.scene as unknown as Record<string, unknown>;
  if (typeof anyScene['date'] === 'string') return anyScene['date'] as string;
  return item.placement?.inferredTime ?? null;
}

function sortByEffectiveTime(items: SceneWithContext[]): SceneWithContext[] {
  return [...items].sort((a, b) => {
    const ta = effectiveTime(a);
    const tb = effectiveTime(b);
    if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta) return -1;
    if (tb) return 1;
    return a.fileOrder - b.fileOrder;
  });
}

function confidenceLabel(c: number): string {
  if (c >= 0.9) return 'high';
  if (c >= 0.6) return 'medium';
  if (c > 0) return 'low';
  return 'none';
}

// ─── Node layout ───

const NODE_WIDTH = 200;
const NODE_HEIGHT = 96;
const H_GAP = 56;
const V_GAP = 80;
const COLS = 4;

function buildNodesAndEdges(
  items: SceneWithContext[],
  onAction: (sceneId: string, action: PlacementAction) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = items
    .filter(item => item.placementState?.action !== 'ignored')
    .map((item, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = col * (NODE_WIDTH + H_GAP);
      const y = row * (NODE_HEIGHT + V_GAP);

      const time = effectiveTime(item);
      const dateLabel = time
        ? (() => {
            try {
              return new Date(time).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
            } catch {
              return time;
            }
          })()
        : null;

      const placement = item.placement;
      const state = item.placementState;
      const conf = placement?.confidence ?? 0;
      const confLevel = confidenceLabel(conf);
      const isMatched = state?.action === 'matched';
      const isSuggested = state?.action === 'suggested';

      return {
        id: item.scene.id,
        position: { x, y },
        data: {
          label: (
            <div className={`tl-node${isMatched ? ' tl-node--matched' : ''}`}>
              <div className="tl-node-title">{item.scene.title}</div>

              {dateLabel && (
                <div className="tl-node-time">
                  {dateLabel}
                  {placement?.source && (
                    <span className={`tl-node-source tl-node-source--${placement.source}`}>
                      {placement.source === 'explicit_marker' ? 'frontmatter' : 'prose'}
                    </span>
                  )}
                </div>
              )}

              {placement && placement.confidence > 0 && (
                <div className={`tl-node-conf tl-node-conf--${confLevel}`}>
                  {Math.round(conf * 100)}% confidence
                  {placement.cue && ` · ${placement.cue}`}
                </div>
              )}

              <div className="tl-node-chapter">{item.chapter.title}</div>

              {placement && !isMatched && (
                <div className="tl-node-actions">
                  <button
                    className="tl-btn tl-btn--match"
                    title="Accept Archive inference — apply inferred time to this scene"
                    onClick={e => { e.stopPropagation(); onAction(item.scene.id, 'matched'); }}
                  >
                    Match Archive
                  </button>
                  <button
                    className={`tl-btn tl-btn--suggest${isSuggested ? ' tl-btn--active' : ''}`}
                    title="Flag for manual story date revision"
                    onClick={e => { e.stopPropagation(); onAction(item.scene.id, 'suggested'); }}
                  >
                    Suggest Change
                  </button>
                  <button
                    className="tl-btn tl-btn--ignore"
                    title="Ignore Archive inference for this scene"
                    onClick={e => { e.stopPropagation(); onAction(item.scene.id, 'ignored'); }}
                  >
                    Ignore
                  </button>
                </div>
              )}

              {isMatched && (
                <div className="tl-node-matched-badge">Archive matched</div>
              )}
            </div>
          ),
        },
        style: {
          width: NODE_WIDTH,
          minHeight: NODE_HEIGHT,
          padding: 0,
          background: 'transparent',
          border: 'none',
        },
      };
    });

  const visibleIds = new Set(nodes.map(n => n.id));
  const visibleItems = items.filter(i => visibleIds.has(i.scene.id));

  const edges: Edge[] = visibleItems.slice(0, -1).map((item, idx) => ({
    id: `e-${item.scene.id}-${visibleItems[idx + 1].scene.id}`,
    source: item.scene.id,
    target: visibleItems[idx + 1].scene.id,
    type: 'smoothstep',
    style: { stroke: 'var(--color-border)', strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}

// ─── Component ───

interface Props {
  story: Story | null;
}

export default function StoryTimeline({ story }: Props) {
  const [placements, setPlacements] = useState<InferredPlacement[]>([]);
  const [placementStates, setPlacementStates] = useState<Record<string, PlacementState>>({});
  const [inferring, setInferring] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);

  const runInference = useCallback(async () => {
    if (!story) return;
    setInferring(true);
    setInferError(null);
    try {
      const api = (window as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
      const result = await api['timelineInfer'](story.id) as { placements: InferredPlacement[] };
      setPlacements(result.placements ?? []);
      // Reset states for newly inferred placements
      setPlacementStates({});
    } catch (err) {
      setInferError(String(err));
    } finally {
      setInferring(false);
    }
  }, [story]);

  const handleAction = useCallback((sceneId: string, action: PlacementAction) => {
    setPlacementStates(prev => {
      const placement = placements.find(p => p.sceneId === sceneId);
      return {
        ...prev,
        [sceneId]: {
          action,
          acceptedTime: action === 'matched' ? (placement?.inferredTime ?? undefined) : undefined,
        },
      };
    });
  }, [placements]);

  const placementMap = useMemo(() => {
    const m: Record<string, InferredPlacement> = {};
    for (const p of placements) m[p.sceneId] = p;
    return m;
  }, [placements]);

  const items: SceneWithContext[] = useMemo(() => {
    if (!story) return [];
    return collectScenes(story).map(({ scene, chapter, fileOrder }) => ({
      scene,
      chapter,
      story,
      fileOrder,
      placement: placementMap[scene.id] ?? null,
      placementState: placementStates[scene.id] ?? null,
    }));
  }, [story, placementMap, placementStates]);

  const sortedItems = useMemo(() => sortByEffectiveTime(items), [items]);

  const { nodes, edges } = useMemo(
    () => buildNodesAndEdges(sortedItems, handleAction),
    [sortedItems, handleAction],
  );

  if (!story) {
    return (
      <div className="timeline-empty" data-panel="timeline">
        <div className="timeline-empty-icon" aria-hidden="true"><BookOpen size={40} /></div>
        <h2>Select a story to view its timeline.</h2>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="timeline-empty" data-panel="timeline">
        <div className="timeline-empty-icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>Create scenes in your story to see them here.</h2>
      </div>
    );
  }

  return (
    <div className="timeline-root" data-panel="timeline">
      <div className="timeline-toolbar">
        <span className="timeline-story-title">{story.title}</span>
        <button
          className={`timeline-infer-btn${inferring ? ' timeline-infer-btn--loading' : ''}`}
          onClick={runInference}
          disabled={inferring}
        >
          {inferring ? 'Inferring…' : 'Run Archive Inference'}
        </button>
        {inferError && <span className="timeline-infer-error">{inferError}</span>}
        {placements.length > 0 && !inferring && (
          <span className="timeline-infer-summary">
            {placements.filter(p => p.inferredTime).length}/{placements.length} scenes dated
          </span>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
