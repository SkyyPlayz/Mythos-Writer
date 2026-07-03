// SKY-3185 — F5: TimelineRoot view-switcher + grouping tests (vitest + @testing-library/react).
//
// Coverage:
//   - View switch: Spreadsheet | AEON | AEON Track render exactly one surface
//   - localStorage persistence + restore for timeline:viewMode / timeline:groupBy
//   - Invalid stored values fall back to defaults (spreadsheet / none)
//   - groupBy passthrough to the spreadsheet view
//   - Selection cleared on view switch (no stale cross-view state)
//   - Track mode forwards the switcher into TrackTimeline (no double header)
//   - Null story renders without crashing
//   - groupScenes chapter/location grouping (F5 extension, real implementation)

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TimelineRoot from './TimelineRoot';
import { groupScenes } from './TimelineSpreadsheet';
import type { SpreadsheetScene } from './TimelineSpreadsheet';
import type { Story } from './types';

// ─── Child-view mocks ───
// The three surfaces are mocked so tests exercise TimelineRoot's state ownership
// (viewMode / groupBy / selectedIds) through the real TimelineHeader controls.
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

vi.mock('./AeonLaneView', () => ({
  default: ({ selectedIds }: { selectedIds?: Set<string> }) => (
    <div data-testid="mock-aeon" data-selected-count={selectedIds?.size ?? 0}>AEON lanes</div>
  ),
}));

vi.mock('./TrackTimeline', () => ({
  default: ({ viewMode, onViewModeChange }: {
    viewMode?: string;
    onViewModeChange?: (mode: 'spreadsheet' | 'aeon' | 'track') => void;
  }) => (
    <div data-testid="mock-track" data-viewmode={viewMode ?? 'unset'}>
      <button
        type="button"
        data-testid="mock-track-to-spreadsheet"
        onClick={() => onViewModeChange?.('spreadsheet')}
      >
        back to spreadsheet
      </button>
    </div>
  ),
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

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

// ─── View switcher ───

describe('TimelineRoot — view switcher', () => {
  it('renders the spreadsheet view by default', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-aeon')).toBeNull();
    expect(screen.queryByTestId('mock-track')).toBeNull();
  });

  it('renders the header with the view-mode toggle', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Timeline view mode' })).toBeInTheDocument();
  });

  it('switches to the AEON lane view on AEON click', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('view-mode-aeon'));
    expect(screen.getByTestId('mock-aeon')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
  });

  it('switches to the track view on AEON Track click and hands the header to TrackTimeline', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('view-mode-track'));
    expect(screen.getByTestId('mock-track')).toBeInTheDocument();
    expect(screen.getByTestId('mock-track')).toHaveAttribute('data-viewmode', 'track');
    expect(screen.queryByTestId('mock-spreadsheet')).toBeNull();
    // TimelineRoot must NOT mount its own header in track mode — TrackTimeline
    // renders one internally (its zoom is the track viewport zoom).
    expect(screen.queryByTestId('timeline-header')).toBeNull();
  });

  it('switcher forwarded into track mode can switch back to spreadsheet', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('view-mode-track'));
    fireEvent.click(screen.getByTestId('mock-track-to-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-track')).toBeNull();
  });

  it('sets aria-pressed on the active mode button only', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-aeon')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-track')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('view-mode-aeon'));
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-aeon')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the pre-F5 accessible button names (Spreadsheet / AEON / AEON Track)', () => {
    render(<TimelineRoot story={STORY} />);
    const toggle = screen.getByTestId('view-mode-toggle');
    expect(toggle).toHaveTextContent('Spreadsheet');
    expect(screen.getByRole('button', { name: 'AEON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AEON Track/ })).toBeInTheDocument();
  });
});

// ─── localStorage persistence ───

