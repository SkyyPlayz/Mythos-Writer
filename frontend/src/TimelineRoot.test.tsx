// SKY-3185 — F5: TimelineRoot view-switcher + grouping tests (vitest + @testing-library/react).
// Beta 4 M23 — grown to the prototype's seven modes (tlModeSeg, 6559):
// Progress · Structure · Plotlines · Spreadsheet · Tension · Relationships ·
// Subway, with Progress as the §8.4 DEFAULT and the axis lane rows as the
// Progress/Structure surface.
//
// Coverage:
//   - View switch: seven modes, each rendering exactly one surface
//   - Progress default + localStorage persistence / restore / legacy migration
//     ('aeon' → progress, 'track' → subway, M22's 'axis' → progress)
//   - Progress legend renders only in progress mode
//   - View / Show filter selects (View jumps modes; Show reaches the axis)
//   - Templates ▾ → plotline row + dashed beat cards persisted (§14.4 step 8)
//   - `+ Plotline`, left-panel book focus + plotline toggles + rename
//   - "Today" — lanes modes flip to progress and the axis gets the signal
//   - groupBy passthrough to the spreadsheet view
//   - Null story: lanes render (vault-scoped); relations/subway show the
//     no-story state
//   - groupScenes chapter/location grouping (F5 extension, real implementation)

import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TimelineRoot from './TimelineRoot';
import { groupScenes } from './TimelineSpreadsheet';
import type { SpreadsheetScene } from './TimelineSpreadsheet';
import type { Story } from './types';
import type { TimelinesStore } from './timelinesTypes';

// ─── Child-view mocks ───
// The surfaces are mocked so tests exercise TimelineRoot's state ownership
// (viewMode / groupBy / filters / focus) through the real header controls.
// importOriginal keeps TimelineSpreadsheet's named exports (groupScenes) real.

vi.mock('./TimelineSpreadsheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./TimelineSpreadsheet')>();
  return {
    ...actual,
    default: ({ groupBy, selectedIds, onSelectionChange }: {
      groupBy?: string;
      selectedIds?: Set<string>;
      onSelectionChange?: (ids: Set<string>) => void;
    }) => (
      <div
        data-testid="mock-spreadsheet"
        data-groupby={groupBy ?? 'unset'}
        data-selected-count={selectedIds?.size ?? 0}
      >
        <button
          type="button"
          data-testid="mock-select-scene"
          onClick={() => onSelectionChange?.(new Set(['sc-1']))}
        >
          select scene
        </button>
      </div>
    ),
  };
});

vi.mock('./timeline2/AxisView', () => ({
  default: (props: {
    mode?: string;
    chapters?: unknown[];
    hiddenPlotlines?: Set<string>;
    bookFocus?: string | null;
    showFilter?: string;
    todaySignal?: number;
  }) => (
    <div
      data-testid="mock-axis"
      data-mode={props.mode ?? 'unset'}
      data-chapter-count={props.chapters?.length ?? 0}
      data-hidden-count={props.hiddenPlotlines?.size ?? 0}
      data-book-focus={props.bookFocus ?? ''}
      data-show={props.showFilter ?? ''}
      data-today-signal={props.todaySignal ?? 0}
    >
      Axis lanes
    </div>
  ),
}));

vi.mock('./TimelineRelationships', () => ({
  default: () => <div data-testid="mock-relationships">Relationships</div>,
}));

vi.mock('./TimelineSubway', () => ({
  default: () => <div data-testid="mock-subway">Subway</div>,
}));

// ─── Fixtures ───

