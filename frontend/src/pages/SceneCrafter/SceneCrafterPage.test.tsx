import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SceneCrafterPage from './SceneCrafterPage';

const STORY = {
  id: 'story-1',
  title: 'Skyfall Chronicles',
  path: 'Stories/Skyfall Chronicles',
  chapters: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BOARD = {
  storyId: 'story-1',
  lastModified: '2026-01-01T00:00:00.000Z',
  lanes: [
    {
      name: 'Idea',
      cards: [
        {
          wikilink: 'Notes/Opening Beat',
          title: 'Opening Beat',
          done: false,
          tags: ['manuscript/scene-1', 'character', 'urgent'],
          raw: '',
        },
      ],
    },
    { name: 'Outline', cards: [] },
    { name: 'Draft', cards: [] },
    { name: 'Revision', cards: [] },
    { name: 'Done', cards: [] },
  ],
  extraFrontmatter: {},
  kanbanSettings: '{"kanban-plugin":"board"}',
};

function cloneBoard() {
  return structuredClone(BOARD);
}

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    sceneCrafterGetBoard: vi.fn().mockResolvedValue(cloneBoard()),
    sceneCrafterCreateBoard: vi.fn().mockResolvedValue(cloneBoard()),
    sceneCrafterAddCard: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterMoveCard: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterToggleCardDone: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterDeleteCard: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterAddLane: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterRenameLane: vi.fn().mockResolvedValue({ ok: true }),
    sceneCrafterDeleteLane: vi.fn().mockResolvedValue({ ok: true, cardCount: 0 }),
    sceneCrafterReorderLanes: vi.fn().mockResolvedValue({ ok: true }),
    onSceneCrafterExternalEdit: vi.fn().mockReturnValue(vi.fn()),
    ...overrides,
  };
}

beforeEach(() => {
  (window as unknown as { api: unknown }).api = makeApi();
});

async function renderPage() {
  const result = render(<SceneCrafterPage story={STORY} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return result;
}

describe('SceneCrafterPage — board loading and empty state', () => {
  it('auto-creates a board when none exists and renders the 5 canonical lanes', async () => {
    const api = makeApi({
      sceneCrafterGetBoard: vi.fn().mockResolvedValue(null),
      sceneCrafterCreateBoard: vi.fn().mockResolvedValue(cloneBoard()),
    });
    (window as unknown as { api: unknown }).api = api;

    await renderPage();

    expect(api.sceneCrafterGetBoard).toHaveBeenCalledWith('story-1', 'Skyfall Chronicles');
    expect(api.sceneCrafterCreateBoard).toHaveBeenCalledWith('story-1', 'Skyfall Chronicles');
    for (const lane of ['Idea', 'Outline', 'Draft', 'Revision', 'Done']) {
      expect(screen.getByTestId(`scene-crafter-lane-${lane}`)).toBeInTheDocument();
    }
  });

  it('shows the empty-board CTA only while the board has no cards', async () => {
    const emptyBoard = cloneBoard();
    emptyBoard.lanes.forEach((lane) => { lane.cards = []; });
    (window as unknown as { api: unknown }).api = makeApi({ sceneCrafterGetBoard: vi.fn().mockResolvedValue(emptyBoard) });

    await renderPage();

    expect(screen.getByText(/drag a vault note here/i)).toBeInTheDocument();
  });
});

describe('SceneCrafterPage — card rendering and mutations', () => {
  it('renders card title, visible tags, and hides #manuscript tags from chips', async () => {
    await renderPage();

    const card = screen.getByTestId('scene-crafter-card-Notes/Opening Beat');
    expect(within(card).getByText('Opening Beat')).toBeInTheDocument();
    expect(within(card).getByText('#character')).toBeInTheDocument();
    expect(within(card).getByText('#urgent')).toBeInTheDocument();
    expect(within(card).queryByText('#manuscript/scene-1')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /go to scene/i })).toBeInTheDocument();
  });

  it('toggles a card checkbox through the Scene Crafter IPC handler', async () => {
    const api = makeApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: /mark Opening Beat done/i }));

    await waitFor(() => {
      expect(api.sceneCrafterToggleCardDone).toHaveBeenCalledWith({
        storySlug: 'Skyfall Chronicles',
        laneIndex: 0,
        cardIndex: 0,
      });
    });
  });

  it('moves a card between lanes and persists by calling sceneCrafterMoveCard', async () => {
    const api = makeApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.dragStart(screen.getByTestId('scene-crafter-card-Notes/Opening Beat'));
    fireEvent.dragOver(screen.getByTestId('scene-crafter-lane-Draft'));
    fireEvent.drop(screen.getByTestId('scene-crafter-lane-Draft'));

    await waitFor(() => {
      expect(api.sceneCrafterMoveCard).toHaveBeenCalledWith({
        storySlug: 'Skyfall Chronicles',
        fromLane: 0,
        fromIndex: 0,
        toLane: 2,
        toIndex: 0,
      });
    });
  });

  it('creates a card from a dropped vault note path', async () => {
    const api = makeApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.drop(screen.getByTestId('scene-crafter-lane-Outline'), {
      dataTransfer: {
        getData: (type: string) => type === 'application/x-mythos-note-path' ? 'Characters/Lyra.md' : '',
      },
    });

    await waitFor(() => {
      expect(api.sceneCrafterAddCard).toHaveBeenCalledWith({
        storySlug: 'Skyfall Chronicles',
        laneIndex: 1,
        card: { wikilink: 'Characters/Lyra', title: 'Lyra', done: false, tags: [] },
      });
    });
  });
});

