import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { drag, type DragBehavior } from 'd3-drag';
import 'd3-transition';
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

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Props {
  onOpenNote?: (path: string) => void;
}

function runForceSimulation(gnodes: GraphNode[], gedges: GraphEdge[], W: number, H: number): SimNode[] {
  const nodes: SimNode[] = gnodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(gnodes.length, 1);
    return { ...n, x: W / 2 + (W / 3) * Math.cos(angle), y: H / 2 + (H / 3) * Math.sin(angle), vx: 0, vy: 0 };
  });
  const idxById: Record<string, number> = {};
  nodes.forEach((n, i) => { idxById[n.id] = i; });

  const k = Math.sqrt((W * H) / Math.max(nodes.length, 1));
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = nodes.map(() => ({ x: 0, y: 0 }));

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = (k * k) / dist;
        disp[i].x += (dx / dist) * force;
        disp[i].y += (dy / dist) * force;
        disp[j].x -= (dx / dist) * force;
        disp[j].y -= (dy / dist) * force;
      }
    }

    // Attraction along edges
    for (const e of gedges) {
      const ui = idxById[e.source], vi = idxById[e.target];
      if (ui == null || vi == null) continue;
      const dx = nodes[ui].x - nodes[vi].x;
      const dy = nodes[ui].y - nodes[vi].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist * dist) / k;
      disp[ui].x -= (dx / dist) * force;
      disp[ui].y -= (dy / dist) * force;
      disp[vi].x += (dx / dist) * force;
      disp[vi].y += (dy / dist) * force;
    }

    const temp = W / (iter + 1);
    for (let i = 0; i < nodes.length; i++) {
      const d = disp[i];
      const dLen = Math.max(Math.sqrt(d.x * d.x + d.y * d.y), 0.01);
      nodes[i].x += (d.x / dLen) * Math.min(dLen, temp);
      nodes[i].y += (d.y / dLen) * Math.min(dLen, temp);
      nodes[i].x = Math.max(60, Math.min(W - 60, nodes[i].x));
      nodes[i].y = Math.max(40, Math.min(H - 40, nodes[i].y));
    }
  }
  return nodes;
}

const NODE_W = 100;
const NODE_H = 28;

