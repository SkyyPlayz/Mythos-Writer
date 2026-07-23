// Beta 4 M24 — TimelineTension tests (vitest + @testing-library/react).
//
// Coverage:
//   - Empty state renders the first-use nudge, canvas still present
//   - Per-chapter points render with the right aria-valuenow / aria-valuetext
//   - Keyboard ↑/↓ (and Shift for ±10) persists a new tension value
//   - Keyboard ←/→ moves focus between chapter points
//   - ACT I/II/III separators + legend render

import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import TimelineTension from './TimelineTension';
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
    spans: [],
    rows: [],
    events: [],
    tensionPoints: [
      { id: 'tension:1', timelineId: 'tl-story', chapter: 1, value: 20 },
      { id: 'tension:2', timelineId: 'tl-story', chapter: 2, value: 80 },
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
});

describe('TimelineTension', () => {
  it('shows the empty-state nudge when there are no points, canvas still present', () => {
    const store = makeStore({ tensionPoints: [] });
    setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    expect(screen.getByTestId('timeline-tension-empty')).toBeInTheDocument();
    expect(screen.getByTestId('tlt-svg')).toBeInTheDocument();
  });

  it('renders one slider per chapter with correct aria-valuenow/valuetext', () => {
    const store = makeStore();
    setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    const p1 = screen.getByTestId('tlt-point-1');
    expect(p1).toHaveAttribute('aria-valuenow', '20');
    expect(p1).toHaveAttribute('aria-valuetext', 'Chapter 1: tension 20');
    const p2 = screen.getByTestId('tlt-point-2');
    expect(p2).toHaveAttribute('aria-valuenow', '80');
  });

  it('renders the classic-arc path, legend, and ACT separators', () => {
    const store = makeStore();
    setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    expect(screen.getByTestId('tlt-classic-path')).toBeInTheDocument();
    expect(screen.getByTestId('tlt-story-path')).toBeInTheDocument();
    expect(screen.getByTestId('tlt-legend')).toHaveTextContent('your story');
    expect(screen.getByTestId('tlt-legend')).toHaveTextContent('classic arc');
    expect(screen.getByTestId('tlt-act-ACT-I')).toBeInTheDocument();
    expect(screen.getByTestId('tlt-act-ACT-II')).toBeInTheDocument();
    expect(screen.getByTestId('tlt-act-ACT-III')).toBeInTheDocument();
  });

  it('ArrowUp increases the focused chapter\'s tension and persists via timelinesUpsertItem', async () => {
    const store = makeStore();
    const api = setupApi(store);
    const onStoreChange = vi.fn();
    render(
      <TimelineTension store={store} onStoreChange={onStoreChange} chapters={[{}, {}]} />,
    );
    const p1 = screen.getByTestId('tlt-point-1');
    fireEvent.focus(p1);
    fireEvent.keyDown(p1, { key: 'ArrowUp' });
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledWith({
      type: 'tensionPoint',
      item: expect.objectContaining({ id: 'tension:1', chapter: 1, value: 21 }),
    });
    expect(onStoreChange).toHaveBeenCalledWith(store);
  });

  it('Shift+ArrowDown decreases the tension by 10', async () => {
    const store = makeStore();
    const api = setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    const p2 = screen.getByTestId('tlt-point-2');
    fireEvent.focus(p2);
    fireEvent.keyDown(p2, { key: 'ArrowDown', shiftKey: true });
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledWith({
      type: 'tensionPoint',
      item: expect.objectContaining({ id: 'tension:2', chapter: 2, value: 70 }),
    });
  });

  it('ArrowRight moves focus to the next chapter point', () => {
    const store = makeStore();
    setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    const p1 = screen.getByTestId('tlt-point-1');
    fireEvent.focus(p1);
    fireEvent.keyDown(p1, { key: 'ArrowRight' });
    expect(screen.getByTestId('tlt-point-2')).toHaveClass('tlt-point--focused');
  });

  it('creates a new tension point (with a fresh id) for a chapter with no prior value', async () => {
    const store = makeStore({
      tensionPoints: [{ id: 'tension:1', timelineId: 'tl-story', chapter: 1, value: 20 }],
    });
    const api = setupApi(store);
    render(
      <TimelineTension store={store} onStoreChange={() => {}} chapters={[{}, {}]} />,
    );
    const p2 = screen.getByTestId('tlt-point-2');
    fireEvent.focus(p2);
    fireEvent.keyDown(p2, { key: 'ArrowUp' });
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledWith({
      type: 'tensionPoint',
      item: expect.objectContaining({ chapter: 2, value: 51 }),
    });
  });
});