const STORY: Story = {
  id: 'story-1',
  title: 'Test Story',
  path: '/stories/test',
  chapters: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const STANDARD = { preset: 'standard' as const, monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };

/** Explicit store fixture (never rely on implicit seeding): a story timeline
 *  with two book spans and one plotline carrying one card. */
function makeM21Store(): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [
      {
        id: 'tl-story', name: 'Story Timeline', kind: 'story', axis: 'calendar',
        calendar: { ...STANDARD }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    eras: [],
    spans: [
      { id: 'book-1', timelineId: 'tl-story', name: 'BOOK ONE', startWhen: 0, endWhen: 432 },
      { id: 'book-2', timelineId: 'tl-story', name: 'BOOK TWO', startWhen: 432, endWhen: 864 },
    ],
    rows: [
      { id: 'pl-1', timelineId: 'tl-story', name: 'Main Plot', kind: 'plotline', color: '#00f0ff' },
    ],
    events: [
      { id: 'ev-1', timelineId: 'tl-story', name: 'Inciting incident', when: 100 },
      { id: 'card-1', timelineId: 'tl-story', name: 'Opening beat', when: 200, rowId: 'pl-1', chapter: 2 },
    ],
  };
}

function makeScene(overrides: Partial<SpreadsheetScene> = {}): SpreadsheetScene {
  return {
    id: crypto.randomUUID(),
    title: 'Scene',
    chapterId: '',
    date: '',
    pov: '',
    arcIds: [],
    characterIds: [],
    wordCount: null,
    mood: '',
    locationId: '',
    ...overrides,
  };
}

/** TimelineRoot loads the shared Aeon dataset + the M21 store — stub both. */
function setupApi(store: TimelinesStore | null = makeM21Store()) {
  const value: Record<string, unknown> = {
    timelineGetScenes: vi.fn().mockResolvedValue({ scenes: [] }),
    timelineListArcs: vi.fn().mockResolvedValue({ arcs: [] }),
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
  };
  if (store) {
    value.timelinesGetStore = vi.fn().mockResolvedValue({ store });
    value.timelinesUpsert = vi.fn().mockResolvedValue({ ok: true, id: store.activeTimelineId, store });
    value.timelinesSetActive = vi.fn().mockResolvedValue({ ok: true, store });
    value.timelinesUpsertItem = vi.fn().mockResolvedValue({ ok: true, store });
    value.timelinesDeleteItem = vi.fn().mockResolvedValue({ ok: true, store });
  }
  Object.defineProperty(window, 'api', { value, writable: true, configurable: true });
  return value as unknown as Window['api'];
}

/** Render TimelineRoot and flush its async loads so no state update lands
 *  outside act() (setupTests fails the test on act warnings). */
async function renderRoot(story: Story | null = STORY) {
  const utils = render(<TimelineRoot story={story} />);
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  setupApi();
});
afterEach(() => cleanup());

// ─── View switcher ───

describe('TimelineRoot — view switcher', () => {
  it('renders the Progress axis lanes by default (§8.4 DEFAULT mode)', async () => {
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-mode', 'progress');
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
    expect(screen.queryByTestId('mock-relationships')).toBeNull();
    expect(screen.queryByTestId('mock-subway')).toBeNull();
  });

  it('offers the seven prototype modes, exact labels (tlModeSeg 6559)', async () => {
    await renderRoot();
    const toggle = screen.getByTestId('view-mode-toggle');
    const labels = Array.from(toggle.querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual([
      'Progress', 'Structure', 'Plotlines', 'Spreadsheet', 'Tension', 'Relationships', 'Subway',
    ]);
  });

  it('switches to the same axis surface, ungreyed, in structure mode', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-mode', 'structure');
  });

  it('Plotlines and Tension explain themselves until M24', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-plot'));
    expect(screen.getByTestId('tlr-plot-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-axis')).toBeNull();
    fireEvent.click(screen.getByTestId('view-mode-tension'));
    expect(screen.getByTestId('tlr-tension-stub')).toBeInTheDocument();
  });

  it('switches to the spreadsheet / relationships / subway surfaces', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('view-mode-relations'));
    expect(await screen.findByTestId('mock-relationships')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('view-mode-subway'));
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-axis')).toBeNull();
  });

  it('sets aria-pressed on the active mode button only', async () => {
    await renderRoot();
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the unavailable state when the timelines store cannot load', async () => {
    setupApi(null); // no timelinesGetStore
    await renderRoot();
    expect(screen.getByTestId('tlr-lanes-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-axis')).toBeNull();
  });
});

