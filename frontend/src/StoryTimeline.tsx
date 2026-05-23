import { useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './StoryTimeline.css';

interface TimelineEntry {
  id: string;
  scene_path: string;
  inferred_time: string;
  confidence: number;
  source: 'explicit_marker' | 'prose';
  notes_json: string | null;
  created_at: string;
}

interface StoryTimelineProps {
  storyPath: string;
  storyTitle: string;
  onClose: () => void;
}

// Detect overlapping entries (within 1 hour of each other)
function detectOverlaps(entries: TimelineEntry[]): Set<string> {
  const overlaps = new Set<string>();
  const sorted = [...entries].sort(
    (a, b) => new Date(a.inferred_time).getTime() - new Date(b.inferred_time).getTime()
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = new Date(sorted[i].inferred_time).getTime();
    const b = new Date(sorted[i + 1].inferred_time).getTime();
    if (Math.abs(b - a) < 60 * 60 * 1000) {
      overlaps.add(sorted[i].id);
      overlaps.add(sorted[i + 1].id);
    }
  }
  return overlaps;
}

function sceneLabel(path: string): string {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  return file.replace(/\.md$/, '').replace(/-/g, ' ');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function StoryTimeline({ storyPath, storyTitle, onClose }: StoryTimelineProps) {
  const [entries, setEntries] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  const loadEntries = useCallback(async () => {
    try {
      const result = await (window as any).api.timelineList(storyPath);
      const rows: TimelineEntry[] = result?.entries ?? [];
      const sorted = [...rows].sort(
        (a, b) => new Date(a.inferred_time).getTime() - new Date(b.inferred_time).getTime()
      );
      const overlaps = detectOverlaps(sorted);
      const CARD_W = 200;
      const GAP_X = 60;
      const ROW_H = 120;

      // Lay out nodes left-to-right, wrapping every 5
      const PER_ROW = 5;
      const nodes: Node[] = sorted.map((entry, i) => {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        const isPlanned = entry.source === 'prose' && entry.confidence < 0.5;
        const hasOverlap = overlaps.has(entry.id);
        return {
          id: entry.id,
          position: { x: col * (CARD_W + GAP_X), y: row * ROW_H },
          data: {
            label: (
              <div className={`tl-node${isPlanned ? ' tl-node--planned' : ''}${hasOverlap ? ' tl-node--overlap' : ''}`}>
                <div className="tl-node-time">{formatTime(entry.inferred_time)}</div>
                <div className="tl-node-title">{sceneLabel(entry.scene_path)}</div>
                {hasOverlap && <div className="tl-node-overlap-badge">⚠ overlap</div>}
                {isPlanned && <div className="tl-node-planned-badge">planned</div>}
              </div>
            ),
          },
          style: { padding: 0, background: 'transparent', border: 'none', width: CARD_W },
        };
      });

      // Sequential edges
      const newEdges: Edge[] = sorted.slice(0, -1).map((entry, i) => ({
        id: `e-${entry.id}-${sorted[i + 1].id}`,
        source: entry.id,
        target: sorted[i + 1].id,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#585b70' },
        style: { stroke: '#585b70' },
      }));

      setEntries(nodes);
      setEdges(newEdges);
    } catch (err) {
      console.error('StoryTimeline: failed to load entries', err);
    }
  }, [storyPath, setEntries, setEdges]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const isEmpty = entries.length === 0;

  return (
    <div className="tl-overlay">
      <div className="tl-panel">
        <div className="tl-header">
          <span className="tl-title">Timeline — {storyTitle}</span>
          <button className="tl-close" onClick={onClose} aria-label="Close timeline">✕</button>
        </div>
        {isEmpty ? (
          <div className="tl-empty">
            <div className="tl-empty-icon">⏱</div>
            <p>No timeline entries yet.</p>
            <p className="tl-empty-sub">The Archive Agent will populate entries as it processes scenes.</p>
          </div>
        ) : (
          <div className="tl-flow-wrap">
            <ReactFlow
              nodes={entries}
              edges={edges}
              fitView
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#313244" gap={20} />
              <Controls />
            </ReactFlow>
          </div>
        )}
      </div>
    </div>
  );
}
