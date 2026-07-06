// Beta 3 M20 — TimelineLanes tests (vitest + @testing-library/react).
//
// Coverage:
//   - Lane stack renders every populated row (eras, bands, arcs, chapters,
//     key events, characters, world, themes) from derived data
//   - Plan-vs-Progress greys unwritten content with the exact prototype filter
//     (grayscale(.92) brightness(.82) + opacity .55) — inline, assertable
//   - Structure mode renders the same lanes ungreyed
//   - "You are here" chapter cell: cyan outline class + title
//   - Minimap: window reflects scroll metrics; pointer scrub drives scrollLeft
//   - Empty data → empty state

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TimelineLanes from './TimelineLanes';
import {
  deriveAeonTimeline,
  PROGRESS_GREY_FILTER,
  type AeonTimelineData,
  type AeonSceneInput,
} from './timelineAeon';

afterEach(() => cleanup());

// ─── Fixture: 3 chapters, ch-1 written, characters + arcs + entities ───

function makeScene(overrides: Partial<AeonSceneInput> = {}): AeonSceneInput {
  return {
    id: 'sc-1',
    title: 'Scene',
    chapterId: 'ch-1',
    date: '',
    wordCount: null,
    pov: '',
    mood: '',
    arcIds: [],
    characterIds: [],
    ...overrides,
  };
}

function makeData(): AeonTimelineData {
  return deriveAeonTimeline({
    storyTitle: 'The Neon Saga',
    chapters: [
      { id: 'ch-1', title: 'Chapter One' },
      { id: 'ch-2', title: 'Chapter Two' },
      { id: 'ch-3', title: 'Chapter Three' },
    ],
    arcs: [
      { id: 'arc-a', title: 'Hero Journey', color: '#00f0ff' },
      { id: 'arc-b', title: 'Villain Rise', color: '#ff4dff' },
    ],
    scenes: [
      makeScene({ id: 's1', title: 'Departure', chapterId: 'ch-1', date: '2340-06-14', wordCount: 900, arcIds: ['arc-a'], characterIds: ['c-mira'] }),
      makeScene({ id: 's2', title: 'Crossing', chapterId: 'ch-2', date: '2340-06-15', arcIds: ['arc-b'], characterIds: ['c-mira', 'c-kael'] }),
      makeScene({ id: 's3', title: 'Arrival', chapterId: 'ch-3', date: '2341-01-02', arcIds: ['arc-a', 'arc-b'], characterIds: ['c-kael'] }),
    ],
    characters: [
      { id: 'c-mira', name: 'Mira Veynn' },
      { id: 'c-kael', name: 'Kael Thorne' },
    ],
    worldEvents: [{ id: 'w1', name: 'Festival of Lanterns' }],
    concepts: [{ id: 't1', name: 'Trust & Betrayal' }],
  });
}

const EXPECTED_GREY_OPACITY = '0.55';

// ─── Lane stack rendering ───

describe('TimelineLanes — lane stack', () => {
  it('renders every populated lane row', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    expect(screen.getByTestId('timeline-lanes')).toBeInTheDocument();
    expect(screen.getByTestId('tla-eras')).toBeInTheDocument();
    expect(screen.getByTestId('tla-bands')).toBeInTheDocument();
    expect(screen.getByTestId('tla-arcs')).toBeInTheDocument();
    expect(screen.getByTestId('tla-chapters')).toBeInTheDocument();
    expect(screen.getByTestId('tla-events')).toBeInTheDocument();
    expect(screen.getByTestId('tla-journeys')).toBeInTheDocument();
    expect(screen.getByTestId('tla-world')).toBeInTheDocument();
    expect(screen.getByTestId('tla-themes')).toBeInTheDocument();
  });

  it('renders one chapter cell per chapter and eras per scene-year', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    expect(screen.getAllByTestId('tla-chapter-cell')).toHaveLength(3);
    expect(screen.getByTestId('tla-eras')).toHaveTextContent('2340');
    expect(screen.getByTestId('tla-eras')).toHaveTextContent('2341');
  });

  it('renders the band with the uppercase story title', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    expect(screen.getByTestId('tla-bands')).toHaveTextContent('THE NEON SAGA');
    expect(screen.getByTestId('tla-bands')).toHaveTextContent('Ch. 1–3 · 3 scenes');
  });

  it('opens the scene when a key-event card is clicked', () => {
    const onOpenScene = vi.fn();
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" onOpenScene={onOpenScene} />);
    fireEvent.click(screen.getAllByTestId('tla-event-card')[0]);
    expect(onOpenScene).toHaveBeenCalledWith('s1');
  });

  it('renders the empty state when there is no data', () => {
    render(
      <TimelineLanes
        data={deriveAeonTimeline({ storyTitle: '', scenes: [], chapters: [], arcs: [], characters: [], worldEvents: [], concepts: [] })}
        mode="structure"
        zoom="month"
      />,
    );
    expect(screen.getByTestId('timeline-lanes-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-lanes')).toBeNull();
  });
});

