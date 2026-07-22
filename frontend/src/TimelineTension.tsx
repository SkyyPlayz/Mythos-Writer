// Beta 4 M24 (§8.5) — Tension: SVG dramatic-arc curve. One draggable point per
// chapter (0–100), a dashed non-interactive "classic arc" reference curve, and
// ACT I/II/III separators at 25%/75%. Reads/writes `timelines.json` through the
// same `timelinesUpsertItem` IPC path as Plotlines (TimelineTensionPoint, M24),
// so switching modes never loses or duplicates data (M24 AC7).
//
// A11y (docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md §2): each point is a
// `role="slider"` in a 1-D roving-tabindex row — `←/→` move focus chapter to
// chapter, `↑/↓` (`Shift+↑/↓` = ±10) adjust value, `Home`/`End` jump to the
// first/last chapter. Every keypress is itself the WCAG 2.5.7 drag equivalent.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TimelinesStore, TimelineTensionPoint } from './timelinesTypes';
import './TimelineTension.css';

export interface TensionChapterCell {
  isHere?: boolean;
}

export interface TimelineTensionProps {
  store: TimelinesStore;
  onStoreChange: (store: TimelinesStore) => void;
  chapters?: readonly TensionChapterCell[];
  onOpenChapterEvent?: (chapter: number) => void;
}

const VIEW_W = 960;
const VIEW_H = 320;
const PAD_X = 32;
const PAD_TOP = 20;
const PAD_BOTTOM = 40;

/** Classic Freytag dramatic-arc reference points (0–100 tension), sampled at
 *  10 fixed story-percent stops — a dashed guide, never persisted or dragged. */
const CLASSIC_ARC: readonly number[] = [10, 20, 35, 45, 55, 70, 90, 60, 35, 15];

function newItemId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

function xForChapter(chapter: number, chapterCount: number): number {
  const n = Math.max(1, chapterCount);
  const usable = VIEW_W - PAD_X * 2;
  if (n === 1) return PAD_X + usable / 2;
  return PAD_X + ((chapter - 1) / (n - 1)) * usable;
}

function yForValue(value: number): number {
  const usable = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const clamped = Math.max(0, Math.min(100, value));
  return PAD_TOP + usable * (1 - clamped / 100);
}

function valueForY(y: number): number {
  const usable = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const frac = 1 - (y - PAD_TOP) / usable;
  return Math.max(0, Math.min(100, Math.round(frac * 100)));
}

function smoothPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const mx = (p0.x + p1.x) / 2;
    d += ` Q ${p0.x} ${p0.y} ${mx} ${(p0.y + p1.y) / 2}`;
    d += ` Q ${mx} ${(p0.y + p1.y) / 2} ${p1.x} ${p1.y}`;
  }
  return d;
}

