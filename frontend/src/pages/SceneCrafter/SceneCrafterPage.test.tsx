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

function makeApi<T extends Record<string, unknown> = Record<string, never>>(overrides: T = {} as T) {
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
    sceneCrafterSaveBoard: vi.fn().mockResolvedValue({ ok: true }),
    onSceneCrafterExternalEdit: vi.fn().mockReturnValue(vi.fn()),
    sceneCrafterClose: vi.fn(),
    streamCancel: vi.fn().mockResolvedValue({ cancelled: true }),
    streamAck: vi.fn(),
    ...overrides,
  };
}

// ── Streaming test helpers (mirrors EntriesQuickAdd.test.tsx) ────────────────
type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; category: string; message: string }) => void;

let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

function streamingApi<T extends Record<string, unknown> = Record<string, never>>(overrides: T = {} as T) {
  return makeApi({
    streamStart: vi.fn().mockResolvedValue({ streamId: 'sid-1' }),
    writeNotesVault: vi.fn().mockResolvedValue({ path: 'Boards/x.canvas.json' }),
    onStreamToken: (cb: TokenHandler) => { tokenCb = cb; return () => { tokenCb = null; }; },
    onStreamEnd: (cb: EndHandler) => { endCb = cb; return () => { endCb = null; }; },
    onStreamError: (cb: ErrorHandler) => { errorCb = cb; return () => { errorCb = null; }; },
    ...overrides,
  });
}

async function finishStream(text: string) {
  await waitFor(() => expect(tokenCb).not.toBeNull());
  await act(async () => {
    tokenCb?.({ streamId: 'sid-1', token: text });
    endCb?.({ streamId: 'sid-1' });
  });
}

beforeEach(() => {
  (window as unknown as { api: unknown }).api = makeApi();
  tokenCb = null;
  endCb = null;
  errorCb = null;
});

