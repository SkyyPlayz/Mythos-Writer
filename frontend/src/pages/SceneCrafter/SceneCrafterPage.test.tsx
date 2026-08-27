import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SceneCrafterPage from './SceneCrafterPage';
import { CANVAS_CARD_DRAG_MIME } from '../../canvas/canvasTypes';
import { __resetAiEnabledForTests, setAiEnabled } from '../../hooks/useAiEnabled';

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
  __resetAiEnabledForTests();
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

  it('POV is a typeable field, not a <select> — no hidden Custom… step (SKY-11049 item 7)', async () => {
    await renderWithCast();
    const field = screen.getByRole('combobox', { name: 'POV' });
    expect(field.tagName).toBe('INPUT');
    expect(screen.queryByText('Custom…')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'A nameless watcher' } });
    expect(field).toHaveValue('A nameless watcher');
  });

  it('focusing POV shows the vault Characters group as cards, title-cased (SKY-11049 item 7)', async () => {
    await renderWithCast();
    const field = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.focus(field);
    const listbox = screen.getByRole('listbox', { name: /vault characters/i });
    const optionLabels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(optionLabels).toEqual(expect.arrayContaining([expect.stringContaining('Mira Veynn'), expect.stringContaining('Kael Thorne')]));
  });

  it('picking a character card fills POV and closes the dropdown', async () => {
    await renderWithCast();
    const field = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.focus(field);
    fireEvent.click(screen.getByRole('option', { name: /mira veynn/i }));
    expect(field).toHaveValue('Mira Veynn');
    expect(screen.queryByRole('listbox', { name: /vault characters/i })).not.toBeInTheDocument();
  });

  it('typing filters the character-card dropdown by name', async () => {
    await renderWithCast();
    const field = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'kael' } });
    const listbox = screen.getByRole('listbox', { name: /vault characters/i });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    expect(within(listbox).getByRole('option', { name: /kael thorne/i })).toBeInTheDocument();
  });

  it('an empty vault-wide character list is never a dead control — POV stays a plain text box with a hint', async () => {
    (window as unknown as { api: unknown }).api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({ items: [] }),
    });
    await renderPage();
    const field = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.focus(field);
    expect(screen.queryByRole('listbox', { name: /vault characters/i })).not.toBeInTheDocument();
    expect(screen.getByText('Type a name — or add characters in your Notes vault')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'A nameless watcher' } });
    expect(field).toHaveValue('A nameless watcher');
  });

  it('resolves characters from a #Character-tagged note when there is no Characters folder (owner vault shape)', async () => {
    (window as unknown as { api: unknown }).api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          {
            path: 'Main Characters/Liora Ashen.md',
            name: 'Liora Ashen.md',
            isDirectory: false,
            modifiedAt: '2026-01-01T00:00:00.000Z',
            characterTag: true,
          },
        ],
      }),
    });
    await renderPage();
    const field = screen.getByRole('combobox', { name: 'POV' });
    fireEvent.focus(field);
    expect(screen.getByRole('option', { name: /liora ashen/i })).toBeInTheDocument();
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

