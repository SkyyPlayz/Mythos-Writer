import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useViewport,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './SubwayCanvas.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChronologicalTime {
  date: string;
  isEstimated: boolean;
  confidence: number;
  source: string;
}

interface SceneEntry {
  id: string;
  title: string;
  path: string;
  order: number;
  chronologicalTime?: ChronologicalTime;
  timelineMetadata?: {
    wordCount?: number;
    pov?: string;
  };
}

interface Track {
  pov: string;
  colorHex: string;
  datedScenes: SceneEntry[];
  undatedScenes: SceneEntry[];
}

interface SubwayNodeData extends Record<string, unknown> {
  title: string;
  colorHex: string;
  isUndated: boolean;
}

interface Props {
  storyId: string | null;
  onOpenSceneEditor?: () => void;
  onOpenBrainstorm?: () => void;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const TRACK_HEIGHT = 72;
const NODE_WIDTH = 80;
const NODE_HEIGHT = 48;
const SCENE_SPACING = 120;
const GUTTER_WIDTH = 150;
const UNDATED_GAP = 60;
const INITIAL_VIEWPORT = { x: GUTTER_WIDTH, y: 20, zoom: 1 };

const POV_PALETTE = [
  '#00f0ff', // --neon-cyan
  '#9b5fff', // --neon-violet
  '#fbbf24', // --pov-gold
  '#10b981', // --pov-teal
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return `rgba(128,128,128,${alpha})`;
  return `rgba(${parseInt(m[0], 16)},${parseInt(m[1], 16)},${parseInt(m[2], 16)},${alpha})`;
}

function sortByDate(scenes: SceneEntry[]): SceneEntry[] {
  return [...scenes].sort((a, b) => {
    const da = a.chronologicalTime?.date ?? '';
    const db = b.chronologicalTime?.date ?? '';
    if (da && db) return da < db ? -1 : da > db ? 1 : 0;
    if (da) return -1;
    if (db) return 1;
    return a.order - b.order;
  });
}

function buildTracks(scenes: SceneEntry[]): Track[] {
  const povMap = new Map<string, SceneEntry[]>();
  for (const scene of scenes) {
    const pov = scene.timelineMetadata?.pov?.trim() || 'Unassigned';
    if (!povMap.has(pov)) povMap.set(pov, []);
    povMap.get(pov)!.push(scene);
  }
  let pi = 0;
  const tracks: Track[] = [];
  for (const [pov, povScenes] of povMap) {
    tracks.push({
      pov,
      colorHex: POV_PALETTE[pi % POV_PALETTE.length],
      datedScenes: sortByDate(povScenes.filter(s => !!s.chronologicalTime?.date)),
      undatedScenes: povScenes.filter(s => !s.chronologicalTime?.date),
    });
    pi++;
  }
  return tracks;
}

function computeMaxDatedX(tracks: Track[]): number {
  let max = 0;
  for (const track of tracks) {
    const lastIdx = track.datedScenes.length - 1;
    if (lastIdx >= 0) {
      const x = lastIdx * SCENE_SPACING;
      if (x > max) max = x;
    }
  }
  return max;
}

function buildNodes(tracks: Track[], maxDatedX: number): Node<SubwayNodeData>[] {
  const nodes: Node<SubwayNodeData>[] = [];
  const undatedStartX = maxDatedX + SCENE_SPACING + UNDATED_GAP;

  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti];
    const nodeY = ti * TRACK_HEIGHT + (TRACK_HEIGHT - NODE_HEIGHT) / 2;

    for (let si = 0; si < track.datedScenes.length; si++) {
      nodes.push({
        id: track.datedScenes[si].id,
        type: 'subwayScene',
        position: { x: si * SCENE_SPACING, y: nodeY },
        data: { title: track.datedScenes[si].title, colorHex: track.colorHex, isUndated: false },
        draggable: true,
        selectable: true,
      });
    }

    for (let ui = 0; ui < track.undatedScenes.length; ui++) {
      nodes.push({
        id: track.undatedScenes[ui].id,
        type: 'subwayScene',
        position: { x: undatedStartX + ui * SCENE_SPACING, y: nodeY },
        data: { title: track.undatedScenes[ui].title, colorHex: track.colorHex, isUndated: true },
        draggable: true,
        selectable: true,
        style: { opacity: 0.7 },
      });
    }
  }
  return nodes;
}

