// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SubwayCanvas from './SubwayCanvas';

// ─── React Flow mock ──────────────────────────────────────────────────────────

vi.mock('@xyflow/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...mod,
    ReactFlow: ({ children, 'aria-label': ariaLabel }: { children?: React.ReactNode; 'aria-label'?: string }) => (
      <div data-testid="react-flow" aria-label={ariaLabel}>
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    useNodesState: (initial: unknown[]) => [initial ?? [], vi.fn(), vi.fn()],
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    BackgroundVariant: { Dots: 'dots' },
  };
});

// ─── window.api mock ──────────────────────────────────────────────────────────

const mockApi: Record<string, ReturnType<typeof vi.fn>> = {
  timelineGetScenes: vi.fn(),
  timelineUpdateScene: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true });
  mockApi.timelineGetScenes.mockResolvedValue({ scenes: [] });
  mockApi.timelineUpdateScene.mockResolvedValue({});
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScene(id: string, pov: string, date?: string) {
  return {
    id,
    title: `Scene ${id}`,
    path: `scenes/${id}.md`,
    order: 0,
    chronologicalTime: date ? { date, isEstimated: false, confidence: 1, source: 'frontmatter' } : undefined,
    timelineMetadata: { pov, wordCount: 500 },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SubwayCanvas', () => {
  it('shows empty state when storyId is null', () => {
    render(<SubwayCanvas storyId={null} />);
    expect(screen.getByRole('status', { name: /no scenes/i })).toBeInTheDocument();
    expect(screen.getByText(/no scenes yet/i)).toBeInTheDocument();
  });

  it('shows empty state when story has no scenes', async () => {
    mockApi.timelineGetScenes.mockResolvedValue({ scenes: [] });
    render(<SubwayCanvas storyId="story-1" />);
    await waitFor(() => {
      expect(screen.getByText(/no scenes yet/i)).toBeInTheDocument();
    });
  });

  it('calls timelineGetScenes with storyId', async () => {
    render(<SubwayCanvas storyId="story-abc" />);
    await waitFor(() => {
      expect(mockApi.timelineGetScenes).toHaveBeenCalledWith('story-abc');
    });
  });

  it('calls onOpenSceneEditor when button clicked in empty state', () => {
    const onOpen = vi.fn();
    render(<SubwayCanvas storyId={null} onOpenSceneEditor={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /open scene editor/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('calls onOpenBrainstorm when button clicked in empty state', () => {
    const onOpen = vi.fn();
    render(<SubwayCanvas storyId={null} onOpenBrainstorm={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /start brainstorming/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows loading state then canvas', async () => {
    let resolve!: (v: unknown) => void;
    mockApi.timelineGetScenes.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<SubwayCanvas storyId="story-1" />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    resolve({ scenes: [makeScene('s1', 'Arya', '2025-01-01')] });
    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeInTheDocument();
    });
  });

  it('shows error state on IPC failure', async () => {
    mockApi.timelineGetScenes.mockRejectedValue(new Error('IPC_ERROR'));
    render(<SubwayCanvas storyId="story-1" />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('IPC_ERROR');
    });
  });

  it('renders canvas with scenes', async () => {
    mockApi.timelineGetScenes.mockResolvedValue({
      scenes: [
        makeScene('s1', 'Arya', '2025-01-01'),
        makeScene('s2', 'Jon',  '2025-01-05'),
      ],
    });
    render(<SubwayCanvas storyId="story-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('subway-canvas')).toBeInTheDocument();
    });
    expect(screen.getByTestId('react-flow')).toHaveAttribute('aria-label', 'Story timeline — subway view');
  });

  it('re-fetches when storyId changes', async () => {
    mockApi.timelineGetScenes.mockResolvedValue({ scenes: [makeScene('s1', 'Arya', '2025-01-01')] });
    const { rerender } = render(<SubwayCanvas storyId="story-1" />);
    await waitFor(() => expect(mockApi.timelineGetScenes).toHaveBeenCalledWith('story-1'));

    rerender(<SubwayCanvas storyId="story-2" />);
    await waitFor(() => expect(mockApi.timelineGetScenes).toHaveBeenCalledWith('story-2'));
    expect(mockApi.timelineGetScenes).toHaveBeenCalledTimes(2);
  });
});

// ─── Date interpolation (pure logic) ─────────────────────────────────────────

describe('interpolateDate (unit)', () => {
  function interpolateDate(prev: string | undefined, next: string | undefined): string {
    if (!prev && !next) return new Date().toISOString().split('T')[0];
    if (!prev) return next!;
    if (!next) {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    const prevMs = new Date(prev).getTime();
    const nextMs = new Date(next).getTime();
    if (Number.isNaN(prevMs) || Number.isNaN(nextMs)) return prev;
    return new Date(Math.round((prevMs + nextMs) / 2)).toISOString().split('T')[0];
  }

  it('returns midpoint of two dates', () => {
    const result = interpolateDate('2025-01-01', '2025-01-03');
    expect(result).toBe('2025-01-02');
  });

  it('returns next when prev is undefined', () => {
    expect(interpolateDate(undefined, '2025-06-15')).toBe('2025-06-15');
  });

  it('returns prev+1 day when next is undefined', () => {
    expect(interpolateDate('2025-06-10', undefined)).toBe('2025-06-11');
  });

  it('returns today when both undefined', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(interpolateDate(undefined, undefined)).toBe(today);
  });

  it('handles same-day prev and next gracefully', () => {
    const result = interpolateDate('2025-01-01', '2025-01-01');
    expect(result).toBe('2025-01-01');
  });
});

// ─── buildTracks (unit) ───────────────────────────────────────────────────────

describe('buildTracks (unit)', () => {
  function buildTracks(scenes: ReturnType<typeof makeScene>[]) {
    const povMap = new Map<string, ReturnType<typeof makeScene>[]>();
    for (const scene of scenes) {
      const pov = scene.timelineMetadata?.pov?.trim() || 'Unassigned';
      if (!povMap.has(pov)) povMap.set(pov, []);
      povMap.get(pov)!.push(scene);
    }
    return [...povMap.entries()].map(([pov, povScenes]) => ({
      pov,
      dated: povScenes.filter(s => !!s.chronologicalTime?.date),
      undated: povScenes.filter(s => !s.chronologicalTime?.date),
    }));
  }

  it('groups scenes by POV', () => {
    const tracks = buildTracks([
      makeScene('s1', 'Arya', '2025-01-01'),
      makeScene('s2', 'Arya', '2025-01-02'),
      makeScene('s3', 'Jon',  '2025-01-01'),
    ]);
    expect(tracks).toHaveLength(2);
    const arya = tracks.find(t => t.pov === 'Arya')!;
    expect(arya.dated).toHaveLength(2);
    const jon = tracks.find(t => t.pov === 'Jon')!;
    expect(jon.dated).toHaveLength(1);
  });

  it('separates dated and undated scenes', () => {
    const tracks = buildTracks([
      makeScene('s1', 'Arya', '2025-01-01'),
      makeScene('s2', 'Arya'),
    ]);
    const arya = tracks.find(t => t.pov === 'Arya')!;
    expect(arya.dated).toHaveLength(1);
    expect(arya.undated).toHaveLength(1);
  });

  it('assigns "Unassigned" track for scenes without POV', () => {
    const scene = { ...makeScene('s1', 'Arya'), timelineMetadata: undefined };
    const tracks = buildTracks([scene]);
    expect(tracks[0].pov).toBe('Unassigned');
  });
});
