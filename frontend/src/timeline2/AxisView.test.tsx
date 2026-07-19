import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import AxisView, { type AxisChapterCell } from './AxisView';
import type { TimelinesStore } from '../timelinesTypes';
import { ARC_LANE, CHARACTER_LANE, THEME_LANE, WORLD_LANE } from './axis/storyLanes';

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
    const onSelectionChange = vi.fn();
    render(<AxisView store={store} onStoreChange={() => {}} onSelectionChange={onSelectionChange} />);
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
    // a real drag must not select the item
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('sub-threshold jitter is a click, not a drag', async () => {
    const onSelectionChange = vi.fn();
    render(<AxisView store={store} onStoreChange={() => {}} onSelectionChange={onSelectionChange} />);
    mockRowRect('ax-events-row');
    const card = screen.getByTestId('ax-event-ev-1');
    fireEvent.mouseDown(card, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 102 });
    fireEvent.mouseUp(window);
    fireEvent.click(card);
    await flush();
    expect(api.timelinesUpsertItem).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'event', id: 'ev-1' });
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

// ═══ Beta 4 M23 — lane rows + Progress/Structure (§8.4) ═══

/** Story-lane fixture: arcs / characters / world / themes / one plotline with
 *  a beat card, plus a flashback pair on the KEY EVENTS row. */
function makeStoryLanesStore(): TimelinesStore {
  const base = makeStore({
    spans: [
      { id: 'book-1', timelineId: 'tl-story', name: 'Book One', startWhen: 0, endWhen: 432 },
      { id: 'book-2', timelineId: 'tl-story', name: 'Book Two', startWhen: 432, endWhen: 864 },
      { id: 'arc-1', timelineId: 'tl-story', name: 'I. The Call', startWhen: 0, endWhen: 400, rowId: ARC_LANE },
      { id: 'char-1', timelineId: 'tl-story', name: 'Mira', startWhen: 0, endWhen: 800, rowId: CHARACTER_LANE },
      { id: 'char-2', timelineId: 'tl-story', name: 'Kael', startWhen: 100, endWhen: 864, rowId: CHARACTER_LANE },
    ],
    rows: [
      { id: 'pl-1', timelineId: 'tl-story', name: 'Main Plot', kind: 'plotline', color: '#00f0ff' },
    ],
    events: [
      { id: 'ev-early', timelineId: 'tl-story', name: 'Early', when: 100, chapter: 1 },
      { id: 'ev-flash', timelineId: 'tl-story', name: 'The Crown of Ash', when: 50, chapter: 31, summary: 'The truth of the royal line.' },
      { id: 'ev-late', timelineId: 'tl-story', name: 'Late', when: 800, chapter: 40 },
      { id: 'ev-world', timelineId: 'tl-story', name: 'Festival of Lanterns', when: 300, rowId: WORLD_LANE },
      { id: 'ev-theme', timelineId: 'tl-story', name: 'Trust & Betrayal', when: 0, rowId: THEME_LANE },
      { id: 'card-1', timelineId: 'tl-story', name: 'Opening Image', when: 40, rowId: 'pl-1', chapter: 1, beat: true },
    ],
  });
  return base;
}

const CHAPTERS: AxisChapterCell[] = Array.from({ length: 4 }, (_, i) => ({
  id: `ch-${i + 1}`,
  label: `Chapter ${i + 1}`,
  written: i < 2,
  isHere: i === 1,
}));

