import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import AxisView from './AxisView';
import type { TimelinesStore } from '../timelinesTypes';
import { safeEncodeWhen } from './axis/calendarCodec';

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
      {
        id: 'tl-world', name: 'World of Veynn', kind: 'world', axis: 'calendar',
        calendar: { ...STANDARD }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    eras: [
      { id: 'era-1', timelineId: 'tl-story', name: 'OPENING', startWhen: 0, endWhen: 864 },
    ],
    spans: [
      { id: 'span-a', timelineId: 'tl-story', name: 'Book One', startWhen: 0, endWhen: 864 },
      { id: 'span-w', timelineId: 'tl-world', name: 'Founding', startWhen: 0, endWhen: 432 },
    ],
    rows: [
      { id: 'row-1', timelineId: 'tl-story', name: 'MAGIC SATURATION', kind: 'custom' },
    ],
    events: [
      { id: 'ev-1', timelineId: 'tl-story', name: 'Inciting incident', when: 432 },
      { id: 'ev-w', timelineId: 'tl-world', name: 'World event', when: 100 },
    ],
    ...overrides,
  };
}

function setupApi(store: TimelinesStore) {
  const api = {
    timelinesUpsertItem: vi.fn().mockResolvedValue({ ok: true, store }),
    timelinesDeleteItem: vi.fn().mockResolvedValue({ ok: true, store }),
    timelinesSetActive: vi.fn().mockResolvedValue({ ok: true, store }),
    timelinesUpsert: vi.fn().mockResolvedValue({ ok: true, id: 'tl-story', store }),
  };
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true });
  return api;
}

async function flush() {
  await act(async () => {});
}

function mockRowRect(testId: string, width = 1000) {
  const el = screen.getByTestId(testId);
  el.getBoundingClientRect = () =>
    ({ width, height: 50, top: 0, left: 0, bottom: 50, right: width, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
}

afterEach(() => cleanup());

describe('AxisView — rendering', () => {
  let store: TimelinesStore;
  beforeEach(() => {
    store = makeStore();
    setupApi(store);
  });

  it('renders the eras bar, ticks, spans, events and custom rows', () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('timeline-axis-view')).toBeInTheDocument();
    expect(screen.getByTestId('ax-era-era-1')).toHaveTextContent('OPENING');
    expect(screen.getAllByTestId('ax-tick').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ax-span-span-a')).toBeInTheDocument();
    expect(screen.getByTestId('ax-event-ev-1')).toBeInTheDocument();
    expect(screen.getByTestId('ax-crow-row-1')).toBeInTheDocument();
    // only the active timeline's items plot
    expect(screen.queryByTestId('ax-event-ev-w')).toBeNull();
  });

  it('story timelines label the span row BOOKS', () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    expect(screen.getByText('BOOKS')).toBeInTheDocument();
  });

  it('coarse zoom over a multi-year axis shows year tick labels', () => {
    // Year seg needs a step ≥ half a year → give the timeline a 5-year era.
    const wide = makeStore({
      eras: [{ id: 'era-1', timelineId: 'tl-story', name: 'OPENING', startWhen: 0, endWhen: 4320 }],
    });
    setupApi(wide);
    render(<AxisView store={wide} onStoreChange={() => {}} />);
    const ticks = screen.getAllByTestId('ax-tick');
    expect(ticks.some((t) => / EC$/.test(t.textContent ?? ''))).toBe(true);
  });
});

describe('AxisView — zoom', () => {
  let store: TimelinesStore;
  beforeEach(() => {
    store = makeStore();
    setupApi(store);
  });

  it('zoom segment sets the canvas min-width (Day → 5400px)', () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    expect(screen.getByTestId('ax-canvas').getAttribute('data-min-width')).toBe('');
    fireEvent.click(screen.getByTestId('ax-zoom-Day'));
    expect(screen.getByTestId('ax-canvas').getAttribute('data-min-width')).toBe('5400');
    expect(screen.getByTestId('ax-canvas').style.minWidth).toBe('5400px');
  });

  it('deeper zoom re-labels ticks down to hours (§14.4 step 5)', () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    // Day segment + Ctrl+scroll to the ×44 limit → hour-granularity labels.
    fireEvent.click(screen.getByTestId('ax-zoom-Day'));
    const scroll = screen.getByTestId('ax-scroll');
    for (let i = 0; i < 40; i++) {
      fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -100 });
    }
    const ticks = screen.getAllByTestId('ax-tick');
    expect(ticks.some((t) => /D\d+ · \d{2}:00$/.test(t.textContent ?? ''))).toBe(true);
  });

  it('Ctrl+scroll grows the canvas; plain scroll does not', () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    const scroll = screen.getByTestId('ax-scroll');
    fireEvent.wheel(scroll, { deltaY: -100 });
    expect(screen.getByTestId('ax-canvas').getAttribute('data-min-width')).toBe('');
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -100 });
    // 1100 × 1.13 = 1243
    expect(screen.getByTestId('ax-canvas').getAttribute('data-min-width')).toBe('1243');
  });
});