describe('SceneCrafterPage — SKY-11072 vault-reference columns (owner ruling: prototype wins)', () => {
  const REF_VAULT_ITEMS = [
    { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
    { path: 'Locations/Ward Violet.md', name: 'Ward Violet.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
    { path: 'Items & Systems/Drownlight.md', name: 'Drownlight.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
    { path: 'Loose Note.md', name: 'Loose Note.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
  ];

  async function renderRefColumns(onOpenNote = vi.fn()) {
    const api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({ items: REF_VAULT_ITEMS }),
    });
    (window as unknown as { api: unknown }).api = api;
    render(<SceneCrafterPage story={STORY} onOpenNote={onOpenNote} onOpenScene={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    return onOpenNote;
  }

  it('renders CHARACTERS / LOCATIONS / ITEMS & SYSTEMS columns stocked from the vault, and opens a note on click', async () => {
    const onOpenNote = await renderRefColumns();

    const characters = screen.getByTestId('sc-ref-col-characters');
    const locations = screen.getByTestId('sc-ref-col-locations');
    const items = screen.getByTestId('sc-ref-col-items');
    expect(within(characters).getByText('Mira Veynn')).toBeInTheDocument();
    expect(within(locations).getByText('Ward Violet')).toBeInTheDocument();
    expect(within(items).getByText('Drownlight')).toBeInTheDocument();

    fireEvent.click(within(locations).getByRole('button', { name: /^ward violet/i }));
    expect(onOpenNote).toHaveBeenCalledWith('Locations/Ward Violet');
  });

  it('× removes the card from this scene only — the note stays in the suggested rail', async () => {
    await renderRefColumns();

    const characters = screen.getByTestId('sc-ref-col-characters');
    fireEvent.click(within(characters).getByRole('button', { name: 'Remove Mira Veynn from this scene' }));
    expect(within(characters).queryByText('Mira Veynn')).not.toBeInTheDocument();

    // The vault note is untouched: still listed by the suggested rail.
    const rail = screen.getByLabelText('Suggested cards');
    expect(within(rail).getByText('Mira Veynn')).toBeInTheDocument();
  });

  it('the + picker offers vault notes not in the column and adds the picked one', async () => {
    await renderRefColumns();

    const characters = screen.getByTestId('sc-ref-col-characters');
    fireEvent.click(within(characters).getByRole('button', { name: 'Add a note to CHARACTERS' }));

    const search = screen.getByRole('textbox', { name: 'Search notes to add to CHARACTERS' });
    fireEvent.change(search, { target: { value: 'loose' } });
    fireEvent.click(within(characters).getByRole('button', { name: /loose note/i }));

    // Picker closes; the note now sits in the column as a reference card.
    expect(screen.queryByRole('textbox', { name: 'Search notes to add to CHARACTERS' })).not.toBeInTheDocument();
    expect(within(characters).getByRole('button', { name: 'Remove Loose Note from this scene' })).toBeInTheDocument();
  });

  it('re-adding a removed note via the + picker restores it (un-remove path)', async () => {
    await renderRefColumns();

    const characters = screen.getByTestId('sc-ref-col-characters');
    fireEvent.click(within(characters).getByRole('button', { name: 'Remove Mira Veynn from this scene' }));
    expect(within(characters).queryByText('Mira Veynn')).not.toBeInTheDocument();

    fireEvent.click(within(characters).getByRole('button', { name: 'Add a note to CHARACTERS' }));
    fireEvent.click(within(characters).getByRole('button', { name: /mira veynn/i }));
    expect(within(characters).getByRole('button', { name: 'Remove Mira Veynn from this scene' })).toBeInTheDocument();
  });

  it('beats live in Scene Setup only — the old beats/cast/places kanban is gone', async () => {
    await renderPage();
    expect(screen.queryByLabelText('Scene board: beats, cast, and places')).not.toBeInTheDocument();

    const addInput = screen.getByRole('textbox', { name: 'Add a beat' });
    fireEvent.change(addInput, { target: { value: 'Cold open on the sealed door' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // The beat renders once — in the Setup list — not mirrored anywhere else.
    expect(screen.getAllByText('Cold open on the sealed door')).toHaveLength(1);
  });

  it('migrates beats from a legacy "Beats" lane on the saved board into the Setup list (instruction 3)', async () => {
    const legacyBoard = cloneBoard();
    legacyBoard.lanes.push({
      name: 'Beats',
      cards: [
        { wikilink: 'x', title: 'Cold open on the sealed door', done: false, tags: [], raw: '' },
        { wikilink: 'y', title: 'The door answers', done: false, tags: [], raw: '' },
      ],
    });
    const api = makeApi({ sceneCrafterGetBoard: vi.fn().mockResolvedValue(legacyBoard) });
    (window as unknown as { api: unknown }).api = api;
    render(<SceneCrafterPage story={STORY} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByTestId('sc-beat-0')).toHaveTextContent('Cold open on the sealed door');
    expect(screen.getByTestId('sc-beat-1')).toHaveTextContent('The door answers');
  });
});

describe('SceneCrafterPage — SKY-8207 saved boards survive a remount (app-restart simulation)', () => {
  it('a board saved under Boards/<storySlug>/ still appears in the BOARDS list after the page remounts', async () => {
    // DesktopShell always sets story.path to `stories/<uuid>` — storySlugFromStory()
    // takes the last segment, so boards persist at Boards/<uuid>/*.canvas.json.
    const storyUuid = 'f8c62a1a-9b71-4f22-8f6f-0123456789ab';
    const uuidStory = { ...STORY, path: `stories/${storyUuid}` };
    const boardPath = `Boards/${storyUuid}/My Board.canvas.json`;

    const api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          { path: 'Boards', name: 'Boards', isDirectory: true, modifiedAt: '2026-01-01T00:00:00.000Z' },
          { path: `Boards/${storyUuid}`, name: storyUuid, isDirectory: true, modifiedAt: '2026-01-01T00:00:00.000Z' },
          { path: boardPath, name: 'My Board.canvas.json', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      readNotesVault: vi.fn().mockResolvedValue({
        content: JSON.stringify({ nodes: [], edges: [] }),
        path: boardPath,
      }),
    });
    (window as unknown as { api: unknown }).api = api;

    // First mount — simulates the original session that saved the board.
    const first = render(<SceneCrafterPage story={uuidStory} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByTestId('crafter-board-list')).toBeInTheDocument();
    first.unmount();

    // Second mount — simulates the app restart: a fresh listNotesVault() call
    // (not React state) is the only source for the boards list.
    render(<SceneCrafterPage story={uuidStory} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const boardList = screen.getByTestId('crafter-board-list');
    expect(within(boardList).getByText('My Board')).toBeInTheDocument();
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

// ─── SKY-9878 (M10-S3): SUGGESTED CARDS rail → canvas + live restock + R11 ──

/** Opens a pre-saved canvas board so the rail's canvas-view behavior is reachable directly. */
async function renderWithOpenBoard(extraVaultItems: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> = []) {
  const boardPath = 'Boards/Skyfall Chronicles/My Board.canvas.json';
  const api = makeApi({
    listNotesVault: vi.fn().mockResolvedValue({
      items: [
        { path: 'Boards', name: 'Boards', isDirectory: true, modifiedAt: '2026-01-01T00:00:00.000Z' },
        { path: 'Boards/Skyfall Chronicles', name: 'Skyfall Chronicles', isDirectory: true, modifiedAt: '2026-01-01T00:00:00.000Z' },
        { path: boardPath, name: 'My Board.canvas.json', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
        ...extraVaultItems,
      ],
    }),
    readNotesVault: vi.fn().mockResolvedValue({ content: JSON.stringify({ nodes: [], edges: [] }), path: boardPath }),
    writeNotesVault: vi.fn().mockResolvedValue({ path: boardPath }),
  });
  (window as unknown as { api: unknown }).api = api;
  await renderPage();
  fireEvent.click(within(screen.getByTestId('crafter-board-list')).getByText('My Board'));
  await waitFor(() => expect(screen.getByTestId('canvas-board')).toBeInTheDocument());
  return api;
}

describe('SceneCrafterPage — SKY-9878 SUGGESTED CARDS rail on the open canvas board', () => {
  it('renders the rail beside the board, grouped by vault category', async () => {
    await renderWithOpenBoard();
    const suggested = screen.getByLabelText('Suggested cards');
    expect(within(suggested).getByText('CHARACTERS')).toBeInTheDocument();
    expect(within(suggested).getByText('Mira Veynn')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-board')).toBeInTheDocument();
  });

  it('clicking a suggested card adds it as a new card on the open board (canvas spec §2)', async () => {
    await renderWithOpenBoard();
    const suggested = screen.getByLabelText('Suggested cards');
    const stage = screen.getByTestId('canvas-stage');
    expect(within(stage).queryByText('Mira Veynn')).not.toBeInTheDocument();

    const card = within(suggested).getByRole('button', { name: /Mira Veynn/i });
    expect(card).not.toHaveAttribute('aria-pressed');
    fireEvent.click(card);

    await waitFor(() => expect(within(stage).getByText('Mira Veynn')).toBeInTheDocument());
  });

  it('click-to-add and drag-to-add both append a card with the same content (AC2)', async () => {
    await renderWithOpenBoard();
    const suggested = screen.getByLabelText('Suggested cards');
    const stage = screen.getByTestId('canvas-stage');
    const card = within(suggested).getByRole('button', { name: /Mira Veynn/i });
    expect(card).toHaveAttribute('draggable', 'true');

    fireEvent.click(card);
    await waitFor(() => expect(within(stage).getAllByText('Mira Veynn')).toHaveLength(1));

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(CANVAS_CARD_DRAG_MIME, expect.stringContaining('Mira Veynn'));
    const raw = (dataTransfer.setData as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    const dropEvent = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 600, clientY: 500 });
    Object.assign(dropEvent, { dataTransfer: { types: [CANVAS_CARD_DRAG_MIME], getData: () => raw } });
    fireEvent(screen.getByTestId('canvas-board'), dropEvent);

    await waitFor(() => expect(within(stage).getAllByText('Mira Veynn')).toHaveLength(2));
  });
});

describe('SceneCrafterPage — SKY-9878 live vault restock (AC3, no manual refresh)', () => {
  it('a vault-change push event restocks the rail with no manual refresh', async () => {
    let vaultChangedHandler: (() => void) | undefined;
    const api = makeApi({
      listNotesVault: vi.fn()
        .mockResolvedValueOnce({
          items: [{ path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' }],
        })
        .mockResolvedValueOnce({
          items: [
            { path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
            { path: 'Locations/Ward Violet.md', name: 'Ward Violet.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      onVaultNotesUpdated: vi.fn((cb: () => void) => { vaultChangedHandler = cb; return vi.fn(); }),
    });
    (window as unknown as { api: unknown }).api = api;
    await renderPage();

    const suggested = screen.getByLabelText('Suggested cards');
    expect(within(suggested).queryByText('Ward Violet')).not.toBeInTheDocument();

    await act(async () => { vaultChangedHandler?.(); });

    await waitFor(() => expect(within(suggested).getByText('Ward Violet')).toBeInTheDocument());
    expect(api.listNotesVault).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes the vault-change listener on unmount', async () => {
    const unsubscribe = vi.fn();
    const api = makeApi({ onVaultNotesUpdated: vi.fn().mockReturnValue(unsubscribe) });
    (window as unknown as { api: unknown }).api = api;
    const { unmount } = await renderPage();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('SceneCrafterPage — SKY-9878 R11/M11c hint copy (rail is manual either way)', () => {
  it('credits the Brainstorm Agent while AI is on (default)', async () => {
    await renderPage();
    expect(screen.getByText(/the Brainstorm Agent keeps this list stocked from your vault\./)).toBeInTheDocument();
  });

  it('switches to a Notes-Vault-only hint with AI off', async () => {
    setAiEnabled(false);
    await renderPage();
    expect(screen.getByText(/this list is drawn straight from your Notes Vault\./)).toBeInTheDocument();
    expect(screen.queryByText(/Brainstorm Agent/)).not.toBeInTheDocument();
  });

  it('manual add path (M11c): a suggested card still selects as draft context with AI off — no AI call either way', async () => {
    const api = makeApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [{ path: 'Characters/Mira Veynn.md', name: 'Mira Veynn.md', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' }],
      }),
    });
    (window as unknown as { api: unknown }).api = api;
    setAiEnabled(false);
    await renderPage();

    const suggested = screen.getByLabelText('Suggested cards');
    const card = within(suggested).getByRole('button', { name: /Mira Veynn/i });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });
});
