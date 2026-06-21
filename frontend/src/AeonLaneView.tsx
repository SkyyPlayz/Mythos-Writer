// SKY-3183 — AEON lane view: arc lanes + scene cards + span bars (windowed).
// SKY-3184 — F4: hover tooltip, click→detail popover, right-click menu,
//            double-click→editor, full keyboard nav (↑↓ lanes ←→ within lane Home/End Enter).
//
// SVG+HTML, additive to existing spreadsheet timeline. 500-scene × 10-arc
// perf gate: only renders cards in the current horizontal viewport + buffer.
import { useState, useCallback, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { Story } from './types';
import './AeonLaneView.css';

// ─── Layout constants ───

const LANE_HEIGHT = 120;      // px per arc lane row
const CARD_WIDTH = 140;       // px
const CARD_HEIGHT = 80;       // px
const AXIS_HEIGHT = 40;       // px for the time-axis header strip
const LANE_LABEL_WIDTH = 160; // px for the frozen left-side arc label column
const CANVAS_RIGHT_PAD = 80;  // px after last scene
const UNDATED_SECTION_WIDTH = 180; // px reserved for undated scenes at the right
const CARD_BUFFER_PX = 400;   // render cards within this buffer beyond visible viewport
const MIN_PX_PER_DAY = 6;     // floor density so short date ranges don't squish
const POPOVER_W = 220;        // fixed width for the click-detail popover

// ─── Data types ───

interface AeonScene {
  id: string;
  title: string;
  arcIds: string[];
  date: string;            // empty string = no date
  wordCount: number | null;
  confidence: number;      // 0-1 from chronologicalTime
}

interface AeonArc {
  id: string;
  title: string;
  color: string;
}

// ─── Time axis helpers ───

function parseDateMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : ms;
}

interface TimeAxis {
  minMs: number;
  maxMs: number;
  totalWidthPx: number;
  dateToX: (dateStr: string) => number;
  ticks: Array<{ x: number; label: string }>;
}

function buildTimeAxis(scenes: AeonScene[]): TimeAxis | null {
  const msDates = scenes
    .filter(s => s.date)
    .map(s => parseDateMs(s.date))
    .filter((ms): ms is number => ms !== null);

  if (msDates.length === 0) return null;

  const minMs = Math.min(...msDates);
  let maxMs = Math.max(...msDates);
  if (maxMs === minMs) maxMs = minMs + 30 * 24 * 60 * 60 * 1000;

  const spanMs = maxMs - minMs;
  const spanDays = spanMs / (1000 * 60 * 60 * 24);
  const pxPerMs = Math.max(
    MIN_PX_PER_DAY / (1000 * 60 * 60 * 24),
    Math.min(800 / spanMs, (MIN_PX_PER_DAY * 4) / (1000 * 60 * 60 * 24)),
  );

  const canvasWidthPx = Math.ceil(spanMs * pxPerMs);
  const totalWidthPx = canvasWidthPx + UNDATED_SECTION_WIDTH + CANVAS_RIGHT_PAD;

  function dateToX(dateStr: string): number {
    if (!dateStr) return canvasWidthPx + UNDATED_SECTION_WIDTH / 2;
    const ms = parseDateMs(dateStr);
    if (ms === null) return canvasWidthPx + UNDATED_SECTION_WIDTH / 2;
    return Math.round((ms - minMs) * pxPerMs);
  }

  const ticks: Array<{ x: number; label: string }> = [];
  const tickIntervalMs = spanDays <= 90
    ? 7 * 24 * 60 * 60 * 1000
    : spanDays <= 730
    ? 30 * 24 * 60 * 60 * 1000
    : 365 * 24 * 60 * 60 * 1000;

  const startDate = new Date(minMs);
  startDate.setUTCDate(1);
  startDate.setUTCHours(0, 0, 0, 0);
  let tickMs = startDate.getTime();
  while (tickMs <= maxMs) {
    const x = dateToX(new Date(tickMs).toISOString().slice(0, 10));
    const d = new Date(tickMs);
    const label = spanDays <= 730
      ? d.toLocaleString('default', { month: 'short', year: '2-digit' })
      : String(d.getUTCFullYear());
    ticks.push({ x, label });
    tickMs += tickIntervalMs;
  }

  return { minMs, maxMs, totalWidthPx, dateToX, ticks };
}