export default function TimelineTension({
  store,
  onStoreChange,
  chapters = [],
  onOpenChapterEvent,
}: TimelineTensionProps) {
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  const activeId = active?.id ?? '';
  const chapterCount = Math.max(chapters.length, 1);
  const chapterCols = Array.from({ length: chapterCount }, (_, i) => i + 1);

  const points = useMemo(
    () => (store.tensionPoints ?? []).filter((p) => p.timelineId === activeId),
    [store.tensionPoints, activeId],
  );
  const valueByChapter = useMemo(() => {
    const m = new Map<number, TimelineTensionPoint>();
    for (const p of points) m.set(p.chapter, p);
    return m;
  }, [points]);

  const [focusedChapter, setFocusedChapter] = useState(1);
  const [draggingChapter, setDraggingChapter] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const persistPoint = useCallback(
    (chapter: number, value: number) => {
      const api = window.api;
      if (typeof api?.timelinesUpsertItem !== 'function' || !activeId) return;
      const existing = valueByChapter.get(chapter);
      const item: TimelineTensionPoint = {
        id: existing?.id ?? newItemId('tension'),
        timelineId: activeId,
        chapter,
        value: Math.max(0, Math.min(100, Math.round(value))),
        source: 'manual',
      };
      api
        .timelinesUpsertItem({ type: 'tensionPoint', item })
        .then((res) => { if (res.ok) onStoreChange(res.store); })
        .catch(() => { /* keep the local copy — next load reconciles */ });
    },
    [activeId, valueByChapter, onStoreChange],
  );

  const handlePointerDown = useCallback(
    (chapter: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      setFocusedChapter(chapter);
      setDraggingChapter(chapter);
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingChapter == null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const svgY = ((e.clientY - rect.top) / rect.height) * VIEW_H;
      persistPoint(draggingChapter, valueForY(svgY));
    },
    [draggingChapter, persistPoint],
  );

  const handlePointerUp = useCallback(() => {
    setDraggingChapter(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      const current = valueByChapter.get(focusedChapter)?.value ?? 50;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusedChapter((c) => Math.max(1, c - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusedChapter((c) => Math.min(chapterCount, c + 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedChapter(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocusedChapter(chapterCount);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        persistPoint(focusedChapter, current + step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        persistPoint(focusedChapter, current - step);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpenChapterEvent?.(focusedChapter);
      }
    },
    [chapterCount, focusedChapter, valueByChapter, persistPoint, onOpenChapterEvent],
  );

  const yourPoints = chapterCols.map((ch) => ({
    x: xForChapter(ch, chapterCount),
    y: yForValue(valueByChapter.get(ch)?.value ?? 50),
  }));
  const yourPath = smoothPath(yourPoints);

  const classicPoints = Array.from({ length: chapterCount }, (_, i) => {
    const frac = chapterCount === 1 ? 0 : i / (chapterCount - 1);
    const idx = frac * (CLASSIC_ARC.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(CLASSIC_ARC.length - 1, lo + 1);
    const t = idx - lo;
    const value = CLASSIC_ARC[lo] * (1 - t) + CLASSIC_ARC[hi] * t;
    return { x: xForChapter(i + 1, chapterCount), y: yForValue(value) };
  });
  const classicPath = smoothPath(classicPoints);

  const actX = (pct: number) => PAD_X + (VIEW_W - PAD_X * 2) * pct;

  if (points.length === 0) {
    return (
      <div className="tlt-root" data-testid="timeline-tension" role="region" aria-label="Tension curve">
        <div
          className="tlt-empty"
          data-testid="timeline-tension-empty"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <h2>No tension data yet</h2>
          <p>Drag a point on any chapter to start plotting your story&rsquo;s rise and fall.</p>
        </div>
        {renderCurve()}
      </div>
    );
  }

  return (
    <div className="tlt-root" data-testid="timeline-tension" role="region" aria-label="Tension curve">
      {renderCurve()}
    </div>
  );

  function renderCurve() {
    return (
      <>
        <svg
          ref={svgRef}
          className="tlt-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          data-testid="tlt-svg"
        >
          {/* ACT separators at 25% / 75% (§2) — dashed rule + text label, never color-only. */}
          {[
            { pct: 0, label: 'ACT I' },
            { pct: 0.25, label: 'ACT II' },
            { pct: 0.75, label: 'ACT III' },
          ].map((act) => (
            <g key={act.label} data-testid={`tlt-act-${act.label.replace(' ', '-')}`}>
              {act.pct > 0 && (
                <line
                  x1={actX(act.pct)}
                  y1={PAD_TOP}
                  x2={actX(act.pct)}
                  y2={VIEW_H - PAD_BOTTOM}
                  className="tlt-act-line"
                  aria-hidden="true"
                />
              )}
              <text
                x={actX(act.pct) + 6}
                y={PAD_TOP + 14}
                className="tlt-act-label"
              >
                {act.label}
              </text>
            </g>
          ))}

          {/* Classic dramatic arc — dashed reference, non-interactive. */}
          <path
            d={classicPath}
            className="tlt-classic-path"
            fill="none"
            aria-hidden="true"
            data-testid="tlt-classic-path"
          />

          {/* Your story's curve — solid, draggable points. */}
          <path d={yourPath} className="tlt-story-path" fill="none" data-testid="tlt-story-path" />

          {chapterCols.map((ch) => {
            const value = valueByChapter.get(ch)?.value ?? 50;
            const x = xForChapter(ch, chapterCount);
            const y = yForValue(value);
            return (
              <circle
                key={ch}
                cx={x}
                cy={y}
                r={7}
                className={`tlt-point${focusedChapter === ch ? ' tlt-point--focused' : ''}`}
                tabIndex={focusedChapter === ch ? 0 : -1}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                aria-valuetext={`Chapter ${ch}: tension ${value}`}
                onPointerDown={handlePointerDown(ch)}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocusedChapter(ch)}
                data-testid={`tlt-point-${ch}`}
              />
            );
          })}
        </svg>

        <div className="tlt-legend" data-testid="tlt-legend">
          <span className="tlt-legend-item">
            <span className="tlt-legend-swatch tlt-legend-swatch--solid" aria-hidden="true" />
            your story
          </span>
          <span className="tlt-legend-item">
            <span className="tlt-legend-swatch tlt-legend-swatch--dashed" aria-hidden="true" />
            classic arc
          </span>
        </div>
      </>
    );
  }
}
