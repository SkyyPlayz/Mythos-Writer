// SKY-795: Filter + arc-focus toolbar mounted above the timeline grid.
// Stays presentational — the parent (TimelineSpreadsheet) owns the filter state.

import type { EntityTab, TimelineFilters } from './timelineFilters';

export interface ArcOption {
  id: string;
  title: string;
  color: string;
}

export interface CharOption {
  id: string;
  name: string;
}

export interface LocationOption {
  id: string;
  name: string;
}

interface Props {
  filters: TimelineFilters;
  onFiltersChange: (next: TimelineFilters) => void;
  arcs: ArcOption[];
  characters: CharOption[];
  locations: LocationOption[];
}

const ENTITY_TABS: { id: EntityTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Character' },
  { id: 'arc', label: 'Arc' },
  { id: 'location', label: 'Location' },
];

export default function TimelineFilterBar({
  filters,
  onFiltersChange,
  arcs,
  characters,
  locations,
}: Props) {
  function updateTab(tab: EntityTab) {
    // Switching tabs clears the entity value so a stale id from another type can't keep filtering.
    onFiltersChange({ ...filters, entityTab: tab, entityValue: '' });
  }

  function updateEntityValue(value: string) {
    onFiltersChange({ ...filters, entityValue: value });
  }

  function updateDateFrom(value: string) {
    onFiltersChange({ ...filters, dateFrom: value });
  }

  function updateDateTo(value: string) {
    onFiltersChange({ ...filters, dateTo: value });
  }

  function updateFocusedArc(arcId: string) {
    onFiltersChange({ ...filters, focusedArcId: arcId });
  }

  const showEntitySelector = filters.entityTab !== 'all';

  return (
    <div className="tlf-bar" role="region" aria-label="Timeline filters">
      <div
        className="tlf-tabs"
        role="tablist"
        aria-label="Filter scenes by entity type"
      >
        {ENTITY_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tlf-tab-${tab.id}`}
            className={`tlf-tab${filters.entityTab === tab.id ? ' tlf-tab--active' : ''}`}
            aria-selected={filters.entityTab === tab.id}
            aria-controls="tlf-entity-value"
            onClick={() => updateTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showEntitySelector && (
        <select
          id="tlf-entity-value"
          className="tlf-entity-select"
          value={filters.entityValue}
          onChange={e => updateEntityValue(e.target.value)}
          aria-label={`Filter to a single ${filters.entityTab}`}
        >
          <option value="">— Any {filters.entityTab} —</option>
          {filters.entityTab === 'character' && characters.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          {filters.entityTab === 'arc' && arcs.map(a => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
          {filters.entityTab === 'location' && locations.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )}

      <div className="tlf-divider" aria-hidden="true" />

      <div className="tlf-arc-focus" role="group" aria-label="Single-arc focus">
        <label htmlFor="tlf-arc-focus" className="tlf-label">Focus arc:</label>
        <select
          id="tlf-arc-focus"
          className="tlf-arc-select"
          value={filters.focusedArcId}
          onChange={e => updateFocusedArc(e.target.value)}
          aria-label="Single-arc focus — selected arc stays vivid, other arcs ghost to 20%"
        >
          <option value="">— No focus —</option>
          {arcs.map(a => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
        {filters.focusedArcId && (
          <span
            className="tlf-arc-focus-swatch"
            aria-hidden="true"
            style={{ background: arcs.find(a => a.id === filters.focusedArcId)?.color ?? '#888' }}
          />
        )}
      </div>

      <div className="tlf-divider" aria-hidden="true" />

      <div className="tlf-date-range" role="group" aria-label="Date range filter">
        <label htmlFor="tlf-date-from" className="tlf-label">From:</label>
        <input
          id="tlf-date-from"
          type="date"
          className="tlf-date-input"
          value={filters.dateFrom}
          onChange={e => updateDateFrom(e.target.value)}
          aria-label="Hide scenes before this date"
        />
        <label htmlFor="tlf-date-to" className="tlf-label">To:</label>
        <input
          id="tlf-date-to"
          type="date"
          className="tlf-date-input"
          value={filters.dateTo}
          onChange={e => updateDateTo(e.target.value)}
          aria-label="Hide scenes after this date"
        />
        {(filters.dateFrom || filters.dateTo) && (
          <button
            type="button"
            className="tlf-clear-btn"
            onClick={() => onFiltersChange({ ...filters, dateFrom: '', dateTo: '' })}
            aria-label="Clear date range"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