function interpolateDate(prev: string | undefined, next: string | undefined): string {
  if (!prev && !next) return new Date().toISOString().split('T')[0];
  if (!prev) return next!;
  if (!next) {
    const d = new Date(prev);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  const prevMs = new Date(prev).getTime();
  const nextMs = new Date(next).getTime();
  if (Number.isNaN(prevMs) || Number.isNaN(nextMs)) return prev;
  return new Date(Math.round((prevMs + nextMs) / 2)).toISOString().split('T')[0];
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ─── Custom scene node ────────────────────────────────────────────────────────

const SubwaySceneNode = memo(function SubwaySceneNode({ data, selected }: NodeProps<Node<SubwayNodeData>>) {
  const { title, colorHex, isUndated } = data;
  return (
    <div
      className={`subway-scene-node${selected ? ' subway-scene-node--selected' : ''}`}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: selected ? '#ffffff' : colorHex,
        background: hexToRgba(colorHex, 0.12),
        boxShadow: selected ? `0 0 12px ${colorHex}, 0 0 4px ${colorHex}` : undefined,
      }}
      aria-label={`${isUndated ? 'Undated scene' : 'Scene'}: ${title}`}
    >
      {isUndated && (
        <span className="subway-scene-node__badge" aria-hidden="true">?</span>
      )}
      <span className="subway-scene-node__label">{title}</span>
    </div>
  );
});

// ─── Track-lines overlay (must be inside ReactFlow to access useViewport) ──────

