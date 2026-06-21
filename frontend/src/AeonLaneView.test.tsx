// SKY-3183 — AeonLaneView unit tests (vitest + @testing-library/react).
// SKY-3184 — F4 additions: hover tooltip, click detail popover, double-click→editor,
//            right-click context menu, keyboard navigation (arrows, Home/End).
//
// Coverage:
//   - Empty / loading / error states
//   - Lane grouping
//   - Written vs planned visual class
//   - Confidence badge
//   - Accessibility (role=button, tabIndex roving, aria-label, aria-pressed, region)
//   - Click → detail popover (NOT onOpenScene directly)
//   - Double-click → onOpenScene
//   - Hover tooltip show/hide
//   - Right-click → context menu; "Open in editor" → onOpenScene
//   - Keyboard: Enter/Space → popover; Arrow keys move focus; Home/End jump
//   - Time axis
//   - Stat bar

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import AeonLaneView from './AeonLaneView';
import type { Story } from './types';

interface MockScene {
  id: string;
  title: string;
  entityLinks?: { arcs?: string[] };
  chronologicalTime?: { date?: string; confidence?: number };
  timelineMetadata?: { wordCount?: number | null };
}

interface MockArc {
  id: string;
  title: string;
  color: string;
}

const STORY: Story = {
  id: 'story-1',
  title: 'The Neon Saga',
  path: '/vault/story-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
} as unknown as Story;

function makeScene(overrides: Partial<MockScene> = {}): MockScene {
  return {
    id: 'scene-1',
    title: 'Opening Scene',
    entityLinks: { arcs: ['arc-1'] },
    chronologicalTime: { date: '2025-03-01', confidence: 0.9 },
    timelineMetadata: { wordCount: 800 },
    ...overrides,
  };
}

function makeArc(overrides: Partial<MockArc> = {}): MockArc {
  return { id: 'arc-1', title: 'Act One', color: '#00f0ff', ...overrides };
}

function setupApi(scenes: MockScene[] = [], arcs: MockArc[] = []) {
  const mockGetScenes = vi.fn().mockResolvedValue({ scenes });
  const mockListArcs = vi.fn().mockResolvedValue({ arcs });
  Object.defineProperty(window, 'api', {
    value: { timelineGetScenes: mockGetScenes, timelineListArcs: mockListArcs },
    writable: true, configurable: true,
  });
  return { mockGetScenes, mockListArcs };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ─── States ───

describe('AeonLaneView — states', () => {
  it('renders no-story empty state when story=null', () => {
    setupApi();
    render(<AeonLaneView story={null} />);
    expect(screen.getByTestId('aeon-empty-no-story')).toBeInTheDocument();
  });

  it('shows loading state then resolves', async () => {
    let resolve!: (v: unknown) => void;
    Object.defineProperty(window, 'api', {
      value: {
        timelineGetScenes: () => new Promise(r => { resolve = r; }),
        timelineListArcs: vi.fn().mockResolvedValue({ arcs: [] }),
      },
      writable: true, configurable: true,
    });
    render(<AeonLaneView story={STORY} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolve({ scenes: [] });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows error state when API rejects', async () => {
    Object.defineProperty(window, 'api', {
      value: {
        timelineGetScenes: vi.fn().mockRejectedValue(new Error('DB error')),
        timelineListArcs: vi.fn().mockRejectedValue(new Error('DB error')),
      },
      writable: true, configurable: true,
    });
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('DB error');
  });

  it('shows no-scenes empty state when scenes array is empty', async () => {
    setupApi([], []);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getByTestId('aeon-empty-no-scenes')).toBeInTheDocument());
  });
});

// ─── Lane grouping ───

describe('AeonLaneView — lane grouping', () => {
  it('renders a lane for each arc that has scenes', async () => {
    setupApi([makeScene({ entityLinks: { arcs: ['arc-1'] } })], [makeArc({ id: 'arc-1', title: 'Act One' })]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByLabelText('Arc lane: Act One')).toBeInTheDocument();
  });

  it('omits empty arc lanes (arc with no scenes)', async () => {
    setupApi(
      [makeScene({ entityLinks: { arcs: ['arc-1'] } })],
      [makeArc({ id: 'arc-1', title: 'Act One' }), makeArc({ id: 'arc-2', title: 'Act Two' })],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByLabelText('Arc lane: Act One')).toBeInTheDocument();
    expect(screen.queryByLabelText('Arc lane: Act Two')).toBeNull();
  });

  it('adds "No Arc" lane for scenes with no arcIds', async () => {
    setupApi([makeScene({ entityLinks: { arcs: [] } })], []);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByLabelText('Arc lane: No Arc')).toBeInTheDocument();
  });

  it('scene with multiple arcIds appears in all matching lanes', async () => {
    setupApi(
      [makeScene({ id: 'sc-x', entityLinks: { arcs: ['arc-1', 'arc-2'] } })],
      [makeArc({ id: 'arc-1', title: 'Act One' }), makeArc({ id: 'arc-2', title: 'Act Two' })],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2);
  });
});

// ─── Written vs planned ───

