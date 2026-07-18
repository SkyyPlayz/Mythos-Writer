// SKY-3185 — F5: TimelineRoot view-switcher + grouping tests (vitest + @testing-library/react).
// Beta 3 M20 — grown to the prototype's five Aeon modes: Plan vs Progress /
// Structure / Spreadsheet / Relationships / Subway.
//
// Coverage:
//   - View switch: the five modes render exactly one surface each
//   - localStorage persistence + restore for timeline:viewMode / timeline:groupBy
//   - Legacy Beta-2 stored modes migrate ('aeon' → progress, 'track' → subway)
//   - Invalid stored values fall back to defaults (spreadsheet / none)
//   - Plan-vs-Progress legend renders only in progress mode
//   - Zoom segment (Year…Scene) drives the lanes zoom prop
//   - "Today" jump: lanes modes flip to progress; sheet/relations/subway keep mode
//   - groupBy passthrough to the spreadsheet view
//   - Selection cleared on view switch (no stale cross-view state)
//   - Null story renders without crashing
//   - groupScenes chapter/location grouping (F5 extension, real implementation)

import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TimelineRoot from './TimelineRoot';
import { groupScenes } from './TimelineSpreadsheet';
import type { SpreadsheetScene } from './TimelineSpreadsheet';
import type { Story } from './types';

// ─── Child-view mocks ───
// The surfaces are mocked so tests exercise TimelineRoot's state ownership
// (viewMode / groupBy / selectedIds / zoom) through the real header controls.
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

vi.mock('./TimelineLanes', () => ({
  default: ({ mode, zoom, todaySignal, data }: { mode?: string; zoom?: string; todaySignal?: number; data?: { chapters?: unknown[]; events?: unknown[] } }) => (
    <div
      data-testid="mock-lanes"
      data-mode={mode ?? 'unset'}
      data-zoom={zoom ?? 'unset'}
      data-today-signal={todaySignal ?? 0}
      data-chapter-count={data?.chapters?.length ?? 0}
      data-event-count={data?.events?.length ?? 0}
    >
      Aeon lanes
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

/** TimelineRoot loads the shared Aeon dataset itself — stub the IPC surface. */
function setupApi() {
  Object.defineProperty(window, 'api', {
    value: {
      timelineGetScenes: vi.fn().mockResolvedValue({ scenes: [] }),
      timelineListArcs: vi.fn().mockResolvedValue({ arcs: [] }),
      entityList: vi.fn().mockResolvedValue({ entities: [] }),
    },
    writable: true, configurable: true,
  });
}

/** Render TimelineRoot and flush its async Aeon data load so no state update
 *  lands outside act() (setupTests fails the test on act warnings). */
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
  it('renders the spreadsheet view by default', async () => {
    await renderRoot();
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-lanes')).toBeNull();
    expect(screen.queryByTestId('mock-relationships')).toBeNull();
    expect(screen.queryByTestId('mock-subway')).toBeNull();
  });

  it('renders the header with the view-mode toggle', async () => {
    await renderRoot();
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Timeline view mode' })).toBeInTheDocument();
  });

  it('offers the five prototype modes plus the M22 axis surface, exact labels', async () => {
    await renderRoot();
    const toggle = screen.getByTestId('view-mode-toggle');
    const labels = Array.from(toggle.querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual(['Plan vs Progress', 'Structure', 'Spreadsheet', 'Relationships', 'Subway', 'Axis']);
  });

  it('switches to the lanes view in progress mode', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    const lanes = await screen.findByTestId('mock-lanes');
    expect(lanes).toHaveAttribute('data-mode', 'progress');
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
  });

  it('switches to the same lanes surface, ungreyed, in structure mode', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    const lanes = await screen.findByTestId('mock-lanes');
    expect(lanes).toHaveAttribute('data-mode', 'structure');
  });

  it('switches to the relationships view', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-relations'));
    expect(await screen.findByTestId('mock-relationships')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
  });

  it('switches to the subway view', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-subway'));
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
  });

  it('sets aria-pressed on the active mode button only', async () => {
    await renderRoot();
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─── Plan-vs-Progress legend ───

describe('TimelineRoot — legend', () => {
  it('shows the written/planned legend only in progress mode', async () => {
    await renderRoot();
    expect(screen.queryByTestId('tl-legend')).toBeNull();
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    expect(screen.getByTestId('tl-legend')).toHaveTextContent('written');
    expect(screen.getByTestId('tl-legend')).toHaveTextContent('planned from your notes');
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    await waitFor(() => expect(screen.queryByTestId('tl-legend')).toBeNull());
  });
});

// ─── Zoom segment ───

describe('TimelineRoot — zoom segment', () => {
  it('offers the five prototype zoom levels', async () => {
    await renderRoot();
    const seg = screen.getByTestId('tl-zoom-seg');
    const labels = Array.from(seg.querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual(['Year', 'Quarter', 'Month', 'Week', 'Scene']);
  });

  it('passes the selected zoom level to the lanes view', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    expect(await screen.findByTestId('mock-lanes')).toHaveAttribute('data-zoom', 'month');
    fireEvent.click(screen.getByTestId('tl-zoom-week'));
    expect(screen.getByTestId('tl-zoom-week')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mock-lanes')).toHaveAttribute('data-zoom', 'week');
  });
});

// ─── Today jump ───

describe('TimelineRoot — Today jump', () => {
  it('flips structure mode to progress (prototype tlToday)', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-structure'));
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('view-mode-progress')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('mock-lanes')).toHaveAttribute('data-mode', 'progress');
  });

  it('keeps the sheet / relations / subway modes unchanged', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('view-mode-subway'));
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('view-mode-subway')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
  });

  it('bumps the lanes todaySignal so the here-chapter scrolls into view', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    expect(await screen.findByTestId('mock-lanes')).toHaveAttribute('data-today-signal', '0');
    fireEvent.click(screen.getByTestId('tl-today-btn'));
    expect(screen.getByTestId('mock-lanes')).toHaveAttribute('data-today-signal', '1');
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
    expect(await screen.findByTestId('mock-lanes')).toHaveAttribute('data-mode', 'progress');
  });

  it('migrates the legacy Beta-2 "track" mode to the subway view', async () => {
    localStorage.setItem('timeline:viewMode', 'track');
    await renderRoot();
    expect(await screen.findByTestId('mock-subway')).toBeInTheDocument();
  });

  it('falls back to spreadsheet for an invalid stored viewMode', async () => {
    localStorage.setItem('timeline:viewMode', 'kanban-nonsense');
    await renderRoot();
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
  });

  it('persists groupBy to localStorage on change', async () => {
    await renderRoot();
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'chapter' } });
    expect(localStorage.getItem('timeline:groupBy')).toBe('chapter');
  });

  it('restores groupBy from localStorage on mount', async () => {
    localStorage.setItem('timeline:groupBy', 'character');
    await renderRoot();
    expect(screen.getByTestId('groupby-select')).toHaveValue('character');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'character');
  });

  it('falls back to none for an invalid stored groupBy', async () => {
    localStorage.setItem('timeline:groupBy', 'mood');
    await renderRoot();
    expect(screen.getByTestId('groupby-select')).toHaveValue('none');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'none');
  });
});

