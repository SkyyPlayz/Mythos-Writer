// SKY-2450 — Timeline header bar with zoom controls.
// SKY-3185 — F5: Spreadsheet|Track segmented toggle + grouping dropdown.
//
// Presentational: parent owns currentZoom, viewMode, and groupBy.
// Global keyboard shortcuts (Ctrl/Cmd + = / − / 0) and Ctrl/Cmd+wheel are
// registered on document so they work regardless of focus position.
import { useCallback, useEffect, useRef } from 'react';
import type { TimelineViewMode, TimelineGroupBy } from './timelineFilters';
import './TimelineHeader.css';

// Additive step per press / wheel tick (10% of the 1.0 default zoom level).
const ZOOM_STEP = 0.1;

const GROUP_BY_OPTIONS: { value: TimelineGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arc', label: 'Arc' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'character', label: 'Character' },
  { value: 'location', label: 'Location' },
];

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
  /** F5 — active view mode; omit to hide the view switcher. */
  viewMode?: TimelineViewMode;
  /** F5 — called when the user switches between Spreadsheet and Track. */
  onViewModeChange?: (mode: TimelineViewMode) => void;
  /** F5 — active grouping; omit to hide the grouping control. */
  groupBy?: TimelineGroupBy;
  /** F5 — called when the user changes the grouping. */
  onGroupByChange?: (groupBy: TimelineGroupBy) => void;
}

export default function TimelineHeader({
  title,
  currentZoom,
  minZoom = 0.5,
  maxZoom = 3.0,
  onZoomChange,
  onZoomFit,
  viewMode,
  onViewModeChange,
  groupBy,
  onGroupByChange,
}: TimelineHeaderProps) {
  const clamp = useCallback(
    (z: number) => Math.min(maxZoom, Math.max(minZoom, z)),
    [minZoom, maxZoom],
  );

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
      e.preventDefault();
      if (e.deltaY < 0) stepInRef.current();
      else stepOutRef.current();
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const zoomPct = Math.round(currentZoom * 100);
  const canZoomIn = currentZoom < maxZoom;
  const canZoomOut = currentZoom > minZoom;

  const showViewSwitcher = viewMode !== undefined && onViewModeChange !== undefined;
  const showGroupBy = groupBy !== undefined && onGroupByChange !== undefined;

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

      {/* F5 — Spreadsheet | Track segmented toggle */}
      {showViewSwitcher && (
        <>
          <div className="tlh-divider" aria-hidden="true" />
          <div
            className="tlh-view-toggle"
            role="group"
            aria-label="View mode"
            data-testid="view-mode-toggle"
          >
            <button
              type="button"
              className={`tlh-view-btn${viewMode === 'spreadsheet' ? ' tlh-view-btn--active' : ''}`}
              aria-pressed={viewMode === 'spreadsheet'}
              onClick={() => onViewModeChange?.('spreadsheet')}
              data-testid="view-mode-spreadsheet"
            >
              Spreadsheet
            </button>
            <button
              type="button"
              className={`tlh-view-btn${viewMode === 'track' ? ' tlh-view-btn--active' : ''}`}
              aria-pressed={viewMode === 'track'}
              onClick={() => onViewModeChange?.('track')}
              data-testid="view-mode-track"
            >
              Track
            </button>
          </div>
        </>
      )}

      {/* F5 — Grouping selector */}
      {showGroupBy && (
        <>
          <div className="tlh-divider" aria-hidden="true" />
          <div className="tlh-group-by" role="group" aria-label="Group scenes by">
            <label className="tlh-group-label" htmlFor="tlh-group-select">
              Group:
            </label>
            <select
              id="tlh-group-select"
              className="tlh-group-select"
              value={groupBy}
              onChange={e => onGroupByChange?.(e.target.value as TimelineGroupBy)}
              aria-label="Group scenes by"
              data-testid="groupby-select"
            >
              {GROUP_BY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

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