// ─── Arc span bar bounds ───

interface SpanBounds { startX: number; endX: number }

function computeArcSpan(scenes: AeonScene[], arcId: string, axis: TimeAxis): SpanBounds | null {
  const arcScenes = scenes.filter(s => s.arcIds.includes(arcId) && s.date);
  if (arcScenes.length === 0) return null;
  const xs = arcScenes.map(s => axis.dateToX(s.date));
  return { startX: Math.min(...xs), endX: Math.max(...xs) + CARD_WIDTH };
}

// ─── Hover Tooltip ───

interface HoverInfo { sceneId: string; x: number; y: number }

interface AeonHoverTooltipProps {
  scene: AeonScene;
  arcs: AeonArc[];
  x: number;
  y: number;
}

function formatDateShort(date: string): string {
  if (!date) return 'Undated';
  try {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return date;
  }
}

function formatDateLong(date: string): string {
  if (!date) return 'Undated';
  try {
    return new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return date;
  }
}

function AeonHoverTooltip({ scene, arcs, x, y }: AeonHoverTooltipProps) {
  const arcName = scene.arcIds
    .map(id => arcs.find(a => a.id === id)?.title)
    .filter(Boolean)
    .join(', ');

  const TOOLTIP_W = 200;
  const TOOLTIP_H = 64;
  const left = Math.min(x + 14, window.innerWidth - TOOLTIP_W - 8);
  const top = y + 20 + TOOLTIP_H > window.innerHeight ? y - TOOLTIP_H - 8 : y + 20;

  const detail = [formatDateShort(scene.date), arcName, scene.wordCount != null ? `${scene.wordCount.toLocaleString()} words` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="aeon-tooltip"
      role="tooltip"
      id={`aeon-tooltip-${scene.id}`}
      style={{ position: 'fixed', left, top }}
      data-testid="aeon-hover-tooltip"
    >
      <p className="aeon-tooltip__title">{scene.title}</p>
      {detail && <p className="aeon-tooltip__detail">{detail}</p>}
    </div>
  );
}

// ─── Detail Popover (click) ───

interface DetailState { scene: AeonScene; anchorRect: DOMRect }

interface AeonDetailPopoverProps {
  scene: AeonScene;
  arcs: AeonArc[];
  anchorRect: DOMRect;
  onOpenInEditor: () => void;
  onDismiss: () => void;
}