// ─── Grouping passthrough ───

describe('TimelineRoot — grouping', () => {
  it('passes the selected groupBy down to the spreadsheet view', async () => {
    await renderRoot();
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
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    await screen.findByTestId('mock-lanes');
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'location');
  });
});

// ─── Selection sync ───

describe('TimelineRoot — selection', () => {
  it('lifts the child selection into TimelineRoot', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
  });

  it('clears the selection when the view mode switches', async () => {
    await renderRoot();
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    await screen.findByTestId('mock-lanes');
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '0');
  });
});

// ─── Null story ───

describe('TimelineRoot — null story', () => {
  it('renders without crashing when story is null', async () => {
    expect(() => render(<TimelineRoot story={null} />)).not.toThrow();
    expect(screen.getByTestId('timeline-root')).toBeInTheDocument();
  });

  it('renders the header with the toggle when no story is selected', async () => {
    await renderRoot(null);
    expect(screen.getByTestId('timeline-header')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
  });

  it('shows the no-story state for the Aeon views', async () => {
    await renderRoot(null);
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    expect(screen.getByTestId('tlr-no-story')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-lanes')).toBeNull();
  });
});

// ─── M22: Axis engine mode + calendar editor ───

describe('TimelineRoot — M22 axis mode', () => {
  const M21_STORE = {
    schemaVersion: 1 as const,
    activeTimelineId: 'tl-story',
    timelines: [
      {
        id: 'tl-story', name: 'Story Timeline', kind: 'story' as const, axis: 'calendar' as const,
        calendar: { preset: 'standard' as const, monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    eras: [], spans: [], rows: [],
    events: [{ id: 'ev-1', timelineId: 'tl-story', name: 'Inciting incident', when: 2.4 }],
  };

  function setupTimelinesApi() {
    Object.defineProperty(window, 'api', {
      value: {
        timelineGetScenes: vi.fn().mockResolvedValue({ scenes: [] }),
        timelineListArcs: vi.fn().mockResolvedValue({ arcs: [] }),
        entityList: vi.fn().mockResolvedValue({ entities: [] }),
        timelinesGetStore: vi.fn().mockResolvedValue({ store: M21_STORE }),
        timelinesUpsert: vi.fn().mockResolvedValue({ ok: true, id: 'tl-story', store: M21_STORE }),
        timelinesSetActive: vi.fn().mockResolvedValue({ ok: true, store: M21_STORE }),
        timelinesUpsertItem: vi.fn().mockResolvedValue({ ok: true, store: M21_STORE }),
        timelinesDeleteItem: vi.fn().mockResolvedValue({ ok: true, store: M21_STORE }),
      },
      writable: true, configurable: true,
    });
  }

  it('renders the axis engine in axis mode and hides the legacy zoom/group/Today controls', async () => {
    setupTimelinesApi();
    await renderRoot();
    fireEvent.click(screen.getByTestId('view-mode-axis'));
    expect(await screen.findByTestId('timeline-axis-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
    expect(screen.queryByTestId('tl-zoom-seg')).toBeNull();
    expect(screen.queryByTestId('tl-today-btn')).toBeNull();
    expect(screen.queryByTestId('groupby-select')).toBeNull();
    // the axis engine's own zoom seg is present instead
    expect(screen.getByTestId('ax-zoom-seg')).toBeInTheDocument();
  });

  it('shows the unavailable state when the timelines store cannot load', async () => {
    await renderRoot(); // default api: no timelinesGetStore
    fireEvent.click(screen.getByTestId('view-mode-axis'));
    expect(screen.getByTestId('tlr-axis-unavailable')).toBeInTheDocument();
  });

  it('axis mode does not require a story', async () => {
    setupTimelinesApi();
    await renderRoot(null);
    fireEvent.click(screen.getByTestId('view-mode-axis'));
    expect(await screen.findByTestId('timeline-axis-view')).toBeInTheDocument();
    expect(screen.queryByTestId('tlr-no-story')).toBeNull();
  });

  it('Edit calendar… opens the M22 calendar editor and persists preset picks', async () => {
    setupTimelinesApi();
    await renderRoot();
    fireEvent.click(await screen.findByRole('button', { name: /Active timeline:/i }));
    fireEvent.click(screen.getByTestId('timeline-edit-calendar'));
    expect(screen.getByTestId('calendar-editor-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cem-preset-aeon-13'));
    await act(async () => {});
    expect(window.api.timelinesUpsert).toHaveBeenCalledWith({
      id: 'tl-story',
      name: 'Story Timeline',
      kind: 'story',
      calendar: { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 },
    });
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Calendar set — Strange world — 13 × 28 · 18h');
  });

  it('+ New timeline creates one immediately and switches to it (prototype tlNewTimeline)', async () => {
    setupTimelinesApi();
    await renderRoot();
    fireEvent.click(await screen.findByRole('button', { name: /Active timeline:/i }));
    fireEvent.click(screen.getByTestId('timeline-new'));
    await act(async () => {});
    expect(window.api.timelinesUpsert).toHaveBeenCalledWith({ name: 'New Timeline', kind: 'custom' });
    expect(window.api.timelinesSetActive).toHaveBeenCalledWith('tl-story');
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
    Object.defineProperty(window, 'api', {
      value: {
        timelineGetScenes: vi.fn().mockResolvedValue({
          scenes: [
            {
              id: 'sc-1',
              title: "The Watcher's Call",
              chapterId: 'ch-1',
              timelineMetadata: { wordCount: 900 },
            },
          ],
        }),
        timelineListArcs: vi.fn().mockResolvedValue({ arcs: [] }),
        entityList: vi.fn().mockResolvedValue({ entities: [] }),
        listNotesVault: vi.fn().mockResolvedValue({
          items: [
            { path: 'Plans/gate.md', name: 'gate.md', isDirectory: false, modifiedAt: '2026-07-01T00:00:00.000Z' },
          ],
        }),
        readNotesVault: vi.fn().mockResolvedValue({ content: planContent, path: 'Plans/gate.md' }),
      },
      writable: true, configurable: true,
    });
  }

  it('merges planned beats from Plans/ notes into the lanes dataset', async () => {
    setupPlanApi("- Signal fires\n- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    const lanes = await screen.findByTestId('mock-lanes');
    // ch-1 + the synthetic "Planned from notes" chapter for the two
    // unwritten beats (Signal fires, Finale).
    expect(lanes).toHaveAttribute('data-chapter-count', '2');
    expect((window.api.readNotesVault as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('Plans/gate.md');
  });

  it('shows the skip-backward flag chip for planned scenes left behind', async () => {
    setupPlanApi("- Signal fires\n- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    const chip = await screen.findByTestId('tl-skip-flags');
    expect(chip).toHaveTextContent('1 planned scene skipped');
    expect(chip).toHaveAttribute('title', 'Signal fires');
  });

  it('shows no skip chip when writing follows plan order', async () => {
    setupPlanApi("- The Watcher's Call\n- Finale");
    await renderRoot(STORY_WITH_CHAPTERS);
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    await screen.findByTestId('tl-legend');
    expect(screen.queryByTestId('tl-skip-flags')).toBeNull();
  });

  it('renders from written scenes alone when the vault has no plan notes', async () => {
    setupPlanApi('');
    (window.api.listNotesVault as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [] });
    await renderRoot(STORY_WITH_CHAPTERS);
    fireEvent.click(screen.getByTestId('view-mode-progress'));
    const lanes = await screen.findByTestId('mock-lanes');
    expect(lanes).toHaveAttribute('data-chapter-count', '1');
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