export default function VaultGraphView({ onOpenNote }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graphData, setGraphData] = useState<VaultGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [dims, setDims] = useState({ w: 900, h: 700 });
  const containerRef = useRef<HTMLDivElement>(null);

  // observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await (window as any).api?.vaultGraphData?.() as VaultGraphData | undefined;
        if (data) setGraphData(data);
        else setError('VAULT_GRAPH_DATA IPC not available yet.');
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const folders = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.folder).filter(Boolean))) as string[];
  }, [graphData]);

  const tags = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.flatMap((n) => n.tags ?? [])));
  }, [graphData]);

  const { simNodes, simEdges } = useMemo(() => {
    if (!graphData) return { simNodes: [], simEdges: [] };
    let filtered = graphData.nodes;
    if (filterFolder) filtered = filtered.filter((n) => n.folder === filterFolder);
    if (filterTag) filtered = filtered.filter((n) => n.tags?.includes(filterTag));
    const nodeIds = new Set(filtered.map((n) => n.id));
    const filteredEdges = graphData.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const simNodes = runForceSimulation(filtered, filteredEdges, dims.w, dims.h);
    return { simNodes, simEdges: filteredEdges };
  }, [graphData, filterFolder, filterTag, dims]);

  // render SVG using d3-zoom and d3-drag
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || simNodes.length === 0) return;

    const svgSel = select(svgEl);
    svgSel.selectAll('*').remove();

    const defs = svgSel.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#585b70');

    const g = svgSel.append('g').attr('class', 'vgv-world');

    // edges
    const idxById: Record<string, SimNode> = {};
    simNodes.forEach((n) => { idxById[n.id] = n; });

    g.append('g').attr('class', 'edges')
      .selectAll('line')
      .data(simEdges)
      .enter()
      .append('line')
      .attr('x1', (e) => idxById[e.source]?.x ?? 0)
      .attr('y1', (e) => idxById[e.source]?.y ?? 0)
      .attr('x2', (e) => idxById[e.target]?.x ?? 0)
      .attr('y2', (e) => idxById[e.target]?.y ?? 0)
      .attr('stroke', '#585b70')
      .attr('stroke-width', 1.2)
      .attr('marker-end', 'url(#arrowhead)');

    // node groups
    type NodeDatum = SimNode;

    const nodeG = g.append('g').attr('class', 'nodes')
      .selectAll<SVGGElement, NodeDatum>('g')
      .data(simNodes)
      .enter()
      .append('g')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('cursor', 'pointer')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => d.label);

    nodeG.append('rect')
      .attr('x', -NODE_W / 2)
      .attr('y', -NODE_H / 2)
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', 6)
      .attr('fill', '#1e1e2e')
      .attr('stroke', '#585b70')
      .attr('stroke-width', 1);

    nodeG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#cdd6f4')
      .attr('font-size', 11)
      .text((d) => d.label.length > 14 ? d.label.slice(0, 12) + '…' : d.label);

    // click handler
    nodeG.on('click', (_event, d) => {
      onOpenNote?.(d.path);
    });

    // hover highlight
    nodeG.on('mouseenter', function () {
      select(this).select('rect').attr('stroke', '#cba6f7').attr('stroke-width', 2);
    }).on('mouseleave', function () {
      select(this).select('rect').attr('stroke', '#585b70').attr('stroke-width', 1);
    });

    // drag
    const dragBehavior: DragBehavior<SVGGElement, NodeDatum, NodeDatum> = drag<SVGGElement, NodeDatum>()
      .on('start', function (_event, d) {
        select(this).raise();
        d.vx = 0; d.vy = 0;
      })
      .on('drag', function (event, d) {
        d.x = event.x; d.y = event.y;
        select(this).attr('transform', `translate(${d.x},${d.y})`);
        // update edges
        g.selectAll<SVGLineElement, GraphEdge>('line')
          .filter((e) => e.source === d.id || e.target === d.id)
          .attr('x1', (e) => e.source === d.id ? d.x : (idxById[e.source]?.x ?? 0))
          .attr('y1', (e) => e.source === d.id ? d.y : (idxById[e.source]?.y ?? 0))
          .attr('x2', (e) => e.target === d.id ? d.x : (idxById[e.target]?.x ?? 0))
          .attr('y2', (e) => e.target === d.id ? d.y : (idxById[e.target]?.y ?? 0));
      });

    nodeG.call(dragBehavior);

    // zoom & pan
    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        const t: ZoomTransform = event.transform;
        g.attr('transform', t.toString());
      });

    svgSel.call(zoomBehavior);

    // fit to view
    const padding = 60;
    const xs = simNodes.map((n) => n.x);
    const ys = simNodes.map((n) => n.y);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    const gw = maxX - minX, gh = maxY - minY;
    const scale = Math.min(dims.w / gw, dims.h / gh, 2);
    const tx = (dims.w - gw * scale) / 2 - minX * scale;
    const ty = (dims.h - gh * scale) / 2 - minY * scale;
    try {
      svgSel.call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
    } catch {
      // jsdom lacks SVGSVGElement.viewBox — skip initial fit in test env
      g.attr('transform', zoomIdentity.translate(tx, ty).scale(scale).toString());
    }

    return () => { svgSel.selectAll('*').remove(); };
  }, [simNodes, simEdges, dims, onOpenNote]);

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
      <div className="vgv-canvas" ref={containerRef}>
        <svg
          ref={svgRef}
          width={dims.w}
          height={dims.h}
          style={{ display: 'block', background: '#11111b' }}
          aria-label="Vault note graph"
        />
      </div>
    </div>
  );
}