function AeonDetailPopover({ scene, arcs, anchorRect, onOpenInEditor, onDismiss }: AeonDetailPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDismiss(); }
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onDismiss]);

  useEffect(() => { ref.current?.focus(); }, []);

  const spaceRight = window.innerWidth - anchorRect.right - 8;
  const left = spaceRight >= POPOVER_W
    ? anchorRect.right + 8
    : Math.max(8, anchorRect.left - POPOVER_W - 8);
  const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - 300));

  const sceneArcs = scene.arcIds
    .map(id => arcs.find(a => a.id === id))
    .filter((a): a is AeonArc => Boolean(a));

  return (
    <div
      ref={ref}
      className="aeon-popover"
      role="dialog"
      aria-label={`Scene details: ${scene.title}`}
      tabIndex={-1}
      style={{ position: 'fixed', left, top, width: POPOVER_W }}
      data-testid="aeon-detail-popover"
    >
      <header className="aeon-popover__header">
        <h3 className="aeon-popover__title" title={scene.title}>{scene.title || 'Untitled scene'}</h3>
        <button
          type="button"
          className="aeon-popover__close"
          aria-label="Close scene details"
          onClick={onDismiss}
          data-testid="aeon-popover-close"
        >×</button>
      </header>

      <dl className="aeon-popover__meta">
        <div className="aeon-popover__row">
          <dt>Date</dt>
          <dd>{formatDateLong(scene.date)}</dd>
        </div>
        <div className="aeon-popover__row">
          <dt>Words</dt>
          <dd>{scene.wordCount != null ? scene.wordCount.toLocaleString() : '—'}</dd>
        </div>
        <div className="aeon-popover__row">
          <dt>Confidence</dt>
          <dd>{Math.round(scene.confidence * 100)}%</dd>
        </div>
      </dl>

      {sceneArcs.length > 0 && (
        <ul className="aeon-popover__arcs" aria-label="Arc memberships">
          {sceneArcs.map(arc => (
            <li key={arc.id} className="aeon-popover__arc-pill">
              <span className="aeon-popover__arc-dot" style={{ background: arc.color }} aria-hidden="true" />
              {arc.title}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="aeon-popover__open-btn"
        onClick={() => { onOpenInEditor(); onDismiss(); }}
        data-testid="aeon-popover-open-in-editor"
      >
        Open in Editor
      </button>
    </div>
  );
}

// ─── Scene Context Menu (right-click) ───

interface ContextMenuState { sceneId: string; x: number; y: number }

interface AeonSceneContextMenuProps {
  sceneId: string;
  x: number;
  y: number;
  title: string;
  onOpenInEditor: () => void;
  onDismiss: () => void;
}

function AeonSceneContextMenu({ sceneId, x, y, title, onOpenInEditor, onDismiss }: AeonSceneContextMenuProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const btn = ref.current?.querySelector<HTMLButtonElement>('button');
    btn?.focus();
  }, []);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onDismiss]);

  return (
    <ul
      ref={ref}
      role="menu"
      aria-label={`Actions for ${title}`}
      className="aeon-context-menu"
      style={{ position: 'fixed', top: y, left: x }}
      data-testid="aeon-scene-context-menu"
      data-scene-id={sceneId}
      onContextMenu={e => e.preventDefault()}
    >
      <li role="none">
        <button
          type="button"
          role="menuitem"
          className="aeon-context-item"
          onClick={() => { onOpenInEditor(); onDismiss(); }}
          data-testid="aeon-context-open-in-editor"
        >
          Open in editor
        </button>
      </li>
    </ul>
  );
}

// ─── Memoized scene card ───

interface SceneCardProps {
  scene: AeonScene;
  arcColor: string;
  xOffset: number;
  isSelected: boolean;
  tabIndex: number;
  onClick: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onHoverStart: (id: string, x: number, y: number) => void;
  onHoverEnd: () => void;
  onKeyNav: (id: string, key: string) => void;
}

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

const SceneCard = memo(function SceneCard({
  scene, arcColor, xOffset, isSelected, tabIndex,
  onClick, onDoubleClick, onContextMenu, onHoverStart, onHoverEnd, onKeyNav,
}: SceneCardProps) {
  const isWritten = (scene.wordCount ?? 0) > 0;
  const isHighConf = scene.confidence >= 0.8;

  const handleClick = useCallback(() => onClick(scene.id), [onClick, scene.id]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onDoubleClick(scene.id);
  }, [onDoubleClick, scene.id]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(scene.id, e.clientX, e.clientY);
  }, [onContextMenu, scene.id]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    onHoverStart(scene.id, e.clientX, e.clientY);
  }, [onHoverStart, scene.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(scene.id);
    } else if (NAV_KEYS.has(e.key)) {
      e.preventDefault();
      onKeyNav(scene.id, e.key);
    }
  }, [onClick, onKeyNav, scene.id]);

  const dateLabel = formatDateShort(scene.date);
  const confidencePct = Math.round(scene.confidence * 100);

  const cardClass = [
    'aeon-card',
    isWritten ? 'aeon-card--written' : 'aeon-card--planned',
    isSelected ? 'aeon-card--selected' : null,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClass}
      style={{
        position: 'absolute',
        left: xOffset,
        top: (LANE_HEIGHT - CARD_HEIGHT) / 2,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        '--aeon-arc-color': isWritten ? arcColor : 'var(--text-muted)',
      } as React.CSSProperties}
      role="button"
      tabIndex={tabIndex}
      aria-label={`Scene: ${scene.title}, ${dateLabel}, ${confidencePct}% confidence`}
      aria-pressed={isSelected}
      data-scene-id={scene.id}
      data-testid="aeon-scene-card"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      onKeyDown={handleKeyDown}
    >
      <span
        className={`aeon-card__conf-badge${isHighConf ? ' aeon-card__conf-badge--high' : ' aeon-card__conf-badge--low'}`}
        aria-hidden="true"
        data-testid="aeon-conf-badge"
      >
        {isHighConf ? '✓' : '?'}
      </span>
      <p className="aeon-card__title" title={scene.title}>{scene.title}</p>
      <p className="aeon-card__date">{dateLabel}</p>
    </div>
  );
});

