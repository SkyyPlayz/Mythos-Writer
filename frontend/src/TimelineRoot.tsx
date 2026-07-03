// SKY-3185 — F5: TimelineRoot — single entry point for the Timeline view.
//
// Owns: viewMode ('spreadsheet' | 'aeon' | 'track' — the three surfaces that
//       exist today), groupBy (none/arc/chapter/character/location), the
//       cross-view selectedIds, and header zoom for the non-track views.
// The Spreadsheet|AEON|AEON Track segmented toggle + grouping select render via
// TimelineHeader's F5 props. TrackTimeline mounts its own TimelineHeader (its
// zoom is the track viewport), so in track mode the switcher props are forwarded
// into it instead of mounting a second header here.
// viewMode + groupBy persist to localStorage so they survive app restarts.
import { useState, useCallback } from 'react';
import type { Story } from './types';
import {
  type TimelineViewMode,
  type TimelineGroupBy,
  VALID_TIMELINE_VIEW_MODES,
  VALID_TIMELINE_GROUP_BYS,
} from './timelineFilters';
import TimelineHeader from './TimelineHeader';
import TimelineSpreadsheet from './TimelineSpreadsheet';
import AeonLaneView from './AeonLaneView';
import TrackTimeline from './TrackTimeline';
import './TimelineRoot.css';

const STORAGE_KEY_MODE = 'timeline:viewMode';
const STORAGE_KEY_GROUP = 'timeline:groupBy';

/** Read the persisted view mode; unknown/absent values fall back to 'spreadsheet'. */
function readStoredViewMode(): TimelineViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_MODE);
    if (v && (VALID_TIMELINE_VIEW_MODES as readonly string[]).includes(v)) {
      return v as TimelineViewMode;
    }
  } catch {
    // localStorage unavailable — use the default
  }
  return 'spreadsheet';
}

/** Read the persisted grouping; unknown/absent values fall back to 'none'. */
function readStoredGroupBy(): TimelineGroupBy {
  try {
    const v = localStorage.getItem(STORAGE_KEY_GROUP);
    if (v && (VALID_TIMELINE_GROUP_BYS as readonly string[]).includes(v)) {
      return v as TimelineGroupBy;
    }
  } catch {
    // localStorage unavailable — use the default
  }
  return 'none';
}

interface Props {
  story: Story | null;
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineRoot({ story, onOpenScene }: Props) {
  // Lazy init so localStorage is read once per mount, not on every render.
  const [viewMode, setViewModeState] = useState<TimelineViewMode>(readStoredViewMode);
  const [groupBy, setGroupByState] = useState<TimelineGroupBy>(readStoredGroupBy);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Header zoom for the non-track views (track owns its viewport zoom).
  const [zoom, setZoom] = useState(1.0);

  const handleViewModeChange = useCallback((mode: TimelineViewMode) => {
    setViewModeState(mode);
    // Clear the selection on view switch so no stale cross-view state lingers.
    setSelectedIds(new Set());
    try { localStorage.setItem(STORAGE_KEY_MODE, mode); } catch { /* ignore quota errors */ }
  }, []);

  const handleGroupByChange = useCallback((g: TimelineGroupBy) => {
    setGroupByState(g);
    try { localStorage.setItem(STORAGE_KEY_GROUP, g); } catch { /* ignore quota errors */ }
  }, []);

  const handleZoomFit = useCallback(() => setZoom(1.0), []);

  return (
    <div className="tlr-root" data-testid="timeline-root">
      {viewMode !== 'track' && (
        <TimelineHeader
          title={story?.title ?? ''}
          currentZoom={zoom}
          onZoomChange={setZoom}
          onZoomFit={handleZoomFit}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          groupBy={groupBy}
          onGroupByChange={handleGroupByChange}
        />
      )}

      <div className="tlr-body">
        {viewMode === 'spreadsheet' && (
          <TimelineSpreadsheet
            story={story}
            onOpenScene={onOpenScene}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            groupBy={groupBy}
            onGroupByChange={handleGroupByChange}
          />
        )}
        {viewMode === 'aeon' && (
          <AeonLaneView
            story={story}
            onOpenScene={onOpenScene}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        )}
        {viewMode === 'track' && (
          <TrackTimeline
            story={story}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            groupBy={groupBy}
            onGroupByChange={handleGroupByChange}
          />
        )}
      </div>
    </div>
  );
}