describe('AeonLaneView — written vs planned', () => {
  it('wordCount > 0 → written class', async () => {
    setupApi([makeScene({ timelineMetadata: { wordCount: 500 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveClass('aeon-card--written');
  });

  it('wordCount null → planned class', async () => {
    setupApi([makeScene({ timelineMetadata: { wordCount: null } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveClass('aeon-card--planned');
  });

  it('wordCount 0 → planned class', async () => {
    setupApi([makeScene({ timelineMetadata: { wordCount: 0 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveClass('aeon-card--planned');
  });
});

// ─── Confidence badge ───

describe('AeonLaneView — confidence badge', () => {
  it('confidence 0.9 → ✓ badge with high class', async () => {
    setupApi([makeScene({ chronologicalTime: { date: '2025-03-01', confidence: 0.9 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-conf-badge'));
    expect(screen.getByTestId('aeon-conf-badge')).toHaveTextContent('✓');
    expect(screen.getByTestId('aeon-conf-badge')).toHaveClass('aeon-card__conf-badge--high');
  });

  it('confidence exactly 0.8 → ✓ badge (boundary)', async () => {
    setupApi([makeScene({ chronologicalTime: { date: '2025-03-01', confidence: 0.8 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-conf-badge'));
    expect(screen.getByTestId('aeon-conf-badge')).toHaveTextContent('✓');
  });

  it('confidence 0.5 → ? badge with low class', async () => {
    setupApi([makeScene({ chronologicalTime: { date: '2025-03-01', confidence: 0.5 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-conf-badge'));
    expect(screen.getByTestId('aeon-conf-badge')).toHaveTextContent('?');
    expect(screen.getByTestId('aeon-conf-badge')).toHaveClass('aeon-card__conf-badge--low');
  });

  it('confidence badge is aria-hidden', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-conf-badge'));
    expect(screen.getByTestId('aeon-conf-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});

// ─── Accessibility ───

describe('AeonLaneView — accessibility', () => {
  beforeEach(() => { setupApi([makeScene()], [makeArc()]); });

  it('scene card has role=button', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveAttribute('role', 'button');
  });

  it('first card has tabIndex=0 (roving tabindex default)', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveAttribute('tabindex', '0');
  });

  it('scene card has meaningful aria-label', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const label = screen.getByTestId('aeon-scene-card').getAttribute('aria-label') ?? '';
    expect(label).toContain('Opening Scene');
    expect(label).toContain('confidence');
  });

  it('the lane view has role=region with an aria-label', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByRole('region', { name: /aeon timeline/i })).toBeInTheDocument();
  });

  it('aria-pressed=false on unselected scene card', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─── Interaction: click / double-click / keyboard ───

describe('AeonLaneView — interaction', () => {
  it('click shows detail popover', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
  });

  it('click does NOT call onOpenScene directly', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('detail popover "Open in Editor" calls onOpenScene', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-popover-open-in-editor'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('double-click calls onOpenScene with scene id', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.dblClick(screen.getByTestId('aeon-scene-card'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('does not crash when onOpenScene is omitted on double-click', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(() => fireEvent.dblClick(screen.getByTestId('aeon-scene-card'))).not.toThrow();
  });

  it('clicking a card sets aria-pressed=true (selection)', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking same card again deselects and closes detail popover', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    fireEvent.click(card);
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
    fireEvent.click(card);
    expect(screen.queryByTestId('aeon-detail-popover')).toBeNull();
    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('Enter key shows detail popover', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.keyDown(screen.getByTestId('aeon-scene-card'), { key: 'Enter' });
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
  });

  it('Space key shows detail popover', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.keyDown(screen.getByTestId('aeon-scene-card'), { key: ' ' });
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
  });

  it('detail popover close button dismisses it', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-popover-close'));
    expect(screen.queryByTestId('aeon-detail-popover')).toBeNull();
  });

  it('detail popover shows scene title', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-detail-popover')).toHaveTextContent('Opening Scene');
  });
});

// ─── Hover tooltip ───

describe('AeonLaneView — hover tooltip', () => {
  it('mouseenter shows tooltip', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.mouseEnter(screen.getByTestId('aeon-scene-card'), { clientX: 100, clientY: 100 });
    expect(screen.getByTestId('aeon-hover-tooltip')).toBeInTheDocument();
  });

  it('tooltip has role=tooltip', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.mouseEnter(screen.getByTestId('aeon-scene-card'), { clientX: 100, clientY: 100 });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('mouseleave hides tooltip', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    fireEvent.mouseEnter(card, { clientX: 100, clientY: 100 });
    expect(screen.getByTestId('aeon-hover-tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    expect(screen.queryByTestId('aeon-hover-tooltip')).toBeNull();
  });

  it('tooltip is hidden when detail popover is open', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    fireEvent.mouseEnter(card, { clientX: 100, clientY: 100 });
    fireEvent.click(card);
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
    expect(screen.queryByTestId('aeon-hover-tooltip')).toBeNull();
  });
});

// ─── Context menu ───

describe('AeonLaneView — context menu', () => {
  it('right-click shows context menu', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.contextMenu(screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-context-menu')).toBeInTheDocument();
  });

  it('context menu has role=menu', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.contextMenu(screen.getByTestId('aeon-scene-card'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('context menu "Open in editor" calls onOpenScene', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.contextMenu(screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-context-open-in-editor'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('Escape key dismisses context menu', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.contextMenu(screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-context-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('aeon-scene-context-menu')).toBeNull();
  });

  it('right-click closes detail popover', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    fireEvent.click(card);
    expect(screen.getByTestId('aeon-detail-popover')).toBeInTheDocument();
    fireEvent.contextMenu(card);
    expect(screen.queryByTestId('aeon-detail-popover')).toBeNull();
    expect(screen.getByTestId('aeon-scene-context-menu')).toBeInTheDocument();
  });
});

// ─── Keyboard navigation ───

describe('AeonLaneView — keyboard navigation', () => {
  it('ArrowRight moves focus to next card in lane', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'Scene Two', chronologicalTime: { date: '2025-04-01', confidence: 0.9 } }),
      ],
      [makeArc()],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2));
    const cards = screen.getAllByTestId('aeon-scene-card');
    expect(cards[0]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(cards[0], { key: 'ArrowRight' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
    expect(cards[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowLeft moves focus to previous card', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'Scene Two', chronologicalTime: { date: '2025-04-01', confidence: 0.9 } }),
      ],
      [makeArc()],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2));
    const cards = screen.getAllByTestId('aeon-scene-card');
    fireEvent.keyDown(cards[0], { key: 'ArrowRight' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
    fireEvent.keyDown(cards[1], { key: 'ArrowLeft' });
    await waitFor(() => expect(cards[0]).toHaveAttribute('tabindex', '0'));
  });

  it('Home moves focus to first card', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'S2', chronologicalTime: { date: '2025-04-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-3', title: 'S3', chronologicalTime: { date: '2025-05-01', confidence: 0.9 } }),
      ],
      [makeArc()],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(3));
    const cards = screen.getAllByTestId('aeon-scene-card');
    fireEvent.keyDown(cards[0], { key: 'ArrowRight' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
    fireEvent.keyDown(cards[1], { key: 'Home' });
    await waitFor(() => expect(cards[0]).toHaveAttribute('tabindex', '0'));
  });

  it('End moves focus to last card', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'S2', chronologicalTime: { date: '2025-04-01', confidence: 0.9 } }),
      ],
      [makeArc()],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2));
    const cards = screen.getAllByTestId('aeon-scene-card');
    fireEvent.keyDown(cards[0], { key: 'End' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
  });

  it('ArrowDown moves focus to next lane', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', entityLinks: { arcs: ['arc-1'] }, chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'S2', entityLinks: { arcs: ['arc-2'] }, chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
      ],
      [makeArc({ id: 'arc-1', title: 'Act One' }), makeArc({ id: 'arc-2', title: 'Act Two' })],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2));
    const cards = screen.getAllByTestId('aeon-scene-card');
    expect(cards[0]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(cards[0], { key: 'ArrowDown' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
    expect(cards[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowUp moves focus to previous lane', async () => {
    setupApi(
      [
        makeScene({ id: 'scene-1', entityLinks: { arcs: ['arc-1'] }, chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
        makeScene({ id: 'scene-2', title: 'S2', entityLinks: { arcs: ['arc-2'] }, chronologicalTime: { date: '2025-03-01', confidence: 0.9 } }),
      ],
      [makeArc({ id: 'arc-1', title: 'Act One' }), makeArc({ id: 'arc-2', title: 'Act Two' })],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => expect(screen.getAllByTestId('aeon-scene-card').length).toBe(2));
    const cards = screen.getAllByTestId('aeon-scene-card');
    fireEvent.keyDown(cards[0], { key: 'ArrowDown' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('tabindex', '0'));
    fireEvent.keyDown(cards[1], { key: 'ArrowUp' });
    await waitFor(() => expect(cards[0]).toHaveAttribute('tabindex', '0'));
  });

  it('ArrowLeft at lane start does not crash', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(() => fireEvent.keyDown(screen.getByTestId('aeon-scene-card'), { key: 'ArrowLeft' })).not.toThrow();
  });
});

// ─── Time axis ───

describe('AeonLaneView — time axis', () => {
  it('time axis SVG is rendered when scenes have dates', async () => {
    setupApi([makeScene({ chronologicalTime: { date: '2025-03-01', confidence: 0.9 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-time-axis'));
    expect(screen.getByTestId('aeon-time-axis')).toBeInTheDocument();
  });

  it('time axis is absent when no scenes have dates', async () => {
    setupApi([makeScene({ chronologicalTime: { date: '', confidence: 0 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.queryByTestId('aeon-time-axis')).toBeNull();
  });
});

// ─── Stat bar ───

describe('AeonLaneView — stat bar', () => {
  it('shows story title in the stat bar', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByText('The Neon Saga')).toBeInTheDocument();
  });

  it('shows scene count in the stat bar', async () => {
    setupApi([makeScene(), makeScene({ id: 'scene-2', title: 'Second' })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByText(/2\/2 scenes dated/)).toBeInTheDocument();
  });
});
