// SKY-3185 — F5: TimelineRoot — view switcher + grouping container.
//
// Owns: viewMode ('spreadsheet'|'track'), groupBy (arc/chapter/character/location/none),
//       and selectedIds (shared across both views for selection sync).
// Persists viewMode + groupBy to localStorage so settings survive app restarts.
import { useState, useCallback, useMemo } from 'react';
import type { Story } from './types';
import type { TimelineViewMode, TimelineGroupBy } from './timelineFilters';
import { VALID_TIMELINE_GROUP_BYS } from './timelineFilters';
import TimelineHeader from './TimelineHeader';
import TimelineSpreadsheet from './TimelineSpreadsheet';
import AeonLaneView from './AeonLaneView';
import './TimelineRoot.css';

const STORAGE_KEY_MODE = 'timeline:viewMode';
const STORAGE_KEY_GROUP = 'timeline:groupBy';

function readStoredMode(): TimelineViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_MODE);
    return v === 'track' ? 'track' : 'spreadsheet';
  } catch {
    return 'spreadsheet';
  }
}

function readStoredGroupBy(): TimelineGroupBy {
  try {
    const v = localStorage.getItem(STORAGE_KEY_GROUP);
    if (v && (VALID_TIMELINE_GROUP_BYS as string[]).includes(v)) {
      return v as TimelineGroupBy;
    }
  } catch {
    // ignore
  }
  return 'none';
}

interface Props {
  story: Story | null;
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineRoot({ story, onOpenScene }: Props) {
  const [viewMode, setViewModeState] = useState<TimelineViewMode>(readStoredMode);
  const [groupBy, setGroupByState] = useState<TimelineGroupBy>(readStoredGroupBy);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Zoom state — shared so the header zoom controls work for both views.
  const [zoom, setZoom] = useState(1.0);

  const handleViewModeChange = useCallback((mode: TimelineViewMode) => {
    setViewModeState(mode);
    // Clear selection on view switch to prevent stale cross-view state.
    setSelectedIds(new Set());
    try { localStorage.setItem(STORAGE_KEY_MODE, mode); } catch { /* ignore */ }
  }, []);

  const handleGroupByChange = useCallback((g: TimelineGroupBy) => {
    setGroupByState(g);
    try { localStorage.setItem(STORAGE_KEY_GROUP, g); } catch { /* ignore */ }
  }, []);

  const handleZoomFit = useCallback(() => setZoom(1.0), []);

  // Memoised so child views don't re-render on unrelated state changes.
  const selectedIdsMemo = useMemo(() => selectedIds, [selectedIds]);

  return (
    <div className="tlr-root" data-testid="timeline-root">
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

      <div className="tlr-body">
        {viewMode === 'spreadsheet' ? (
          <TimelineSpreadsheet
            story={story}
            onOpenScene={onOpenScene}
            selectedIds={selectedIdsMemo}
            onSelectionChange={setSelectedIds}
            groupByProp={groupBy}
            onGroupByChange={handleGroupByChange}
          />
        ) : (
          <AeonLaneView
            story={story}
            onOpenScene={onOpenScene}
            selectedIds={selectedIdsMemo}
            onSelectionChange={setSelectedIds}
          />
        )}
      </div>
    </div>
  );
}
