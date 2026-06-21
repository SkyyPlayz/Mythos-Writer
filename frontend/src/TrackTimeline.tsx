// SKY-3182 — Part F · F2: TrackTimeline SVG canvas shell.
// SVG time axis + grid + time-unit headers; zoom/pan via TimelineHeader;
// viewport persisted to localStorage; gap indicators in proportional mode.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import TimelineHeader from './TimelineHeader';
import type { Story } from './types';
import './TrackTimeline.css';

const SLOT_WIDTH = 140;      // px per scene slot (uniform mode, zoom=1)
const AXIS_HEIGHT = 48;      // px for the time-header row
const TRACK_HEIGHT = 72;     // px per track row
const AXIS_LEFT = 8;         // left padding before first slot
const GAP_THRESHOLD = 0.2;   // fraction of span that qualifies as a "gap"
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4.0;
const VIEWPORT_STORAGE_KEY = 'tt-viewport-v1';
const SAVE_DEBOUNCE_MS = 600;

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;
const MS_MONTH = 30.44 * MS_DAY;
const MS_QUARTER = 91.31 * MS_DAY;

export type SpacingMode = 'uniform' | 'proportional';

export interface TrackTimelineProps {
  story: Story | null;
  spacingMode?: SpacingMode;
}

interface ViewportState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

interface TtScene {
  id: string;
  title: string;
  date: string; // '' if undated
}

interface PlacedScene {
  raw: TtScene;
  x: number;
}

interface GapIndicator {
  x: number;
  width: number;
  labelText: string;
}

interface Tick {
  x: number;
  label: string;
}

type TickUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

function loadStoredViewport(): ViewportState | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ViewportState;
  } catch {
    return null;
  }
}

function saveViewport(vp: ViewportState): void {
  try {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(vp));
  } catch {
    // ignore quota errors
  }
}

function tickUnit(spanMs: number, zoom: number): TickUnit {
  const effective = spanMs / zoom;
  if (effective < 14 * MS_DAY) return 'day';
  if (effective < 12 * MS_WEEK) return 'week';
  if (effective < 24 * MS_MONTH) return 'month';
  if (effective < 8 * MS_QUARTER) return 'quarter';
  return 'year';
}

function floorTo(ts: number, unit: TickUnit): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  if (unit === 'day') return d.getTime();
  if (unit === 'week') {
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - dow);
    return d.getTime();
  }
  if (unit === 'month') {
    d.setUTCDate(1);
    return d.getTime();
  }
  if (unit === 'quarter') {
    const m = d.getUTCMonth();
    d.setUTCMonth(m - (m % 3), 1);
    return d.getTime();
  }
  // year
  d.setUTCMonth(0, 1);
  return d.getTime();
}