function TrackOverlay({ tracks, maxDatedX }: { tracks: Track[]; maxDatedX: number }) {
  const viewport = useViewport();

  // Convert canvas coords to screen coords for the SVG overlay
  const toScreen = (cx: number, cy: number) => ({
    sx: cx * viewport.zoom + viewport.x,
    sy: cy * viewport.zoom + viewport.y,
  });

  const totalW = 20000;
  const undatedScreenX = toScreen(maxDatedX + SCENE_SPACING + UNDATED_GAP / 2, 0).sx;
  const totalTrackH = tracks.length * TRACK_HEIGHT;
  const topScreen = toScreen(0, 0).sy;
  const botScreen = toScreen(0, totalTrackH).sy;
  const hasUndated = tracks.some(t => t.undatedScenes.length > 0);

  return (
    <Panel position="top-left" className="subway-overlay-panel">
      {/* Track lines */}
      <svg className="subway-track-svg" aria-hidden="true">
        {tracks.map((track, i) => {
          const cy = (i * TRACK_HEIGHT + TRACK_HEIGHT / 2);
          const { sy } = toScreen(0, cy);
          return (
            <line
              key={track.pov}
              x1={0}
              y1={sy}
              x2={totalW}
              y2={sy}
              stroke={track.colorHex}
              strokeWidth="1.5"
              strokeOpacity="0.25"
            />
          );
        })}
        {/* Undated zone divider */}
        {hasUndated && (
          <line
            x1={undatedScreenX}
            y1={topScreen}
            x2={undatedScreenX}
            y2={botScreen}
            stroke="var(--border-default)"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeOpacity="0.5"
          />
        )}
      </svg>
      {/* Undated zone label */}
      {hasUndated && (
        <span
          className="subway-undated-label"
          style={{ left: undatedScreenX + 6, top: topScreen - 20 }}
        >
          Undated
        </span>
      )}
      {/* POV gutter labels */}
      <div
        className="subway-gutter"
        style={{
          transform: `translateX(${-viewport.x}px)`,
          width: GUTTER_WIDTH,
        }}
      >
        {tracks.map((track, i) => {
          const cy = i * TRACK_HEIGHT + TRACK_HEIGHT / 2;
          const { sy } = toScreen(0, cy);
          return (
            <div
              key={track.pov}
              className="subway-gutter__label"
              style={{
                top: sy - 10,
                color: track.colorHex,
              }}
            >
              {track.pov}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function SubwayEmptyState({ onOpenSceneEditor, onOpenBrainstorm }: Pick<Props, 'onOpenSceneEditor' | 'onOpenBrainstorm'>) {
  return (
    <div className="subway-empty" role="status" aria-label="No scenes in timeline">
      <svg className="subway-empty__illustration" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
        <line x1="20" y1="40" x2="220" y2="40" stroke="var(--border-default)" strokeWidth="2" opacity="0.6" />
        <line x1="20" y1="70" x2="220" y2="70" stroke="var(--border-default)" strokeWidth="2" opacity="0.4" />
        <line x1="20" y1="100" x2="220" y2="100" stroke="var(--border-default)" strokeWidth="2" opacity="0.25" />
        <circle cx="60"  cy="40"  r="7" fill="none" stroke="#00f0ff" strokeWidth="2" opacity="0.5" />
        <circle cx="120" cy="40"  r="7" fill="none" stroke="#00f0ff" strokeWidth="2" opacity="0.5" />
        <circle cx="80"  cy="70"  r="7" fill="none" stroke="#9b5fff" strokeWidth="2" opacity="0.4" />
        <circle cx="150" cy="70"  r="7" fill="none" stroke="#9b5fff" strokeWidth="2" opacity="0.4" />
        <circle cx="100" cy="100" r="7" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.3" />
      </svg>
      <h2 className="subway-empty__headline">No scenes yet — let&apos;s start your story</h2>
      <p className="subway-empty__sub">
        Add scenes from the Scene Editor, or brainstorm here to let the Archive Agent build your timeline.
      </p>
      <div className="subway-empty__actions">
        <button className="subway-empty__btn subway-empty__btn--primary" onClick={onOpenSceneEditor}>
          Open Scene Editor
        </button>
        <button className="subway-empty__btn subway-empty__btn--secondary" onClick={onOpenBrainstorm}>
          Start Brainstorming
        </button>
      </div>
      <p className="subway-empty__hint">Scenes with POV metadata will appear on the timeline.</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const NODE_TYPES = { subwayScene: SubwaySceneNode };

export default function SubwayCanvas({ storyId, onOpenSceneEditor, onOpenBrainstorm }: Props) {
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [loading, setLoading] = useState(storyId !== null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SubwayNodeData>>([]);
  const settlingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null);

  // ─── IPC load ───

  useEffect(() => {
    if (!storyId) {
      setLoading(false);
      setScenes([]);
      return;
    }
    setLoading(true);
    setError(null);
    const api = (window as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
    api['timelineGetScenes'](storyId)
      .then((res) => {
        setScenes(((res as { scenes?: SceneEntry[] }).scenes) ?? []);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [storyId]);

  // ─── Layout ───

  const tracks = useMemo(() => buildTracks(scenes), [scenes]);
  const maxDatedX = useMemo(() => computeMaxDatedX(tracks), [tracks]);

  useEffect(() => {
    setNodes(buildNodes(tracks, maxDatedX));
  }, [tracks, maxDatedX, setNodes]);

  // ─── Drag-to-reorder ───

  const handleNodeDragStop: OnNodeDrag = useCallback((_evt, node) => {
    const { id, position } = node;

    const trackIndex = Math.max(
      0,
      Math.min(tracks.length - 1, Math.round((position.y - (TRACK_HEIGHT - NODE_HEIGHT) / 2) / TRACK_HEIGHT)),
    );
    const track = tracks[trackIndex];
    const snappedY = trackIndex * TRACK_HEIGHT + (TRACK_HEIGHT - NODE_HEIGHT) / 2;
    const isInUndatedZone = position.x > maxDatedX + SCENE_SPACING + UNDATED_GAP / 2;

    if (isInUndatedZone) {
      setNodes(prev => prev.map(n => n.id !== id ? n : {
        ...n,
        position: { x: position.x, y: snappedY },
        style: { ...n.style, opacity: 0.7 },
      }));
      const api = (window as unknown as { api: Record<string, (...a: unknown[]) => Promise<unknown>> }).api;
      api['timelineUpdateScene']({ sceneId: id, chronologicalTime: null }).catch(() => {});
      return;
    }

    const newIdx = Math.max(0, Math.min(track.datedScenes.length, Math.round(position.x / SCENE_SPACING)));
    const prevDate = track.datedScenes[newIdx - 1]?.chronologicalTime?.date;
    const nextDate = track.datedScenes[newIdx]?.id !== id
      ? track.datedScenes[newIdx]?.chronologicalTime?.date
      : track.datedScenes[newIdx + 1]?.chronologicalTime?.date;
    const newDate = interpolateDate(prevDate, nextDate);
    const snappedX = newIdx * SCENE_SPACING;
    const transition = prefersReducedMotion() ? undefined : 'transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1)';

    setNodes(prev => prev.map(n => n.id !== id ? n : {
      ...n,
      position: { x: snappedX, y: snappedY },
      style: { ...n.style, opacity: 1, transition },
    }));

    if (settlingRef.current) clearTimeout(settlingRef.current);
    settlingRef.current = setTimeout(() => {
      setNodes(prev => prev.map(n => n.id !== id ? n : {
        ...n,
        style: { ...n.style, transition: undefined },
      }));
    }, 300);

    const api = (window as unknown as { api: Record<string, (...a: unknown[]) => Promise<unknown>> }).api;
    api['timelineUpdateScene']({
      sceneId: id,
      chronologicalTime: { date: newDate, isEstimated: true, confidence: 0.5, source: 'user_drag' },
    })
      .then(() => {
        setScenes(prev => prev.map(s => s.id !== id ? s : {
          ...s,
          chronologicalTime: { date: newDate, isEstimated: true, confidence: 0.5, source: 'user_drag' },
        }));
      })
      .catch(() => {});
  }, [tracks, maxDatedX, setNodes]);

  // ─── Keyboard navigation ───

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!focusedSceneId || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const cur = nodes.find(n => n.id === focusedSceneId);
      if (!cur) return;
      const curTrack = Math.round((cur.position.y - (TRACK_HEIGHT - NODE_HEIGHT) / 2) / TRACK_HEIGHT);

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const nextTrack = curTrack + (e.key === 'ArrowUp' ? -1 : 1);
        const candidate = nodes.find(n =>
          Math.round((n.position.y - (TRACK_HEIGHT - NODE_HEIGHT) / 2) / TRACK_HEIGHT) === nextTrack
        );
        if (candidate) setFocusedSceneId(candidate.id);
      } else {
        const trackNodes = nodes
          .filter(n => Math.round((n.position.y - (TRACK_HEIGHT - NODE_HEIGHT) / 2) / TRACK_HEIGHT) === curTrack)
          .sort((a, b) => a.position.x - b.position.x);
        const idx = trackNodes.findIndex(n => n.id === focusedSceneId);
        const nextIdx = idx + (e.key === 'ArrowLeft' ? -1 : 1);
        if (nextIdx >= 0 && nextIdx < trackNodes.length) {
          setFocusedSceneId(trackNodes[nextIdx].id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedSceneId, nodes]);

  // ─── Render ───

  if (!storyId) {
    return (
      <SubwayEmptyState
        onOpenSceneEditor={onOpenSceneEditor}
        onOpenBrainstorm={onOpenBrainstorm}
      />
    );
  }

  if (loading) return <div className="subway-state" role="status" aria-live="polite" aria-label="Loading timeline">Loading timeline…</div>;
  if (error) return <div className="subway-state subway-state--error" role="alert">{error}</div>;

  if (scenes.length === 0) {
    return (
      <SubwayEmptyState
        onOpenSceneEditor={onOpenSceneEditor}
        onOpenBrainstorm={onOpenBrainstorm}
      />
    );
  }

  return (
    <div className="subway-canvas-root" data-testid="subway-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        onNodesChange={onNodesChange}
        nodeTypes={NODE_TYPES}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_evt, node) => setFocusedSceneId(node.id)}
        defaultViewport={INITIAL_VIEWPORT}
        minZoom={0.1}
        maxZoom={3}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        aria-label="Story timeline — subway view"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--border-default)"
        />
        <Controls showInteractive={false} />
        <TrackOverlay tracks={tracks} maxDatedX={maxDatedX} />
      </ReactFlow>
    </div>
  );
}