describe('AxisView — auto-stacking', () => {
  it('three events on the SAME date stack into three lanes and grow the row (§14.4 step 3)', () => {
    const store = makeStore({
      events: [
        { id: 'ev-1', timelineId: 'tl-story', name: 'A', when: 432 },
        { id: 'ev-2', timelineId: 'tl-story', name: 'B', when: 432 },
        { id: 'ev-3', timelineId: 'tl-story', name: 'C', when: 432 },
      ],
    });
    setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    const row = screen.getByTestId('ax-events-row');
    expect(row.getAttribute('data-lane-count')).toBe('3');
    expect(row.style.height).toBe(`${(3 - 1) * 92 + 96}px`);
    const lanes = ['ev-1', 'ev-2', 'ev-3'].map((id) =>
      screen.getByTestId(`ax-event-${id}`).getAttribute('data-lane'),
    );
    expect([...lanes].sort()).toEqual(['0', '1', '2']);
  });

  it('sequential book spans with touching edges do NOT stack (§14.4 step 4)', () => {
    const store = makeStore({
      spans: [
        { id: 'b1', timelineId: 'tl-story', name: 'Book One', startWhen: 0, endWhen: 288 },
        { id: 'b2', timelineId: 'tl-story', name: 'Book Two', startWhen: 288, endWhen: 576 },
        { id: 'b3', timelineId: 'tl-story', name: 'Book Three', startWhen: 576, endWhen: 864 },
      ],
    });
    setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    const row = screen.getByTestId('ax-spans-row');
    expect(row.getAttribute('data-lane-count')).toBe('1');
    expect(row.style.height).toBe('50px');
  });

  it('overlapping spans stack and the row grows', () => {
    const store = makeStore({
      spans: [
        { id: 'b1', timelineId: 'tl-story', name: 'Book One', startWhen: 0, endWhen: 600 },
        { id: 'b2', timelineId: 'tl-story', name: 'Book Two', startWhen: 300, endWhen: 864 },
      ],
    });
    setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    const row = screen.getByTestId('ax-spans-row');
    expect(row.getAttribute('data-lane-count')).toBe('2');
    expect(row.style.height).toBe('100px');
  });
});

describe('AxisView — direct manipulation', () => {
  let store: TimelinesStore;
  let api: ReturnType<typeof setupApi>;
  beforeEach(() => {
    store = makeStore();
    api = setupApi(store);
  });

  it('dragging an event past the threshold moves it in time and toasts (§14.4 step 1)', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    mockRowRect('ax-events-row');
    const card = screen.getByTestId('ax-event-ev-1');
    fireEvent.mouseDown(card, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledTimes(1);
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('event');
    expect(call.item.id).toBe('ev-1');
    expect(call.item.when).toBeGreaterThan(432);
    expect(screen.getByTestId('app-toast')).toHaveTextContent(
      'Rough time set — fine-tune with the exact-time picker',
    );
    // a real drag must not open the inspector
    expect(screen.queryByTestId('ax-inspector')).toBeNull();
  });

  it('sub-threshold jitter is a click, not a drag', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    mockRowRect('ax-events-row');
    const card = screen.getByTestId('ax-event-ev-1');
    fireEvent.mouseDown(card, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 102 });
    fireEvent.mouseUp(window);
    fireEvent.click(card);
    await flush();
    expect(api.timelinesUpsertItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('ax-inspector')).toBeInTheDocument();
  });

  it('resizing a book span by its edge changes only that edge (§14.4 step 2)', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    mockRowRect('ax-spans-row');
    fireEvent.mouseDown(screen.getByTestId('ax-rz-r-span-a'), { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });
    fireEvent.mouseUp(window);
    await flush();
    expect(api.timelinesUpsertItem).toHaveBeenCalledTimes(1);
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('span');
    expect(call.item.startWhen).toBe(0);
    expect(call.item.endWhen).toBeGreaterThan(864);
  });

  it('era drag persists new dates (§14.4 step 9)', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    mockRowRect('ax-eras-row');
    fireEvent.mouseDown(screen.getByTestId('ax-era-era-1'), { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window);
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('era');
    expect(call.item.startWhen).toBeGreaterThan(0);
    expect(call.item.endWhen - call.item.startWhen).toBeCloseTo(864, 0);
  });

  it('click (no drag) selects into the inspector; rename persists on blur', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-era-era-1'));
    const title = screen.getByTestId('ax-insp-title');
    expect(title).toHaveValue('OPENING');
    fireEvent.change(title, { target: { value: 'THE LONG DAWN' } });
    fireEvent.blur(title);
    await flush();
    const call = api.timelinesUpsertItem.mock.calls.at(-1)?.[0];
    expect(call.type).toBe('era');
    expect(call.item.name).toBe('THE LONG DAWN');
  });

  it('inspector Delete removes the item', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-event-ev-1'));
    fireEvent.click(screen.getByTestId('ax-insp-delete'));
    await flush();
    expect(api.timelinesDeleteItem).toHaveBeenCalledWith({ type: 'event', id: 'ev-1' });
    expect(screen.queryByTestId('ax-inspector')).toBeNull();
    expect(screen.queryByTestId('ax-event-ev-1')).toBeNull();
  });
});

