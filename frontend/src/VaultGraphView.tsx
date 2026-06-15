import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './VaultGraphView.css';

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  folder?: string;
  tags?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Entity type system (spec §1) ────────────────────────────────────────────

export type EntityType =
  | 'Character'
  | 'Location'
  | 'Faction'
  | 'Item'
  | 'System'
  | 'History'
  | 'Note';

/** Derive entity type from the node's folder field per spec §1 table. */
export function deriveEntityType(node: GraphNode): EntityType {
  const f = (node.folder ?? '').toLowerCase();
  if (f.startsWith('char')) return 'Character';
  if (f.startsWith('loc') || f.startsWith('place') || f.startsWith('setting')) return 'Location';
  if (f.startsWith('fac') || f.startsWith('group') || f.startsWith('org')) return 'Faction';
  if (f.startsWith('item') || f.startsWith('obj') || f.startsWith('artifact')) return 'Item';
  if (f.startsWith('sys') || f.startsWith('magic') || f.startsWith('rule')) return 'System';
  if (f.startsWith('hist') || f.startsWith('timeline') || f.startsWith('event')) return 'History';
  return 'Note';
}

/** Neon border color per entity type (matches --neon-* tokens). */
export const TYPE_COLORS: Record<EntityType, string> = {
  Note: '#00f0ff',
  Location: '#00f0ff',
  History: '#00f0ff',
  Character: '#9b5fff',
  Item: '#9b5fff',
  Faction: '#ff4dff',
  System: '#ff4dff',
};

const TYPE_CSS_CLASS: Record<EntityType, string> = {
  Note: 'vgv-node--note',
  Character: 'vgv-node--character',
  Location: 'vgv-node--location',
  Faction: 'vgv-node--faction',
  Item: 'vgv-node--item',
  System: 'vgv-node--system',
  History: 'vgv-node--history',
};

// ─── Custom node component ────────────────────────────────────────────────────

interface NeonNodeData extends Record<string, unknown> {
  label: string;
  path: string;
  entityType: EntityType;
}

function NeonNode({ data, selected }: NodeProps) {
  const nd = data as NeonNodeData;
  const entityType: EntityType = nd.entityType ?? 'Note';
  const typeClass = TYPE_CSS_CLASS[entityType] ?? 'vgv-node--note';
  const label = nd.label ?? '';
  const truncated = label.length > 15 ? label.slice(0, 14) + '…' : label;

  return (
    <div
      className={`vgv-node-base ${typeClass}${selected ? ' vgv-node--selected' : ''}`}
      title={label}
      data-entity-type={entityType}
    >
      <Handle type="target" position={Position.Top} className="vgv-handle" />
      <span className="vgv-node-label">{truncated}</span>
      <Handle type="source" position={Position.Bottom} className="vgv-handle" />
    </div>
  );
}

// ─── Custom edge component ────────────────────────────────────────────────────

interface NeonEdgeData extends Record<string, unknown> {
  sourceColor: string;
  targetColor: string;
}

function NeonEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const ed = data as NeonEdgeData | undefined;
  const srcColor = ed?.sourceColor ?? '#00f0ff';
  const tgtColor = ed?.targetColor ?? '#9b5fff';
  const gradId = `neon-eg-${id}`;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={srcColor} />
          <stop offset="100%" stopColor={tgtColor} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        className={`vgv-edge${selected ? ' vgv-edge--selected' : ''}`}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
    </>
  );
}

// Define outside component to prevent ReactFlow from remounting nodes/edges on re-render
const NODE_TYPES = { neonNode: NeonNode };
const EDGE_TYPES = { neonEdge: NeonEdge };

// ─── Force-directed layout ────────────────────────────────────────────────────

function applyForceLayout(
  gnodes: GraphNode[],
  gedges: GraphEdge[],
): { id: string; x: number; y: number }[] {
  const W = 900, H = 700;
  const positions: Record<string, { x: number; y: number }> = {};

  gnodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(gnodes.length, 1);
    positions[n.id] = {
      x: W / 2 + (W / 3) * Math.cos(angle),
      y: H / 2 + (H / 3) * Math.sin(angle),
    };
  });

  const k = Math.sqrt((W * H) / Math.max(gnodes.length, 1));
  const iterations = 80;

  for (let iter = 0; iter < iterations; iter++) {
    const disp: Record<string, { x: number; y: number }> = {};
    gnodes.forEach((n) => { disp[n.id] = { x: 0, y: 0 }; });

    for (let i = 0; i < gnodes.length; i++) {
      for (let j = i + 1; j < gnodes.length; j++) {
        const u = gnodes[i].id, v = gnodes[j].id;
        const dx = positions[u].x - positions[v].x;
        const dy = positions[u].y - positions[v].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = (k * k) / dist;
        disp[u].x += (dx / dist) * force;
        disp[u].y += (dy / dist) * force;
        disp[v].x -= (dx / dist) * force;
        disp[v].y -= (dy / dist) * force;
      }
    }

    for (const e of gedges) {
      const u = e.source, v = e.target;
      if (!positions[u] || !positions[v]) continue;
      const dx = positions[u].x - positions[v].x;
      const dy = positions[u].y - positions[v].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist * dist) / k;
      disp[u].x -= (dx / dist) * force;
      disp[u].y -= (dy / dist) * force;
      disp[v].x += (dx / dist) * force;
      disp[v].y += (dy / dist) * force;
    }

    const temp = W / (iter + 1);
    for (const n of gnodes) {
      const d = disp[n.id];
      const dLen = Math.max(Math.sqrt(d.x * d.x + d.y * d.y), 0.01);
      positions[n.id].x += (d.x / dLen) * Math.min(dLen, temp);
      positions[n.id].y += (d.y / dLen) * Math.min(dLen, temp);
      positions[n.id].x = Math.max(40, Math.min(W - 40, positions[n.id].x));
      positions[n.id].y = Math.max(40, Math.min(H - 40, positions[n.id].y));
    }
  }

  return gnodes.map((n) => ({ id: n.id, ...positions[n.id] }));
}

