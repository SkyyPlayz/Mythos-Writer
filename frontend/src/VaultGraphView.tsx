import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import './VaultGraphView.css';

// M21: canvas matches the prototype sim space (Liquid Neon prototype 1615, 3835).
const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 640;
const MAX_INTERACTIVE_NODES = 500;
const DEPTH_UNLIMITED = 7;
const LONG_PRESS_MS = 500;
const MAX_VISIBLE_CHIPS = 8;

// ─── M21 force sim (exact port of prototype `stepSim`, lines 3805–3840) ──────
const SIM_CENTER_X = 500;
const SIM_CENTER_Y = 325;
const SIM_DAMPING = 0.85;
const SIM_MAX_VELOCITY = 4.5;
const SIM_MIN_X = 36;
const SIM_MAX_X = 964;
const SIM_MIN_Y = 42;
const SIM_MAX_Y = 602;
/** Below this total energy the rAF loop stops repainting (prototype 3844). */
export const SIM_ENERGY_CUTOFF = 0.06;
/** Synchronous settle budgets for the initial (non-animated) layout. */
const SETTLE_STEPS = 300;
const SETTLE_STEPS_LARGE = 120;
const SETTLE_LARGE_THRESHOLD = 200;
const DRAG_THRESHOLD_PX = 3;

// M21 zoom — prototype gWheel 3749, gZoomIn/Out/Reset 4873–4876.
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.6;
const ZOOM_WHEEL_IN = 1.12;
const ZOOM_WHEEL_OUT = 0.9;
const ZOOM_BTN_IN = 1.18;
const ZOOM_BTN_OUT = 0.85;

// Star discs: prototype node circle is drawn at n.r * 1.5 px wide; our discs
// extend to 2× the token-circle radius so the gradient fade stays visible.
const STAR_DISC_SCALE = 2;
const STAR_GLOW_MAX_NODES = 200;

const GRAPH_CATEGORIES = [
  'characters',
  'locations',
  'factions',
  'history',
  'systems',
  'items',
  'scenes',
  'misc',
  'default',
] as const;

type GraphCategory = (typeof GRAPH_CATEGORIES)[number];
type VaultGraphScope = 'notes' | 'story' | 'both';

// GH #650: the Notes/Story/Both scope survives remounts via localStorage.
const VAULT_SCOPE_STORAGE_KEY = 'mythos:vaultGraph:scope';

function isVaultGraphScope(value: unknown): value is VaultGraphScope {
  return value === 'notes' || value === 'story' || value === 'both';
}

function readStoredVaultScope(): VaultGraphScope | null {
  try {
    const stored = window.localStorage.getItem(VAULT_SCOPE_STORAGE_KEY);
    return isVaultGraphScope(stored) ? stored : null;
  } catch {
    return null; // storage unavailable (private mode / disabled)
  }
}

function persistVaultScope(scope: VaultGraphScope): void {
  try {
    window.localStorage.setItem(VAULT_SCOPE_STORAGE_KEY, scope);
  } catch { /* storage unavailable — scope stays session-only */ }
}

const GRAPH_CATEGORY_LABELS: Record<GraphCategory, string> = {
  characters: 'Characters',
  locations: 'Locations',
  factions: 'Factions',
  history: 'History',
  systems: 'Systems',
  items: 'Items',
  scenes: 'Scenes',
  misc: 'Misc',
  default: 'Default',
};
// M21: category colors ported from the prototype `gCats` (3044–3052) with the
// Neon Classic slot defaults (`catCol`, 4156). `scenes` is the prototype's gold
// "Story" cluster; `history` is "History / Lore". `misc` (no prototype
// counterpart) uses classic slot c6; `default` uses the note-edge blue.
export const GRAPH_CATEGORY_COLORS: Record<GraphCategory, string> = {
  characters: '#00f0ff',
  locations: '#9b5fff',
  factions: '#ff4dff',
  history: '#e0b3ff',
  systems: '#2fe6c8',
  items: '#ff9a3d',
  scenes: '#ffd319',
  misc: '#3d9bff',
  default: '#9fc0e8',
};

/** Resolve a category's display color, honoring per-category recolors. */
export function categoryColor(
  category: GraphCategory,
  overrides?: Partial<Record<GraphCategory, string>>,
): string {
  return overrides?.[category] ?? GRAPH_CATEGORY_COLORS[category];
}

// M21: per-edge-type colors — prototype `gLines` defaults (4872).
export const EDGE_COLOR_DEFAULTS = {
  note: '#9fc0e8',
  story: '#ffd319',
} as const;

/** Port of the prototype `hexA` helper (3305–3309): #rrggbb → rgba(). */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

