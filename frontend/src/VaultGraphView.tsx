import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
const DEPTH_UNLIMITED = 7;
const LONG_PRESS_MS = 500;
const MAX_VISIBLE_CHIPS = 8;

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

const GRAPH_CATEGORY_LABELS: Record<GraphCategory, string> = {
  characters: 'Characters',
  locations: 'Locations',
  factions: 'Factions',
  history: 'History',
  systems: 'Systems',
  items: 'Items',
  misc: 'Misc',
  default: 'Default',
};

// Ordered chip list per spec (bottom toolbar)
const CHIP_DEFS: { key: GraphCategory; label: string }[] = [
  { key: 'characters', label: 'Characters' },
  { key: 'locations', label: 'Locations' },
  { key: 'factions', label: 'Factions' },
  { key: 'history', label: 'History' },
  { key: 'systems', label: 'Systems' },
  { key: 'items', label: 'Items' },
  { key: 'misc', label: 'Misc' },
];

const ALL_CHIP_KEYS = new Set<GraphCategory>(CHIP_DEFS.map((c) => c.key));

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

const TRUNCATION_THRESHOLD = MAX_INTERACTIVE_NODES;
const LOADING_SPINNER_DELAY_MS = 2000;
const VIEWPORT_BUFFER = 0.2;

const SKELETON_NODES: Array<{ x: number; y: number; r: number }> = [
  { x: 600, y: 200, r: 14 }, { x: 400, y: 350, r: 10 }, { x: 780, y: 320, r: 8 },
  { x: 300, y: 500, r: 9 }, { x: 500, y: 550, r: 7 }, { x: 700, y: 480, r: 11 },
  { x: 850, y: 550, r: 7 }, { x: 200, y: 300, r: 6 }, { x: 900, y: 200, r: 8 },
  { x: 650, y: 650, r: 6 },
];

const SKELETON_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 7], [4, 5], [5, 9], [2, 8],
];

interface Props {
  onOpenNote?: (path: string) => void;
  mostRecentNotePath?: string;
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

function sortNodesForKeyboard(nodes: PositionedNode[], neighbours: Map<string, Set<string>>): PositionedNode[] {
  return [...nodes].sort((a, b) => {
    const degreeDelta = nodeDegree(b, neighbours) - nodeDegree(a, neighbours);
    if (degreeDelta !== 0) return degreeDelta;
    return displayLabel(a.label).localeCompare(displayLabel(b.label));
  });
}

function nearestDirectionalNode(
  current: PositionedNode,
  candidates: PositionedNode[],
  direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
): PositionedNode | null {
  const scored = candidates
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => {
      const dx = candidate.x - current.x;
      const dy = candidate.y - current.y;
      const inDirection = (
        (direction === 'ArrowRight' && dx > 0)
        || (direction === 'ArrowLeft' && dx < 0)
        || (direction === 'ArrowDown' && dy > 0)
        || (direction === 'ArrowUp' && dy < 0)
      );
      if (!inDirection) return null;
      const primary = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
      return { candidate, score: primary + secondary * 0.5 };
    })
    .filter((entry): entry is { candidate: PositionedNode; score: number } => entry !== null)
    .sort((a, b) => a.score - b.score);

  return scored[0]?.candidate ?? null;
}

function graphSummary(nodes: PositionedNode[], edges: GraphEdge[], search: string, neighbours: Map<string, Set<string>>): string {
  const orphanCount = nodes.filter((node) => (neighbours.get(node.id)?.size ?? 0) === 0).length;
  const filterSummary = search.trim() ? `Filtered by "${search.trim()}".` : 'No active filters.';
  return `${nodes.length} notes. ${edges.length} connections. ${orphanCount} orphan notes. ${filterSummary}`;
}

