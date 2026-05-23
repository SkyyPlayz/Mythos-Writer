import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
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

interface Props {
  onOpenNote?: (path: string) => void;
}

// Simple force-directed layout using a spring-repulsion pass
function applyForceLayout(
  gnodes: GraphNode[],
  gedges: GraphEdge[],
): { id: string; x: number; y: number }[] {
  const W = 900, H = 700;
  const positions: Record<string, { x: number; y: number }> = {};

  // Initialize in a circle
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

    // Repulsion
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

    // Attraction along edges
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

    // Apply displacement with cooling
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

  const nodes: Node[] = filtered.map((n) => ({
    id: n.id,
    position: posMap[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, path: n.path },
    type: 'default',
    style: {
      background: '#1e1e2e',
      color: '#cdd6f4',
      border: '1px solid #585b70',
      borderRadius: 8,
      fontSize: 12,
      padding: '4px 10px',
      cursor: 'pointer',
    },
  }));

  const edges: Edge[] = filteredEdges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: '#585b70' },
  }));

  return { nodes, edges };
}

export default function VaultGraphView({ onOpenNote }: Props) {
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState('');
  const [filterTag, setFilterTag] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await (window as any).api?.vaultGraphData?.() as VaultGraphData | undefined;
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
    const path = (node.data as any).path as string;
    if (path) onOpenNote?.(path);
  }, [onOpenNote]);

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
      <div className="vgv-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          fitView
          attributionPosition="bottom-right"
        >
          <Background gap={16} color="#313244" />
          <Controls />
          <MiniMap
            nodeColor="#585b70"
            maskColor="rgba(17,17,27,0.8)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
