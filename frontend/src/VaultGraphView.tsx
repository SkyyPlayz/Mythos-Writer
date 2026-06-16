import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import './VaultGraphView.css';

const GRAPH_WIDTH = 1200;
const GRAPH_HEIGHT = 800;
const LINK_DISTANCE = 80;
const CHARGE_REPULSION = -120;
const COLLISION_PADDING = 12;
const CENTER_GRAVITY = 0.05;
const MAX_INTERACTIVE_NODES = 500;

const GRAPH_CATEGORIES = [
  'characters',
  'locations',
  'factions',
  'history',
  'systems',
  'items',
  'misc',
  'default',
] as const;

type GraphCategory = (typeof GRAPH_CATEGORIES)[number];

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  category?: string;
  degree?: number;
  folder?: string;
  tags?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
}

export interface VaultGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  radius: number;
  categoryKey: GraphCategory;
}

interface Props {
  onOpenNote?: (path: string) => void;
}

function isGraphCategory(value: string): value is GraphCategory {
  return (GRAPH_CATEGORIES as readonly string[]).includes(value);
}

function categoryFromFolder(folder?: string): GraphCategory {
  const normalized = (folder ?? '').trim().toLowerCase();
  if (normalized.startsWith('char')) return 'characters';
  if (normalized.startsWith('loc') || normalized.startsWith('place') || normalized.startsWith('setting')) return 'locations';
  if (normalized.startsWith('fac') || normalized.startsWith('group') || normalized.startsWith('org')) return 'factions';
  if (normalized.startsWith('hist') || normalized.startsWith('timeline') || normalized.startsWith('event')) return 'history';
  if (normalized.startsWith('sys') || normalized.startsWith('magic') || normalized.startsWith('rule')) return 'systems';
  if (normalized.startsWith('item') || normalized.startsWith('obj') || normalized.startsWith('artifact')) return 'items';
  if (normalized) return 'misc';
  return 'default';
}

function nodeCategory(node: GraphNode): GraphCategory {
  const normalized = (node.category ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (isGraphCategory(normalized)) return normalized;
  return categoryFromFolder(node.folder);
}

function nodeDegree(node: GraphNode, neighbours: Map<string, Set<string>>): number {
  return node.degree ?? neighbours.get(node.id)?.size ?? 0;
}

export function computeNodeRadius(degree: number): number {
  if (degree <= 0) return 5;
  return 6 + Math.min(Math.max(degree * 0.5, 0), 10);
}

export function buildNeighbourMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, new Set());
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, new Set());
    neighbours.get(edge.source)?.add(edge.target);
    neighbours.get(edge.target)?.add(edge.source);
  }
  return neighbours;
}

function displayLabel(label: string): string {
  return label.replace(/\.md$/i, '');
}

function edgeTestId(edge: GraphEdge): string {
  return `vault-edge-${edge.source}__${edge.target}`;
}

function initialPositions(nodes: GraphNode[], neighbours: Map<string, Set<string>>): PositionedNode[] {
  const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * 0.32;
  return nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1);
    const degree = nodeDegree(node, neighbours);
    return {
      ...node,
      categoryKey: nodeCategory(node),
      radius: computeNodeRadius(degree),
      x: GRAPH_WIDTH / 2 + radius * Math.cos(angle),
      y: GRAPH_HEIGHT / 2 + radius * Math.sin(angle),
    };
  });
}

