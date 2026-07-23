// Beta 4 M24 — TimelinePlotlines tests (vitest + @testing-library/react).
//
// Coverage:
//   - Sticky plotline column + 12 chapter-column grid render
//   - Scene cards render in the cell matching their `chapter` (1–12)
//   - YOU ARE HERE marker scales the real chapter count onto the grid
//   - `+` per cell adds a blank card via timelinesUpsertItem
//   - Drag-and-drop moves a card between cells (updates rowId/chapter/when)
//   - Empty state when the active timeline has no plotlines

import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import TimelinePlotlines from './TimelinePlotlines';
import type { TimelinesStore } from './timelinesTypes';

const STANDARD = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 } as const;

function makeStore(overrides: Partial<TimelinesStore> = {}): TimelinesStore {
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
    spans: [
      { id: 'span-a', timelineId: 'tl-story', name: 'Book One', startWhen: 0, endWhen: 1200 },
    ],
    rows: [
      { id: 'row-pl1', timelineId: 'tl-story', name: 'The Crown Plot', kind: 'plotline', color: '#00f0ff' },
    ],
    events: [
      {
        id: 'ev-1', timelineId: 'tl-story', name: 'Opening scene', when: 0,
        rowId: 'row-pl1', chapter: 1, beat: false, written: true,
      },
      {
        id: 'ev-2', timelineId: 'tl-story', name: 'Midpoint beat', when: 600,
        rowId: 'row-pl1', chapter: 6, beat: true, written: false,
      },
    ],
    ...overrides,
  };
}

function setupApi(store: TimelinesStore) {
  const api = { timelinesUpsertItem: vi.fn().mockResolvedValue({ ok: true, store }) };
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true });
  return api;
}

async function flush() {
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  // @ts-expect-error — test cleanup of the global api stub
  delete window.api;
});

describe('TimelinePlotlines', () => {
  it('renders the sticky plotline column and 12 chapter columns', () => {
    const store = makeStore();
    setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('tlp-row-row-pl1')).toHaveTextContent('The Crown Plot');
    for (let col = 1; col <= 12; col++) {
      expect(screen.getByTestId(`tlp-col-head-${col}`)).toHaveTextContent(`Ch. ${col}`);
    }
  });

  it('places scene cards in the cell matching their chapter', () => {
    const store = makeStore();
    setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('tlp-cell-row-pl1-1')).toContainElement(screen.getByTestId('tlp-card-ev-1'));
    expect(screen.getByTestId('tlp-cell-row-pl1-6')).toContainElement(screen.getByTestId('tlp-card-ev-2'));
    expect(screen.getByTestId('tlp-card-ev-2')).toHaveAttribute('data-beat', 'true');
  });

  it('shows the plotline card count', () => {
    const store = makeStore();
    setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('tlp-row-row-pl1')).toHaveTextContent('2');
  });

  it('scales the real chapter index onto the 12-column grid for YOU ARE HERE', () => {
    const store = makeStore();
    setupApi(store);
    // 12 real chapters, "here" is chapter index 5 (0-based, the 6th chapter) → col 6 of 12.
    const chapters = Array.from({ length: 12 }, (_, i) => ({ isHere: i === 5 }));
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} chapters={chapters} />);
    expect(screen.getByTestId('tlp-here-marker')).toBeInTheDocument();
    expect(screen.getByTestId('tlp-col-head-6')).toContainElement(screen.getByTestId('tlp-here-marker'));
  });

  it('omits the YOU ARE HERE marker when no chapter is here', () => {
    const store = makeStore();
    setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    expect(screen.queryByTestId('tlp-here-marker')).not.toBeInTheDocument();
  });

  it('adds a blank card at the clicked cell via timelinesUpsertItem', async () => {
    const store = makeStore();
    const api = setupApi(store);
    const onStoreChange = vi.fn();
    render(<TimelinePlotlines store={store} onStoreChange={onStoreChange} />);
    fireEvent.click(screen.getByTestId('tlp-add-row-pl1-9'));
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledTimes(1);
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('event');
    expect(call.item.rowId).toBe('row-pl1');
    expect(call.item.chapter).toBe(9);
    expect(call.item.beat).toBe(true);
    expect(onStoreChange).toHaveBeenCalledWith(store);
  });

  it('drags a card to a different cell and persists the new chapter', async () => {
    const store = makeStore();
    const api = setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    const card = screen.getByTestId('tlp-card-ev-1');
    const targetCell = screen.getByTestId('tlp-cell-row-pl1-3');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(targetCell, { dataTransfer });
    fireEvent.drop(targetCell, { dataTransfer });
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledTimes(1);
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.item.id).toBe('ev-1');
    expect(call.item.rowId).toBe('row-pl1');
    expect(call.item.chapter).toBe(3);
  });

  it('renders an empty state when the active timeline has no plotlines', () => {
    const store = makeStore({ rows: [] });
    setupApi(store);
    render(<TimelinePlotlines store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('timeline-plotlines-empty')).toBeInTheDocument();
  });
});
