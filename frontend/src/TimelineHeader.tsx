// SKY-2450 — Timeline header bar with zoom controls.
//
// Presentational: parent owns currentZoom; this component fires onZoomChange.
// Global keyboard shortcuts (Ctrl/Cmd + = / − / 0) and Ctrl/Cmd+wheel are
// registered on document so they work regardless of focus position.
import { useCallback, useEffect, useRef } from 'react';
import './TimelineHeader.css';

// Additive step per press / wheel tick (10% of the 1.0 default zoom level).
const ZOOM_STEP = 0.1;

export interface TimelineHeaderProps {
  /** Displayed as "Story Timeline: {title}". */
  title: string;
  /** 1.0 = default; 0.5 = half; 2.0 = double. */
  currentZoom: number;
  /** Minimum allowed zoom. Default: 0.5 */
  minZoom?: number;
  /** Maximum allowed zoom. Default: 3.0 */
  maxZoom?: number;
  onZoomChange: (newZoom: number) => void;
  onZoomFit: () => void;
}

export default function TimelineHeader({
  title,
  currentZoom,
  minZoom = 0.5,
  maxZoom = 3.0,
  onZoomChange,
  onZoomFit,
}: TimelineHeaderProps) {
  // Clamp helper
  const clamp = useCallback(
    (z: number) => Math.min(maxZoom, Math.max(minZoom, z)),
    [minZoom, maxZoom],
  );

  // Round to 1 decimal place to avoid floating-point drift (0.1 + 0.2 ≠ 0.3).
  const stepIn = useCallback(() => {
    onZoomChange(clamp(Math.round((currentZoom + ZOOM_STEP) * 10) / 10));
  }, [currentZoom, clamp, onZoomChange]);

  const stepOut = useCallback(() => {
    onZoomChange(clamp(Math.round((currentZoom - ZOOM_STEP) * 10) / 10));
  }, [currentZoom, clamp, onZoomChange]);

  // Stable refs so the document listener always calls the latest callbacks
  // without re-registering every time zoom changes.
  const stepInRef = useRef(stepIn);
  const stepOutRef = useRef(stepOut);
  const onZoomFitRef = useRef(onZoomFit);
  stepInRef.current = stepIn;
  stepOutRef.current = stepOut;
  onZoomFitRef.current = onZoomFit;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd shortcuts override browser zoom in an Electron app — intended.
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        stepInRef.current();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        stepOutRef.current();
      } else if (e.key === '0') {
        e.preventDefault();
        onZoomFitRef.current();
      }
    }

    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      // Prevent browser pinch-zoom (passive:false set below).
      e.preventDefault();
      if (e.deltaY < 0) stepInRef.current();
      else stepOutRef.current();
    }

    document.addEventListener('keydown', handleKeyDown);
    // non-passive so we can call preventDefault() on wheel events.
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
    };
  }, []); // empty: listeners are stable via refs

  const zoomPct = Math.round(currentZoom * 100);
  const canZoomIn = currentZoom < maxZoom;
  const canZoomOut = currentZoom > minZoom;

  return (
    <div
      className="tlh-root"
      role="toolbar"
      aria-label="Timeline controls"
      data-testid="timeline-header"
    >
      <span className="tlh-title" title={`Story Timeline: ${title}`}>
        Story Timeline: {title}
      </span>

      <div className="tlh-divider" aria-hidden="true" />

      <div className="tlh-zoom-group" role="group" aria-label="Zoom controls">
        <button
          type="button"
          className="tlh-zoom-btn"
          aria-label="Zoom out"
          title="Zoom out (Ctrl/Cmd −)"
          disabled={!canZoomOut}
          onClick={stepOut}
          data-testid="zoom-out-btn"
        >
          −
        </button>

        <span
          className="tlh-zoom-level"
          aria-live="polite"
          aria-label={`Zoom level ${zoomPct} percent`}
          data-testid="zoom-level"
        >
          {zoomPct}%
        </span>

        <button
          type="button"
          className="tlh-zoom-btn"
          aria-label="Zoom in"
          title="Zoom in (Ctrl/Cmd +)"
          disabled={!canZoomIn}
          onClick={stepIn}
          data-testid="zoom-in-btn"
        >
          +
        </button>

        <div className="tlh-zoom-sep" aria-hidden="true" />

        <button
          type="button"
          className="tlh-zoom-btn tlh-zoom-btn--fit"
          aria-label="Zoom to fit all scenes"
          title="Zoom to fit (Ctrl/Cmd 0)"
          onClick={onZoomFit}
          data-testid="zoom-fit-btn"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