async function renderPage() {
  const result = render(<SceneCrafterPage story={STORY} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return result;
}

describe('SceneCrafterPage — board loading (SKY-7601: no more lanes Kanban)', () => {
  it('auto-creates a board when none exists and renders without the retired lanes UI', async () => {
    const api = makeApi({
      sceneCrafterGetBoard: vi.fn().mockResolvedValue(null),
      sceneCrafterCreateBoard: vi.fn().mockResolvedValue(cloneBoard()),
    });
    (window as unknown as { api: unknown }).api = api;

    await renderPage();

    expect(api.sceneCrafterGetBoard).toHaveBeenCalledWith('story-1', 'Skyfall Chronicles');
    expect(api.sceneCrafterCreateBoard).toHaveBeenCalledWith('story-1', 'Skyfall Chronicles');
    expect(document.querySelector('.scene-crafter-lanes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add lane/i })).not.toBeInTheDocument();
  });

  it('does not render the legacy per-card checkbox/lane UI even when the on-disk board still has lanes', async () => {
    await renderPage();

    expect(screen.queryByTestId('scene-crafter-lane-Idea')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-crafter-card-Notes/Opening Beat')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /mark Opening Beat done/i })).not.toBeInTheDocument();
  });
});

describe('SceneCrafterPage — SKY-7601 Linked scenes (manuscriptSceneId/"Go to scene" preserved)', () => {
  it('shows a Linked scenes list with "Go to scene" for a board card carrying a manuscript/ tag', async () => {
    const onOpenScene = vi.fn();
    render(<SceneCrafterPage story={STORY} onOpenNote={vi.fn()} onOpenScene={onOpenScene} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const linked = screen.getByTestId('crafter-linked-scenes');
    expect(within(linked).getByText('Opening Beat')).toBeInTheDocument();

    fireEvent.click(within(linked).getByRole('button', { name: /go to scene/i }));
    expect(onOpenScene).toHaveBeenCalledWith('scene-1');
  });

  it('omits the Linked scenes section when no board card has a manuscript/ tag', async () => {
    const board = cloneBoard();
    board.lanes[0].cards[0].tags = ['character', 'urgent'];
    (window as unknown as { api: unknown }).api = makeApi({ sceneCrafterGetBoard: vi.fn().mockResolvedValue(board) });

    await renderPage();

    expect(screen.queryByTestId('crafter-linked-scenes')).not.toBeInTheDocument();
  });
});

describe('SceneCrafterPage — SKY-1805 post-merge bug fixes', () => {
  it('calls sceneCrafterClose with the story slug on component unmount', async () => {
    const api = makeApi();
    (window as unknown as { api: unknown }).api = api;
    const { unmount } = await renderPage();
    unmount();
    expect(api.sceneCrafterClose).toHaveBeenCalledWith('Skyfall Chronicles');
  });

});

describe('SceneCrafterPage — conflict banner', () => {
  it('persists the current board when Keep my version resolves a conflict', async () => {
    let externalEditHandler: ((storySlug: string) => void) | undefined;
    const board = cloneBoard();
    board.lanes[0].cards[0].title = 'Unsaved Local Beat';
    const api = makeApi({
      sceneCrafterGetBoard: vi.fn().mockResolvedValue(board),
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
    fireEvent.click(screen.getByRole('button', { name: /keep my version/i }));

    await waitFor(() => expect(api.sceneCrafterSaveBoard).toHaveBeenCalledWith({
      storySlug: 'Skyfall Chronicles',
      board,
    }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('SceneCrafterPage — diff modal a11y (M2)', () => {
  async function openDiffModal() {
    let externalEditHandler: ((storySlug: string) => void) | undefined;
    const api = makeApi({
      onSceneCrafterExternalEdit: vi.fn((cb: (storySlug: string) => void) => {
        externalEditHandler = cb;
        return vi.fn();
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    await act(async () => { externalEditHandler?.('Skyfall Chronicles'); });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /see diff/i }));
    return screen.getByRole('dialog');
  }

  it('dialog has aria-modal="true" and is labelled by its heading', async () => {
    const dialog = await openDiffModal();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'sc-diff-title');
    expect(document.getElementById('sc-diff-title')).toHaveTextContent(/board diff/i);
  });

  it('closes the diff modal with the Escape key', async () => {
    const dialog = await openDiffModal();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the diff modal by clicking the backdrop', async () => {
    await openDiffModal();
    const backdrop = document.querySelector('.scene-crafter-modal') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Close button inside the dialog closes the modal', async () => {
    const dialog = await openDiffModal();
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('SceneCrafterPage — M19 scene setup form (§7.1, AC1)', () => {
  async function renderWithCast() {
    const api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
          { path: 'Characters/kael-thorne.md', name: 'kael-thorne.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    return renderPage();
  }

  it('POV select is populated from the vault Characters group, title-cased', async () => {
    await renderWithCast();
    const select = screen.getByRole('combobox', { name: 'POV' });
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(optionLabels).toEqual(expect.arrayContaining(['Mira Veynn', 'Kael Thorne']));
  });

  it('picking a cast member sets POV without showing the custom input', async () => {
    await renderWithCast();
    const select = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.change(select, { target: { value: 'Mira Veynn' } });
    expect(select).toHaveValue('Mira Veynn');
    expect(screen.queryByRole('textbox', { name: /custom pov name/i })).not.toBeInTheDocument();
  });

  it('choosing Custom… reveals a free-text POV input', async () => {
    await renderWithCast();
    const select = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.change(select, { target: { value: '__custom__' } });
    const custom = screen.getByRole('textbox', { name: /custom pov name/i });
    fireEvent.change(custom, { target: { value: 'A nameless watcher' } });
    expect(custom).toHaveValue('A nameless watcher');
  });

  it('beats reorder with the up/down buttons and stay bounded at the edges', async () => {
    await renderPage();
    const addInput = screen.getByRole('textbox', { name: 'Add a beat' });
    fireEvent.change(addInput, { target: { value: 'First beat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(addInput, { target: { value: 'Second beat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: /move beat "first beat" up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move beat "second beat" down/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /move beat "second beat" up/i }));
    const beats = screen.getAllByTestId(/sc-beat-\d/).map((li) => li.textContent);
    expect(beats[0]).toContain('Second beat');
    expect(beats[1]).toContain('First beat');
  });

  it('selecting Custom length reveals a free-text length input', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const customLen = screen.getByRole('textbox', { name: /custom length/i });
    fireEvent.change(customLen, { target: { value: '900 words' } });
    expect(customLen).toHaveValue('900 words');
  });

  it('does not show the custom length input for the fixed lengths', async () => {
    await renderPage();
    expect(screen.queryByRole('textbox', { name: /custom length/i })).not.toBeInTheDocument();
  });
});

describe('SceneCrafterPage — M19 right kanban: beats/cast/places (§7.1, AC8)', () => {
  it('shows beats from the setup and cast/places notes from the vault, and opens a note on click', async () => {
    const onOpenNote = vi.fn();
    const api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
          { path: 'Locations/Ward Violet.md', name: 'Ward Violet.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    render(<SceneCrafterPage story={STORY} onOpenNote={onOpenNote} onOpenScene={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const kanban = screen.getByLabelText('Scene board: beats, cast, and places');
    expect(within(kanban).getByText('Mira Veynn')).toBeInTheDocument();
    expect(within(kanban).getByText('Ward Violet')).toBeInTheDocument();

    fireEvent.click(within(kanban).getByRole('button', { name: 'Ward Violet' }));
    expect(onOpenNote).toHaveBeenCalledWith('Locations/Ward Violet');
  });

  it('lists beats added in Scene Setup under the BEATS column', async () => {
    await renderPage();
    const addInput = screen.getByRole('textbox', { name: 'Add a beat' });
    fireEvent.change(addInput, { target: { value: 'Cold open on the sealed door' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const kanban = screen.getByLabelText('Scene board: beats, cast, and places');
    expect(within(kanban).getByText('Cold open on the sealed door')).toBeInTheDocument();
  });
});

describe('SceneCrafterPage — SKY-7601 suggested-card selection (rewired off the retired lanes board)', () => {
  async function renderWithSuggested() {
    const api = streamingApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    return api;
  }

  it('clicking a suggested card marks it selected without writing to the Scene Crafter board', async () => {
    const api = await renderWithSuggested();
    const suggested = screen.getByLabelText('Suggested cards');
    const card = within(suggested).getByRole('button', { name: /Mira Veynn/i });

    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);

    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(api.sceneCrafterAddCard).not.toHaveBeenCalled();
  });

  it('clicking a selected suggested card again deselects it', async () => {
    await renderWithSuggested();
    const suggested = screen.getByLabelText('Suggested cards');
    const card = within(suggested).getByRole('button', { name: /Mira Veynn/i });

    fireEvent.click(card);
    fireEvent.click(card);

    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('a selected suggested card is included as context in the AI draft prompt', async () => {
    const api = await renderWithSuggested();
    const suggested = screen.getByLabelText('Suggested cards');
    fireEvent.click(within(suggested).getByRole('button', { name: /Mira Veynn/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));

    await waitFor(() => expect(api.streamStart).toHaveBeenCalledTimes(1));
    const [{ messages }] = (api.streamStart as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(messages[0].content).toContain('Mira Veynn');
  });
});

describe('SceneCrafterPage — M19 AI generate → draft card (§7.1, AC5-7)', () => {
  it('Generate starts a stream and shows the coach-framed copy', async () => {
    const api = streamingApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    expect(screen.getByText(/writing coach drafts a first-pass scaffold/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await waitFor(() => expect(api.streamStart).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('sc-draft-generating')).toBeInTheDocument();
  });

  it('a finished stream renders the "— first pass" draft card with word count', async () => {
    const api = streamingApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await finishStream('She reached the sealed door and stopped.');

    const card = screen.getByTestId('sc-draft-card');
    expect(within(card).getByText(/— first pass/)).toBeInTheDocument();
    expect(within(card).getByText('7 words')).toBeInTheDocument();
    expect(within(card).getByText(/she reached the sealed door/i)).toBeInTheDocument();
  });

  it('Discard clears the draft card back to idle', async () => {
    const api = streamingApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await finishStream('Some draft text.');

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByTestId('sc-draft-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate ✦' })).toBeInTheDocument();
  });

  it('Retry cancels/discards the current draft and starts a fresh stream', async () => {
    const api = streamingApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await finishStream('First attempt.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.streamStart).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('sc-draft-card')).not.toBeInTheDocument();
  });

  it('Add to scene board writes only to the Notes Vault canvas board — never manuscript/scene storage', async () => {
    const api = streamingApi({
      sceneCrafterAddCard: vi.fn(),
      sceneRename: vi.fn(),
      chapterCreate: vi.fn(),
      sceneCreate: vi.fn(),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await finishStream('The scaffold prose.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to scene board' }));
    });

    await waitFor(() => expect(api.writeNotesVault).toHaveBeenCalledTimes(1));
    const [path, content] = (api.writeNotesVault as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toMatch(/^Boards\/Skyfall Chronicles\//);
    expect(JSON.parse(content as string).nodes.some((n: { text?: string }) => n.text?.includes('first pass'))).toBe(true);
    // The draft never routes through any manuscript/scene write path.
    expect(api.chapterCreate).not.toHaveBeenCalled();
    expect(api.sceneCreate).not.toHaveBeenCalled();
    expect(api.sceneRename).not.toHaveBeenCalled();
    // The draft card clears and the new board opens in the canvas view.
    expect(screen.queryByTestId('sc-draft-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-board')).toBeInTheDocument();
  });

  it('shows the stream error with Retry/Discard when generation fails mid-stream', async () => {
    const api = streamingApi();
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));
    await waitFor(() => expect(tokenCb).not.toBeNull());
    await act(async () => { errorCb?.({ streamId: 'sid-1', category: 'network', message: 'AI unavailable.' }); });

    expect(screen.getByRole('alert')).toHaveTextContent('AI unavailable.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('shows a start error and lets the writer try again when streamStart itself rejects', async () => {
    const api = streamingApi({ streamStart: vi.fn().mockRejectedValue(new Error('No API key configured.')) });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate ✦' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('No API key configured.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