describe('TimelineRoot — persistence', () => {
  it('persists viewMode to localStorage on switch', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('view-mode-track'));
    expect(localStorage.getItem('timeline:viewMode')).toBe('track');
    fireEvent.click(screen.getByTestId('mock-track-to-spreadsheet'));
    expect(localStorage.getItem('timeline:viewMode')).toBe('spreadsheet');
  });

  it('restores viewMode from localStorage on mount', () => {
    localStorage.setItem('timeline:viewMode', 'aeon');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-aeon')).toBeInTheDocument();
  });

  it('falls back to spreadsheet for an invalid stored viewMode', () => {
    localStorage.setItem('timeline:viewMode', 'kanban-nonsense');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
  });

  it('persists groupBy to localStorage on change', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'chapter' } });
    expect(localStorage.getItem('timeline:groupBy')).toBe('chapter');
  });

  it('restores groupBy from localStorage on mount', () => {
    localStorage.setItem('timeline:groupBy', 'character');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('groupby-select')).toHaveValue('character');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'character');
  });

  it('falls back to none for an invalid stored groupBy', () => {
    localStorage.setItem('timeline:groupBy', 'mood');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('groupby-select')).toHaveValue('none');
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'none');
  });
});

// ─── Grouping passthrough ───

describe('TimelineRoot — grouping', () => {
  it('passes the selected groupBy down to the spreadsheet view', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'none');
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'arc' } });
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'arc');
  });

  it('offers all five grouping options', () => {
    render(<TimelineRoot story={STORY} />);
    const options = Array.from(
      screen.getByTestId('groupby-select').querySelectorAll('option'),
    ).map(o => o.getAttribute('value'));
    expect(options).toEqual(['none', 'arc', 'chapter', 'character', 'location']);
  });

  it('keeps groupBy when switching views', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'location' } });
    fireEvent.click(screen.getByTestId('view-mode-aeon'));
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'location');
  });
});

// ─── Selection sync ───

describe('TimelineRoot — selection', () => {
  it('lifts the child selection into TimelineRoot', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
  });

  it('clears the selection when the view mode switches', () => {
    render(<TimelineRoot story={STORY} />);
    fireEvent.click(screen.getByTestId('mock-select-scene'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '1');
    fireEvent.click(screen.getByTestId('view-mode-aeon'));
    expect(screen.getByTestId('mock-aeon')).toHaveAttribute('data-selected-count', '0');
    fireEvent.click(screen.getByTestId('view-mode-spreadsheet'));
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-selected-count', '0');
  });
});

// ─── Null story ───

describe('TimelineRoot — null story', () => {
  it('renders without crashing when story is null', () => {
    expect(() => render(<TimelineRoot story={null} />)).not.toThrow();
    expect(screen.getByTestId('timeline-root')).toBeInTheDocument();
  });

  it('renders the header with an empty title when no story is selected', () => {
    render(<TimelineRoot story={null} />);
    expect(screen.getByTestId('timeline-header')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
  });
});

// ─── groupScenes F5 extension (real implementation via importOriginal) ───

describe('groupScenes — F5 chapter/location grouping', () => {
  it('groups by chapter and uses chapter titles', () => {
    const s1 = makeScene({ chapterId: 'ch-1' });
    const s2 = makeScene({ chapterId: 'ch-2' });
    const groups = groupScenes([s1, s2], 'chapter', [], [], [], [
      { id: 'ch-1', title: 'Chapter One' },
      { id: 'ch-2', title: 'Chapter Two' },
    ]);
    expect(groups.map(g => g.label)).toEqual(['Chapter One', 'Chapter Two']);
    expect(groups.find(g => g.key === 'ch-1')!.scenes[0]).toBe(s1);
  });

  it('creates "No Chapter" group for scenes without a chapterId', () => {
    const groups = groupScenes([makeScene({ chapterId: '' })], 'chapter', [], [], [], []);
    expect(groups[0].key).toBe('__unassigned__');
    expect(groups[0].label).toBe('No Chapter');
  });

  it('groups by location and uses location names', () => {
    const s1 = makeScene({ locationId: 'loc-1' });
    const s2 = makeScene({ locationId: '' });
    const groups = groupScenes([s1, s2], 'location', [], [], [{ id: 'loc-1', name: 'The Keep' }]);
    const keep = groups.find(g => g.key === 'loc-1')!;
    expect(keep.label).toBe('The Keep');
    expect(keep.scenes[0]).toBe(s1);
    expect(groups.find(g => g.key === '__unassigned__')!.label).toBe('No Location');
  });
});