describe('AxisView — embedding (§14.4 step 6)', () => {
  it('embedded spans render dashed with mini preview strips and open on click', async () => {
    const store = makeStore({
      spans: [
        { id: 'span-e', timelineId: 'tl-story', name: 'World context', startWhen: 0, endWhen: 864, opensTimelineId: 'tl-world' },
        { id: 'span-w', timelineId: 'tl-world', name: 'Founding', startWhen: 0, endWhen: 432 },
      ],
    });
    const api = setupApi(store);
    const onStoreChange = vi.fn();
    render(<AxisView store={store} onStoreChange={onStoreChange} />);
    const span = screen.getByTestId('ax-span-span-e');
    expect(span.getAttribute('data-embedded')).toBe('true');
    expect(screen.getByTestId('ax-mini-strip-span-w')).toBeInTheDocument();
    fireEvent.click(span);
    await flush();
    expect(api.timelinesSetActive).toHaveBeenCalledWith('tl-world');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Opened “World context”');
  });

  it('the inspector embed select attaches a timeline to a plain span', async () => {
    const store = makeStore();
    const api = setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-span-span-a'));
    fireEvent.change(screen.getByTestId('ax-insp-embed'), { target: { value: 'tl-world' } });
    await flush();
    const call = api.timelinesUpsertItem.mock.calls.at(-1)?.[0];
    expect(call.item.opensTimelineId).toBe('tl-world');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Timeline embedded');
  });
});

describe('AxisView — adds + custom rows (§14.4 step 9)', () => {
  let store: TimelinesStore;
  let api: ReturnType<typeof setupApi>;
  beforeEach(() => {
    store = makeStore();
    api = setupApi(store);
  });

  it('ERAS + adds an era and selects it', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-add-era'));
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('era');
    expect(call.item.name).toBe('NEW ERA');
    expect(screen.getByTestId('ax-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Era added');
  });

  it('+ Custom row adds a row; rename commits on blur; remove deletes it', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-add-crow'));
    await flush();
    expect(api.timelinesUpsertItem.mock.calls[0][0].type).toBe('row');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Row added');

    const name = screen.getByTestId('ax-crow-name-row-1');
    fireEvent.change(name, { target: { value: 'SEASONS' } });
    fireEvent.blur(name);
    await flush();
    const renameCall = api.timelinesUpsertItem.mock.calls.at(-1)?.[0];
    expect(renameCall.type).toBe('row');
    expect(renameCall.item.name).toBe('SEASONS');

    fireEvent.click(screen.getByTestId('ax-crow-remove-row-1'));
    await flush();
    expect(api.timelinesDeleteItem).toHaveBeenCalledWith({ type: 'row', id: 'row-1' });
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Row removed');
  });

  it('the per-row + plots a span on that row', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-crow-add-row-1'));
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('span');
    expect(call.item.rowId).toBe('row-1');
  });
});

describe('AxisView — exact-time picker (§14.4 step 7)', () => {
  it('sets an exact time under a 13×28×18 calendar and replots', async () => {
    const aeon = { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 } as const;
    const store = makeStore();
    store.timelines[0].calendar = { ...aeon };
    const api = setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);

    fireEvent.click(screen.getByTestId('ax-event-ev-1'));
    fireEvent.click(screen.getByTestId('ax-insp-exact'));
    expect(screen.getByTestId('exact-time-modal')).toBeInTheDocument();
    expect(screen.getByText(/13 months × 28 days × 18h days/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('etm-start-year'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('etm-start-month'), { target: { value: '13' } });
    fireEvent.change(screen.getByTestId('etm-start-day'), { target: { value: '28' } });
    fireEvent.change(screen.getByTestId('etm-start-hour'), { target: { value: '17' } });
    fireEvent.click(screen.getByTestId('etm-apply'));
    await flush();

    const call = api.timelinesUpsertItem.mock.calls.at(-1)?.[0];
    expect(call.type).toBe('event');
    expect(call.item.when).toBe(safeEncodeWhen({ year: 2, month: 13, day: 28, hour: 17 }, { ...aeon }));
    expect(screen.queryByTestId('exact-time-modal')).toBeNull();
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Exact time set — replotted on the axis');
  });

  it('the change link opens the calendar editor above the picker', () => {
    const store = makeStore();
    setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-span-span-a'));
    fireEvent.click(screen.getByTestId('ax-insp-exact'));
    fireEvent.click(screen.getByTestId('etm-change-calendar'));
    expect(screen.getByTestId('calendar-editor-modal')).toBeInTheDocument();
  });

  it('span targets get START and END field groups', () => {
    const store = makeStore();
    setupApi(store);
    render(<AxisView store={store} onStoreChange={() => {}} />);
    fireEvent.click(screen.getByTestId('ax-span-span-a'));
    fireEvent.click(screen.getByTestId('ax-insp-exact'));
    expect(screen.getByTestId('etm-start-year')).toBeInTheDocument();
    expect(screen.getByTestId('etm-end-year')).toBeInTheDocument();
  });
});
