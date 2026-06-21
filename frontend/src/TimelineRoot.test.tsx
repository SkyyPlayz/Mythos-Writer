// SKY-3185 — F5: TimelineRoot view-switcher + grouping tests.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TimelineRoot from './TimelineRoot';
import type { Story } from './types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./TimelineSpreadsheet', () => ({
  default: ({ groupByProp, selectedIds }: { groupByProp?: string; selectedIds?: Set<string> }) => (
    <div
      data-testid="mock-spreadsheet"
      data-groupby={groupByProp ?? 'none'}
      data-selected-count={selectedIds?.size ?? 0}
    >
      Spreadsheet View
    </div>
  ),
}));

vi.mock('./AeonLaneView', () => ({
  default: ({ selectedIds }: { selectedIds?: Set<string> }) => (
    <div
      data-testid="mock-aeon"
      data-selected-count={selectedIds?.size ?? 0}
    >
      Track View
    </div>
  ),
}));

const STORY: Story = {
  id: 's1',
  title: 'Test Story',
  path: '/test',
  chapters: [],
  createdAt: '',
  updatedAt: '',
};

// ─── localStorage cleanup ─────────────────────────────────────────────────────
// setupTests.ts installs a custom localStorageMock on window.localStorage (a plain
// object, not Storage.prototype), so vi.spyOn(Storage.prototype) does not intercept
// calls from the component.  Use the native mock directly: clear() in beforeEach
// for isolation, getItem/setItem for assertions.

beforeEach(() => localStorage.clear());

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TimelineRoot — view switcher', () => {
  it('renders spreadsheet view by default', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-spreadsheet')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-aeon')).not.toBeInTheDocument();
  });

  it('switches to track view on Track button click', async () => {
    render(<TimelineRoot story={STORY} />);
    const trackBtn = screen.getByTestId('view-mode-track');
    await act(async () => { fireEvent.click(trackBtn); });
    expect(screen.getByTestId('mock-aeon')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-spreadsheet')).not.toBeInTheDocument();
  });

  it('persists view mode to localStorage', async () => {
    render(<TimelineRoot story={STORY} />);
    await act(async () => { fireEvent.click(screen.getByTestId('view-mode-track')); });
    expect(localStorage.getItem('timeline:viewMode')).toBe('track');
  });

  it('reads viewMode from localStorage on mount', () => {
    localStorage.setItem('timeline:viewMode', 'track');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('mock-aeon')).toBeInTheDocument();
  });

  it('Spreadsheet button has aria-pressed=true when active', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('view-mode-spreadsheet')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-track')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('TimelineRoot — grouping', () => {
  it('passes groupBy to spreadsheet view', async () => {
    render(<TimelineRoot story={STORY} />);
    const select = screen.getByTestId('groupby-select');
    await act(async () => { fireEvent.change(select, { target: { value: 'arc' } }); });
    expect(screen.getByTestId('mock-spreadsheet')).toHaveAttribute('data-groupby', 'arc');
  });

  it('persists groupBy to localStorage', async () => {
    render(<TimelineRoot story={STORY} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId('groupby-select'), { target: { value: 'chapter' } });
    });
    expect(localStorage.getItem('timeline:groupBy')).toBe('chapter');
  });

  it('reads groupBy from localStorage on mount', () => {
    localStorage.setItem('timeline:groupBy', 'character');
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('groupby-select')).toHaveValue('character');
  });
});

describe('TimelineRoot — selection', () => {
  it('clears selection when view mode switches', async () => {
    render(<TimelineRoot story={STORY} />);
    const trackBtn = screen.getByTestId('view-mode-track');
    await act(async () => { fireEvent.click(trackBtn); });
    expect(screen.getByTestId('mock-aeon')).toHaveAttribute('data-selected-count', '0');
  });

  it('renders header with view-mode-toggle', () => {
    render(<TimelineRoot story={STORY} />);
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
  });
});

describe('TimelineRoot — empty/null story', () => {
  it('renders without crashing when story is null', () => {
    expect(() => render(<TimelineRoot story={null} />)).not.toThrow();
  });

  it('shows empty title in header when no story', () => {
    render(<TimelineRoot story={null} />);
    const header = screen.getByTestId('timeline-header');
    expect(header).toBeInTheDocument();
  });
});