// Ordered chip list per spec (bottom toolbar)
const CHIP_DEFS: { key: GraphCategory; label: string }[] = [
  { key: 'characters', label: 'Characters' },
  { key: 'locations', label: 'Locations' },
  { key: 'factions', label: 'Factions' },
  { key: 'history', label: 'History' },
  { key: 'systems', label: 'Systems' },
  { key: 'items', label: 'Items' },
  { key: 'scenes', label: 'Scenes' },
  { key: 'misc', label: 'Misc' },
];
const ALL_CHIP_KEYS = new Set<GraphCategory>(CHIP_DEFS.map((c) => c.key));

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  category?: string;
  vault?: 'notes' | 'story';
  storyId?: string;
  chapterId?: string;
  sceneId?: string;
  degree?: number;
  folder?: string;
  tags?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  crossVault?: boolean;
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
  { x: 500, y: 160, r: 14 }, { x: 333, y: 280, r: 10 }, { x: 650, y: 256, r: 8 },
  { x: 250, y: 400, r: 9 }, { x: 417, y: 440, r: 7 }, { x: 583, y: 384, r: 11 },
  { x: 708, y: 440, r: 7 }, { x: 167, y: 240, r: 6 }, { x: 750, y: 160, r: 8 },
  { x: 542, y: 520, r: 6 },
];

const SKELETON_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 7], [4, 5], [5, 9], [2, 8],
];

interface Props {
  onOpenNote?: (path: string) => void;
  onOpenScene?: (storyId: string, chapterId: string, sceneId: string) => void;
  mostRecentNotePath?: string;
  initialVaultScope?: VaultGraphScope;
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
  if (node.vault === 'story') return 'scenes';
  const normalized = (node.category ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (isGraphCategory(normalized)) return normalized;
  return categoryFromFolder(node.folder);
}

function nodeDegree(node: GraphNode, neighbours: Map<string, Set<string>>): number {
  return node.degree ?? neighbours.get(node.id)?.size ?? 0;
}

function graphNodeFillToken(category: GraphCategory): string {
  if (category === 'scenes') return 'var(--ln-graph-node-scenes, var(--ln-graph-node-highlight))';
  return `var(--ln-graph-node-${category})`;
}

function graphNodeStrokeToken(category: GraphCategory): string {
  if (category === 'scenes') return 'var(--ln-graph-border-scenes, var(--ln-graph-border-highlight))';
  return `var(--ln-graph-border-${category})`;
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

// ─── M21 force sim ────────────────────────────────────────────────────────────
// Exact port of the prototype physics (`stepSim`, 3805–3840): center pull +
// pairwise repulsion + spring links, damping ×0.85, velocity clamp ±4.5,
// bounds 1000×640, pinned nodes held at fx/fy.

export interface SimNodeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pin coordinates — non-null while a node is pinned (drag-to-pin). */
  fx: number | null;
  fy: number | null;
}

export interface SimParams {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
}

// Prototype defaults: fCenter 6, fRepel 14, fLink 8, linkDist 120 (3260).
export const SIM_DEFAULTS: SimParams = {
  centerForce: 6,
  repelForce: 14,
  linkForce: 8,
  linkDistance: 120,
};

function clampValue(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Advance the simulation one tick, mutating `sim` in place. Returns the total
 * energy (Σ|vx|+|vy|; pinned nodes contribute 1 each, per the prototype).
 * `rand` is injectable so tests can run the step deterministically.
 */
export function stepSim(
  sim: Map<string, SimNodeState>,
  visibleIds: readonly string[],
  links: ReadonlyArray<readonly [string, string]>,
  params: SimParams = SIM_DEFAULTS,
  rand: () => number = Math.random,
): number {
  // Prototype 3809: kC = fCenter*0.00042, kR = fRepel*430, kL = fLink*0.0011.
  const kC = params.centerForce * 0.00042;
  const kR = params.repelForce * 430;
  const kL = params.linkForce * 0.0011;
  const linkDistance = params.linkDistance;

  const bodies: SimNodeState[] = [];
  for (const id of visibleIds) {
    const p = sim.get(id);
    if (p) bodies.push(p);
  }

  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    a.vx += (SIM_CENTER_X - a.x) * kC;
    a.vy += (SIM_CENTER_Y - a.y) * kC;
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 64) {
        dx = rand() - 0.5;
        dy = rand() - 0.5;
        d2 = 64;
      }
      const d = Math.sqrt(d2);
      const f = Math.min(kR / d2, 3.4);
      const ux = dx / d;
      const uy = dy / d;
      a.vx += ux * f;
      a.vy += uy * f;
      b.vx -= ux * f;
      b.vy -= uy * f;
    }
  }

  const visible = new Set(visibleIds);
  for (const [sourceId, targetId] of links) {
    if (!visible.has(sourceId) || !visible.has(targetId)) continue;
    const a = sim.get(sourceId);
    const b = sim.get(targetId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - linkDistance) * kL;
    const ux = dx / d;
    const uy = dy / d;
    a.vx += ux * f;
    a.vy += uy * f;
    b.vx -= ux * f;
    b.vy -= uy * f;
  }

  let energy = 0;
  for (const p of bodies) {
    if (p.fx != null && p.fy != null) {
      p.x = p.fx;
      p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
      energy += 1;
      continue;
    }
    p.vx *= SIM_DAMPING;
    p.vy *= SIM_DAMPING;
    p.vx = clampValue(-SIM_MAX_VELOCITY, SIM_MAX_VELOCITY, p.vx);
    p.vy = clampValue(-SIM_MAX_VELOCITY, SIM_MAX_VELOCITY, p.vy);
    p.x += p.vx;
    p.y += p.vy;
    p.x = clampValue(SIM_MIN_X, SIM_MAX_X, p.x);
    p.y = clampValue(SIM_MIN_Y, SIM_MAX_Y, p.y);
    energy += Math.abs(p.vx) + Math.abs(p.vy);
  }
  return energy;
}