function nodeAnnouncement(node: PositionedNode, neighbours: Map<string, Set<string>>, terse = false): string {
  const label = displayLabel(node.label);
  const connectionCount = neighbours.get(node.id)?.size ?? 0;
  if (terse) return `${label}. ${connectionCount} connections.`;
  return `${label}. ${node.categoryKey} note. ${connectionCount} connections. Press Enter to open.`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** BFS from fromNodeId up to depth hops. Returns null when depth >= DEPTH_UNLIMITED. */
export function computeDepthVisible(
  fromNodeId: string | null,
  allNodeIds: string[],
  neighbours: Map<string, Set<string>>,
  depth: number,
): Set<string> | null {
  if (depth >= DEPTH_UNLIMITED) return null;

  if (!fromNodeId) {
    // No selection: show connected nodes within N hops + orphans
    const connected = new Set<string>();
    for (const nid of allNodeIds) {
      if ((neighbours.get(nid)?.size ?? 0) > 0) connected.add(nid);
    }

    const visible = new Set<string>();
    for (const nid of allNodeIds) {
      if (!connected.has(nid)) { visible.add(nid); continue; } // orphan
      const seen = new Set<string>([nid]);
      let frontier = [nid];
      for (let hop = 0; hop < depth; hop++) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const nb of (neighbours.get(cur) ?? [])) {
            if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
          }
        }
        frontier = next;
      }
      for (const s of seen) visible.add(s);
    }
    return visible;
  }

  // With selection: BFS up to depth
  const visible = new Set<string>([fromNodeId]);
  let frontier = [fromNodeId];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of (neighbours.get(cur) ?? [])) {
        if (!visible.has(nb)) { visible.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }
  return visible;
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

// ─── Category chip ────────────────────────────────────────────────────────────

interface ChipProps {
  chipKey: GraphCategory;
  label: string;
  active: boolean;
  onToggle: (key: GraphCategory) => void;
  onShowOnly: (key: GraphCategory) => void;
  onShowAll: () => void;
}

function CategoryChip({ chipKey, label, active, onToggle, onShowOnly, onShowAll }: ChipProps) {
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    longPressRef.current = setTimeout(() => { onShowOnly(chipKey); }, LONG_PRESS_MS);
  }, [chipKey, onShowOnly]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (active) { onShowOnly(chipKey); } else { onShowAll(); }
  }, [active, chipKey, onShowOnly, onShowAll]);

  return (
    <button
      type="button"
      className={`vgv-chip${active ? ' vgv-chip--active' : ' vgv-chip--inactive'}`}
      data-category={chipKey}
      onClick={() => onToggle(chipKey)}
      onPointerDown={handlePointerDown}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onContextMenu={handleContextMenu}
      aria-pressed={active}
      aria-label={`${label} filter`}
    >
      <span className="vgv-chip-label">{label}</span>
      {active && (
        <span
          className="vgv-chip-dismiss"
          aria-hidden="true"
          onClick={(e) => { e.stopPropagation(); onToggle(chipKey); }}
        >
          ×
        </span>
      )}
    </button>
  );
}