// ─── Progress legend ───

describe('TimelineRoot — legend', () => {
  it('shows the written/planned legend only in progress mode', async () => {
    await renderRoot();
    expect(screen.getByTestId('tl-legend')).toHaveTextContent('written');
    expect(screen.getByTestId('tl-legend')).toHaveTextContent('planned from your notes');
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    await waitFor(() => expect(screen.queryByTestId('tl-legend')).toBeNull());
  });
});

// ─── View / Show filter selects (prototype tlFilterSel) ───

describe('TimelineRoot — filter selects', () => {
  it('View → World Chronology jumps to the spreadsheet and toasts', async () => {
    await renderRoot();
    fireEvent.change(screen.getByTestId('tl-view-filter'), { target: { value: 'World Chronology' } });
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    expect(screen.getByTestId('app-toast')).toHaveTextContent('View → World Chronology');
  });

  it('View → Per Character jumps to the subway', async () => {
    await renderRoot();
    fireEvent.change(screen.getByTestId('tl-view-filter'), { target: { value: 'Per Character' } });
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
  });

  it('Show filter reaches the axis lanes live and toasts', async () => {
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-show', 'All Events');
    fireEvent.change(screen.getByTestId('tl-show-filter'), { target: { value: 'Written Only' } });
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-show', 'Written Only');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Show → Written Only');
  });
});

// ─── Templates ▾ + `+ Plotline` (§14.4 step 8) ───

describe('TimelineRoot — plot structure templates', () => {
  it('applying Save the Cat persists a plotline row + 8 dashed beat cards and toasts', async () => {
    const api = setupApi();
    await renderRoot();
    fireEvent.click(screen.getByTestId('tl-templates-btn'));
    expect(screen.getByTestId('tl-templates-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tl-template-save-the-cat'));
    await act(async () => {});

    const upsert = api.timelinesUpsertItem as ReturnType<typeof vi.fn>;
    expect(upsert).toHaveBeenCalledTimes(9); // 1 row + 8 beats
    const rowCall = upsert.mock.calls[0][0];
    expect(rowCall.type).toBe('row');
    expect(rowCall.item.kind).toBe('plotline');
    expect(rowCall.item.name).toBe('Save the Cat');
    const beatCalls = upsert.mock.calls.slice(1).map(c => c[0]);
    for (const call of beatCalls) {
      expect(call.type).toBe('event');
      expect(call.item.rowId).toBe(rowCall.item.id);
      expect(call.item.beat).toBe(true);
      expect(Number.isFinite(call.item.when)).toBe(true);
    }
    expect(beatCalls[0].item.name).toBe('Opening Image');
    expect(beatCalls[7].item.name).toBe('Final Image');
    expect(beatCalls[7].item.chapter).toBe(12);
    expect(screen.getByTestId('app-toast')).toHaveTextContent(
      '“Save the Cat” laid onto the timeline as a plotline',
    );
    expect(screen.queryByTestId('tl-templates-menu')).toBeNull();
  });

  it('offers all three templates with beat counts', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('tl-templates-btn'));
    const menu = screen.getByTestId('tl-templates-menu');
    expect(menu).toHaveTextContent('Three-Act Structure');
    expect(menu).toHaveTextContent('7 beats');
    expect(menu).toHaveTextContent('Save the Cat');
    expect(menu).toHaveTextContent('Hero’s Journey');
    expect(menu).toHaveTextContent('8 beats');
    expect(menu).toHaveTextContent('Beat cards are dashed — replace them with your scenes');
  });

  it('the menu closes on outside click and on Escape', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('tl-templates-btn'));
    fireEvent.click(screen.getByTestId('tl-templates-backdrop'));
    expect(screen.queryByTestId('tl-templates-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('tl-templates-btn'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('tl-templates-menu')).toBeNull();
  });

  it('+ Plotline persists a new plotline row and toasts', async () => {
    const api = setupApi();
    await renderRoot();
    fireEvent.click(screen.getByTestId('tl-add-plotline'));
    await act(async () => {});
    const upsert = api.timelinesUpsertItem as ReturnType<typeof vi.fn>;
    const call = upsert.mock.calls[0][0];
    expect(call.type).toBe('row');
    expect(call.item.kind).toBe('plotline');
    expect(call.item.name).toBe('New Plotline');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Plotline added');
  });

  it('hides the plotline tools in the sheet / relations / subway modes', async () => {
    await renderRoot();
    expect(screen.getByTestId('tl-templates-btn')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.queryByTestId('tl-templates-btn')).toBeNull();
    expect(screen.queryByTestId('tl-add-plotline')).toBeNull();
    fireEvent.click(screen.getByTestId('view-mode-plot'));
    expect(screen.getByTestId('tl-templates-btn')).toBeInTheDocument();
  });
});