describe('SceneCrafterPage — lane management and error states', () => {
  it('renames a lane through IPC after double-click edit', async () => {
    const api = makeApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.doubleClick(screen.getByText('Idea'));
    const input = screen.getByRole('textbox', { name: /rename lane Idea/i });
    fireEvent.change(input, { target: { value: 'Spark' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(api.sceneCrafterRenameLane).toHaveBeenCalledWith({
        storySlug: 'Skyfall Chronicles',
        laneIndex: 0,
        name: 'Spark',
      });
    });
  });

  it('requires confirmation before deleting a non-empty lane', async () => {
    const api = makeApi({
      sceneCrafterDeleteLane: vi.fn()
        .mockResolvedValueOnce({ ok: false, cardCount: 1 })
        .mockResolvedValueOnce({ ok: true, cardCount: 1 }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /delete lane Idea/i }));
    expect(await screen.findByText(/lane has 1 card/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete anyway/i }));

    await waitFor(() => {
      expect(api.sceneCrafterDeleteLane).toHaveBeenLastCalledWith({
        storySlug: 'Skyfall Chronicles',
        laneIndex: 0,
        force: true,
      });
    });
  });

  it('shows a write-error toast and retries the failed mutation', async () => {
    const api = makeApi({
      sceneCrafterToggleCardDone: vi.fn()
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce({ ok: true }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: /mark Opening Beat done/i }));
    expect(await screen.findByText(/could not save scene crafter board/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry save/i }));

    await waitFor(() => expect(api.sceneCrafterToggleCardDone).toHaveBeenCalledTimes(2));
  });
});

describe('SceneCrafterPage — conflict banner', () => {
  it('shows conflict actions on external-edit push and Use disk version reloads the board', async () => {
    let externalEditHandler: ((storySlug: string) => void) | undefined;
    const api = makeApi({
      onSceneCrafterExternalEdit: vi.fn((cb: (storySlug: string) => void) => {
        externalEditHandler = cb;
        return vi.fn();
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    await act(async () => {
      externalEditHandler?.('Skyfall Chronicles');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/board changed on disk/i);
    fireEvent.click(screen.getByRole('button', { name: /use disk version/i }));

    await waitFor(() => expect(api.sceneCrafterGetBoard).toHaveBeenCalledTimes(2));
  });
});
