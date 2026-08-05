// Beta 4 M7 / M1-S3 — Margin ruler (§5.1, plan §M1 row 6): the thin ruler
// strip under the format toolbar. ONE ruler, TWO diamond pairs on the same
// track: the OUTER pair drags the page width, the INNER pair drags the page
// margins. The pairs are locked — margins are absolute px anchored to the page
// edges, so dragging the outer diamonds moves the page and carries the margin
// diamonds with it while the margin value never changes. Ticks every 24px
// (major every 120px), end stops + a glowing span the width of the page. Live
// values render as the page-corner badge (ManuscriptView), fed via onDragLive.
// When the comments gutter is open, the ruler reserves its width so it stays
// centered over the page column instead of the full row.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { PAGE_MARGIN_MIN, clampPageMargin, maxPageMargin } from '../theme';
import './MarginRuler.css';

const DEFAULT_MIN = 520;
const DEFAULT_MAX = 3000;
const MINOR_TICK = 24;
const MAJOR_TICK = 120;
/** Nudge step for keyboard resize — matches the sheet edge-drag's arrow-key step. */
const KEY_STEP = 20;
/** Keyboard nudge for the margin diamonds — finer, margins are a smaller range. */
const MARGIN_KEY_STEP = 4;
/**
 * Matches CommentsGutter's `.msv-gutter` width exactly — reserving anything
 * else would leave the ruler drifting off-center from the page column it sits
 * above once the gutter opens.
 */
export const MARGIN_RULER_GUTTER_WIDTH = 236;

/** A live diamond drag, for the page-corner value badge (plan §M1 row 6). */
export interface RulerDrag {
  kind: 'width' | 'margin';
  px: number;
}

export interface MarginRulerProps {
  /** Current page (sheet) width in px — drives the glowing span + outer pair. */
  pageWidth: number;
  /** Current page margin in px (absolute, symmetric) — drives the inner pair. */
  marginPx: number;
  /** Clamp range, px. Defaults match the manuscript sheet's 520–3000 range. */
  min?: number;
  max?: number;
  /** True while the comments gutter dock is open (§5.1 "gutter-aware"). */
  gutterOpen?: boolean;
  /** Fired continuously while an outer (page-width) handle is being dragged. */
  onChange: (px: number) => void;
  /** Fired once on outer-handle drag release or a keyboard nudge. */
  onCommit: (px: number) => void;
  /** Fired continuously while an inner (margin) handle is being dragged. */
  onMarginChange?: (px: number) => void;
  /** Fired once on inner-handle drag release or a keyboard nudge. */
  onMarginCommit?: (px: number) => void;
  /** Live drag state for the page-corner badge; null on release. */
  onDragLive?: (drag: RulerDrag | null) => void;
}