/**
 * Port of the prototype `relayoutReal` (4698): clear every pin and give each
 * node a random velocity kick so the layout re-settles.
 */
export function relayoutSim(sim: Map<string, SimNodeState>, rand: () => number = Math.random): void {
  for (const p of sim.values()) {
    p.fx = null;
    p.fy = null;
    p.vx = (rand() - 0.5) * 60;
    p.vy = (rand() - 0.5) * 60;
  }
}

function countPinned(sim: Map<string, SimNodeState>, visibleIds: readonly string[]): number {
  let pinned = 0;
  for (const id of visibleIds) {
    if (sim.get(id)?.fx != null) pinned += 1;
  }
  return pinned;
}

/** Run the sim synchronously until it settles (or the step budget runs out). */
function settleSim(
  sim: Map<string, SimNodeState>,
  visibleIds: readonly string[],
  links: ReadonlyArray<readonly [string, string]>,
  params: SimParams = SIM_DEFAULTS,
  maxSteps = SETTLE_STEPS,
): void {
  for (let step = 0; step < maxSteps; step += 1) {
    const energy = stepSim(sim, visibleIds, links, params);
    if (energy - countPinned(sim, visibleIds) <= SIM_ENERGY_CUTOFF) return;
  }
}

function settleBudget(nodeCount: number): number {
  return nodeCount > SETTLE_LARGE_THRESHOLD ? SETTLE_STEPS_LARGE : SETTLE_STEPS;
}

/** Seed sim entries for new nodes on a circle around the sim center. */
function seedSim(sim: Map<string, SimNodeState>, nodes: GraphNode[]): void {
  const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * 0.32;
  nodes.forEach((node, index) => {
    if (sim.has(node.id)) return;
    const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1);
    sim.set(node.id, {
      x: SIM_CENTER_X + radius * Math.cos(angle),
      y: SIM_CENTER_Y + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    });
  });
}

