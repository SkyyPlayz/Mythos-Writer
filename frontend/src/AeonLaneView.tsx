// SKY-3183 — AEON lane view: arc lanes + scene cards + span bars (windowed).
//
// SVG+HTML, additive to existing spreadsheet timeline. 500-scene × 10-arc
// perf gate: only renders cards in the current horizontal viewport + buffer.
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { BookOpen, FileText } from 'lucide-react';
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

  // Build tick marks
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

// ─── Memoized scene card ───

interface SceneCardProps {
  scene: AeonScene;
  arcColor: string;
  xOffset: number;
  isSelected: boolean;
  onClick: (id: string) => void;
}

const SceneCard = memo(function SceneCard({
  scene, arcColor, xOffset, isSelected, onClick,
}: SceneCardProps) {
  const isWritten = (scene.wordCount ?? 0) > 0;
  const isHighConf = scene.confidence >= 0.8;

  const handleClick = useCallback(() => onClick(scene.id), [onClick, scene.id]);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(scene.id); }
  }, [onClick, scene.id]);

  const dateLabel = scene.date
    ? (() => {
        try {
          return new Date(scene.date).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: '2-digit',
          });
        } catch {
          return scene.date;
        }
      })()
    : 'Undated';

  const cardClass = [
    'aeon-card',
    isWritten ? 'aeon-card--written' : 'aeon-card--planned',
    isSelected ? 'aeon-card--selected' : null,
  ].filter(Boolean).join(' ');

  const confidencePct = Math.round(scene.confidence * 100);

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
      tabIndex={0}
      aria-label={`Scene: ${scene.title}, ${dateLabel}, ${confidencePct}% confidence`}
      aria-pressed={isSelected}
      data-scene-id={scene.id}
      data-testid="aeon-scene-card"
      onClick={handleClick}
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
  onClickScene: (id: string) => void;
}

const LaneRow = memo(function LaneRow({
  arc, scenes, axis, totalWidthPx, scrollX, viewportWidth, selectedIds, onClickScene,
}: LaneRowProps) {
  const arcColor = arc?.color ?? 'var(--text-muted)';
  const arcId = arc?.id ?? '__unassigned__';
  const label = arc?.title ?? 'No Arc';

  const span = axis && arc ? computeArcSpan(scenes, arcId, axis) : null;

  // Windowing: only render cards within the visible horizontal range + buffer.
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
        {/* Span bar */}
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

        {/* Scene cards */}
        {visibleCards.map(scene => (
          <SceneCard
            key={scene.id}
            scene={scene}
            arcColor={arcColor}
            xOffset={axis ? axis.dateToX(scene.date) : 0}
            isSelected={selectedIds.has(scene.id)}
            onClick={onClickScene}
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
}

export default function AeonLaneView({ story, onOpenScene }: Props) {
  const [scenes, setScenes] = useState<AeonScene[]>([]);
  const [arcs, setArcs] = useState<AeonArc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  }, [story, api]);

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

  const handleClickScene = useCallback((id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    onOpenScene?.(id);
  }, [onOpenScene]);

  // ─── Empty / loading / error states ───

  if (!story) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-story">
        <div className="aeon-empty__icon" aria-hidden="true"><BookOpen size={40} /></div>
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
        <div className="aeon-empty__icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>Timeline unavailable</h2>
        <p className="aeon-empty__text aeon-empty__text--error">{error}</p>
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-scenes">
        <div className="aeon-empty__icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>Create scenes in your story to see them here.</h2>
        <p className="aeon-empty__text">Add dates to scenes to position them on the timeline.</p>
      </div>
    );
  }

  if (arcLanes.length === 0) {
    return (
      <div className="aeon-empty" data-testid="aeon-empty-no-arcs">
        <div className="aeon-empty__icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>No scenes have arcs or dates yet.</h2>
      </div>
    );
  }

  const datedCount = scenes.filter(s => s.date).length;

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
              onClickScene={handleClickScene}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