export default function MarginRuler({
  pageWidth,
  marginPx,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  gutterOpen = false,
  onChange,
  onCommit,
  onMarginChange,
  onMarginCommit,
  onDragLive,
}: MarginRulerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Local live values track a drag in progress; otherwise they mirror the
  // props so external changes (popover, sheet-edge drag) move the ruler too.
  const [liveWidth, setLiveWidth] = useState(pageWidth);
  const [liveMargin, setLiveMargin] = useState(marginPx);

  useEffect(() => {
    if (!dragging) setLiveWidth(pageWidth);
  }, [pageWidth, dragging]);

  useEffect(() => {
    if (!dragging) setLiveMargin(marginPx);
  }, [marginPx, dragging]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setTrackWidth(w);
    });
    ro.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const clamp = useCallback((w: number) => Math.max(min, Math.min(max, w)), [min, max]);

  // Same symmetric-resize math as the sheet's own edge drag (ManuscriptView
  // startEdgeDrag): the page is centered, so each handle moves the width by
  // twice the pointer delta, signed per side.
  const startHandleDrag = useCallback(
    (side: 1 | -1) => (e: ReactMouseEvent) => {
      e.preventDefault();
      const sx = e.clientX;
      const sw = pageWidth;
      setDragging(true);
      const move = (ev: MouseEvent) => {
        const next = clamp(sw + (ev.clientX - sx) * side * 2);
        setLiveWidth(next);
        onChange(next);
        onDragLive?.({ kind: 'width', px: Math.round(next) });
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDragging(false);
        onDragLive?.(null);
        onCommit(clamp(sw + (ev.clientX - sx) * side * 2));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [pageWidth, clamp, onChange, onCommit, onDragLive]
  );

  // Inner pair: one symmetric margin value, two handles. Dragging a handle
  // toward the page center grows the margin; the width never changes.
  const startMarginDrag = useCallback(
    (side: 1 | -1) => (e: ReactMouseEvent) => {
      e.preventDefault();
      const sx = e.clientX;
      const sm = marginPx;
      setDragging(true);
      const move = (ev: MouseEvent) => {
        const next = clampPageMargin(sm + (ev.clientX - sx) * side, pageWidth);
        setLiveMargin(next);
        onMarginChange?.(next);
        onDragLive?.({ kind: 'margin', px: next });
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDragging(false);
        onDragLive?.(null);
        onMarginCommit?.(clampPageMargin(sm + (ev.clientX - sx) * side, pageWidth));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [marginPx, pageWidth, onMarginChange, onMarginCommit, onDragLive]
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        onCommit(clamp(pageWidth + KEY_STEP));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        onCommit(clamp(pageWidth - KEY_STEP));
      }
    },
    [pageWidth, clamp, onCommit]
  );

  const marginKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        onMarginCommit?.(clampPageMargin(marginPx + MARGIN_KEY_STEP, pageWidth));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        onMarginCommit?.(clampPageMargin(marginPx - MARGIN_KEY_STEP, pageWidth));
      }
    },
    [marginPx, pageWidth, onMarginCommit]
  );

  const spanLeft = (trackWidth - liveWidth) / 2;
  const spanRight = spanLeft + liveWidth;
  // Locked pairs: the margin diamonds sit at (page edge + margin), so an outer
  // drag carries them while liveMargin stays put — clamped down only when the
  // live width no longer fits the stored margin.
  const shownMargin = Math.min(liveMargin, maxPageMargin(liveWidth));
  const valueNow = Math.round(liveWidth);
  const handleProps = (side: 1 | -1, edge: number) => ({
    className: `mgr-handle mgr-handle--${side < 0 ? 'l' : 'r'}`,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': 'Drag to resize page width',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': valueNow,
    'aria-valuetext': `${valueNow} px page`,
    style: { left: edge },
    onMouseDown: startHandleDrag(side),
    onKeyDown: handleKeyDown,
  });
  // visSide is which page edge the handle sits on; dragging toward the page
  // center (right from the left edge, left from the right edge) grows the
  // margin, so the drag sign is the opposite of the width handles'.
  const marginHandleProps = (visSide: 'l' | 'r', edge: number) => ({
    className: `mgr-handle mgr-handle--margin mgr-handle--${visSide}`,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': 'Drag to adjust margins',
    'aria-valuemin': PAGE_MARGIN_MIN,
    'aria-valuemax': maxPageMargin(liveWidth),
    'aria-valuenow': shownMargin,
    'aria-valuetext': `${shownMargin} px margin`,
    style: { left: edge },
    onMouseDown: startMarginDrag(visSide === 'l' ? 1 : -1),
    onKeyDown: marginKeyDown,
  });

  return (
    <div
      className="mgr-root"
      data-testid="margin-ruler"
      style={gutterOpen ? { marginRight: MARGIN_RULER_GUTTER_WIDTH } : undefined}
    >
      <div className="mgr-track" ref={trackRef} data-testid="margin-ruler-track">
        <div
          className="mgr-ticks"
          aria-hidden="true"
          style={{
            backgroundImage:
              `repeating-linear-gradient(90deg, rgba(255,255,255,.42) 0 1.5px, transparent 1.5px ${MAJOR_TICK}px),` +
              `repeating-linear-gradient(90deg, rgba(255,255,255,.16) 0 1px, transparent 1px ${MINOR_TICK}px)`,
          }}
        />
        <div className="mgr-endstop mgr-endstop--l" style={{ left: spanLeft }} aria-hidden="true" />
        <div className="mgr-endstop mgr-endstop--r" style={{ left: spanRight }} aria-hidden="true" />
        <div className="mgr-span" style={{ left: spanLeft, width: liveWidth }} aria-hidden="true" />
        <div data-testid="margin-ruler-handle-l" {...handleProps(-1, spanLeft)} />
        <div data-testid="margin-ruler-handle-r" {...handleProps(1, spanRight)} />
        <div
          data-testid="margin-ruler-margin-handle-l"
          {...marginHandleProps('l', spanLeft + shownMargin)}
        />
        <div
          data-testid="margin-ruler-margin-handle-r"
          {...marginHandleProps('r', spanRight - shownMargin)}
        />
      </div>
    </div>
  );
}