describe('AxisView — M23 story rows render from timelines.json', () => {
  let store: TimelinesStore;
  beforeEach(() => {
    store = makeStoryLanesStore();
    setupApi(store);
  });

  it('renders ARCS, CHARACTERS, WORLD, THEMES and PLOTLINES rows on a story timeline', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    expect(screen.getByTestId('ax-arc-arc-1')).toHaveTextContent('I. The Call');
    expect(screen.getByTestId('ax-char-char-1')).toBeInTheDocument();
    expect(screen.getByTestId('ax-world-ev-world')).toHaveTextContent('Festival of Lanterns');
    expect(screen.getByTestId('ax-theme-ev-theme')).toHaveTextContent('Trust & Betrayal');
    expect(screen.getByTestId('ax-plotlane-pl-1')).toBeInTheDocument();
    expect(screen.getByTestId('ax-plotcard-card-1')).toHaveTextContent('Opening Image');
    // row labels + sublabels
    expect(screen.getByText('ARCS')).toBeInTheDocument();
    expect(screen.getByText('CHAPTERS')).toBeInTheDocument();
    expect(screen.getByText('PLOTLINES')).toBeInTheDocument();
    expect(screen.getByText('TOGGLE IN LEFT PANEL')).toBeInTheDocument();
    expect(screen.getByText('CHARACTERS')).toBeInTheDocument();
    expect(screen.getByText('LIFESPANS · APPEARANCES')).toBeInTheDocument();
    expect(screen.getByText('WORLD')).toBeInTheDocument();
    expect(screen.getByText('THEMES')).toBeInTheDocument();
  });

  it('story-lane items never leak into the KEY EVENTS row', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    expect(screen.getByTestId('ax-event-ev-early')).toBeInTheDocument();
    expect(screen.queryByTestId('ax-event-ev-world')).toBeNull();
    expect(screen.queryByTestId('ax-event-ev-theme')).toBeNull();
    expect(screen.queryByTestId('ax-event-card-1')).toBeNull();
  });

  it('world / universe timelines keep only the M22 rows (prototype tlIsStoryTl)', () => {
    const worldStore = { ...store, activeTimelineId: 'tl-world' };
    setupApi(worldStore);
    render(<AxisView store={worldStore} onStoreChange={() => {}} chapters={CHAPTERS} />);
    expect(screen.getByText('SPANS & STORIES')).toBeInTheDocument();
    expect(screen.queryByText('ARCS')).toBeNull();
    expect(screen.queryByText('CHAPTERS')).toBeNull();
    expect(screen.queryByText('PLOTLINES')).toBeNull();
    expect(screen.queryByText('THEMES')).toBeNull();
  });

  it('characters get one lane each — never stacked together (§8.3)', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    const row = screen.getByTestId('ax-chars-row');
    expect(row.getAttribute('data-lane-count')).toBe('2');
    expect(row.style.height).toBe(`${2 * 20 + 2}px`);
    expect(screen.getByTestId('ax-char-char-1').getAttribute('data-lane')).toBe('0');
    expect(screen.getByTestId('ax-char-char-2').getAttribute('data-lane')).toBe('1');
  });

  it('chapter minis plot by date with tooltips; beat chips render dashed', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    const minis = screen.getAllByTestId('ax-chapter');
    expect(minis).toHaveLength(4);
    expect(minis[0].getAttribute('title')).toMatch(/^Chapter 1 · Y/);
    const chip = screen.getByTestId('ax-plotcard-card-1');
    expect(chip.getAttribute('data-beat')).toBe('true');
    expect(chip.style.border).toContain('dashed');
  });

  it('computes the FLASHBACK badge from chronology ≠ narrative', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    expect(screen.getByTestId('ax-flash-ev-flash')).toHaveTextContent('FLASHBACK');
    expect(screen.queryByTestId('ax-flash-ev-early')).toBeNull();
    expect(screen.queryByTestId('ax-flash-ev-late')).toBeNull();
  });

  it('hiddenPlotlines removes the plotline lane live', () => {
    const { rerender } = render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />,
    );
    expect(screen.getByTestId('ax-plotlane-pl-1')).toBeInTheDocument();
    rerender(
      <AxisView
        store={store}
        onStoreChange={() => {}}
        chapters={CHAPTERS}
        hiddenPlotlines={new Set(['pl-1'])}
      />,
    );
    expect(screen.queryByTestId('ax-plotlane-pl-1')).toBeNull();
  });

  it('clicking a plotline chip selects it into the inspector as a Plotline card', () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    fireEvent.click(screen.getByTestId('ax-plotcard-card-1'));
    expect(screen.getByTestId('ax-inspector')).toBeInTheDocument();
    expect(screen.getByText('Plotline card')).toBeInTheDocument();
    expect(screen.getByTestId('ax-insp-title')).toHaveValue('Opening Image');
  });
});

describe('AxisView — M23 Show filter + book focus (filters regroup live)', () => {
  let store: TimelinesStore;
  beforeEach(() => {
    store = makeStoryLanesStore();
    setupApi(store);
  });

  it('Written Only / Planned Only split the KEY EVENTS row on the current position', () => {
    const { rerender } = render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} showFilter="Written Only" />,
    );
    // here = end of Chapter 2 of 4 → mid-axis; early events written, late planned.
    expect(screen.getByTestId('ax-event-ev-early')).toBeInTheDocument();
    expect(screen.queryByTestId('ax-event-ev-late')).toBeNull();
    rerender(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} showFilter="Planned Only" />,
    );
    expect(screen.queryByTestId('ax-event-ev-early')).toBeNull();
    expect(screen.getByTestId('ax-event-ev-late')).toBeInTheDocument();
  });

  it('book focus hides events outside the focused book and dims the other books', () => {
    render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} bookFocus="book-1" />,
    );
    expect(screen.getByTestId('ax-event-ev-early')).toBeInTheDocument();
    expect(screen.queryByTestId('ax-event-ev-late')).toBeNull(); // when 800 > book-1 end
    expect(screen.getByTestId('ax-span-book-2').style.opacity).toBe('0.28');
    expect(screen.getByTestId('ax-span-book-1').style.opacity).not.toBe('0.28');
  });
});

