// Beta 4 M24 (§8.5) — Spreadsheet: EVENT/CH/DATE·ERA/POV/LOCATION/IMPACT
// columns, a Narrative⇄Chronological sort toggle (Chronological surfaces
// FLASHBACK badges on out-of-narrative-order rows), and a Group-By dropdown.
// Reads the M21 `timelines.json` events directly (docs/TIMELINE-VIEW-MODES
// -A11Y-SPEC.md §3.1) — display-only: row click routes to the Inspector
// (§8.6), the same as every other mode. Editing lives in the M25 Inspector,
// not here.
import { useCallback, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { TimelinesStore, TimelineEvent } from './timelinesTypes';
import type { TimelineGroupBy } from './timelineFilters';
import { safeCalendar, formatWhen } from './timeline2/axis/calendarCodec';
import './TimelineSpreadsheet.css';

export type SheetSort = 'narrative' | 'chronological';
export type SheetGroupBy = 'none' | 'pov' | 'location' | 'chapter';

export interface SheetRow {
  event: TimelineEvent;
  narrativeIndex: number;
  isFlashback: boolean;
}

export interface SheetGroup {
  key: string;
  label: string;
  rows: SheetRow[];
}

// ─── Pure helpers (exported for tests) ───

/** "Narrative" order: by chapter (unset chapters last), tie-broken by the
 *  store's own event order — i.e. the order the story is told in. */
export function narrativeOrder(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ca = a.e.chapter ?? Number.POSITIVE_INFINITY;
      const cb = b.e.chapter ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}

/**
 * A row is a FLASHBACK when its in-world `when` is earlier than the latest
 * `when` already seen earlier in narrative order — i.e. the story visits an
 * earlier moment in time later than a moment it already passed (M24 AC8).
 */
export function computeFlashbacks(eventsInNarrativeOrder: readonly TimelineEvent[]): ReadonlySet<string> {
  const flashbacks = new Set<string>();
  let maxWhenSoFar = Number.NEGATIVE_INFINITY;
  for (const e of eventsInNarrativeOrder) {
    if (Number.isFinite(e.when) && e.when < maxWhenSoFar) flashbacks.add(e.id);
    if (Number.isFinite(e.when)) maxWhenSoFar = Math.max(maxWhenSoFar, e.when);
  }
  return flashbacks;
}

export function buildSheetRows(events: readonly TimelineEvent[], sort: SheetSort): SheetRow[] {
  const inNarrativeOrder = narrativeOrder(events);
  const flashbacks = computeFlashbacks(inNarrativeOrder);
  const narrativeIndexById = new Map(inNarrativeOrder.map((e, i) => [e.id, i]));

  const ordered =
    sort === 'chronological'
      ? [...events].sort((a, b) => (a.when ?? 0) - (b.when ?? 0))
      : inNarrativeOrder;

  return ordered.map((event) => ({
    event,
    narrativeIndex: narrativeIndexById.get(event.id) ?? 0,
    isFlashback: sort === 'chronological' && flashbacks.has(event.id),
  }));
}

export function groupSheetRows(rows: readonly SheetRow[], by: SheetGroupBy): SheetGroup[] {
  if (by === 'none') return [{ key: '__flat__', label: '', rows: [...rows] }];
  const groups = new Map<string, SheetGroup>();
  const ensure = (key: string, label: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    return groups.get(key)!;
  };
  for (const row of rows) {
    if (by === 'pov') {
      const key = row.event.pov?.trim() || '__unassigned__';
      ensure(key, key === '__unassigned__' ? 'No POV' : key).rows.push(row);
    } else if (by === 'location') {
      const key = row.event.location?.trim() || '__unassigned__';
      ensure(key, key === '__unassigned__' ? 'No Location' : key).rows.push(row);
    } else {
      const key = row.event.chapter != null ? String(row.event.chapter) : '__unassigned__';
      ensure(key, key === '__unassigned__' ? 'No Chapter' : `Chapter ${key}`).rows.push(row);
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === '__unassigned__') return 1;
    if (b.key === '__unassigned__') return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

// ─── Component ───

interface Props {
  store: TimelinesStore | null;
  /** Controlled selection — a row click selects it and routes to the
   *  Inspector via TimelineRoot's shared selection state (§8.6/§14.5). */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** F5-shared groupBy prop; only 'none'/'chapter'/'location'/'character'
   *  (rendered as POV) map onto this mode's own SheetGroupBy — 'arc' renders
   *  as 'none' (events have no arc concept in the M21 model). */
  groupBy?: TimelineGroupBy;
  onGroupByChange?: (groupBy: TimelineGroupBy) => void;
}

export default function TimelineSpreadsheet({
  store,
  selectedIds: selectedIdsProp,
  onSelectionChange,
  groupBy: groupByProp,
  onGroupByChange,
}: Props) {
  const [sort, setSort] = useState<SheetSort>('narrative');
  const [internalGroupBy, setInternalGroupBy] = useState<TimelineGroupBy>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());

  const selectedIds = selectedIdsProp ?? internalSelectedIds;
  const resolvedGroupByProp = groupByProp ?? internalGroupBy;
  const groupBy: SheetGroupBy =
    resolvedGroupByProp === 'character' ? 'pov' :
    resolvedGroupByProp === 'location' || resolvedGroupByProp === 'chapter' ? resolvedGroupByProp :
    'none';

  const setSelected = useCallback(
    (ids: Set<string>) => {
      if (selectedIdsProp === undefined) setInternalSelectedIds(ids);
      onSelectionChange?.(ids);
    },
    [selectedIdsProp, onSelectionChange],
  );

  const setGroupBy = useCallback(
    (g: SheetGroupBy) => {
      const asShared: TimelineGroupBy = g === 'pov' ? 'character' : g;
      if (groupByProp === undefined) setInternalGroupBy(asShared);
      onGroupByChange?.(asShared);
      setCollapsedGroups(new Set());
    },
    [groupByProp, onGroupByChange],
  );

  const activeId = store?.activeTimelineId ?? '';
  const calendar = safeCalendar(store?.timelines.find((t) => t.id === activeId)?.calendar);
  const events = useMemo(
    () => (store?.events ?? []).filter((e) => e.timelineId === activeId),
    [store, activeId],
  );

  const rows = useMemo(() => buildSheetRows(events, sort), [events, sort]);
  const groups = useMemo(() => groupSheetRows(rows, groupBy), [rows, groupBy]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const captionText = `Timeline events, ${sort === 'narrative' ? 'Narrative' : 'Chronological'} order${
    groupBy !== 'none' ? `, grouped by ${groupBy === 'pov' ? 'POV' : groupBy === 'location' ? 'Location' : 'Chapter'}` : ''
  }`;

  if (!store) {
    return (
      <div className="tls-empty" data-testid="timeline-spreadsheet-unavailable">
        <h2>Timeline store unavailable.</h2>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="tls-empty" data-testid="timeline-spreadsheet-empty">
        <div className="tls-empty-icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>No events yet.</h2>
        <p>Events written into your timeline will show up here.</p>
      </div>
    );
  }

  return (
    <div className="tls-root" data-testid="timeline-spreadsheet-root" role="region" aria-label="Story timeline spreadsheet">
      <div className="tls-toolbar" role="toolbar" aria-label="Spreadsheet controls">
        <div className="tls-sort-seg" role="group" aria-label="Narrative or Chronological order">
          {(['narrative', 'chronological'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`tls-toolbar-btn${sort === s ? ' active' : ''}`}
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
              data-testid={`tls-sort-${s}`}
            >
              {s === 'narrative' ? 'Narrative' : 'Chronological'}
            </button>
          ))}
        </div>

        <div className="tls-toolbar-group" role="group" aria-label="Group by">
          <span className="tls-toolbar-label">Group:</span>
          {(['none', 'pov', 'location', 'chapter'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`tls-toolbar-btn${groupBy === g ? ' active' : ''}`}
              aria-pressed={groupBy === g}
              onClick={() => setGroupBy(g)}
              data-testid={`tls-group-${g}`}
            >
              {g === 'none' ? 'None' : g === 'pov' ? 'POV' : g === 'location' ? 'Location' : 'Chapter'}
            </button>
          ))}
        </div>
      </div>

      <p className="tls-sort-caption" data-testid="tls-sort-caption">
        {sort === 'chronological'
          ? 'Chronological order — sorted by in-world date. FLASHBACK marks events told out of story order.'
          : 'Narrative order — the order the story tells these events.'}
      </p>

      <div className="tls-scroll">
        <table className="tls-table" data-testid="tls-table">
          <caption className="sr-only" data-testid="tls-caption">{captionText}</caption>
          <thead>
            <tr className="tls-header-row">
              <th className="tls-th tls-th-event" scope="col">Event</th>
              <th className="tls-th tls-th-ch" scope="col">CH</th>
              <th
                className="tls-th tls-th-date"
                scope="col"
                aria-sort={sort === 'chronological' ? 'ascending' : 'none'}
              >
                Date/Era
              </th>
              <th className="tls-th tls-th-pov" scope="col">POV</th>
              <th className="tls-th tls-th-location" scope="col">Location</th>
              <th className="tls-th tls-th-impact" scope="col">Impact</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={`group-${group.key}`}>
              {groupBy !== 'none' && (
                <tr
                  className="tls-group-row"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={!collapsedGroups.has(group.key)}
                >
                  <td className="tls-group-cell" colSpan={6}>
                    <span className="tls-group-toggle" aria-hidden="true">
                      {collapsedGroups.has(group.key) ? '▶' : '▼'}
                    </span>
                    <span className="tls-group-label">{group.label}</span>
                    <span className="tls-group-count">({group.rows.length})</span>
                  </td>
                </tr>
              )}
              {!collapsedGroups.has(group.key) && group.rows.map(({ event, isFlashback }) => {
                const isSelected = selectedIds.has(event.id);
                return (
                  <tr
                    key={event.id}
                    className={`tls-row${isSelected ? ' tls-row--selected' : ''}`}
                    aria-selected={isSelected}
                    data-testid={`row-${event.id}`}
                    onClick={() => setSelected(new Set([event.id]))}
                  >
                    <td className="tls-td tls-td-event" data-testid={`cell-${event.id}-event`}>
                      {event.name}
                      {isFlashback && (
                        <span className="tls-flashback-badge" data-testid={`flashback-${event.id}`}>
                          FLASHBACK
                        </span>
                      )}
                    </td>
                    <td className="tls-td tls-td-ch" data-testid={`cell-${event.id}-ch`}>
                      {event.chapter ?? <span className="tls-cell-empty">—</span>}
                    </td>
                    <td className="tls-td tls-td-date" data-testid={`cell-${event.id}-date`}>
                      {formatWhen(event.when, calendar)}
                    </td>
                    <td className="tls-td tls-td-pov" data-testid={`cell-${event.id}-pov`}>
                      {event.pov || <span className="tls-cell-empty">—</span>}
                    </td>
                    <td className="tls-td tls-td-location" data-testid={`cell-${event.id}-location`}>
                      {event.location || <span className="tls-cell-empty">—</span>}
                    </td>
                    <td className="tls-td tls-td-impact" data-testid={`cell-${event.id}-impact`}>
                      {event.impact || <span className="tls-cell-empty">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