function applyForceLayout(nodes: GraphNode[], edges: GraphEdge[]): PositionedNode[] {
  const neighbours = buildNeighbourMap(edges);
  const positioned = initialPositions(nodes, neighbours);
  const byId = new Map(positioned.map((node) => [node.id, node]));

  for (let step = 0; step < 80; step += 1) {
    const movement = new Map(positioned.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let i = 0; i < positioned.length; i += 1) {
      for (let j = i + 1; j < positioned.length; j += 1) {
        const a = positioned[i];
        const b = positioned[j];
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const distance = Math.max(Math.hypot(dx, dy), 0.01);
        const minDistance = a.radius + b.radius + COLLISION_PADDING;
        const collisionBoost = distance < minDistance ? (minDistance - distance) * 0.25 : 0;
        const force = (Math.abs(CHARGE_REPULSION) / distance) + collisionBoost;
        const ax = (dx / distance) * force;
        const ay = (dy / distance) * force;
        const ma = movement.get(a.id);
        const mb = movement.get(b.id);
        if (ma && mb) {
          ma.x += ax;
          ma.y += ay;
          mb.x -= ax;
          mb.y -= ay;
        }
      }
    }

    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x || 0.01;
      const dy = target.y - source.y || 0.01;
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (distance - LINK_DISTANCE) * 0.06;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      const ms = movement.get(source.id);
      const mt = movement.get(target.id);
      if (ms && mt) {
        ms.x += fx;
        ms.y += fy;
        mt.x -= fx;
        mt.y -= fy;
      }
    }

    for (const node of positioned) {
      const move = movement.get(node.id);
      if (!move) continue;
      move.x += (GRAPH_WIDTH / 2 - node.x) * CENTER_GRAVITY;
      move.y += (GRAPH_HEIGHT / 2 - node.y) * CENTER_GRAVITY;
      node.x = Math.max(32, Math.min(GRAPH_WIDTH - 32, node.x + move.x));
      node.y = Math.max(32, Math.min(GRAPH_HEIGHT - 32, node.y + move.y));
    }
  }

  return positioned;
}

function visibleIdsForHover(hoveredNodeId: string | null, neighbours: Map<string, Set<string>>): Set<string> | null {
  if (!hoveredNodeId) return null;
  return new Set([hoveredNodeId, ...(neighbours.get(hoveredNodeId) ?? [])]);
}

function normalizeNodeResponse(response: unknown): GraphNode[] | null {
  if (Array.isArray(response)) return response as GraphNode[];
  if (response && typeof response === 'object' && Array.isArray((response as { nodes?: unknown }).nodes)) {
    return (response as { nodes: GraphNode[] }).nodes;
  }
  return null;
}

function normalizeEdgeResponse(response: unknown): GraphEdge[] | null {
  if (Array.isArray(response)) return response as GraphEdge[];
  if (response && typeof response === 'object' && Array.isArray((response as { edges?: unknown }).edges)) {
    return (response as { edges: GraphEdge[] }).edges;
  }
  return null;
}