// ─── Plan vs Progress grey filter ───

describe('TimelineLanes — Plan vs Progress grey filter', () => {
  it('greys chapters after the here-index with the exact prototype filter', () => {
    render(<TimelineLanes data={makeData()} mode="progress" zoom="month" />);
    const cells = screen.getAllByTestId('tla-chapter-cell');
    // hereIndex = 0 (only ch-1 has a written scene).
    expect(cells[0].style.filter).toBe('');
    expect(cells[1].style.filter).toBe(PROGRESS_GREY_FILTER);
    expect(cells[1].style.opacity).toBe(EXPECTED_GREY_OPACITY);
    expect(cells[2].style.filter).toBe(PROGRESS_GREY_FILTER);
  });

  it('greys unwritten key events and character journeys', () => {
    render(<TimelineLanes data={makeData()} mode="progress" zoom="month" />);
    const events = screen.getAllByTestId('tla-event-card');
    expect(events[0].style.filter).toBe('');                     // s1 written
    expect(events[1].style.filter).toBe(PROGRESS_GREY_FILTER);   // s2 planned
    expect(events[2].style.filter).toBe(PROGRESS_GREY_FILTER);   // s3 planned
  });

  it('marks the here-chapter with the cyan outline class and title', () => {
    render(<TimelineLanes data={makeData()} mode="progress" zoom="month" />);
    const cells = screen.getAllByTestId('tla-chapter-cell');
    expect(cells[0]).toHaveClass('tla-chapter--here');
    expect(cells[0]).toHaveAttribute('title', 'You are here — Chapter One');
    expect(cells[0]).toHaveAttribute('data-here', 'true');
    expect(cells[1]).not.toHaveClass('tla-chapter--here');
  });

  it('applies no grey filter anywhere in structure mode', () => {
    const { container } = render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    const greyed = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
      .filter(el => el.style.filter === PROGRESS_GREY_FILTER);
    expect(greyed).toHaveLength(0);
  });
});

// ─── Minimap scrubber ───

describe('TimelineLanes — minimap scrubber', () => {
  /** Give the jsdom scroll container real-looking metrics. */
  function mockScrollMetrics(scroller: HTMLElement, { scrollWidth = 2000, clientWidth = 500 } = {}) {
    Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: clientWidth, configurable: true });
  }

  /** jsdom has no PointerEvent — dispatch a MouseEvent under the pointer event
   *  type so React's onPointer* handlers receive real clientX coordinates. */
  function firePointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    fireEvent(el, ev);
  }

  it('renders the minimap with one cell per chapter and a viewport window', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    const minimap = screen.getByTestId('timeline-minimap');
    expect(minimap).toBeInTheDocument();
    expect(minimap.querySelectorAll('.tla-minimap-cell')).toHaveLength(3);
    expect(screen.getByTestId('minimap-window')).toBeInTheDocument();
  });

  it('scrubbing the minimap scrolls the lane canvas horizontally', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="scene" />);
    const scroller = screen.getByTestId('tla-scroll');
    mockScrollMetrics(scroller);
    const minimap = screen.getByTestId('timeline-minimap');
    minimap.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 34, right: 100, bottom: 34, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // Pointer at 50% of the track → scrollLeft centers the 25%-wide window: 750.
    firePointer(minimap, 'pointerdown', 50);
    expect(scroller.scrollLeft).toBe(750);

    // Drag to the far right → clamped to (1 - 0.25) * 2000 = 1500.
    firePointer(minimap, 'pointermove', 100);
    expect(scroller.scrollLeft).toBe(1500);

    // After release, moves no longer scrub.
    firePointer(minimap, 'pointerup', 100);
    firePointer(minimap, 'pointermove', 0);
    expect(scroller.scrollLeft).toBe(1500);
  });

  it('exposes scrollbar semantics for assistive tech', () => {
    render(<TimelineLanes data={makeData()} mode="structure" zoom="month" />);
    const minimap = screen.getByTestId('timeline-minimap');
    expect(minimap).toHaveAttribute('role', 'scrollbar');
    expect(minimap).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('widens the lane canvas as the zoom level gets denser', () => {
    const { container, rerender } = render(<TimelineLanes data={makeData()} mode="structure" zoom="year" />);
    const canvas = () => container.querySelector<HTMLElement>('.tla-canvas')!;
    expect(canvas().style.minWidth).toBe('100%');
    rerender(<TimelineLanes data={makeData()} mode="structure" zoom="scene" />);
    expect(canvas().style.minWidth).toBe('450%');
  });
});
