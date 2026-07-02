// SKY-3182 — TrackTimeline unit tests.
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TrackTimeline from './TrackTimeline';
import type { Story } from './types';

// Mock TimelineHeader so its global document listeners don't interfere with tests
vi.mock('./TimelineHeader', () => ({
  default: ({
    title,
    currentZoom,
    onZoomChange,
    onZoomFit,
  }: {
    title: string;
    currentZoom: number;
    onZoomChange: (z: number) => void;
    onZoomFit: () => void;
  }) => (
    <div data-testid="timeline-header">
      <span data-testid="tlh-title">{title}</span>
      <span data-testid="tlh-zoom">{currentZoom}</span>
      <button data-testid="tlh-zoom-in" onClick={() => onZoomChange(Math.round((currentZoom + 0.1) * 10) / 10)}>
        +
      </button>
      <button data-testid="tlh-zoom-fit" onClick={onZoomFit}>
        Fit
      </button>
    </div>
  ),
}));

const makeStory = (overrides: Partial<Story> = {}): Story => ({
  id: 'story-1',
  title: 'My Test Story',
  path: '/vault/story',
  chapters: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const makeScenes = (count = 3) =>
  Array.from({ length: count }, (_, i) => ({
    id: `scene-${i}`,
    title: `Scene ${i + 1}`,
    // first two get dates, last one is undated
    chronologicalTime:
      i < count - 1
        ? { date: `2024-0${(i % 9) + 1}-01`, confidence: 0.8, isEstimated: false, source: 'manual' }
        : undefined,
  }));

let storageMock: Record<string, string> = {};
const mockGetItem = vi.fn((k: string) => storageMock[k] ?? null);
const mockSetItem = vi.fn((k: string, v: string) => {
  storageMock[k] = v;
});

beforeEach(() => {
  storageMock = {};
  vi.stubGlobal('localStorage', {
    getItem: mockGetItem,
    setItem: mockSetItem,
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stubApi(scenes: unknown[] = [], rejectWith?: string) {
  const handler = rejectWith
    ? () => Promise.reject(new Error(rejectWith))
    : () => Promise.resolve({ scenes });
  Object.defineProperty(window, 'api', {
    value: { timelineGetScenes: vi.fn(handler), timelineListArcs: vi.fn(() => Promise.resolve({ arcs: [] })) },
    writable: true,
    configurable: true,
  });
}

describe('TrackTimeline', () => {
  it('shows empty-state when no story selected', () => {
    stubApi();
    render(<TrackTimeline story={null} />);
    expect(screen.getByRole('status')).toHaveTextContent(/select a story/i);
  });

  it('shows loading spinner while fetching', async () => {
    let resolve!: (v: unknown) => void;
    Object.defineProperty(window, 'api', {
      value: { timelineGetScenes: vi.fn(() => new Promise(r => { resolve = r; })) },
      writable: true,
      configurable: true,
    });
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    await act(async () => {
      resolve({ scenes: [] });
    });
  });

  it('shows no-scenes empty state when API returns empty list', async () => {
    stubApi([]);
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-empty-no-scenes');
  });

  it('shows error message when API rejects', async () => {
    stubApi([], 'Network error');
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('renders SVG canvas after scenes load', async () => {
    stubApi(makeScenes(3));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
  });

  it('passes story title to TimelineHeader', async () => {
    stubApi(makeScenes(1));
    const story = makeStory({ title: 'Epic Chronicles' });
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByTestId('tlh-title')).toHaveTextContent('Epic Chronicles');
  });

  it('renders scene labels in the SVG', async () => {
    stubApi(makeScenes(2));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('Scene 2')).toBeInTheDocument();
  });

  it('SKY-5738: windows scene markers to the visible viewport, omitting far off-screen scenes', async () => {
    // 20 uniformly-spaced dated scenes (SLOT_WIDTH=140px apart) — scene 20 sits
    // ~2668px into content space, well past the default ~1424px visible+buffer
    // range at containerWidth fallback (1024) / offsetX=0 / zoom=1.
    const manyScenes = Array.from({ length: 20 }, (_, i) => ({
      id: `scene-${i}`,
      title: `Scene ${i + 1}`,
      chronologicalTime: {
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        confidence: 0.8,
        isEstimated: false,
        source: 'manual',
      },
    }));
    stubApi(manyScenes);
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.queryByText('Scene 20')).not.toBeInTheDocument();
  });

  it('SVG has accessible aria-label mentioning story title', async () => {
    stubApi(makeScenes(2));
    const story = makeStory({ title: 'My Story' });
    render(<TrackTimeline story={story} />);
    const svg = await screen.findByTestId('tt-svg');
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('My Story'));
  });

  it('shows undated scene count in status bar', async () => {
    // makeScenes(3): scene 0+1 dated, scene 2 undated
    stubApi(makeScenes(3));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByText(/1 undated/i)).toBeInTheDocument();
  });

  it('shows "Proportional spacing" in status bar when spacingMode=proportional', async () => {
    stubApi(makeScenes(3));
    const story = makeStory();
    render(<TrackTimeline story={story} spacingMode="proportional" />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByText(/proportional spacing/i)).toBeInTheDocument();
  });

  it('shows "Uniform spacing" in status bar when spacingMode=uniform', async () => {
    stubApi(makeScenes(3));
    const story = makeStory();
    render(<TrackTimeline story={story} spacingMode="uniform" />);
    await screen.findByTestId('tt-svg');
    expect(screen.getByText(/uniform spacing/i)).toBeInTheDocument();
  });

  it('updates zoom when header fires onZoomChange', async () => {
    stubApi(makeScenes(2));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    await act(async () => {
      fireEvent.click(screen.getByTestId('tlh-zoom-in'));
    });
    await waitFor(() => {
      const zoomEl = screen.getByTestId('tlh-zoom');
      expect(parseFloat(zoomEl.textContent ?? '0')).toBeCloseTo(1.1, 1);
    });
  });

  it('resets to zoom=1 and offset=0 on fit-view', async () => {
    stubApi(makeScenes(2));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByTestId('tt-svg');
    await act(async () => {
      fireEvent.click(screen.getByTestId('tlh-zoom-in'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tlh-zoom-fit'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tlh-zoom')).toHaveTextContent('1');
    });
  });

  it('ArrowRight pans the canvas', async () => {
    stubApi(makeScenes(2));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    const root = await screen.findByRole('application');
    const group = await screen.findByTestId('tt-content-group');
    const before = group.getAttribute('transform') ?? '';
    await act(async () => {
      fireEvent.keyDown(root, { key: 'ArrowRight' });
    });
    const after = group.getAttribute('transform') ?? '';
    expect(after).not.toBe(before);
  });

  it('Home key resets viewport', async () => {
    stubApi(makeScenes(2));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    const root = await screen.findByRole('application');
    await act(async () => {
      fireEvent.keyDown(root, { key: 'ArrowRight' });
    });
    await act(async () => {
      fireEvent.keyDown(root, { key: 'Home' });
    });
    const group = await screen.findByTestId('tt-content-group');
    expect(group.getAttribute('transform')).toContain('translate(0 0)');
  });

  it('root has role=application', async () => {
    stubApi(makeScenes(1));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    await screen.findByRole('application');
  });

  it('root has tabIndex=0', async () => {
    stubApi(makeScenes(1));
    const story = makeStory();
    render(<TrackTimeline story={story} />);
    const root = await screen.findByRole('application');
    expect(root).toHaveAttribute('tabIndex', '0');
  });

  it('reloads scenes when story changes', async () => {
    const apiSpy = vi
      .fn()
      .mockResolvedValueOnce({ scenes: makeScenes(1) })
      .mockResolvedValueOnce({ scenes: makeScenes(2) });
    Object.defineProperty(window, 'api', {
      value: { timelineGetScenes: apiSpy },
      writable: true,
      configurable: true,
    });
    const story1 = makeStory({ id: 'story-1', title: 'Story 1' });
    const story2 = makeStory({ id: 'story-2', title: 'Story 2' });
    const { rerender } = render(<TrackTimeline story={story1} />);
    await screen.findByTestId('tt-svg');
    rerender(<TrackTimeline story={story2} />);
    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledTimes(2);
    });
  });
});