// ─── Left panel: book focus + plotline toggles (prototype 399–417) ───

describe('TimelineRoot — left focus panel', () => {
  it('book cards focus/unfocus and Overview resets (progress extras)', async () => {
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-book-focus', '');
    fireEvent.click(screen.getByTestId('tl-book-card-book-1'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-book-focus', 'book-1');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Focused on BOOK ONE');
    fireEvent.click(screen.getByTestId('tl-overview-card'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-book-focus', '');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Showing the whole series');
  });

  it('plotline rows toggle visibility into the axis', async () => {
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-hidden-count', '0');
    fireEvent.click(screen.getByTestId('tl-pl-toggle-pl-1'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-hidden-count', '1');
    fireEvent.click(screen.getByTestId('tl-pl-toggle-pl-1'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-hidden-count', '0');
  });

  it('right-click renames a plotline inline and persists on Enter', async () => {
    const api = setupApi();
    await renderRoot();
    fireEvent.contextMenu(screen.getByTestId('tl-pl-toggle-pl-1'));
    const input = screen.getByTestId('tl-pl-rename-pl-1');
    fireEvent.change(input, { target: { value: 'Mira’s Arc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    const upsert = api.timelinesUpsertItem as ReturnType<typeof vi.fn>;
    const call = upsert.mock.calls.at(-1)?.[0];
    expect(call.type).toBe('row');
    expect(call.item.id).toBe('pl-1');
    expect(call.item.name).toBe('Mira’s Arc');
  });

  it('shows the plotline card count', async () => {
    await renderRoot();
    expect(screen.getByTestId('tl-pl-toggle-pl-1')).toHaveTextContent('Main Plot');
    expect(screen.getByTestId('tl-pl-toggle-pl-1')).toHaveTextContent('1');
  });
});

// ─── Today jump ───

describe('TimelineRoot — Today jump', () => {
  it('flips structure mode to progress and bumps the axis signal', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-today-signal', '0');
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-today-signal', '1');
  });

  it('keeps the sheet / relations / subway modes unchanged', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-subway'));
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('view-mode-subway')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
  });
});

// ─── localStorage persistence ───

describe('TimelineRoot — persistence', () => {
  it('persists viewMode to localStorage on switch', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-subway'));
    expect(localStorage.getItem('timeline:viewMode')).toBe('subway');
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(localStorage.getItem('timeline:viewMode')).toBe('spreadsheet');
  });

  it('restores viewMode from localStorage on mount', async () => {
    localStorage.setItem('timeline:viewMode', 'relations');
    await renderRoot();
    expect(await screen.findByTestId('mock-relationships')).toBeInTheDocument();
  });

  it('migrates the legacy Beta-2 "aeon" mode to the progress lanes', async () => {
    localStorage.setItem('timeline:viewMode', 'aeon');
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-mode', 'progress');
  });

  it('migrates the M22 "axis" mode to the progress lanes', async () => {
    localStorage.setItem('timeline:viewMode', 'axis');
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-mode', 'progress');
  });

  it('migrates the legacy Beta-2 "track" mode to the subway view', async () => {
    localStorage.setItem('timeline:viewMode', 'track');
    await renderRoot();
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
  });

  it('falls back to the progress lanes for an invalid stored viewMode', async () => {
    localStorage.setItem('timeline:viewMode', 'kanban-nonsense');
    await renderRoot();
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-mode', 'progress');
  });

  it('persists groupBy to localStorage on change', async () => {
    await renderRoot();
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'chapter' } });
    expect(localStorage.getItem('timeline:groupBy')).toBe('chapter');
  });

  it('restores groupBy from localStorage on mount', async () => {
    localStorage.setItem('timeline:groupBy', 'character');
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('groupby-select')).toHaveValue('character');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'character');
  });

  it('falls back to none for an invalid stored groupBy', async () => {
    localStorage.setItem('timeline:groupBy', 'mood');
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('groupby-select')).toHaveValue('none');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'none');
  });
});