export default function VaultGraphView({ onOpenNote }: Props) {
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        const nodesHandler = window.api?.vaultGraphNodes;
        const edgesHandler = window.api?.vaultGraphEdges;
        if (typeof nodesHandler !== 'function' || typeof edgesHandler !== 'function') {
          throw new Error('Vault graph IPC handlers are not available.');
        }

        const [nodeResponse, edgeResponse] = await Promise.all([nodesHandler(), edgesHandler()]);
        const nodes = normalizeNodeResponse(nodeResponse);
        const edges = normalizeEdgeResponse(edgeResponse);
        if (!nodes || !edges) throw new Error('Vault graph IPC handlers returned an invalid payload.');
        if (!cancelled) setGraphData({ nodes, edges });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();
    return () => { cancelled = true; };
  }, []);

  const filteredData = useMemo(() => {
    if (!graphData) return null;
    const query = search.trim().toLowerCase();
    if (!query) return graphData;
    const nodes = graphData.nodes.filter((node) => (
      node.label.toLowerCase().includes(query)
      || node.path.toLowerCase().includes(query)
      || (node.category ?? '').toLowerCase().includes(query)
      || (node.folder ?? '').toLowerCase().includes(query)
    ));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graphData.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return { nodes, edges };
  }, [graphData, search]);

  const neighbours = useMemo(
    () => buildNeighbourMap(filteredData?.edges ?? []),
    [filteredData],
  );

  const positionedNodes = useMemo(
    () => applyForceLayout(filteredData?.nodes ?? [], filteredData?.edges ?? []),
    [filteredData],
  );

  const nodeById = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes],
  );

  const visibleIds = useMemo(
    () => visibleIdsForHover(hoveredNodeId, neighbours),
    [hoveredNodeId, neighbours],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNodeId(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === '0' || event.key === 'Escape') resetView();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetView]);

  const handleWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((value) => Math.max(0.1, Math.min(4, Number((value + direction).toFixed(2)))));
  }, []);

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    setPanStart({ clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!panStart) return;
    setPan({
      x: panStart.x + (event.clientX - panStart.clientX) / zoom,
      y: panStart.y + (event.clientY - panStart.clientY) / zoom,
    });
  }

  function handlePointerUp() {
    setPanStart(null);
  }

  const selectNode = useCallback((node: PositionedNode) => {
    setSelectedNodeId(node.id);
    onOpenNote?.(node.path);
  }, [onOpenNote]);

  if (loading) return <div className="vgv-state">Loading vault graph…</div>;

  if (error) {
    return (
      <div className="vgv-state vgv-error">
        <p>{error}</p>
        <p className="vgv-error-sub">The Notes Vault graph data layer may not be ready yet.</p>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="vgv-state">
        <p>No notes found. Add markdown files with [[wiki-links]] to see your vault graph.</p>
      </div>
    );
  }

  const renderedNodeCount = positionedNodes.length;
  const showLargeGraphNotice = graphData.nodes.length > MAX_INTERACTIVE_NODES;

  return (
    <section className="vgv-root" data-testid="vault-graph-view" aria-label="Vault Graph panel">
      <header className="vgv-toolbar">
        <div className="vgv-title-group">
          <span className="vgv-title">Vault Graph</span>
          <span className="vgv-count">{graphData.nodes.length} notes · {graphData.edges.length} links</span>
        </div>
        <input
          className="vgv-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search nodes…"
          aria-label="Search nodes"
        />
      </header>

      {showLargeGraphNotice && (
        <div className="vgv-large-notice" role="status">
          Showing the default interactive graph. Large-vault show-all rendering is reserved for the canvas mode.
        </div>
      )}

      <div
        className="vgv-canvas"
        data-testid="vault-graph-canvas"
        onClick={() => setSelectedNodeId(null)}
      >
        <svg
          className="vgv-svg"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="img"
          aria-label="Notes Vault graph"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <g transform={`translate(${GRAPH_WIDTH * (1 - zoom) / 2 + pan.x} ${GRAPH_HEIGHT * (1 - zoom) / 2 + pan.y}) scale(${zoom})`}>
            {filteredData?.edges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              const dimmed = visibleIds ? (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) : false;
              return (
                <line
                  key={`${edge.source}-${edge.target}`}
                  data-testid={edgeTestId(edge)}
                  className={`vgv-graph-edge${dimmed ? ' vgv-graph-edge--dimmed' : ''}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                />
              );
            })}

            {positionedNodes.map((node) => {
              const dimmed = visibleIds ? !visibleIds.has(node.id) : false;
              const selected = selectedNodeId === node.id;
              const label = displayLabel(node.label);
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open note ${label}`}
                  data-testid={`vault-node-${node.id}`}
                  className={`vgv-graph-node${dimmed ? ' vgv-graph-node--dimmed' : ''}${selected ? ' vgv-graph-node--selected' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectNode(node);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectNode(node);
                    }
                  }}
                >
                  <circle
                    data-testid="vault-graph-node-circle"
                    className={`vgv-node-circle vgv-node-circle--${node.categoryKey}`}
                    r={node.radius}
                    fill={`var(--ln-graph-node-${node.categoryKey})`}
                    stroke={`var(--ln-graph-border-${node.categoryKey})`}
                    style={{
                      '--vgv-node-fill': `var(--ln-graph-node-${node.categoryKey})`,
                      '--vgv-node-stroke': `var(--ln-graph-border-${node.categoryKey})`,
                    } as CSSProperties}
                  />
                  <text className="vgv-node-label" y={node.radius + 14}>{label}</text>
                  <title>{node.path}</title>
                </g>
              );
            })}
          </g>
        </svg>

        {renderedNodeCount === 0 && (
          <div className="vgv-state vgv-state--overlay">No matching graph nodes.</div>
        )}

        <div className="vgv-zoom-controls" aria-label="Graph zoom controls">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + 0.1))}>+</button>
          <button type="button" aria-label="Reset graph view" onClick={resetView}>↺</button>
        </div>
      </div>
    </section>
  );
}
