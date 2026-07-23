// Beta 4 M24 (§8.5) — TimelineSpreadsheet tests (vitest + @testing-library/react).
//
// Coverage:
//   - Empty / unavailable states
//   - All 6 columns render (EVENT/CH/DATE·ERA/POV/LOCATION/IMPACT)
//   - Narrative vs Chronological sort toggle re-orders rows
//   - FLASHBACK badge appears only in Chronological order, on out-of-order rows
//   - Group-By (POV/Location/Chapter) groups rows with a group header + count
//   - Row click selects and calls onSelectionChange (routes to Inspector)
//   - Pure helpers: narrativeOrder / computeFlashbacks / buildSheetRows / groupSheetRows

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import TimelineSpreadsheet, {
  narrativeOrder,
  computeFlashbacks,
  buildSheetRows,
  groupSheetRows,
} from './TimelineSpreadsheet';
import type { TimelinesStore, TimelineEvent } from './timelinesTypes';

const STANDARD = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 } as const;

function makeStore(events: TimelineEvent[]): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [
      {
        id: 'tl-story', name: 'The Last City of Veynn', kind: 'story', axis: 'calendar',
        calendar: { ...STANDARD }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    eras: [],
    spans: [],
    rows: [],
    events,
  };
}

afterEach(() => {
  cleanup();
});

describe('pure helpers', () => {
  const events: TimelineEvent[] = [
    { id: 'e1', timelineId: 'tl', name: 'Opening', when: 100, chapter: 1 },
    { id: 'e2', timelineId: 'tl', name: 'Flashback beat', when: 10, chapter: 2 },
    { id: 'e3', timelineId: 'tl', name: 'Climax', when: 300, chapter: 3 },
  ];

  it('narrativeOrder sorts by chapter, unset chapters last', () => {
    const ordered = narrativeOrder([
      { id: 'a', timelineId: 'tl', name: 'A', when: 0, chapter: 2 },
      { id: 'b', timelineId: 'tl', name: 'B', when: 0 },
      { id: 'c', timelineId: 'tl', name: 'C', when: 0, chapter: 1 },
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('computeFlashbacks flags an event whose `when` is earlier than the max seen so far', () => {
    const flashbacks = computeFlashbacks(events);
    expect(flashbacks.has('e2')).toBe(true);
    expect(flashbacks.has('e1')).toBe(false);
    expect(flashbacks.has('e3')).toBe(false);
  });

  it('buildSheetRows: narrative order never marks flashbacks; chronological does', () => {
    const narrative = buildSheetRows(events, 'narrative');
    expect(narrative.map((r) => r.event.id)).toEqual(['e1', 'e2', 'e3']);
    expect(narrative.every((r) => !r.isFlashback)).toBe(true);

    const chrono = buildSheetRows(events, 'chronological');
    expect(chrono.map((r) => r.event.id)).toEqual(['e2', 'e1', 'e3']);
    expect(chrono.find((r) => r.event.id === 'e2')!.isFlashback).toBe(true);
  });

  it('groupSheetRows groups by chapter, POV, and location with an "unassigned" bucket last', () => {
    const rows = buildSheetRows(
      [
        { id: 'a', timelineId: 'tl', name: 'A', when: 0, pov: 'Mira', location: 'The Keep' },
        { id: 'b', timelineId: 'tl', name: 'B', when: 1 },
      ],
      'narrative',
    );
    const byPov = groupSheetRows(rows, 'pov');
    expect(byPov.map((g) => g.label)).toEqual(['Mira', 'No POV']);
    const byLocation = groupSheetRows(rows, 'location');
    expect(byLocation.map((g) => g.label)).toEqual(['The Keep', 'No Location']);
  });
});

describe('TimelineSpreadsheet component', () => {
  it('shows the unavailable state when the store is null', () => {
    render(<TimelineSpreadsheet store={null} />);
    expect(screen.getByTestId('timeline-spreadsheet-unavailable')).toBeInTheDocument();
  });

  it('shows the empty state when the active timeline has no events', () => {
    render(<TimelineSpreadsheet store={makeStore([])} />);
    expect(screen.getByTestId('timeline-spreadsheet-empty')).toBeInTheDocument();
  });

  it('renders all six columns and the event data in each', () => {
    const store = makeStore([
      { id: 'e1', timelineId: 'tl-story', name: 'The Fall of Veynn', when: 100, chapter: 3, pov: 'Mira', location: 'The Keep', impact: 'reveals betrayal' },
    ]);
    render(<TimelineSpreadsheet store={store} />);
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'CH' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date/Era' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'POV' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Impact' })).toBeInTheDocument();
    expect(screen.getByTestId('cell-e1-event')).toHaveTextContent('The Fall of Veynn');
    expect(screen.getByTestId('cell-e1-ch')).toHaveTextContent('3');
    expect(screen.getByTestId('cell-e1-pov')).toHaveTextContent('Mira');
    expect(screen.getByTestId('cell-e1-location')).toHaveTextContent('The Keep');
    expect(screen.getByTestId('cell-e1-impact')).toHaveTextContent('reveals betrayal');
  });

  it('Narrative⇄Chronological toggle re-sorts and surfaces a FLASHBACK badge only in Chronological order', () => {
    const store = makeStore([
      { id: 'e1', timelineId: 'tl-story', name: 'Opening', when: 100, chapter: 1 },
      { id: 'e2', timelineId: 'tl-story', name: 'Flashback beat', when: 10, chapter: 2 },
    ]);
    render(<TimelineSpreadsheet store={store} />);
    expect(screen.queryByTestId('flashback-e2')).toBeNull();

    fireEvent.click(screen.getByTestId('tls-sort-chronological'));
    expect(screen.getByTestId('flashback-e2')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').filter((r) => r.dataset.testid?.startsWith('row-'));
    expect(rows[0]).toHaveAttribute('data-testid', 'row-e2');

    fireEvent.click(screen.getByTestId('tls-sort-narrative'));
    expect(screen.queryByTestId('flashback-e2')).toBeNull();
  });

  it('Group-By groups rows under a header with a count', () => {
    const store = makeStore([
      { id: 'e1', timelineId: 'tl-story', name: 'A', when: 0, location: 'The Keep' },
      { id: 'e2', timelineId: 'tl-story', name: 'B', when: 1, location: 'The Keep' },
      { id: 'e3', timelineId: 'tl-story', name: 'C', when: 2 },
    ]);
    render(<TimelineSpreadsheet store={store} />);
    fireEvent.click(screen.getByTestId('tls-group-location'));
    expect(screen.getAllByText('The Keep').length).toBeGreaterThan(0);
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getAllByText('No Location').length).toBeGreaterThan(0);
  });

  it('row click selects the event and calls onSelectionChange', () => {
    const store = makeStore([{ id: 'e1', timelineId: 'tl-story', name: 'A', when: 0 }]);
    const onSelectionChange = vi.fn();
    render(<TimelineSpreadsheet store={store} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByTestId('row-e1'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['e1']));
  });
});
