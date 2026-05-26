import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  MarkerType,
  BackgroundVariant,
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

// Radial layout: evenly space nodes around a circle sized to the count
function computePositions(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const count = nodes.length;
  const radius = Math.max(180, count * 28);
  return Object.fromEntries(
    nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1);
      return [n.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }];
    })
  );
}

const NODE_STYLE: React.CSSProperties = {
  background: '#1e1e2e',
  color: '#cdd6f4',
  border: '1px solid #585b70',
  borderRadius: 6,
  fontSize: 11,
  padding: '4px 10px',
  minWidth: 80,
  maxWidth: 120,
};

export default function VaultGraphView({ onOpenNote }: Props) {
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await (window as unknown as { api?: { vaultGraphData?: () => Promise<VaultGraphData> } }).api?.vaultGraphData?.();
      if (data) {
        setGraphData(data);
        setError(null);
      } else {
        setError('VAULT_GRAPH_DATA IPC not available yet.');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live-update graph when vault files change (debounced 800 ms)
  useEffect(() => {
    type OnVaultFileChanged = (cb: (event: unknown, data: { path: string }) => void) => (() => void) | undefined;
    const api = (window as unknown as { api?: { onVaultFileChanged?: OnVaultFileChanged } }).api;
    const unsub = api?.onVaultFileChanged?.(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchData, 800);
    });
    return () => {
      unsub?.();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchData]);

  const folders = useMemo(
    () => Array.from(new Set((graphData?.nodes ?? []).map((n) => n.folder).filter(Boolean))) as string[],
    [graphData]
  );

  const tags = useMemo(
    () => Array.from(new Set((graphData?.nodes ?? []).flatMap((n) => n.tags ?? []))),
    [graphData]
  );

  // Recompute React Flow nodes/edges when data or filters change
  useEffect(() => {
    if (!graphData) return;

    let filtered = graphData.nodes;
    if (filterFolder) filtered = filtered.filter((n) => n.folder === filterFolder);
    if (filterTag) filtered = filtered.filter((n) => n.tags?.includes(filterTag));

    const nodeIds = new Set(filtered.map((n) => n.id));
    const positions = computePositions(filtered);

    setRfNodes(
      filtered.map((n) => ({
        id: n.id,
        position: positions[n.id],
        data: { label: n.label, path: n.path },
        style: NODE_STYLE,
      }))
    );

    setRfEdges(
      graphData.edges
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e, i) => ({
          id: `e${i}-${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          style: { stroke: '#585b70', strokeWidth: 1.2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#585b70' },
        }))
    );
  }, [graphData, filterFolder, filterTag, setRfNodes, setRfEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const notePath = node.data?.path as string | undefined;
      if (notePath) onOpenNote?.(notePath);
    },
    [onOpenNote]
  );

  if (loading) return <div className="vgv-state">Loading vault graph…</div>;
  if (error) return (
    <div className="vgv-state vgv-error">
      <p>{error}</p>
      <p className="vgv-error-sub">The BackendDev VAULT_GRAPH_DATA handler may not be implemented yet.</p>
    </div>
  );
  if (!graphData || graphData.nodes.length === 0) return (
    <div className="vgv-state">
      <p>No notes found. Add some markdown files with [[wiki-links]] to see your vault graph.</p>
    </div>
  );

  return (
    <div className="vgv-root" data-testid="vault-graph-view">
      <div className="vgv-toolbar">
        <span className="vgv-title">Vault Graph</span>
        <span className="vgv-count">{graphData.nodes.length} notes · {graphData.edges.length} links</span>
        <div className="vgv-filters">
          {folders.length > 0 && (
            <select value={filterFolder} onChange={(e) => setFilterFolder(e.target.value)} aria-label="Filter by folder">
              <option value="">All folders</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {tags.length > 0 && (
            <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="vgv-canvas" aria-label="Vault note graph" role="region">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          fitView
          style={{ background: '#11111b' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="#313244" gap={20} />
          <Controls style={{ background: '#1e1e2e', borderColor: '#313244', color: '#cdd6f4' }} />
        </ReactFlow>
      </div>
    </div>
  );
}