describe('AxisView — M23 Progress mode extras', () => {
  let store: TimelinesStore;
  beforeEach(() => {
    store = makeStoryLanesStore();
    setupApi(store);
  });

  it('progress mode greys planned items with the exact prototype filter', () => {
    render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="progress" />,
    );
    // Unwritten chapter 3 greys; written chapter 1 does not.
    const minis = screen.getAllByTestId('ax-chapter');
    expect(minis[2].style.filter).toBe('grayscale(.92) brightness(.82)');
    expect(minis[2].style.opacity).toBe('0.55');
    expect(minis[0].style.filter).toBe('');
    // The planned late event greys too.
    expect(screen.getByTestId('ax-event-ev-late').style.filter).toContain('grayscale');
    expect(screen.getByTestId('ax-event-ev-early').style.filter).toBe('');
  });

  it('structure mode never greys (identical minus progress styling)', () => {
    render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="structure" />,
    );
    for (const mini of screen.getAllByTestId('ax-chapter')) {
      expect(mini.style.filter).toBe('');
    }
    expect(screen.queryByTestId('ax-chapter-here')).toBeNull();
  });

  it('shows the you-are-here ring only in progress mode', () => {
    const { rerender } = render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="progress" />,
    );
    const here = screen.getAllByTestId('ax-chapter')[1];
    expect(here.getAttribute('data-here')).toBe('true');
    expect(here.getAttribute('title')).toMatch(/^You are here — Chapter 2/);
    rerender(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="structure" />,
    );
    expect(screen.getAllByTestId('ax-chapter')[1].getAttribute('data-here')).toBeNull();
  });

  it('Today selects the event nearest the current position and toasts', async () => {
    const { rerender } = render(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="progress" todaySignal={0} />,
    );
    rerender(
      <AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} mode="progress" todaySignal={1} />,
    );
    await flush();
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Jumped to today — Chapter 2');
    expect(screen.getByTestId('ax-inspector')).toBeInTheDocument();
  });

  it('Today explains itself when nothing is written yet', async () => {
    const { rerender } = render(
      <AxisView store={store} onStoreChange={() => {}} chapters={[]} mode="progress" todaySignal={0} />,
    );
    rerender(
      <AxisView store={store} onStoreChange={() => {}} chapters={[]} mode="progress" todaySignal={1} />,
    );
    await flush();
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Nothing written yet');
  });
});

describe('AxisView — M23 story-lane adds persist to the store', () => {
  let store: TimelinesStore;
  let api: ReturnType<typeof setupApi>;
  beforeEach(() => {
    store = makeStoryLanesStore();
    api = setupApi(store);
  });

  it('the ARCS + plots an arc span on the arc lane', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    fireEvent.click(screen.getByTestId('ax-add-arc'));
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('span');
    expect(call.item.rowId).toBe(ARC_LANE);
    expect(call.item.name).toBe('New Arc');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Added — edit it in the inspector');
  });

  it('the CHARACTERS + plots a lifespan on the character lane', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    fireEvent.click(screen.getByTestId('ax-add-char'));
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('span');
    expect(call.item.rowId).toBe(CHARACTER_LANE);
  });

  it('the WORLD + adds a dated world event; THEMES + adds a theme', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    fireEvent.click(screen.getByTestId('ax-add-world'));
    await flush();
    expect(api.timelinesUpsertItem.mock.calls[0][0].item.rowId).toBe(WORLD_LANE);
    fireEvent.click(screen.getByTestId('ax-add-theme'));
    await flush();
    expect(api.timelinesUpsertItem.mock.calls.at(-1)?.[0].item.rowId).toBe(THEME_LANE);
  });

  it('world chips drag-move only (rough placement toast)', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    mockRowRect('ax-world-row');
    fireEvent.mouseDown(screen.getByTestId('ax-world-ev-world'), { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.type).toBe('event');
    expect(call.item.id).toBe('ev-world');
    expect(call.item.when).toBeGreaterThan(300);
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Rough time set');
  });

  it('arc edges resize like every span-like (universal manipulation)', async () => {
    render(<AxisView store={store} onStoreChange={() => {}} chapters={CHAPTERS} />);
    mockRowRect('ax-arcs-row');
    fireEvent.mouseDown(screen.getByTestId('ax-rz-r-arc-1'), { button: 0, clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 500 });
    fireEvent.mouseUp(window);
    await flush();
    const call = api.timelinesUpsertItem.mock.calls[0][0];
    expect(call.item.id).toBe('arc-1');
    expect(call.item.startWhen).toBe(0);
    expect(call.item.endWhen).toBeGreaterThan(400);
  });
});