/** rAF animation is skipped for reduced motion and non-browser (test) envs. */
function canAnimateSim(): boolean {
  return typeof window !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

export default function VaultGraphView({ onOpenNote, onOpenScene, initialVaultScope, mostRecentNotePath }: Props) {
  // GH #650: an explicit initialVaultScope prop wins; otherwise restore the
  // last-used scope from localStorage, falling back to notes.
  const [vaultScope, setVaultScope] = useState<VaultGraphScope>(
    () => initialVaultScope ?? readStoredVaultScope() ?? 'notes',
  );
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
  const hasLoadedGraphRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // ─── M21: live force sim, per-category colors, filters + inspector ─────────
  // Bumped after every sim tick so render snapshots the latest positions.
  const [, setSimVersion] = useState(0);
  const [catColors, setCatColors] = useState<Record<GraphCategory, string>>(
    () => ({ ...GRAPH_CATEGORY_COLORS }),
  );
  const [lineColors, setLineColors] = useState<{ note: string; story: string }>(
    () => ({ ...EDGE_COLOR_DEFAULTS }),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const simRef = useRef<Map<string, SimNodeState>>(new Map());
  const simInputsRef = useRef<{ ids: string[]; links: Array<[string, string]> }>({ ids: [], links: [] });
  const seededDataRef = useRef<VaultGraphData | null>(null);
  const firstLayoutRef = useRef(true);
  const pendingWakeRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  // Set while the click that trails a drag should be swallowed (drag ≠ open).
  const dragMovedRef = useRef(false);
  const reactId = useId();
  const starPrefix = useMemo(() => `vgv-star-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);

  /** Restart the sim: animate on rAF, or settle synchronously (reduced motion / tests). */
  const wakeSim = useCallback(() => {
    if (!canAnimateSim()) {
      const { ids, links } = simInputsRef.current;
      settleSim(simRef.current, ids, links, SIM_DEFAULTS, settleBudget(ids.length));
      setSimVersion((v) => v + 1);
      return;
    }
    if (rafRef.current != null) return;
    frameRef.current = 0;
    const tick = () => {
      const { ids, links } = simInputsRef.current;
      const energy = stepSim(simRef.current, ids, links);
      frameRef.current += 1;
      // Prototype 3841–3848: keep stepping while hot, repaint every 2nd frame.
      // Persistent pins each contribute 1 energy, so subtract them from the
      // stop condition or a pinned graph would animate forever.
      if (energy - countPinned(simRef.current, ids) <= SIM_ENERGY_CUTOFF) {
        rafRef.current = null;
        setSimVersion((v) => v + 1);
        return;
      }
      if (frameRef.current % 2 === 0) setSimVersion((v) => v + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isInitialLoad = !hasLoadedGraphRef.current;

    setLoading(isInitialLoad);
    setShowSpinner(false);
    setError(null);
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

        const [nodeResponse, edgeResponse] = await Promise.all([nodesHandler(vaultScope), edgesHandler(vaultScope)]);
        const nodes = normalizeNodeResponse(nodeResponse);
        const edges = normalizeEdgeResponse(edgeResponse);
        if (!nodes || !edges) throw new Error('Vault graph IPC handlers returned an invalid payload.');
        if (!cancelled) {
          hasLoadedGraphRef.current = true;
          setGraphData({ nodes, edges });
          setSelectedNodeId(null);
          setKeyboardFocusedNodeId(null);
          setHoveredNodeId(null);
          setShowAll(false);
          setBannerDismissed(false);
        }
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
  }, [vaultScope]);

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

  // M21: reconcile the live sim with the visible data. New nodes are seeded on
  // a circle; the first layout settles synchronously so the initial paint is
  // already arranged, later data changes animate on rAF (via pendingWakeRef).
  if (filteredData && seededDataRef.current !== filteredData) {
    seededDataRef.current = filteredData;
    seedSim(simRef.current, filteredData.nodes);
    simInputsRef.current = {
      ids: filteredData.nodes.map((node) => node.id),
      links: filteredData.edges.map((edge) => [edge.source, edge.target]),
    };
    if (firstLayoutRef.current || !canAnimateSim()) {
      firstLayoutRef.current = false;
      const { ids, links } = simInputsRef.current;
      settleSim(simRef.current, ids, links, SIM_DEFAULTS, settleBudget(ids.length));
    } else {
      pendingWakeRef.current = true;
    }
  }

  useEffect(() => {
    if (!pendingWakeRef.current) return;
    pendingWakeRef.current = false;
    wakeSim();
  });

  // Snapshot of the live sim positions; recomputed on every render (each sim
  // tick bumps simVersion, so animation frames flow through here).
  const positionedNodes: PositionedNode[] = (filteredData?.nodes ?? []).map((node) => {
    const p = simRef.current.get(node.id);
    return {
      ...node,
      categoryKey: nodeCategory(node),
      radius: computeNodeRadius(nodeDegree(node, neighbours)),
      x: p?.x ?? SIM_CENTER_X,
      y: p?.y ?? SIM_CENTER_Y,
    };
  });

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

  // Keyed on the summary text (positions re-snapshot every render, so object
  // identity would re-fire this and clobber focus/hover announcements).
  const summaryMessage = filteredData
    ? graphSummary(positionedNodes, filteredData.edges, searchQuery, neighbours)
    : '';
  useEffect(() => {
    if (!summaryMessage || prefersReducedMotion()) return;
    setLiveMessage(summaryMessage);
  }, [summaryMessage]);

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

  // M21: multiplicative zoom, prototype gWheel (3749).
  const handleWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_WHEEL_IN : ZOOM_WHEEL_OUT;
    setZoom((value) => clampValue(ZOOM_MIN, ZOOM_MAX, value * factor));
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((value) => clampValue(ZOOM_MIN, ZOOM_MAX, value * ZOOM_BTN_IN));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((value) => clampValue(ZOOM_MIN, ZOOM_MAX, value * ZOOM_BTN_OUT));
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
      zoomIn();
      return;
    }

    if (event.key === '-') {
      event.preventDefault();
      zoomOut();
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
    // Prototype gPanDown (3750–3755): pan follows the pointer 1:1.
    setPan({
      x: panStart.x + (event.clientX - panStart.clientX),
      y: panStart.y + (event.clientY - panStart.clientY),
    });
  }

  function handlePointerUp() {
    setPanStart(null);
  }

  const openNode = useCallback((node: PositionedNode) => {
    if (node.vault === 'story' && node.storyId && node.chapterId && node.sceneId) {
      onOpenScene?.(node.storyId, node.chapterId, node.sceneId);
      return;
    }
    onOpenNote?.(node.path);
  }, [onOpenNote, onOpenScene]);

  const selectNode = useCallback((node: PositionedNode) => {
    setSelectedNodeId(node.id);
    openNode(node);
  }, [openNode]);

  // M21 drag-to-pin (prototype nodeDown, 3849–3866). Dragging pins the node at
  // fx/fy; unlike the prototype the pin survives mouse-up — Re-layout clears it.
  function beginNodeDrag(nodeId: string, event: ReactMouseEvent<SVGGElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(nodeId);
    const startX = event.clientX;
    const startY = event.clientY;
    const svg = svgRef.current;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const p = simRef.current.get(nodeId);
      if (!p) return;
      const rect = svg?.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : GRAPH_WIDTH;
      const height = rect && rect.height > 0 ? rect.height : GRAPH_HEIGHT;
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      // Prototype 3856–3859: client coords → sim coords, clamped to sim bounds.
      p.fx = clampValue(SIM_MIN_X, SIM_MAX_X, ((ev.clientX - left - width / 2 - pan.x) / (width * zoom) + 0.5) * GRAPH_WIDTH);
      p.fy = clampValue(SIM_MIN_Y, SIM_MAX_Y, ((ev.clientY - top - height / 2 - pan.y) / (height * zoom) + 0.5) * GRAPH_HEIGHT);
      p.x = p.fx;
      p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
      setSimVersion((v) => v + 1);
      wakeSim();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (moved) {
        // Swallow the click that follows a drag so it doesn't open the note.
        dragMovedRef.current = true;
        window.setTimeout(() => { dragMovedRef.current = false; }, 0);
        wakeSim();
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const handleRelayout = useCallback(() => {
    relayoutSim(simRef.current);
    setSimVersion((v) => v + 1);
    wakeSim();
  }, [wakeSim]);

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

  // GH #650: persist only user-driven scope changes so an explicit
  // initialVaultScope override never clobbers the stored preference.
  const handleScopeSelect = useCallback((scope: VaultGraphScope) => {
    setVaultScope(scope);
    persistVaultScope(scope);
  }, []);

  // M21: the Story-cluster switch drives the same visibility set as the Scenes
  // chip (prototype offCats[5] / storyToggle, 4388–4389). Unlike the prototype
  // (hidden by default, 3259) the app keeps story nodes visible by default —
  // existing scope behavior and tests depend on it.
  const storyClusterOn = activeCategories.has('scenes');
  const handleStoryClusterToggle = useCallback(() => {
    handleToggleCategory('scenes');
  }, [handleToggleCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<GraphCategory, number>();
    for (const node of truncatedData?.nodes ?? []) {
      const cat = nodeCategory(node);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return counts;
  }, [truncatedData]);

  // M21 inspector: selected node + its visible connections (prototype gSel, 4307–4313).
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const inspectorConnections: PositionedNode[] = selectedNode && filteredData
    ? filteredData.edges
      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map((edge) => nodeById.get(edge.source === selectedNode.id ? edge.target : edge.source))
      .filter((node): node is PositionedNode => Boolean(node))
    : [];

  const depthLabel = depthLimit >= DEPTH_UNLIMITED ? 'All' : String(depthLimit);
  const visibleChips = chipsExpanded ? CHIP_DEFS : CHIP_DEFS.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = CHIP_DEFS.length > MAX_VISIBLE_CHIPS ? CHIP_DEFS.length - MAX_VISIBLE_CHIPS : 0;
  const vaultScopeSelector = (
    <div className="vgv-scope-selector" role="group" aria-label="Vault scope">
      {(['notes', 'story', 'both'] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          className={`vgv-scope-btn${vaultScope === scope ? ' vgv-scope-btn--active' : ''}`}
          aria-pressed={vaultScope === scope}
          data-testid={`vault-graph-scope-${scope}`}
          onClick={() => handleScopeSelect(scope)}
        >
          {scope === 'notes' ? 'Notes' : scope === 'story' ? 'Story' : 'Both'}
        </button>
      ))}
    </div>
  );

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
      <section className="vgv-root" data-testid="vault-graph-view" aria-label="Vault Graph panel">
        <header className="vgv-toolbar" ref={toolbarRef} tabIndex={-1}>
          <div className="vgv-title-group">
            <span className="vgv-title">Vault Graph</span>
            <span className="vgv-count">0 notes · 0 links</span>
          </div>
          {vaultScopeSelector}
        </header>
        <div className="vgv-state vgv-state--empty" data-testid="vault-graph-empty">
          <div className="vgv-empty-dots" aria-hidden="true">
            <span className="vgv-empty-dot vgv-empty-dot--a" />
            <span className="vgv-empty-dot vgv-empty-dot--b" />
            <span className="vgv-empty-dot vgv-empty-dot--c" />
          </div>
          <p className="vgv-empty-copy">
            Your notes haven&apos;t linked up yet. Add <span className="vgv-empty-wikilink">[[wiki-links]]</span> in your notes to see connections appear here.
          </p>
          {/* GH #650: hide the CTA when no open handler exists (floating pop-out). */}
          {onOpenNote && (
            <button
              type="button"
              className="vgv-empty-cta"
              data-testid="vault-graph-open-note-cta"
              onClick={() => {
                if (mostRecentNotePath) {
                  onOpenNote(mostRecentNotePath);
                } else {
                  onOpenNote('');
                }
              }}
            >
              Open a note →
            </button>
          )}
        </div>
      </section>
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
          {vaultScopeSelector}
        {/* M21: Story-cluster toggle + Re-layout, prototype header 1600–1611.
            The prototype's left-panel filter strip (413–443) lives in
            DesktopShell's left panel, which this module doesn't own — those
            controls sit in the Colors popover on the canvas instead. */}
        <div className="vgv-story-cluster" data-testid="vault-graph-story-cluster">
          <span className="vgv-story-cluster-label">Story cluster</span>
          <button
            type="button"
            role="switch"
            aria-checked={storyClusterOn}
            aria-label="Show story cluster"
            data-testid="vault-graph-story-toggle"
            className={`vgv-toggle${storyClusterOn ? ' vgv-toggle--on' : ''}`}
            onClick={handleStoryClusterToggle}
          >
            <span className="vgv-toggle-knob" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="vgv-relayout"
          data-testid="vault-graph-relayout"
          onClick={handleRelayout}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
          </svg>
          Re-layout
        </button>
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
          {/* M21 star gradients: white core → category color → transparent
              (prototype node discs, renderVals ~4300). */}
          <defs>
            {GRAPH_CATEGORIES.map((category) => {
              const color = categoryColor(category, catColors);
              return (
                <radialGradient key={category} id={`${starPrefix}-${category}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="18%" stopColor="#ffffff" />
                  <stop offset="42%" stopColor={color} />
                  <stop offset="68%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="78%" stopColor={color} stopOpacity={0} />
                </radialGradient>
              );
            })}
          </defs>
          <g transform={`translate(${GRAPH_WIDTH * (1 - zoom) / 2 + pan.x} ${GRAPH_HEIGHT * (1 - zoom) / 2 + pan.y}) scale(${zoom})`}>
            {filteredData?.edges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              // Prototype gEdgesR (4287–4293): edges touching the hovered node
              // (or the selection, when nothing is hovered) run hot; every
              // other edge dims while a node is hovered.
              const crossVault = edge.crossVault || source.vault !== target.vault;
              const isStoryEdge = crossVault || source.vault === 'story' || target.vault === 'story';
              const hot = hoveredNodeId
                ? (edge.source === hoveredNodeId || edge.target === hoveredNodeId)
                : (selectedNodeId != null && (edge.source === selectedNodeId || edge.target === selectedNodeId));
              const dimmed = Boolean(hoveredNodeId) && !hot;
              const lineColor = isStoryEdge ? lineColors.story : lineColors.note;
              const edgeStyle = {
                '--vgv-edge-stroke': hot ? lineColor : hexToRgba(lineColor, isStoryEdge ? 0.3 : 0.18),
                '--vgv-edge-width': hot ? '2' : '1.2',
                '--vgv-edge-opacity': dimmed ? '0.3' : '1',
                '--vgv-edge-glow': hot ? `drop-shadow(0 0 5px ${hexToRgba(lineColor, 0.8)})` : 'none',
              } as CSSProperties;
              return (
                <line
                  key={`${edge.source}-${edge.target}`}
                  data-testid={edgeTestId(edge)}
                  className={`vgv-graph-edge${crossVault ? ' vgv-graph-edge--cross-vault' : ''}${dimmed ? ' vgv-graph-edge--dimmed' : ''}${hot ? ' vgv-graph-edge--hot' : ''}`}
                  style={edgeStyle}
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
              const hovered = hoveredNodeId === node.id;
              const keyboardFocused = keyboardFocusedNodeId === node.id;
              const pinned = simRef.current.get(node.id)?.fx != null;
              const label = displayLabel(node.label);
              const fillToken = graphNodeFillToken(node.categoryKey);
              const strokeToken = graphNodeStrokeToken(node.categoryKey);
              const color = categoryColor(node.categoryKey, catColors);
              // Prototype star glow (renderVals ~4300): 0 0 16px @.55 + 0 0 34px
              // @.25 box-shadow; selected 0 0 30px @.9 + 0 0 60px @.5. The
              // resting glow is skipped on very large graphs to keep rAF cheap.
              const starGlow = selected || hovered
                ? `drop-shadow(0 0 15px ${hexToRgba(color, 0.9)}) drop-shadow(0 0 30px ${hexToRgba(color, 0.5)})`
                : culledNodes.length <= STAR_GLOW_MAX_NODES
                  ? `drop-shadow(0 0 8px ${hexToRgba(color, 0.55)}) drop-shadow(0 0 17px ${hexToRgba(color, 0.25)})`
                  : 'none';

              let nodeClass = 'vgv-graph-node';
              if (hoverDimmed) nodeClass += ' vgv-graph-node--dimmed';
              if (selected) nodeClass += ' vgv-graph-node--selected';
              if (keyboardFocused) nodeClass += ' vgv-graph-node--keyboard-focused';
              if (pinned) nodeClass += ' vgv-graph-node--pinned';
              if (searchHighlighted) nodeClass += ' vgv-graph-node--search-match';
              else if (searchDimmed) nodeClass += ' vgv-graph-node--search-dimmed';

              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={-1}
                  aria-label={`${node.vault === 'story' ? 'Open scene' : 'Open note'} ${label}`}
                  data-testid={`vault-node-${node.id}`}
                  className={nodeClass}
                  transform={`translate(${node.x} ${node.y})`}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => beginNodeDrag(node.id, event)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (dragMovedRef.current) return;
                    selectNode(node);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectNode(node);
                    }
                  }}
                >
                  {/* lnPulse twinkle timing per node — prototype renderVals ~4300 */}
                  <circle
                    data-testid="vault-graph-star"
                    className="vgv-star-disc"
                    r={node.radius * STAR_DISC_SCALE}
                    fill={`url(#${starPrefix}-${node.categoryKey})`}
                    style={{
                      '--vgv-star-glow': starGlow,
                      animationDuration: `${3 + (node.id.length % 4)}s`,
                      animationDelay: `${node.id.length % 3}s`,
                    } as CSSProperties}
                  />
                  <circle
                    data-testid="vault-graph-node-circle"
                    className={`vgv-node-circle vgv-node-circle--${node.categoryKey}`}
                    r={node.radius}
                    fill={fillToken}
                    stroke={strokeToken}
                    style={{
                      '--vgv-node-fill': fillToken,
                      '--vgv-node-stroke': strokeToken,
                    } as CSSProperties}
                  />
                  <text className="vgv-node-label" y={node.radius * STAR_DISC_SCALE + 6}>{label}</text>
                  <title>{node.path}</title>
                </g>
              );
            })}
          </g>
        </svg>

        {renderedNodeCount === 0 && (
          <div className="vgv-state vgv-state--overlay">No matching graph nodes.</div>
        )}

        {/* M21 inspector — prototype right-panel gSel template (2586–2613). */}
        {selectedNode && (
          <aside
            className="vgv-inspector"
            data-testid="vault-graph-inspector"
            aria-label="Node inspector"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="vgv-inspector-card">
              <div className="vgv-inspector-head">
                <span
                  className="vgv-inspector-orb"
                  aria-hidden="true"
                  style={{
                    background: hexToRgba(categoryColor(selectedNode.categoryKey, catColors), 0.16),
                    borderColor: hexToRgba(categoryColor(selectedNode.categoryKey, catColors), 0.8),
                    boxShadow: `0 0 18px ${hexToRgba(categoryColor(selectedNode.categoryKey, catColors), 0.5)}`,
                  }}
                />
                <div className="vgv-inspector-id">
                  <div className="vgv-inspector-title" data-testid="vault-graph-inspector-title">
                    {displayLabel(selectedNode.label)}
                  </div>
                  <span
                    className="vgv-inspector-chip"
                    style={{
                      color: categoryColor(selectedNode.categoryKey, catColors),
                      borderColor: hexToRgba(categoryColor(selectedNode.categoryKey, catColors), 0.5),
                      background: hexToRgba(categoryColor(selectedNode.categoryKey, catColors), 0.1),
                    }}
                  >
                    {GRAPH_CATEGORY_LABELS[selectedNode.categoryKey].replace(/s$/, '')}
                  </span>
                </div>
              </div>
              <div className="vgv-inspector-path">{selectedNode.path}</div>
            </div>
            <div className="vgv-inspector-card">
              <div className="vgv-inspector-section">Connections</div>
              {inspectorConnections.length === 0 && (
                <div className="vgv-inspector-empty">No connections yet.</div>
              )}
              {inspectorConnections.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  className="vgv-inspector-conn"
                  data-testid={`vault-graph-inspector-conn-${other.id}`}
                  onClick={() => setSelectedNodeId(other.id)}
                >
                  <span
                    className="vgv-inspector-dot"
                    aria-hidden="true"
                    style={{
                      background: categoryColor(other.categoryKey, catColors),
                      boxShadow: `0 0 7px ${hexToRgba(categoryColor(other.categoryKey, catColors), 0.5)}`,
                    }}
                  />
                  <span className="vgv-inspector-conn-label">{displayLabel(other.label)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="vgv-inspector-open"
              data-testid="vault-graph-inspector-open"
              onClick={() => openNode(selectedNode)}
            >
              {selectedNode.vault === 'story' ? 'Open in Story Writer' : 'Open note'}
            </button>
          </aside>
        )}

        <div className="vgv-graph-controls" aria-label="Graph controls">
          {/* M21: category recolor + line colors — prototype left panel 413–443 */}
          <div className="vgv-filters-wrap">
            <button
              type="button"
              aria-label="Graph colors and filters"
              aria-expanded={filtersOpen}
              aria-controls="vault-graph-filters"
              data-testid="vault-graph-filters-toggle"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Colors
            </button>
            {filtersOpen && (
              <div
                id="vault-graph-filters"
                className="vgv-filters-popover"
                role="dialog"
                aria-label="Graph colors and filters"
                data-testid="vault-graph-filters"
              >
                <div className="vgv-filters-heading">Graph filters</div>
                {CHIP_DEFS.map(({ key, label }) => {
                  const color = categoryColor(key, catColors);
                  const active = activeCategories.has(key);
                  return (
                    <div key={key} className={`vgv-filter-row${active ? '' : ' vgv-filter-row--off'}`}>
                      <button
                        type="button"
                        className="vgv-filter-name"
                        aria-pressed={active}
                        onClick={() => handleToggleCategory(key)}
                      >
                        <span
                          className="vgv-filter-dot"
                          aria-hidden="true"
                          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                        />
                        {label}
                      </button>
                      <label className="vgv-filter-wheel" title={`Recolor ${label}`}>
                        <input
                          type="color"
                          value={color}
                          aria-label={`Recolor ${label}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCatColors((prev) => ({ ...prev, [key]: value }));
                          }}
                        />
                      </label>
                      <span className="vgv-filter-count">{categoryCounts.get(key) ?? 0}</span>
                    </div>
                  );
                })}
                <div className="vgv-filters-heading">Connection lines</div>
                {([['note', 'Note ↔ note links'], ['story', 'Story ↔ note links']] as const).map(([key, label]) => (
                  <div key={key} className="vgv-line-row">
                    <span className="vgv-line-label">{label}</span>
                    <span
                      className="vgv-line-swatch"
                      aria-hidden="true"
                      style={{ background: lineColors[key], boxShadow: `0 0 8px ${lineColors[key]}` }}
                    />
                    <label className="vgv-filter-wheel" title={`Recolor ${label}`}>
                      <input
                        type="color"
                        value={lineColors[key]}
                        aria-label={`${label} color`}
                        onChange={(event) => {
                          const value = event.target.value;
                          setLineColors((prev) => ({ ...prev, [key]: value }));
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          {/* M21 zoom dock — prototype 1627–1632 (− / % / + / Fit) */}
          <div className="vgv-zoom-controls" aria-label="Graph zoom controls">
            <button type="button" aria-label="Zoom out" onClick={zoomOut}>−</button>
            <span className="vgv-zoom-pct" data-testid="vault-graph-zoom-pct">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={zoomIn}>+</button>
            <button type="button" aria-label="Reset graph view" onClick={resetView}>Fit</button>
          </div>
        </div>

        {/* Prototype 1633: interaction hint, bottom-left of the canvas */}
        <div className="vgv-canvas-hint" aria-hidden="true">
          Scroll to zoom · drag empty space to pan · drag nodes to pin
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