// ─── Grouping passthrough ───

describe('TimelineRoot — grouping', () => {
  it('passes the selected groupBy down to the spreadsheet view', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'none');
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'arc' } });
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'arc');
  });

  it('offers all five grouping options', async () => {
    await renderRoot();
    const options = Array.from(
      screen.getByTestId('groupby-select').querySelectorAll('option'),
    ).map(o => o.getAttribute('value'));
    expect(options).toEqual(['none', 'arc', 'chapter', 'character', 'location']);
  });

  it('keeps groupBy when switching views', async () => {
    await renderRoot();
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'location' } });
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'location');
  });
});

// ─── Selection sync ───

describe('TimelineRoot — selection', () => {
  it('lifts the child selection into TimelineRoot', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
  });

  it('clears the selection when the view mode switches', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '0');
  });
});

// ─── Null story ───

describe('TimelineRoot — null story', () => {
  it('renders without crashing when story is null', async () => {
    expect(() => render(<TimelineRoot story={null} />)).not.toThrow();
    expect(screen.getByTestId('timeline-root')).toBeInTheDocument();
    await act(async () => {});
  });

  it('the lanes are vault-scoped — they render without a story', async () => {
    await renderRoot(null);
    expect(screen.getByTestId('mock-axis')).toBeInTheDocument();
    expect(screen.queryByTestId('tlr-no-story')).toBeNull();
  });

  it('shows the no-story state for the relations/subway views', async () => {
    await renderRoot(null);
    fireEvent.click(screen.getByTestId('view-mode-relations'));
    expect(screen.getByTestId('tlr-no-story')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-relationships')).toBeNull();
  });
});

// ─── M22: picker + calendar editor (unchanged surface) ───

describe('TimelineRoot — picker + calendar editor', () => {
  it('Edit calendar… opens the M22 calendar editor and persists preset picks', async () => {
    const api = setupApi();
    await renderRoot();
    fireEvent.click(await screen.findByRole('button', { name: /Active timeline:/i }));
    fireEvent.click(screen.getByTestId('timeline-edit-calendar'));
    expect(screen.getByTestId('calendar-editor-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cem-preset-aeon-13'));
    await act(async () => {});
    expect(api.timelinesUpsert).toHaveBeenCalledWith({
      id: 'tl-story',
      name: 'Story Timeline',
      kind: 'story',
      calendar: { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 },
    });
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Calendar set — Strange world — 13 × 28 · 18h');
  });

  it('+ New timeline creates one immediately and switches to it (prototype tlNewTimeline)', async () => {
    const api = setupApi();
    await renderRoot();
    fireEvent.click(await screen.findByRole('button', { name: /Active timeline:/i }));
    fireEvent.click(screen.getByTestId('timeline-new'));
    await act(async () => {});
    expect(api.timelinesUpsert).toHaveBeenCalledWith({ name: 'New Timeline', kind: 'custom' });
    expect(api.timelinesSetActive).toHaveBeenCalledWith('tl-story');
    expect(screen.getByTestId('app-toast')).toHaveTextContent('New timeline — add spans');
  });
});

// ─── M23: timeline auto-build from vault Story Plans ───

describe('TimelineRoot — M23 plan auto-build', () => {
  const STORY_WITH_CHAPTERS: Story = {
    ...STORY,
    chapters: [
      {
        id: 'ch-1',
        title: 'The Quiet Before',
        path: 'chapters/ch-1',
        order: 0,
        scenes: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
  };

  function setupPlanApi(planContent: string) {
    const base = setupApi() as unknown as Record<string, unknown>;
    base.timelineGetScenes = vi.fn().mockResolvedValue({
      scenes: [
        {
          id: 'sc-1',
          title: "The Watcher's Call",
          chapterId: 'ch-1',
          timelineMetadata: { wordCount: 900 },
        },
      ],
    });
    base.listNotesVault = vi.fn().mockResolvedValue({
      items: [
        { path: 'Plans/gate.md', name: 'gate.md', isDirectory: false, modifiedAt: '2026-07-01T00:00:00.000Z' },
      ],
    });
    base.readNotesVault = vi.fn().mockResolvedValue({ content: planContent, path: 'Plans/gate.md' });
    return base;
  }

  it('merges planned beats from Plans/ notes into the axis chapter cells', async () => {
    setupPlanApi("- Signal fires\n- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    // ch-1 + the synthetic "Planned from notes" chapter for the two
    // unwritten beats (Signal fires, Finale).
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-chapter-count', '2');
    expect((window.api.readNotesVault as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('Plans/gate.md');
  });

  it('shows the skip-backward flag chip for planned scenes left behind', async () => {
    setupPlanApi("- Signal fires\n- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    const chip = await screen.findByTestId('tl-skip-flags');
    expect(chip).toHaveTextContent('1 planned scene skipped');
    expect(chip).toHaveAttribute('title', 'Signal fires');
  });

  it('shows no skip chip when writing follows plan order', async () => {
    setupPlanApi("- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    await screen.findByTestId('tl-legend');
    expect(screen.queryByTestId('tl-skip-flags')).toBeNull();
  });

  it('renders from written scenes alone when the vault has no plan notes', async () => {
    const base = setupPlanApi('');
    (base.listNotesVault as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [] });
    await renderRoot(STORY_WITH_CHAPTERS);
    expect(screen.getByTestId('mock-axis')).toHaveAttribute('data-chapter-count', '1');
    expect(screen.queryByTestId('tl-skip-flags')).toBeNull();
  });
});

// ─── groupScenes F5 extension (real implementation via importOriginal) ───

describe('groupScenes — F5 chapter/location grouping', () => {
  it('groups by chapter and uses chapter titles', async () => {
    const s1 = makeScene({ chapterId: 'ch-1' });
    const s2 = makeScene({ chapterId: 'ch-2' });
    const groups = groupScenes([s1, s2], 'chapter', [], [], [], [
      { id: 'ch-1', title: 'Chapter One' },
      { id: 'ch-2', title: 'Chapter Two' },
    ]);
    expect(groups.map(g => g.label)).toEqual(['Chapter One', 'Chapter Two']);
    expect(groups.find(g => g.key === 'ch-1')!.scenes[0]).toBe(s1);
  });

  it('creates "No Chapter" group for scenes without a chapterId', async () => {
    const groups = groupScenes([makeScene({ chapterId: '' })], 'chapter', [], [], [], []);
    expect(groups[0].key).toBe('__unassigned__');
    expect(groups[0].label).toBe('No Chapter');
  });

  it('groups by location and uses location names', async () => {
    const s1 = makeScene({ locationId: 'loc-1' });
    const s2 = makeScene({ locationId: '' });
    const groups = groupScenes([s1, s2], 'location', [], [], [{ id: 'loc-1', name: 'The Keep' }]);
    const keep = groups.find(g => g.key === 'loc-1')!;
    expect(keep.label).toBe('The Keep');
    expect(keep.scenes[0]).toBe(s1);
    expect(groups.find(g => g.key === '__unassigned__')!.label).toBe('No Location');
  });
});
