// SKY-3185 — F5: TimelineRoot — single entry point for the Timeline view.
// Beta 3 M20 — Timeline v2 (Aeon-class): the switcher grows to the prototype's
// five modes — Plan vs Progress / Structure / Spreadsheet / Relationships /
// Subway (prototype `tlModeSeg`, 4571 / template 1443–1595).
//
// Owns: viewMode, groupBy (none/arc/chapter/character/location), the
// cross-view selectedIds, the Aeon zoom level (Year…Scene) and the shared
// Aeon timeline data. The Spreadsheet keeps loading its own data (unchanged
// Beta-2 surface); the four Aeon views render from one derived dataset so all
// five views show the same event data.
// viewMode + groupBy persist to localStorage; legacy Beta-2 modes ('aeon',
// 'track') migrate to their successors on read.
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Story } from './types';
import {
  type TimelineGroupBy,
  VALID_TIMELINE_GROUP_BYS,
} from './timelineFilters';
import {
  type TimelineMode,
  type TimelineZoom,
  type AeonTimelineData,
  VALID_TIMELINE_ZOOMS,
  TIMELINE_ZOOM_LABELS,
  EMPTY_AEON_DATA,
  resolveTimelineMode,
  deriveAeonTimeline,
} from './timelineAeon';
import TimelineSpreadsheet from './TimelineSpreadsheet';
import TimelineLanes from './TimelineLanes';
import TimelineRelationships from './TimelineRelationships';
import TimelineSubway from './TimelineSubway';
import './TimelineRoot.css';

const STORAGE_KEY_MODE = 'timeline:viewMode';
const STORAGE_KEY_GROUP = 'timeline:groupBy';

/** Prototype mode segment labels (4571). */
const MODE_OPTIONS: { value: TimelineMode; label: string }[] = [
  { value: 'progress', label: 'Plan vs Progress' },
  { value: 'structure', label: 'Structure' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'relations', label: 'Relationships' },
  { value: 'subway', label: 'Subway' },
];

const GROUP_BY_OPTIONS: { value: TimelineGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arc', label: 'Arc' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'character', label: 'Character' },
  { value: 'location', label: 'Location' },
];

/** Read the persisted view mode; legacy Beta-2 values ('aeon' → progress,
 *  'track' → subway) migrate, unknown/absent values fall back to 'spreadsheet'. */