// ─── Lane row ───

interface LaneRowProps {
  arc: AeonArc | null;
  scenes: AeonScene[];
  axis: TimeAxis | null;
  totalWidthPx: number;
  scrollX: number;
  viewportWidth: number;
  selectedIds: Set<string>;
  focusedId: string | null;
  onClickScene: (id: string) => void;
  onDoubleClickScene: (id: string) => void;
  onContextMenuScene: (id: string, x: number, y: number) => void;
  onHoverStartScene: (id: string, x: number, y: number) => void;
  onHoverEndScene: () => void;
  onKeyNavScene: (id: string, key: string) => void;
}

const LaneRow = memo(function LaneRow({
  arc, scenes, axis, totalWidthPx, scrollX, viewportWidth, selectedIds, focusedId,
  onClickScene, onDoubleClickScene, onContextMenuScene, onHoverStartScene, onHoverEndScene, onKeyNavScene,
}: LaneRowProps) {
  const arcColor = arc?.color ?? 'var(--text-muted)';
  const arcId = arc?.id ?? '__unassigned__';
  const label = arc?.title ?? 'No Arc';

  const span = axis && arc ? computeArcSpan(scenes, arcId, axis) : null;

  const visStart = scrollX - CARD_BUFFER_PX;
  const visEnd = scrollX + viewportWidth + CARD_BUFFER_PX;

  const visibleCards = useMemo(() => {
    if (!axis) return scenes;
    return scenes.filter(s => {
      const x = axis.dateToX(s.date);
      return x + CARD_WIDTH >= visStart && x <= visEnd;
    });
  }, [scenes, axis, visStart, visEnd]);

  return (
    <div className="aeon-lane" style={{ height: LANE_HEIGHT }} aria-label={`Arc lane: ${label}`}>
      <div
        className="aeon-lane__label"
        style={{ width: LANE_LABEL_WIDTH }}
        title={label}
        aria-hidden="true"
      >
        {arc && (
          <span
            className="aeon-lane__color-dot"
            style={{ background: arcColor }}
            aria-hidden="true"
          />
        )}
        <span className="aeon-lane__label-text">{label}</span>
      </div>

      <div
        className="aeon-lane__canvas"
        style={{ width: totalWidthPx, position: 'relative', height: '100%' }}
      >
        {span && (
          <svg
            className="aeon-lane__span-bar"
            style={{
              position: 'absolute',
              left: span.startX,
              width: span.endX - span.startX,
              bottom: 8,
              height: 6,
            }}
            aria-label={`Arc span for ${label}`}
            aria-hidden="true"
          >
            <rect x={0} y={0} width="100%" height={6} rx={3} fill={arcColor} opacity={0.45} />
          </svg>
        )}

        {visibleCards.map(scene => (
          <SceneCard
            key={scene.id}
            scene={scene}
            arcColor={arcColor}
            xOffset={axis ? axis.dateToX(scene.date) : 0}
            isSelected={selectedIds.has(scene.id)}
            tabIndex={scene.id === focusedId ? 0 : -1}
            onClick={onClickScene}
            onDoubleClick={onDoubleClickScene}
            onContextMenu={onContextMenuScene}
            onHoverStart={onHoverStartScene}
            onHoverEnd={onHoverEndScene}
            onKeyNav={onKeyNavScene}
          />
        ))}
      </div>
    </div>
  );
});

// ─── Time axis strip ───

