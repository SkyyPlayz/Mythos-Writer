// Beta 4 M7 — Margin ruler (§5.1): the thin ruler strip under the format
// toolbar that visualizes and resizes the manuscript sheet's page width.
//
// Ticks every 24px (major every 120px), end stops + a glowing slot-A span the
// width of the page, two slot-B diamond handles that drag the page width
// symmetrically (same math as the sheet's own edge-drag), and a live "1000 px"
// readout that floats above the span's right edge while dragging. When the
// comments gutter is open, the ruler reserves its width so it stays centered
// over the page column instead of the full row.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import './MarginRuler.css';

const DEFAULT_MIN = 520;
const DEFAULT_MAX = 3000;
const MINOR_TICK = 24;
const MAJOR_TICK = 120;
/** Nudge step for keyboard resize — matches the sheet edge-drag's arrow-key step. */
const KEY_STEP = 20;
/**
 * Matches CommentsGutter's `.msv-gutter` width exactly — reserving anything
 * else would leave the ruler drifting off-center from the page column it sits
 * above once the gutter opens.
 */
export const MARGIN_RULER_GUTTER_WIDTH = 236;

export interface MarginRulerProps {
  /** Current page (sheet) width in px — drives the glowing span + readout. */
  pageWidth: number;
  /** Clamp range, px. Defaults match the manuscript sheet's 520–3000 range. */
  min?: number;
  max?: number;
  /** True while the comments gutter dock is open (§5.1 "gutter-aware"). */
  gutterOpen?: boolean;
  /** Fired continuously while a handle is being dragged. */
  onChange: (px: number) => void;
  /** Fired once on drag release or a keyboard nudge. */
  onCommit: (px: number) => void;
}

export default function MarginRuler({
  pageWidth,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  gutterOpen = false,
  onChange,
  onCommit,
}: MarginRulerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Local live value tracks the drag in progress; otherwise mirrors the prop
  // so external width changes (slider, sheet-edge drag) move the ruler too.
  const [liveWidth, setLiveWidth] = useState(pageWidth);

  useEffect(() => {
    if (!dragging) setLiveWidth(pageWidth);
  }, [pageWidth, dragging]);

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
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDragging(false);
        onCommit(clamp(sw + (ev.clientX - sx) * side * 2));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [pageWidth, clamp, onChange, onCommit]
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

  const spanLeft = (trackWidth - liveWidth) / 2;
  const spanRight = spanLeft + liveWidth;
  const valueNow = Math.round(liveWidth);
  const handleProps = (side: 1 | -1, edge: number) => ({
    className: `mgr-handle mgr-handle--${side < 0 ? 'l' : 'r'}`,
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': 'Drag to resize page width',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': valueNow,
    'aria-valuetext': `${valueNow} px`,
    style: { left: edge },
    onMouseDown: startHandleDrag(side),
    onKeyDown: handleKeyDown,
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
        {dragging && (
          <div className="mgr-readout" data-testid="margin-ruler-readout" style={{ left: spanRight }}>
            {valueNow} px
          </div>
        )}
      </div>
    </div>
  );
}
