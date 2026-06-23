// SKY-3183 — AeonLaneView unit tests (vitest + @testing-library/react).
//
// Coverage:
//   – Empty / loading / error states
//   – Lane grouping (arc lanes, no-arc lane, empty arcs omitted)
//   – Written vs planned visual class (wordCount)
//   – Confidence badge (≥0.8 = ✓/high, <0.8 = ?/low, aria-hidden)
//   – Accessibility (role=button, tabIndex, aria-label, aria-pressed, region)
//   – Click → onOpenScene, no crash without handler
//   – Keyboard: Enter/Space trigger onClick
//   – Time axis rendered when scenes have dates
//   – Stat bar shows story title + scene count

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import AeonLaneView from './AeonLaneView';
import type { Story } from './types';

// ─── Minimal mock types that satisfy the component ───

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
    value: {
      timelineGetScenes: mockGetScenes,
      timelineListArcs: mockListArcs,
    },
    writable: true,
    configurable: true,
  });
  return { mockGetScenes, mockListArcs };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Empty / loading / error states ───

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
      writable: true,
      configurable: true,
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
      writable: true,
      configurable: true,
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
    setupApi(
      [makeScene({ entityLinks: { arcs: ['arc-1'] } })],
      [makeArc({ id: 'arc-1', title: 'Act One' })],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    expect(screen.getByLabelText('Arc lane: Act One')).toBeInTheDocument();
  });

  it('omits empty arc lanes (arc with no scenes)', async () => {
    setupApi(
      [makeScene({ entityLinks: { arcs: ['arc-1'] } })],
      [
        makeArc({ id: 'arc-1', title: 'Act One' }),
        makeArc({ id: 'arc-2', title: 'Act Two' }),
      ],
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
      [
        makeArc({ id: 'arc-1', title: 'Act One' }),
        makeArc({ id: 'arc-2', title: 'Act Two' }),
      ],
    );
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-lane-view'));
    const cards = screen.getAllByTestId('aeon-scene-card');
    expect(cards.length).toBe(2);
  });
});

// ─── Written vs planned ───

describe('AeonLaneView — written vs planned', () => {
  it('wordCount > 0 → written class', async () => {
    setupApi([makeScene({ timelineMetadata: { wordCount: 500 } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveClass('aeon-card--written');
    expect(screen.getByTestId('aeon-scene-card')).not.toHaveClass('aeon-card--planned');
  });

  it('wordCount null → planned class', async () => {
    setupApi([makeScene({ timelineMetadata: { wordCount: null } })], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveClass('aeon-card--planned');
    expect(screen.getByTestId('aeon-scene-card')).not.toHaveClass('aeon-card--written');
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
    const badge = screen.getByTestId('aeon-conf-badge');
    expect(badge).toHaveTextContent('✓');
    expect(badge).toHaveClass('aeon-card__conf-badge--high');
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
    const badge = screen.getByTestId('aeon-conf-badge');
    expect(badge).toHaveTextContent('?');
    expect(badge).toHaveClass('aeon-card__conf-badge--low');
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
  beforeEach(() => {
    setupApi([makeScene()], [makeArc()]);
  });

  it('scene card has role=button', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveAttribute('role', 'button');
  });

  it('scene card has tabIndex=0', async () => {
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
    const region = screen.getByRole('region', { name: /aeon timeline/i });
    expect(region).toBeInTheDocument();
  });

  it('aria-pressed=false on unselected scene card', async () => {
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(screen.getByTestId('aeon-scene-card')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─── Interaction ───

describe('AeonLaneView — interaction', () => {
  it('click calls onOpenScene with scene id', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.click(screen.getByTestId('aeon-scene-card'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('does not crash when onOpenScene is omitted', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    expect(() => fireEvent.click(screen.getByTestId('aeon-scene-card'))).not.toThrow();
  });

  it('Enter key triggers onOpenScene', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.keyDown(screen.getByTestId('aeon-scene-card'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('Space key triggers onOpenScene', async () => {
    setupApi([makeScene()], [makeArc()]);
    const onOpen = vi.fn();
    render(<AeonLaneView story={STORY} onOpenScene={onOpen} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    fireEvent.keyDown(screen.getByTestId('aeon-scene-card'), { key: ' ' });
    expect(onOpen).toHaveBeenCalledWith('scene-1');
  });

  it('clicking a card sets aria-pressed=true (selection)', async () => {
    setupApi([makeScene()], [makeArc()]);
    render(<AeonLaneView story={STORY} />);
    await waitFor(() => screen.getByTestId('aeon-scene-card'));
    const card = screen.getByTestId('aeon-scene-card');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'false');
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