// ─── Build ReactFlow elements ─────────────────────────────────────────────────

function buildFlowElements(
  data: VaultGraphData,
  filterFolder: string,
  filterTag: string,
): { nodes: Node[]; edges: Edge[] } {
  let filtered = data.nodes;

  if (filterFolder) {
    filtered = filtered.filter((n) => !n.folder || n.folder === filterFolder);
  }
  if (filterTag) {
    filtered = filtered.filter((n) => n.tags?.includes(filterTag));
  }

  const nodeIds = new Set(filtered.map((n) => n.id));
  const filteredEdges = data.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  const positions = applyForceLayout(filtered, filteredEdges);
  const posMap: Record<string, { x: number; y: number }> = {};
  positions.forEach((p) => { posMap[p.id] = { x: p.x, y: p.y }; });

  // Cache entity types to avoid recomputing per-edge
  const typeMap: Record<string, EntityType> = {};
  filtered.forEach((n) => { typeMap[n.id] = deriveEntityType(n); });

  const nodes: Node[] = filtered.map((n) => ({
    id: n.id,
    position: posMap[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, path: n.path, entityType: typeMap[n.id] } as NeonNodeData,
    type: 'neonNode',
  }));

  const edges: Edge[] = filteredEdges.map((e, i) => {
    const srcType = typeMap[e.source] ?? 'Note';
    const tgtType = typeMap[e.target] ?? 'Note';
    return {
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'neonEdge',
      data: {
        sourceColor: TYPE_COLORS[srcType],
        targetColor: TYPE_COLORS[tgtType],
      } as NeonEdgeData,
    };
  });

  return { nodes, edges };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  onOpenNote?: (path: string) => void;
}

export default function VaultGraphView({ onOpenNote }: Props) {
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await window.api?.vaultGraphData?.() as VaultGraphData | undefined;
        if (data) {
          setGraphData(data);
        } else {
          setError('VAULT_GRAPH_DATA IPC not available yet.');
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!graphData) return;
    const { nodes: n, edges: e } = buildFlowElements(graphData, filterFolder, filterTag);
    setNodes(n);
    setEdges(e);
  }, [graphData, filterFolder, filterTag, setNodes, setEdges]);

  const folders = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.folder).filter(Boolean))) as string[];
  }, [graphData]);

  const tags = useMemo(() => {
    if (!graphData) return [];
    const all = graphData.nodes.flatMap((n) => n.tags ?? []);
    return Array.from(new Set(all));
  }, [graphData]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const path = (node.data as NeonNodeData).path;
    if (path) onOpenNote?.(path);
  }, [onOpenNote]);

  // Zoom-based label/node opacity — direct DOM update to avoid re-renders (spec §7)
  const handleMove = useCallback(
    (_evt: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      const z = viewport.zoom;
      const labelOpacity = z >= 0.6 ? 1 : z <= 0.3 ? 0 : (z - 0.3) / (0.6 - 0.3);
      const nodeOpacity = Math.max(0.3, Math.min(1, z));
      if (canvasRef.current) {
        canvasRef.current.style.setProperty('--vgv-label-opacity', labelOpacity.toFixed(3));
        canvasRef.current.style.setProperty('--vgv-node-opacity', nodeOpacity.toFixed(3));
      }
    },
    [],
  );

  if (loading) {
    return <div className="vgv-state">Loading vault graph…</div>;
  }

  if (error) {
    return (
      <div className="vgv-state vgv-error">
        <p>{error}</p>
        <p className="vgv-error-sub">The BackendDev VAULT_GRAPH_DATA handler may not be implemented yet.</p>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="vgv-state">
        <p>No notes found. Add some markdown files with [[wiki-links]] to see your vault graph.</p>
      </div>
    );
  }

  return (
    <div className="vgv-root" data-testid="vault-graph-view">
      <div className="vgv-toolbar">
        <span className="vgv-title">Vault Graph</span>
        <span className="vgv-count">{graphData.nodes.length} notes · {graphData.edges.length} links</span>
        <div className="vgv-filters">
          {folders.length > 0 && (
            <select
              value={filterFolder}
              onChange={(e) => setFilterFolder(e.target.value)}
              aria-label="Filter by folder"
            >
              <option value="">All folders</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {tags.length > 0 && (
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              aria-label="Filter by tag"
            >
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="vgv-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onMove={handleMove}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          multiSelectionKeyCode="Control"
          fitView
          attributionPosition="bottom-right"
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={20}
            color="#1e242f"
          />
          <Controls />
          <MiniMap
            nodeColor={(node) => TYPE_COLORS[(node.data as NeonNodeData).entityType ?? 'Note'] ?? '#00f0ff'}
            maskColor="rgba(14,17,22,0.85)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