function advanceTick(ts: number, unit: TickUnit): number {
  const d = new Date(ts);
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (unit === 'quarter') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

function formatTickLabel(ts: number, unit: TickUnit): string {
  const d = new Date(ts);
  if (unit === 'day') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (unit === 'week') {
    return 'W' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (unit === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (unit === 'quarter') {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${q} ${d.getUTCFullYear()}`;
  }
  return String(d.getUTCFullYear());
}

function placeScenes(
  scenes: TtScene[],
  spacingMode: SpacingMode,
): { placed: PlacedScene[]; totalWidth: number; minTs: number; maxTs: number } {
  const dated = scenes.filter(s => s.date);
  const undated = scenes.filter(s => !s.date);

  if (spacingMode === 'proportional' && dated.length > 0) {
    const timestamps = dated.map(s => new Date(s.date).getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const span = Math.max(maxTs - minTs, 1);
    const contentWidth = Math.max(dated.length * SLOT_WIDTH, 800);

    const placed: PlacedScene[] = dated
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(s => ({
        raw: s,
        x: AXIS_LEFT + ((new Date(s.date).getTime() - minTs) / span) * contentWidth,
      }));

    const undatedStart = AXIS_LEFT + contentWidth + SLOT_WIDTH;
    undated.forEach((s, i) => {
      placed.push({ raw: s, x: undatedStart + i * SLOT_WIDTH });
    });

    const totalWidth = undatedStart + undated.length * SLOT_WIDTH + SLOT_WIDTH;
    return { placed, totalWidth, minTs, maxTs };
  }

  // Uniform spacing (default)
  const all = [
    ...dated.slice().sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0)),
    ...undated,
  ];
  const placed: PlacedScene[] = all.map((s, i) => ({
    raw: s,
    x: AXIS_LEFT + i * SLOT_WIDTH,
  }));
  const timestamps = dated.map(s => new Date(s.date).getTime());
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const totalWidth = AXIS_LEFT + placed.length * SLOT_WIDTH + SLOT_WIDTH;
  return { placed, totalWidth, minTs, maxTs };
}

function computeGaps(
  placed: PlacedScene[],
  minTs: number,
  maxTs: number,
): GapIndicator[] {
  const span = maxTs - minTs;
  if (span <= 0) return [];

  const dated = placed.filter(p => p.raw.date).sort((a, b) => a.x - b.x);
  const gaps: GapIndicator[] = [];

  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1];
    const curr = dated[i];
    const prevTs = new Date(prev.raw.date).getTime();
    const currTs = new Date(curr.raw.date).getTime();
    const gapMs = currTs - prevTs;
    if (gapMs / span > GAP_THRESHOLD) {
      const gapDays = Math.round(gapMs / MS_DAY);
      const labelText =
        gapDays > 365
          ? `${(gapDays / 365.25).toFixed(1)}y`
          : gapDays > 30
            ? `${Math.round(gapDays / 30.44)}mo`
            : `${gapDays}d`;
      gaps.push({
        x: prev.x + 16,
        width: curr.x - prev.x - 32,
        labelText,
      });
    }
  }
  return gaps;
}

function buildTicks(
  minTs: number,
  maxTs: number,
  placed: PlacedScene[],
  totalWidth: number,
  spacingMode: SpacingMode,
  zoom: number,
): Tick[] {
  const span = maxTs - minTs;
  if (span <= 0) return [];

  const unit = tickUnit(span, zoom);
  const ticks: Tick[] = [];
  let ts = floorTo(minTs, unit);
  const limit = advanceTick(maxTs, unit);

  while (ts <= limit) {
    let x: number;
    if (spacingMode === 'proportional') {
      const contentWidth = Math.max(placed.filter(p => p.raw.date).length * SLOT_WIDTH, 800);
      x = AXIS_LEFT + ((ts - minTs) / span) * contentWidth;
    } else {
      x = AXIS_LEFT + ((ts - minTs) / span) * (totalWidth - AXIS_LEFT * 2);
    }
    ticks.push({ x, label: formatTickLabel(ts, unit) });
    ts = advanceTick(ts, unit);
    if (ticks.length > 200) break;
  }
  return ticks;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

export default function TrackTimeline({ story, spacingMode = 'uniform' }: TrackTimelineProps) {
  const [scenes, setScenes] = useState<TtScene[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = useMemo(() => loadStoredViewport(), []);
  const [zoom, setZoom] = useState(stored?.zoom ?? 1.0);
  const [offsetX, setOffsetX] = useState(stored?.offsetX ?? 0);
  const [offsetY, setOffsetY] = useState(stored?.offsetY ?? 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOX: number;
    startOY: number;
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest offset in refs so pointer handlers don't close over stale state
  const offsetXRef = useRef(offsetX);
  const offsetYRef = useRef(offsetY);
  offsetXRef.current = offsetX;
  offsetYRef.current = offsetY;

  const api = window.api;

  useEffect(() => {
    if (!story) {
      setScenes([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);

    (api.timelineGetScenes(story.id) as Promise<{ scenes?: Array<{ id: string; title: string; chronologicalTime?: { date?: string } }> }>)
      .then(resp => {
        const raw = resp.scenes ?? [];
        setScenes(
          raw.map(s => ({
            id: s.id,
            title: s.title,
            date: s.chronologicalTime?.date ?? '',
          })),
        );
      })
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [story, api]);

  const persistViewport = useCallback((vp: ViewportState) => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveViewport(vp), SAVE_DEBOUNCE_MS);
  }, []);

  const handleZoomChange = useCallback(
    (z: number) => {
      setZoom(z);
      persistViewport({ zoom: z, offsetX: offsetXRef.current, offsetY: offsetYRef.current });
    },
    [persistViewport],
  );

  const handleZoomFit = useCallback(() => {
    setZoom(1.0);
    setOffsetX(0);
    setOffsetY(0);
    persistViewport({ zoom: 1.0, offsetX: 0, offsetY: 0 });
  }, [persistViewport]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOX: offsetXRef.current,
      startOY: offsetYRef.current,
    };
    e.currentTarget.classList.add('tt-svg--dragging');
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffsetX(dragRef.current.startOX + dx);
    setOffsetY(dragRef.current.startOY + dy);
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return;
      e.currentTarget.classList.remove('tt-svg--dragging');
      dragRef.current = null;
      persistViewport({
        zoom,
        offsetX: offsetXRef.current,
        offsetY: offsetYRef.current,
      });
    },
    [zoom, persistViewport],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const PAN = 40 / zoom;
      if (e.key === 'ArrowRight') {
        setOffsetX(x => x - PAN);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        setOffsetX(x => x + PAN);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        setOffsetY(y => y - PAN);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        setOffsetY(y => y + PAN);
        e.preventDefault();
      } else if (e.key === 'Home') {
        handleZoomFit();
        e.preventDefault();
      }
    },
    [zoom, handleZoomFit],
  );

  const { placed, totalWidth, minTs, maxTs } = useMemo(
    () => placeScenes(scenes, spacingMode),
    [scenes, spacingMode],
  );

  const ticks = useMemo(
    () => buildTicks(minTs, maxTs, placed, totalWidth, spacingMode, zoom),
    [minTs, maxTs, placed, totalWidth, spacingMode, zoom],
  );

  const gaps = useMemo(
    () => (spacingMode === 'proportional' ? computeGaps(placed, minTs, maxTs) : []),
    [placed, minTs, maxTs, spacingMode],
  );

  const svgHeight = AXIS_HEIGHT + TRACK_HEIGHT + 16;
  const svgWidth = Math.max(totalWidth + AXIS_LEFT, 600);
  const undatedCount = scenes.filter(s => !s.date).length;
  const storyTitle = story?.title ?? '';

  if (!story) {
    return (
      <div className="tt-root tt-root--empty" role="status" aria-label="No story selected">
        <div className="tt-empty-state">
          <p className="tt-empty-state__msg">Select a story to view its track timeline.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="tt-root"
      role="application"
      tabIndex={0}
      aria-label="AEON track timeline — use arrow keys to pan, Ctrl+wheel to zoom"
      onKeyDown={handleKeyDown}
    >
      <TimelineHeader
        title={storyTitle}
        currentZoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomChange={handleZoomChange}
        onZoomFit={handleZoomFit}
      />
      <div className="tt-canvas-wrap" ref={containerRef}>
        {loading && (
          <div
            className="tt-loading-overlay"
            role="status"
            aria-live="polite"
            aria-label="Loading scenes"
          >
            <span className="tt-loading-spinner" aria-hidden="true" />
            <span className="tt-loading-text">Loading scenes…</span>
          </div>
        )}
        {error && (
          <div className="tt-error" role="alert">
            <p className="tt-error__msg">Failed to load scenes: {error}</p>
          </div>
        )}
        {!loading && !error && scenes.length === 0 && (
          <div className="tt-empty-state" data-testid="tt-empty-no-scenes">
            <p className="tt-empty-state__msg">
              No scenes yet. Add scenes to your story to see them here.
            </p>
          </div>
        )}
        {!loading && !error && scenes.length > 0 && (
          <svg
            className="tt-svg"
            width="100%"
            height={svgHeight * zoom + 32}
            aria-label={`Track timeline for ${storyTitle}. ${scenes.length} scene${scenes.length !== 1 ? 's' : ''}, ${spacingMode} spacing.`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            data-testid="tt-svg"
            role="img"
          >
            <g
              transform={`translate(${offsetX} ${offsetY}) scale(${zoom})`}
              data-testid="tt-content-group"
            >
              {/* Axis background */}
              <rect className="tt-axis-bg" x={0} y={0} width={svgWidth} height={AXIS_HEIGHT} />
              {/* Track background */}
              <rect
                className="tt-track-bg"
                x={0}
                y={AXIS_HEIGHT}
                width={svgWidth}
                height={TRACK_HEIGHT + 16}
              />
              {/* Grid lines and tick labels */}
              {ticks.map((tick, i) => (
                <g key={i}>
                  <line
                    className="tt-gridline"
                    x1={tick.x}
                    y1={AXIS_HEIGHT}
                    x2={tick.x}
                    y2={AXIS_HEIGHT + TRACK_HEIGHT}
                  />
                  <text className="tt-axis-label" x={tick.x + 4} y={AXIS_HEIGHT - 8}>
                    {tick.label}
                  </text>
                </g>
              ))}
              {/* Axis separator */}
              <line
                className="tt-axis-border"
                x1={0}
                y1={AXIS_HEIGHT}
                x2={svgWidth}
                y2={AXIS_HEIGHT}
              />
              {/* Gap indicators — proportional mode only */}
              {gaps.map((gap, i) => (
                <g
                  key={`gap-${i}`}
                  className="tt-gap"
                  aria-label={`Time gap: ${gap.labelText}`}
                >
                  <rect
                    className="tt-gap-band"
                    x={gap.x}
                    y={AXIS_HEIGHT}
                    width={Math.max(gap.width, 0)}
                    height={TRACK_HEIGHT}
                  />
                  <text
                    className="tt-gap-label"
                    x={gap.x + gap.width / 2}
                    y={AXIS_HEIGHT + TRACK_HEIGHT / 2 + 4}
                    textAnchor="middle"
                  >
                    ≈{gap.labelText}
                  </text>
                </g>
              ))}
              {/* Scene markers */}
              {placed.map(p => (
                <g
                  key={p.raw.id}
                  aria-label={`Scene: ${p.raw.title}${p.raw.date ? `, ${formatDisplayDate(p.raw.date)}` : ''}`}
                >
                  <line
                    className={`tt-slot-marker${!p.raw.date ? ' tt-slot-marker--undated' : ''}`}
                    x1={p.x}
                    y1={AXIS_HEIGHT + 6}
                    x2={p.x}
                    y2={AXIS_HEIGHT + TRACK_HEIGHT - 6}
                  />
                  <text className="tt-scene-label" x={p.x + 8} y={AXIS_HEIGHT + 22}>
                    {p.raw.title}
                  </text>
                  {p.raw.date && (
                    <text className="tt-scene-date" x={p.x + 8} y={AXIS_HEIGHT + 38}>
                      {formatDisplayDate(p.raw.date)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        )}
      </div>
      <div className="tt-status" aria-live="polite">
        {!loading && !error && scenes.length > 0 && (
          <span>
            {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
            {undatedCount > 0 ? ` · ${undatedCount} undated` : ''}
            {' · '}
            {spacingMode === 'uniform' ? 'Uniform spacing' : 'Proportional spacing'}
          </span>
        )}
      </div>
    </div>
  );
}