function TimeAxisStrip({ axis, totalWidthPx }: { axis: TimeAxis; totalWidthPx: number }) {
  return (
    <svg
      className="aeon-axis"
      style={{ width: totalWidthPx, height: AXIS_HEIGHT }}
      aria-hidden="true"
      data-testid="aeon-time-axis"
    >
      <line x1={0} y1={AXIS_HEIGHT - 1} x2={totalWidthPx} y2={AXIS_HEIGHT - 1} className="aeon-axis__baseline" />
      {axis.ticks.map(({ x, label }) => (
        <g key={label + x} transform={`translate(${x}, 0)`}>
          <line x1={0} y1={AXIS_HEIGHT - 8} x2={0} y2={AXIS_HEIGHT - 1} className="aeon-axis__tick" />
          <text x={4} y={AXIS_HEIGHT - 12} className="aeon-axis__tick-label">{label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Main component ───

interface Props {
  story: Story | null;
  onOpenScene?: (sceneId: string) => void;
  /** F5 — when provided with onSelectionChange, tracks selection externally. */
  selectedIds?: Set<string>;
  /** F5 — called when the selection changes. */
  onSelectionChange?: (ids: Set<string>) => void;
}

export default function AeonLaneView({
  story,
  onOpenScene,
  selectedIds: selectedIdsProp,
  onSelectionChange,
}: Props) {
  const [scenes, setScenes] = useState<AeonScene[]>([]);
  const [arcs, setArcs] = useState<AeonArc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds: Set<string> = selectedIdsProp ?? internalSelectedIds;
  // Refs keep the selection bridge stable so callbacks don't need it in their deps.
  const internalSelectedIdsRef = useRef(internalSelectedIds);
  internalSelectedIdsRef.current = internalSelectedIds;
  const selectedIdsPropsRef = useRef(selectedIdsProp);
  selectedIdsPropsRef.current = selectedIdsProp;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const setSelectedIds = useCallback((ids: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    const prev = selectedIdsPropsRef.current ?? internalSelectedIdsRef.current;
    const resolved = typeof ids === 'function' ? ids(prev) : ids;
    if (selectedIdsPropsRef.current === undefined) setInternalSelectedIds(resolved);
    onSelectionChangeRef.current?.(resolved);
  }, []);

  // ─── Interaction state ───
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1024);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const api = window.api;

  useEffect(() => {
    if (!story) {
      setScenes([]);
      setArcs([]);
      setSelectedIds(new Set());
      setDetail(null);
      setContextMenu(null);
      setHoverInfo(null);
      setFocusedCardId(null);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all([
      api.timelineGetScenes(story.id),
      api.timelineListArcs(),
    ])
      .then(([scenesResp, arcsResp]) => {
        setArcs((arcsResp.arcs ?? []).map(a => ({ id: a.id, title: a.title, color: a.color })));
        setScenes(
          (scenesResp.scenes ?? []).map(s => ({
            id: s.id,
            title: s.title,
            arcIds: s.entityLinks?.arcs ?? [],
            date: s.chronologicalTime?.date ?? '',
            wordCount: s.timelineMetadata?.wordCount ?? null,
            confidence: s.chronologicalTime?.confidence ?? 0,
          })),
        );
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [story, api, setSelectedIds]);

  // rAF-throttled scroll handler for windowing
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (el) {
        setScrollX(el.scrollLeft);
        setViewportWidth(el.clientWidth);
      }
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [handleScroll]);

  const axis = useMemo(() => buildTimeAxis(scenes), [scenes]);
  const totalWidthPx = axis?.totalWidthPx ?? 800;

  const arcLanes = useMemo(() => {
    const arcMap = new Map<string, AeonScene[]>();
    for (const arc of arcs) arcMap.set(arc.id, []);
    arcMap.set('__unassigned__', []);

    for (const scene of scenes) {
      if (scene.arcIds.length === 0) {
        arcMap.get('__unassigned__')!.push(scene);
      } else {
        for (const arcId of scene.arcIds) {
          if (!arcMap.has(arcId)) arcMap.set(arcId, []);
          arcMap.get(arcId)!.push(scene);
        }
      }
    }

    const lanes: Array<{ arc: AeonArc | null; scenes: AeonScene[] }> = [];
    for (const arc of arcs) {
      const arcScenes = arcMap.get(arc.id) ?? [];
      if (arcScenes.length > 0) lanes.push({ arc, scenes: arcScenes });
    }
    const unassigned = arcMap.get('__unassigned__') ?? [];
    if (unassigned.length > 0) lanes.push({ arc: null, scenes: unassigned });
    return lanes;
  }, [scenes, arcs]);

  // Keyboard nav: scenes sorted by x per lane — consistent arrow key ordering
  const flatLanes = useMemo<string[][]>(() =>
    arcLanes.map(({ scenes: ls }) => {
      if (!axis) return ls.map(s => s.id);
      return [...ls]
        .sort((a, b) => axis.dateToX(a.date) - axis.dateToX(b.date))
        .map(s => s.id);
    }),
  [arcLanes, axis]);

  // Default focus: first card in first lane when nothing explicitly focused
  const effectiveFocusedId = focusedCardId ?? (flatLanes[0]?.[0] ?? null);

  // ─── Handlers ───

  const handleClickScene = useCallback((id: string) => {
    const wasSelected = selectedIds.has(id);
    const n = new Set(selectedIds);
    if (wasSelected) {
      n.delete(id);
      setSelectedIds(n);
      setDetail(null);
    } else {
      n.add(id);
      setSelectedIds(n);
      const clickedScene = scenes.find(s => s.id === id);
      if (clickedScene) {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-scene-id="${id}"]`);
        const rect = el?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
        setDetail({ scene: clickedScene, anchorRect: rect });
      }
    }
  }, [selectedIds, scenes, setSelectedIds]);

  const handleDoubleClickScene = useCallback((id: string) => {
    setDetail(null);
    onOpenScene?.(id);
  }, [onOpenScene]);

  const handleContextMenuScene = useCallback((id: string, x: number, y: number) => {
    setDetail(null);
    setHoverInfo(null);
    setContextMenu({ sceneId: id, x, y });
  }, []);

  const handleHoverStartScene = useCallback((id: string, x: number, y: number) => {
    setHoverInfo({ sceneId: id, x, y });
  }, []);

  const handleHoverEndScene = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const handleKeyNavScene = useCallback((sceneId: string, key: string) => {
    let laneIdx = -1;
    let cardIdx = -1;
    for (let l = 0; l < flatLanes.length; l++) {
      const ci = flatLanes[l].indexOf(sceneId);
      if (ci !== -1) { laneIdx = l; cardIdx = ci; break; }
    }
    if (laneIdx === -1) return;

    let nextId: string | null = null;
    if (key === 'ArrowRight') {
      nextId = flatLanes[laneIdx][cardIdx + 1] ?? null;
    } else if (key === 'ArrowLeft') {
      nextId = cardIdx > 0 ? flatLanes[laneIdx][cardIdx - 1] : null;
    } else if (key === 'ArrowDown') {
      const nextLane = flatLanes[laneIdx + 1];
      nextId = nextLane?.[Math.min(cardIdx, nextLane.length - 1)] ?? null;
    } else if (key === 'ArrowUp') {
      const prevLane = flatLanes[laneIdx - 1];
      nextId = prevLane?.[Math.min(cardIdx, prevLane.length - 1)] ?? null;
    } else if (key === 'Home') {
      nextId = flatLanes[laneIdx][0] ?? null;
    } else if (key === 'End') {
      nextId = flatLanes[laneIdx][flatLanes[laneIdx].length - 1] ?? null;
    }

    if (nextId) {
      setFocusedCardId(nextId);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-scene-id="${nextId}"]`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        // Target outside render window — scroll to expose it, then it'll render and be focusable
        const targetScene = scenes.find(s => s.id === nextId);
        if (targetScene && axis) {
          const tx = axis.dateToX(targetScene.date);
          scrollRef.current?.scrollTo({ left: Math.max(0, tx - viewportWidth / 2), behavior: 'smooth' });
        }
      }
    }
  }, [flatLanes, scenes, axis, viewportWidth]);

  // ─── Empty / loading / error states ───

  if (!story) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-story">
        <div className="aeon-empty__icon" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
        <h2>Select a story to view its AEON timeline.</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="aeon-empty">
        <div className="aeon-loading" role="status" aria-label="Loading timeline" />
        <p className="aeon-empty__text">Loading scenes…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="aeon-empty" role="alert">
        <div className="aeon-empty__icon" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
        <h2>Timeline unavailable</h2>
        <p className="aeon-empty__text aeon-empty__text--error">{error}</p>
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-scenes">
        <div className="aeon-empty__icon" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
        <h2>Create scenes in your story to see them here.</h2>
        <p className="aeon-empty__text">Add dates to scenes to position them on the timeline.</p>
      </div>
    );
  }

  if (arcLanes.length === 0) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-arcs">
        <div className="aeon-empty__icon" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
        <h2>No scenes have arcs or dates yet.</h2>
      </div>
    );
  }

  const datedCount = scenes.filter(s => s.date).length;
  const hoverScene = hoverInfo ? scenes.find(s => s.id === hoverInfo.sceneId) : null;
  const ctxTitle = contextMenu ? (scenes.find(s => s.id === contextMenu.sceneId)?.title ?? '') : '';

  return (
    <div
      className="aeon-root"
      data-testid="aeon-lane-view"
      role="region"
      aria-label={`AEON timeline for ${story.title}`}
    >
      <div className="aeon-statbar" aria-live="polite">
        <span className="aeon-statbar__story">{story.title}</span>
        <span className="aeon-statbar__count">
          {datedCount}/{scenes.length} scenes dated · {arcLanes.length} lane{arcLanes.length !== 1 ? 's' : ''}
        </span>
        {!axis && (
          <span className="aeon-statbar__hint">Add dates to scenes to see arc spans.</span>
        )}
      </div>

      <div
        className="aeon-scroll"
        ref={scrollRef}
        tabIndex={-1}
        aria-label="Timeline canvas — scroll to navigate"
      >
        <div className="aeon-axis-header">
          <div className="aeon-label-spacer" style={{ width: LANE_LABEL_WIDTH }} aria-hidden="true" />
          {axis && <TimeAxisStrip axis={axis} totalWidthPx={totalWidthPx} />}
        </div>

        <div className="aeon-lanes" aria-label="Arc lanes">
          {arcLanes.map(({ arc, scenes: laneScenes }) => (
            <LaneRow
              key={arc?.id ?? '__unassigned__'}
              arc={arc}
              scenes={laneScenes}
              axis={axis}
              totalWidthPx={totalWidthPx}
              scrollX={scrollX}
              viewportWidth={viewportWidth}
              selectedIds={selectedIds}
              focusedId={effectiveFocusedId}
              onClickScene={handleClickScene}
              onDoubleClickScene={handleDoubleClickScene}
              onContextMenuScene={handleContextMenuScene}
              onHoverStartScene={handleHoverStartScene}
              onHoverEndScene={handleHoverEndScene}
              onKeyNavScene={handleKeyNavScene}
            />
          ))}
        </div>
      </div>

      {/* Hover tooltip — hidden while detail popover is open to avoid overlap */}
      {hoverInfo && hoverScene && !detail && (
        <AeonHoverTooltip
          scene={hoverScene}
          arcs={arcs}
          x={hoverInfo.x}
          y={hoverInfo.y}
        />
      )}

      {/* Click detail popover */}
      {detail && (
        <AeonDetailPopover
          scene={detail.scene}
          arcs={arcs}
          anchorRect={detail.anchorRect}
          onOpenInEditor={() => onOpenScene?.(detail.scene.id)}
          onDismiss={() => { setDetail(null); setSelectedIds(prev => { const n = new Set(prev); n.delete(detail.scene.id); return n; }); }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <AeonSceneContextMenu
          sceneId={contextMenu.sceneId}
          x={contextMenu.x}
          y={contextMenu.y}
          title={ctxTitle}
          onOpenInEditor={() => onOpenScene?.(contextMenu.sceneId)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