function isNodeInViewport(
  node: PositionedNode,
  pan: { x: number; y: number },
  zoom: number,
  viewW: number,
  viewH: number,
): boolean {
  const buffer = VIEWPORT_BUFFER;
  const minX = -pan.x - viewW * buffer;
  const maxX = -pan.x + viewW * (1 + buffer);
  const minY = -pan.y - viewH * buffer;
  const maxY = -pan.y + viewH * (1 + buffer);
  const nx = node.x * zoom;
  const ny = node.y * zoom;
  return nx >= minX && nx <= maxX && ny >= minY && ny <= maxY;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VaultGraphView({ onOpenNote, mostRecentNotePath }: Props) {
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSpinner, setShowSpinner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [keyboardFocusedNodeId, setKeyboardFocusedNodeId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<GraphCategory>>(new Set(ALL_CHIP_KEYS));
  const [depthLimit, setDepthLimit] = useState(DEPTH_UNLIMITED);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;

    spinnerTimerRef.current = setTimeout(() => {
      if (!cancelled) setShowSpinner(true);
    }, LOADING_SPINNER_DELAY_MS);

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
        if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();
    return () => {
      cancelled = true;
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    };
  }, []);

  // Truncation (top-500 by degree when vault is large, unless "show all" is active)
  const truncatedData = useMemo(() => {
    if (!graphData) return null;
    if (graphData.nodes.length < TRUNCATION_THRESHOLD || showAll) return graphData;
    const nb = buildNeighbourMap(graphData.edges);
    const nodes = [...graphData.nodes]
      .sort((a, b) => nodeDegree(b, nb) - nodeDegree(a, nb))
      .slice(0, TRUNCATION_THRESHOLD);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [graphData, showAll]);

  // Category-filtered data (chips)
  const categoryFilteredData = useMemo(() => {
    if (!truncatedData) return null;
    // 'default' nodes pass through unless all chip keys are filtered — they aren't in CHIP_DEFS
    const nodes = truncatedData.nodes.filter((n) => {
      const cat = nodeCategory(n);
      // 'default' is not in CHIP_DEFS, so always show unless ALL categories are off
      if (cat === 'default') return activeCategories.size > 0;
      return activeCategories.has(cat);
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = truncatedData.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [truncatedData, activeCategories]);

  // Neighbour map (computed from category-filtered edges)
  const neighbours = useMemo(
    () => buildNeighbourMap(categoryFilteredData?.edges ?? []),
    [categoryFilteredData],
  );

  // Depth-filtered data (applied after category filter)
  const filteredData = useMemo(() => {
    if (!categoryFilteredData) return null;
    const depthVisible = computeDepthVisible(
      selectedNodeId,
      categoryFilteredData.nodes.map((n) => n.id),
      neighbours,
      depthLimit,
    );
    if (depthVisible === null) return categoryFilteredData;
    const nodes = categoryFilteredData.nodes.filter((n) => depthVisible.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = categoryFilteredData.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [categoryFilteredData, neighbours, selectedNodeId, depthLimit]);

  const positionedNodes = useMemo(
    () => applyForceLayout(filteredData?.nodes ?? [], filteredData?.edges ?? []),
    [filteredData],
  );

  const nodeById = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes],
  );

  const culledNodes = useMemo(() => {
    // When "Show all" is active, skip viewport culling entirely — the user
    // explicitly asked to see every node and E2E tests assert count > 500.
    // Viewport culling is only applied for normal (truncated) mode to keep
    // the DOM lean during panning/zooming large graphs.
    if (showAll) return positionedNodes;
    return positionedNodes.filter((node) =>
      isNodeInViewport(node, pan, zoom, GRAPH_WIDTH, GRAPH_HEIGHT),
    );
  }, [positionedNodes, showAll, pan, zoom]);

  // Hover visibility (existing behaviour)
  const hoverVisibleIds = useMemo(
    () => visibleIdsForHover(hoveredNodeId, neighbours),
    [hoveredNodeId, neighbours],
  );

  const keyboardNodes = useMemo(
    () => sortNodesForKeyboard(positionedNodes, neighbours),
    [positionedNodes, neighbours],
  );

  const visibleCategories = useMemo(
    () => GRAPH_CATEGORIES.filter((category) => positionedNodes.some((node) => node.categoryKey === category)),
    [positionedNodes],
  );

  const shouldShowLegend = visibleCategories.length >= 2;

  useEffect(() => {
    if (!filteredData || prefersReducedMotion()) return;
    setLiveMessage(graphSummary(positionedNodes, filteredData.edges, searchQuery, neighbours));
  }, [filteredData, neighbours, positionedNodes, searchQuery]);

  useEffect(() => {
    if (!keyboardFocusedNodeId || nodeById.has(keyboardFocusedNodeId)) return;
    setKeyboardFocusedNodeId(null);
  }, [keyboardFocusedNodeId, nodeById]);

  useEffect(() => {
    if (!hoveredNodeId || prefersReducedMotion()) return undefined;
    const hoveredNode = nodeById.get(hoveredNodeId);
    if (!hoveredNode) return undefined;
    const timeoutId = window.setTimeout(() => {
      setLiveMessage(nodeAnnouncement(hoveredNode, neighbours, true));
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [hoveredNodeId, neighbours, nodeById]);

  // Search highlight set
  const searchMatchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    const ids = new Set<string>();
    for (const node of positionedNodes) {
      if (
        node.label.toLowerCase().includes(query)
        || node.path.toLowerCase().includes(query)
      ) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [searchQuery, positionedNodes]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNodeId(null);
    setKeyboardFocusedNodeId(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === '0') resetView();
      if (event.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
          searchRef.current?.blur();
        } else {
          resetView();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetView, searchQuery]);

  const handleWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((value) => Math.max(0.1, Math.min(4, Number((value + direction).toFixed(2)))));
  }, []);

  const focusNode = useCallback((node: PositionedNode | null) => {
    if (!node) return;
    setKeyboardFocusedNodeId(node.id);
    setLiveMessage(nodeAnnouncement(node, neighbours));
  }, [neighbours]);

  function handleCanvasKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (keyboardNodes.length === 0) return;
    const currentIndex = keyboardFocusedNodeId
      ? keyboardNodes.findIndex((node) => node.id === keyboardFocusedNodeId)
      : -1;
    const currentNode = currentIndex >= 0 ? keyboardNodes[currentIndex] : null;

    if (event.key === 'Tab') {
      event.preventDefault();
      const offset = event.shiftKey ? -1 : 1;
      const nextIndex = currentIndex >= 0
        ? (currentIndex + offset + keyboardNodes.length) % keyboardNodes.length
        : (event.shiftKey ? keyboardNodes.length - 1 : 0);
      focusNode(keyboardNodes[nextIndex]);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (!currentNode) return;
      event.preventDefault();
      selectNode(currentNode);
      return;
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom((value) => Math.min(4, Number((value + 0.1).toFixed(2))));
      return;
    }

    if (event.key === '-') {
      event.preventDefault();
      setZoom((value) => Math.max(0.1, Number((value - 0.1).toFixed(2))));
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      resetView();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedNodeId(null);
      setKeyboardFocusedNodeId(null);
      toolbarRef.current?.focus();
      return;
    }

    if (
      event.key === 'ArrowUp'
      || event.key === 'ArrowDown'
      || event.key === 'ArrowLeft'
      || event.key === 'ArrowRight'
    ) {
      event.preventDefault();
      focusNode(currentNode ? nearestDirectionalNode(currentNode, positionedNodes, event.key) : keyboardNodes[0]);
    }
  }

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

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && searchMatchIds && searchMatchIds.size > 0) {
      const first = positionedNodes.find((n) => searchMatchIds.has(n.id));
      if (first) selectNode(first);
    }
  }, [searchMatchIds, positionedNodes, selectNode]);

  const handleToggleCategory = useCallback((key: GraphCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  const handleShowOnly = useCallback((key: GraphCategory) => {
    setActiveCategories(new Set([key]));
  }, []);

  const handleShowAll = useCallback(() => {
    setActiveCategories(new Set(ALL_CHIP_KEYS));
  }, []);

  const depthLabel = depthLimit >= DEPTH_UNLIMITED ? 'All' : String(depthLimit);
  const visibleChips = chipsExpanded ? CHIP_DEFS : CHIP_DEFS.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = CHIP_DEFS.length > MAX_VISIBLE_CHIPS ? CHIP_DEFS.length - MAX_VISIBLE_CHIPS : 0;

  if (loading) {
    return (
      <div className="vgv-state vgv-state--loading" data-testid="vault-graph-loading" aria-live="polite" aria-label="Loading vault graph">
        {showSpinner ? (
          <div className="vgv-spinner-wrap">
            <span className="vgv-spinner" role="status" />
            <span className="vgv-loading-text">Calculating layout…</span>
          </div>
        ) : (
          <svg
            className="vgv-skeleton"
            viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            aria-hidden="true"
            data-testid="vault-graph-skeleton"
          >
            {SKELETON_EDGES.map(([src, tgt]) => (
              <line
                key={`sk-e-${src}-${tgt}`}
                className="vgv-skeleton-edge"
                x1={SKELETON_NODES[src].x}
                y1={SKELETON_NODES[src].y}
                x2={SKELETON_NODES[tgt].x}
                y2={SKELETON_NODES[tgt].y}
              />
            ))}
            {SKELETON_NODES.map((pos, i) => (
              <circle
                key={`sk-n-${i}`}
                className="vgv-skeleton-node"
                cx={pos.x}
                cy={pos.y}
                r={pos.r}
              />
            ))}
          </svg>
        )}
      </div>
    );
  }

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
      <div className="vgv-state vgv-state--empty" data-testid="vault-graph-empty">
        <div className="vgv-empty-dots" aria-hidden="true">
          <span className="vgv-empty-dot vgv-empty-dot--a" />
          <span className="vgv-empty-dot vgv-empty-dot--b" />
          <span className="vgv-empty-dot vgv-empty-dot--c" />
        </div>
        <p className="vgv-empty-copy">
          Your notes haven&apos;t linked up yet. Add <span className="vgv-empty-wikilink">[[wiki-links]]</span> in your notes to see connections appear here.
        </p>
        <button
          type="button"
          className="vgv-empty-cta"
          data-testid="vault-graph-open-note-cta"
          onClick={() => {
            if (mostRecentNotePath) {
              onOpenNote?.(mostRecentNotePath);
            } else {
              onOpenNote?.('');
            }
          }}
        >
          Open a note →
        </button>
      </div>
    );
  }

  const totalNodeCount = graphData.nodes.length;
  const isTruncated = totalNodeCount >= TRUNCATION_THRESHOLD && !showAll;
  const renderedNodeCount = positionedNodes.length;
  const showTruncationBanner = totalNodeCount >= TRUNCATION_THRESHOLD && !bannerDismissed;

  return (
    <section className="vgv-root" data-testid="vault-graph-view" aria-label="Vault Graph panel">
      <header className="vgv-toolbar" ref={toolbarRef} tabIndex={-1}>
        <div className="vgv-title-group">
          <span className="vgv-title">Vault Graph</span>
          <span className="vgv-count">{graphData.nodes.length} notes · {graphData.edges.length} links</span>
        </div>
        <input
          ref={searchRef}
          type="search"
          className="vgv-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search nodes…"
          aria-label="Search nodes"
        />
      </header>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="vault-graph-live-region"
      >
        {liveMessage}
      </div>

      {showTruncationBanner && (
        <div className="vgv-truncation-banner" role="status" data-testid="vault-graph-truncation-banner">
          <span>⚠ Large vault: {totalNodeCount} notes. Showing top 500 by links.</span>
          {isTruncated && (
            <button
              type="button"
              className="vgv-truncation-showall"
              onClick={() => setShowAll(true)}
            >
              Show all — may be slow
            </button>
          )}
          <button
            type="button"
            className="vgv-truncation-dismiss"
            aria-label="Dismiss large vault notice"
            onClick={() => setBannerDismissed(true)}
          >
            ×
          </button>
        </div>
      )}

      <div
        className="vgv-canvas"
        data-testid="vault-graph-canvas"
        onClick={() => setSelectedNodeId(null)}
      >
        <svg
          ref={svgRef}
          className="vgv-svg"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="application"
          aria-label="Notes Vault graph"
          tabIndex={0}
          onKeyDown={handleCanvasKeyDown}
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
              const dimmed = hoverVisibleIds ? (!hoverVisibleIds.has(edge.source) || !hoverVisibleIds.has(edge.target)) : false;
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

            {culledNodes.map((node) => {
              const hoverDimmed = hoverVisibleIds ? !hoverVisibleIds.has(node.id) : false;
              const searchHighlighted = searchMatchIds ? searchMatchIds.has(node.id) : false;
              const searchDimmed = searchMatchIds ? !searchMatchIds.has(node.id) : false;
              const selected = selectedNodeId === node.id;
              const keyboardFocused = keyboardFocusedNodeId === node.id;
              const label = displayLabel(node.label);

              let nodeClass = 'vgv-graph-node';
              if (hoverDimmed) nodeClass += ' vgv-graph-node--dimmed';
              if (selected) nodeClass += ' vgv-graph-node--selected';
              if (keyboardFocused) nodeClass += ' vgv-graph-node--keyboard-focused';
              if (searchHighlighted) nodeClass += ' vgv-graph-node--search-match';
              else if (searchDimmed) nodeClass += ' vgv-graph-node--search-dimmed';

              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={-1}
                  aria-label={`Open note ${label}`}
                  data-testid={`vault-node-${node.id}`}
                  className={nodeClass}
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

        <div className="vgv-graph-controls" aria-label="Graph controls">
          {shouldShowLegend && (
            <div className="vgv-legend-wrap">
              <button
                type="button"
                aria-label="Legend"
                aria-expanded={legendOpen}
                aria-controls="vault-graph-legend"
                onClick={() => setLegendOpen((open) => !open)}
              >
                Legend
              </button>
              {legendOpen && (
                <div
                  id="vault-graph-legend"
                  className="vgv-legend-popover"
                  role="dialog"
                  aria-label="Graph category legend"
                >
                  {visibleCategories.map((category) => (
                    <div key={category} className="vgv-legend-row">
                      <span className={`vgv-legend-swatch vgv-legend-swatch--${category}`} aria-hidden="true" />
                      <span>{GRAPH_CATEGORY_LABELS[category]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="vgv-zoom-controls" aria-label="Graph zoom controls">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))}>−</button>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + 0.1))}>+</button>
            <button type="button" aria-label="Reset graph view" onClick={resetView}>↺</button>
          </div>
        </div>
      </div>

      {/* Bottom toolbar — category chips + depth slider (spec: 40px) */}
      <footer className="vgv-bottom-toolbar" role="toolbar" aria-label="Graph filters">
        <div className="vgv-chips" role="group" aria-label="Category filters">
          {visibleChips.map((chip) => (
            <CategoryChip
              key={chip.key}
              chipKey={chip.key}
              label={chip.label}
              active={activeCategories.has(chip.key)}
              onToggle={handleToggleCategory}
              onShowOnly={handleShowOnly}
              onShowAll={handleShowAll}
            />
          ))}
          {hiddenCount > 0 && !chipsExpanded && (
            <button
              type="button"
              className="vgv-chip vgv-chip--overflow"
              onClick={() => setChipsExpanded(true)}
              aria-label={`Show ${hiddenCount} more category filters`}
            >
              +{hiddenCount} more
            </button>
          )}
          {chipsExpanded && CHIP_DEFS.length > MAX_VISIBLE_CHIPS && (
            <button
              type="button"
              className="vgv-chip vgv-chip--overflow"
              onClick={() => setChipsExpanded(false)}
              aria-label="Collapse category filters"
            >
              Less
            </button>
          )}
        </div>

        <div className="vgv-depth-wrap">
          <label htmlFor="vgv-depth-slider" className="vgv-depth-label">
            Depth: {depthLabel}
          </label>
          <input
            id="vgv-depth-slider"
            type="range"
            className="vgv-depth-slider"
            min={1}
            max={DEPTH_UNLIMITED}
            step={1}
            value={depthLimit}
            onChange={(e) => setDepthLimit(Number(e.target.value))}
            aria-label={`Depth limit: ${depthLabel}`}
            aria-valuetext={depthLimit >= DEPTH_UNLIMITED ? 'All' : String(depthLimit)}
          />
        </div>
      </footer>
    </section>
  );
}