function readStoredViewMode(): TimelineMode {
  try {
    return resolveTimelineMode(localStorage.getItem(STORAGE_KEY_MODE)) ?? 'spreadsheet';
  } catch {
    // localStorage unavailable — use the default
    return 'spreadsheet';
  }
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
  const [viewMode, setViewModeState] = useState<TimelineMode>(readStoredViewMode);
  const [groupBy, setGroupByState] = useState<TimelineGroupBy>(readStoredGroupBy);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<TimelineZoom>('month');
  // Bumped by the "Today" jump; TimelineLanes scrolls the here-chapter into view.
  const [todaySignal, setTodaySignal] = useState(0);

  // ── Shared Aeon data (progress / structure / relations / subway) ──
  const [aeonData, setAeonData] = useState<AeonTimelineData>(EMPTY_AEON_DATA);
  const [aeonLoading, setAeonLoading] = useState(false);
  const [aeonError, setAeonError] = useState<string | null>(null);

  const api = window.api;

  useEffect(() => {
    if (!story) {
      setAeonData(EMPTY_AEON_DATA);
      setAeonError(null);
      return;
    }
    let cancelled = false;
    setAeonLoading(true);
    setAeonError(null);

    const entityList = api.entityList;
    Promise.all([
      api.timelineGetScenes(story.id),
      api.timelineListArcs(),
      entityList('character').catch(() => ({ entities: [] })),
      entityList('event').catch(() => ({ entities: [] })),
      entityList('concept').catch(() => ({ entities: [] })),
    ])
      .then(([scenesResp, arcsResp, charsResp, eventsResp, conceptsResp]) => {
        if (cancelled) return;
        const toEntity = (e: { id: string; name: string; tags?: string[] }) => ({
          id: e.id,
          name: e.name,
          detail: e.tags?.length ? e.tags.join(', ') : undefined,
        });
        setAeonData(deriveAeonTimeline({
          storyTitle: story.title,
          scenes: (scenesResp.scenes ?? []).map(s => ({
            id: s.id,
            title: s.title,
            chapterId: s.chapterId ?? '',
            date: s.chronologicalTime?.date ?? '',
            wordCount: s.timelineMetadata?.wordCount ?? null,
            pov: s.timelineMetadata?.pov ?? '',
            mood: s.timelineMetadata?.mood ?? '',
            arcIds: s.entityLinks?.arcs ?? [],
            characterIds: s.entityLinks?.characterIds ?? [],
          })),
          chapters: (story.chapters ?? []).map(ch => ({ id: ch.id, title: ch.title })),
          arcs: (arcsResp.arcs ?? []).map(a => ({ id: a.id, title: a.title, color: a.color })),
          characters: (charsResp.entities ?? []).map(toEntity),
          worldEvents: (eventsResp.entities ?? []).map(toEntity),
          concepts: (conceptsResp.entities ?? []).map(toEntity),
        }));
      })
      .catch(err => { if (!cancelled) setAeonError(String(err)); })
      .finally(() => { if (!cancelled) setAeonLoading(false); });

    return () => { cancelled = true; };
  }, [story, api]);

  const handleViewModeChange = useCallback((mode: TimelineMode) => {
    setViewModeState(mode);
    // Clear the selection on view switch so no stale cross-view state lingers.
    setSelectedIds(new Set());
    try { localStorage.setItem(STORAGE_KEY_MODE, mode); } catch { /* ignore quota errors */ }
  }, []);

  const handleGroupByChange = useCallback((g: TimelineGroupBy) => {
    setGroupByState(g);
    try { localStorage.setItem(STORAGE_KEY_GROUP, g); } catch { /* ignore quota errors */ }
  }, []);

  // Prototype `tlToday` (4701): lanes modes jump to Plan vs Progress; the
  // sheet / relations / subway surfaces keep their mode.
  const handleToday = useCallback(() => {
    setViewModeState(prev => {
      const next: TimelineMode =
        prev === 'spreadsheet' || prev === 'relations' || prev === 'subway' ? prev : 'progress';
      try { localStorage.setItem(STORAGE_KEY_MODE, next); } catch { /* ignore quota errors */ }
      return next;
    });
    setTodaySignal(n => n + 1);
  }, []);

  const isLanesMode = viewMode === 'progress' || viewMode === 'structure';
  const isAeonMode = viewMode !== 'spreadsheet';

  const legend = useMemo(() => {
    if (viewMode !== 'progress') return null;
    return (
      <span className="tlr-legend" data-testid="tl-legend">
        <span className="tlr-legend-item">
          <span className="tlr-legend-swatch tlr-legend-swatch--written" aria-hidden="true" />
          written
        </span>
        <span className="tlr-legend-item">
          <span className="tlr-legend-swatch tlr-legend-swatch--planned" aria-hidden="true" />
          planned from your notes
        </span>
        {aeonData.hereLabel && (
          <span className="tlr-legend-item">
            <span className="tlr-legend-swatch tlr-legend-swatch--here" aria-hidden="true" />
            you are here · {aeonData.hereLabel}
          </span>
        )}
      </span>
    );
  }, [viewMode, aeonData.hereLabel]);

  return (
    <div className="tlr-root" data-testid="timeline-root">
      {/* ── Header: mode segment + legend + group + zoom + Today (1446–1466) ── */}
      <div
        className="tlr-header"
        role="toolbar"
        aria-label="Timeline controls"
        data-testid="timeline-header"
      >
        <span className="tlr-title" title={story ? `Timeline: ${story.title}` : 'Timeline'}>
          Timeline
        </span>

        <div
          className="tlr-seg"
          role="group"
          aria-label="Timeline view mode"
          data-testid="view-mode-toggle"
        >
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`tlr-seg-btn${viewMode === opt.value ? ' tlr-seg-btn--active' : ''}`}
              aria-pressed={viewMode === opt.value}
              onClick={() => handleViewModeChange(opt.value)}
              data-testid={`view-mode-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {legend}

        <div className="tlr-spacer" aria-hidden="true" />

        <div className="tlr-group-by" role="group" aria-label="Group scenes by">
          <label className="tlr-group-label" htmlFor="tlr-group-select">
            Group:
          </label>
          <select
            id="tlr-group-select"
            className="tlr-group-select"
            value={groupBy}
            onChange={e => handleGroupByChange(e.target.value as TimelineGroupBy)}
            data-testid="groupby-select"
          >
            {GROUP_BY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div
          className="tlr-seg"
          role="group"
          aria-label="Timeline zoom"
          data-testid="tl-zoom-seg"
        >
          {VALID_TIMELINE_ZOOMS.map(z => (
            <button
              key={z}
              type="button"
              className={`tlr-seg-btn${zoom === z ? ' tlr-seg-btn--active' : ''}`}
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              data-testid={`tl-zoom-${z}`}
            >
              {TIMELINE_ZOOM_LABELS[z]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="tlr-today-btn"
          onClick={handleToday}
          data-testid="tl-today-btn"
        >
          Today
        </button>
      </div>

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

        {isAeonMode && !story && (
          <div className="tlr-state" data-testid="tlr-no-story">
            <h2>Select a story to view its timeline.</h2>
          </div>
        )}
        {isAeonMode && story && aeonLoading && (
          <div className="tlr-state" role="status" aria-label="Loading timeline">
            <p>Loading timeline…</p>
          </div>
        )}
        {isAeonMode && story && !aeonLoading && aeonError && (
          <div className="tlr-state" role="alert">
            <h2>Timeline unavailable</h2>
            <p className="tlr-state-error">{aeonError}</p>
          </div>
        )}

        {story && !aeonLoading && !aeonError && (
          <>
            {isLanesMode && (
              <TimelineLanes
                data={aeonData}
                mode={viewMode as 'progress' | 'structure'}
                zoom={zoom}
                onOpenScene={onOpenScene}
                todaySignal={todaySignal}
              />
            )}
            {viewMode === 'relations' && <TimelineRelationships data={aeonData} />}
            {viewMode === 'subway' && (
              <TimelineSubway data={aeonData} onOpenScene={onOpenScene} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
