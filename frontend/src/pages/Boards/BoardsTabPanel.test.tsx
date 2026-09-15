/**
 * SKY-11187 (Notes Board 4/9) — BoardsTabPanel: the vault-mutating canvas
 * operations (BOARDS-SPEC v2 §5).
 *
 * These tests own the WIRING: which IPC call a gesture makes, and — just as
 * importantly — which ones it must NOT make. The end-to-end proof that a
 * create or rename actually reaches disk and shows up in the Notes tab lives
 * in e2e/tests/sky-11187-board-vault-mutations.spec.ts, across the real
 * process boundary; a mocked `window.api` cannot prove that and does not try.
 *
 * jsdom has no layout, so the canvas viewport is stubbed the same way
 * BoardCanvas.test.tsx stubs it.
 */
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BoardsTabPanel from './BoardsTabPanel';

vi.mock('../../lib/noteThumbnails', () => ({
  resolveNoteThumbs: vi.fn(async () => ({})),
}));

const VIEWPORT = { width: 1200, height: 800 };

class ViewportResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    Object.defineProperty(el, 'clientWidth', { value: VIEWPORT.width, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: VIEWPORT.height, configurable: true });
    this.cb(
      [{ contentRect: { width: VIEWPORT.width, height: VIEWPORT.height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

interface VaultItem { path: string; name: string; isDirectory: boolean }

/** The one place the fake vault lives — mutated by the fake create/rename calls. */
let vaultItems: VaultItem[] = [];

const api = {
  notesVaultReadIcons: vi.fn(async () => ({})),
  listNotesVault: vi.fn(async () => ({ items: vaultItems })),
  notesBoardGet: vi.fn(async () => ({
    id: null,
    children: [] as Array<{ path: string; kind: 'note' | 'folder'; id: string | null }>,
    layout: {},
    colors: {},
    furniture: [],
    view: { zoom: 100, panX: 0, panY: 0 },
  })),
  notesBoardPatchLayout: vi.fn(async () => ({ key: 'n:1', id: '1' })),
  notesBoardCreateItem: vi.fn(async (
    _folder: string,
    kind: 'note' | 'folder',
    _position?: { x: number; y: number },
  ) => {
    const itemPath = kind === 'folder' ? 'New board' : 'New note.md';
    vaultItems = [...vaultItems, { path: itemPath, name: itemPath, isDirectory: kind === 'folder' }];
    return { itemPath, kind };
  }),
  notesBoardRenameItem: vi.fn(async (_folder: string, itemPath: string, newName: string) => {
    const ext = itemPath.endsWith('.md') ? '.md' : '';
    const to = `${newName.trim()}${ext}`;
    vaultItems = vaultItems.map((v) => (v.path === itemPath ? { path: to, name: to, isDirectory: v.isDirectory } : v));
    return { renamed: true as const, itemPath: to };
  }),
  onVaultNotesUpdated: vi.fn(() => () => {}),
  onVaultNotesAssetChanged: vi.fn(() => () => {}),
  // SKY-11189 §7/§8
  notesBoardTrashItems: vi.fn(async (
    _folder: string,
    targets: Array<{ kind: string; itemPath?: string; furnitureId?: string; label: string }>,
  ) => ({
    entries: targets.map((t, i) => ({
      id: `pending-${i}`,
      groupId: `group-${i}`,
      kind: t.kind,
      boardPath: '',
      vaultPath: t.itemPath,
      furnitureId: t.furnitureId,
      label: t.label,
      deletedAt: new Date().toISOString(),
    })),
    undoWindowMs: 8000,
  })),
  notesBoardRestore: vi.fn(async () => ({ restored: true, restoredIds: [] })),
  notesBoardRecentlyDeletedList: vi.fn(async () => ({ entries: [] as NotesBoardPendingEntry[] })),
  notesBoardEmptyTrash: vi.fn(async () => ({ flushedGroupIds: [] })),
};

beforeEach(() => {
  vaultItems = [];
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', ViewportResizeObserver);
  vi.stubGlobal('window', window);
  (window as unknown as { api: typeof api }).api = api;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountPanel() {
  render(<BoardsTabPanel notesVaultRoot="/vault" notesVaultValid />);
  await screen.findByRole('main', { name: 'Boards' });
  // Let the initial load settle before the test drives anything.
  await act(async () => { await Promise.resolve(); });
}

/** Press the empty canvas at a viewport point. */
function pressCanvas(clientX = 400, clientY = 300) {
  const root = document.querySelector('.board-canvas__root') as HTMLElement;
  fireEvent.mouseDown(root, { button: 0, clientX, clientY });
}

const tool = (name: string) => screen.getByRole('radio', { name });

describe('SKY-11187 §5 — Note and Board tools create real vault items', () => {
  it('renders the canvas on an EMPTY board so the first item can be created there', async () => {
    await mountPanel();
    expect(document.querySelector('.board-canvas__root')).toBeTruthy();
    expect(screen.getByText(/Pick the Note or Board tool/)).toBeTruthy();
  });

  it('Note tool + canvas click creates a note at the click point and opens inline rename', async () => {
    await mountPanel();
    fireEvent.click(tool('Note'));
    expect(document.querySelector('.board-canvas__root')?.getAttribute('data-active-tool')).toBe('note');

    await act(async () => { pressCanvas(); });

    expect(api.notesBoardCreateItem).toHaveBeenCalledTimes(1);
    const [folderPath, kind, position] = api.notesBoardCreateItem.mock.calls[0] as [
      string, 'note' | 'folder', { x: number; y: number },
    ];
    // Home is the empty string — the root board addresses like any other (§1).
    expect(folderPath).toBe('');
    expect(kind).toBe('note');
    expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);

    // The placeholder name is a prompt, so the new card lands in rename.
    await waitFor(() => expect(screen.getByLabelText('Note name')).toBeTruthy());
  });

  it('Board tool creates a folder, not a note', async () => {
    await mountPanel();
    fireEvent.click(tool('Board'));
    await act(async () => { pressCanvas(); });

    expect(api.notesBoardCreateItem).toHaveBeenCalledWith('', 'folder', expect.any(Object));
    await waitFor(() => expect(screen.getByLabelText('Board name')).toBeTruthy());
  });

  it('is a one-shot tool — a second click does not create a second item', async () => {
    await mountPanel();
    fireEvent.click(tool('Note'));
    await act(async () => { pressCanvas(); });
    await act(async () => { pressCanvas(500, 400); });

    expect(api.notesBoardCreateItem).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.board-canvas__root')?.getAttribute('data-active-tool')).toBe('select');
  });

  it('does nothing on a canvas click while the Select tool is armed', async () => {
    await mountPanel();
    await act(async () => { pressCanvas(); });
    expect(api.notesBoardCreateItem).not.toHaveBeenCalled();
  });
});

describe('SKY-11187 §5 — inline rename renames the real file', () => {
  async function mountWithNote() {
    vaultItems = [{ path: 'Alice.md', name: 'Alice.md', isDirectory: false }];
    await mountPanel();
    await screen.findByLabelText('Note card: Alice');
  }

  it('F2 on a focused card opens rename; Enter commits it through the vault channel', async () => {
    await mountWithNote();
    const card = screen.getByLabelText('Note card: Alice');
    fireEvent.keyDown(card, { key: 'F2' });

    const input = (await screen.findByLabelText('Note name')) as HTMLInputElement;
    expect(input.value).toBe('Alice');
    fireEvent.change(input, { target: { value: 'Aria' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(api.notesBoardRenameItem).toHaveBeenCalledWith('', 'Alice.md', 'Aria');
  });

  it('right-click → Rename reaches the same inline field', async () => {
    await mountWithNote();
    fireEvent.contextMenu(screen.getByLabelText('Note card: Alice'), { clientX: 100, clientY: 100 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(await screen.findByLabelText('Note name')).toBeTruthy();
  });

  // §5: "renaming to empty string is a no-op" — no IPC, no crash, and the
  // file is left exactly as it was (never deleted, never left unnamed).
  it('committing an EMPTY name is a no-op — nothing is sent to the vault', async () => {
    await mountWithNote();
    fireEvent.keyDown(screen.getByLabelText('Note card: Alice'), { key: 'F2' });
    const input = await screen.findByLabelText('Note name');
    fireEvent.change(input, { target: { value: '   ' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(api.notesBoardRenameItem).not.toHaveBeenCalled();
    // Still there under its original name — a card in rename is selected, and
    // selection rides the accessible name, so match on the stem.
    expect(screen.getByLabelText(/^Note card: Alice/)).toBeTruthy();
  });

  it('Escape abandons the rename without touching the vault', async () => {
    await mountWithNote();
    fireEvent.keyDown(screen.getByLabelText('Note card: Alice'), { key: 'F2' });
    const input = await screen.findByLabelText('Note name');
    fireEvent.change(input, { target: { value: 'Aria' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }); });

    expect(api.notesBoardRenameItem).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from main instead of silently dropping it', async () => {
    await mountWithNote();
    api.notesBoardRenameItem.mockResolvedValueOnce({
      error: 'An item with that name already exists',
    } as never);

    fireEvent.keyDown(screen.getByLabelText('Note card: Alice'), { key: 'F2' });
    const input = await screen.findByLabelText('Note name');
    fireEvent.change(input, { target: { value: 'Bob' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(await screen.findByRole('alert')).toHaveTextContent('An item with that name already exists');
  });

  it('rejects a filesystem-unsafe name before it reaches the vault', async () => {
    await mountWithNote();
    fireEvent.keyDown(screen.getByLabelText('Note card: Alice'), { key: 'F2' });
    const input = await screen.findByLabelText('Note name');
    fireEvent.change(input, { target: { value: 'a/b' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(api.notesBoardRenameItem).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

// The ticket's regression guard against scope creep the other way: moving a
// card is a Store B metadata edit and must never become a vault mutation.
describe('SKY-11187 — dragging a card stays metadata-only', () => {
  it('persists a drag through patchLayout alone — no create, no rename', async () => {
    vaultItems = [{ path: 'Alice.md', name: 'Alice.md', isDirectory: false }];
    await mountPanel();
    const card = await screen.findByLabelText('Note card: Alice');

    fireEvent.mouseDown(card, { button: 0, clientX: 100, clientY: 100 });
    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 260, clientY: 220 });
      fireEvent.mouseUp(window);
    });

    expect(api.notesBoardPatchLayout).toHaveBeenCalledTimes(1);
    expect(api.notesBoardCreateItem).not.toHaveBeenCalled();
    expect(api.notesBoardRenameItem).not.toHaveBeenCalled();
  });
});

describe('SKY-11189 §7/§8 — trash + undo toast + Recently Deleted panel wiring', () => {
  it('Delete on a selected card calls notesBoardTrashItems with the real vault path', async () => {
    vaultItems = [{ path: 'Idea.md', name: 'Idea.md', isDirectory: false }];
    await mountPanel();
    const card = await screen.findByLabelText('Note card: Idea');
    act(() => { card.focus(); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Delete' }); });

    expect(api.notesBoardTrashItems).toHaveBeenCalledWith('', [
      { kind: 'note', itemPath: 'Idea.md', label: 'Idea.md' },
    ]);
  });

  it('shows a toast with an Undo action, and clicking it calls notesBoardRestore', async () => {
    vaultItems = [{ path: 'Idea.md', name: 'Idea.md', isDirectory: false }];
    await mountPanel();
    const card = await screen.findByLabelText('Note card: Idea');
    act(() => { card.focus(); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Delete' }); });

    const undoBtn = await screen.findByRole('button', { name: 'Undo' });
    await act(async () => { fireEvent.click(undoBtn); });
    expect(api.notesBoardRestore).toHaveBeenCalledWith('pending-0');
  });

  it('the Recently Deleted button opens a panel listing pending entries', async () => {
    api.notesBoardRecentlyDeletedList.mockResolvedValueOnce({
      entries: [
        { id: 'x', groupId: 'g', kind: 'note', boardPath: '', vaultPath: 'Idea.md', label: 'Idea.md', deletedAt: new Date().toISOString() },
      ],
    });
    await mountPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Recently Deleted' }));
    await waitFor(() => expect(screen.getAllByText('Idea.md').length).toBeGreaterThan(0));
  });

  it('Restore in the panel calls notesBoardRestore with that entry\'s id', async () => {
    api.notesBoardRecentlyDeletedList.mockResolvedValue({
      entries: [
        { id: 'x', groupId: 'g', kind: 'note', boardPath: '', vaultPath: 'Idea.md', label: 'Idea.md', deletedAt: new Date().toISOString() },
      ],
    });
    await mountPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Recently Deleted' }));
    const restoreBtn = await screen.findByRole('button', { name: 'Restore' });
    await act(async () => { fireEvent.click(restoreBtn); });
    expect(api.notesBoardRestore).toHaveBeenCalledWith('x');
  });

  it('Empty calls notesBoardEmptyTrash and refreshes the list', async () => {
    api.notesBoardRecentlyDeletedList.mockResolvedValue({
      entries: [
        { id: 'x', groupId: 'g', kind: 'note', boardPath: '', vaultPath: 'Idea.md', label: 'Idea.md', deletedAt: new Date().toISOString() },
      ],
    });
    await mountPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Recently Deleted' }));
    const emptyBtn = await screen.findByRole('button', { name: 'Empty' });
    await act(async () => { fireEvent.click(emptyBtn); });
    expect(api.notesBoardEmptyTrash).toHaveBeenCalledTimes(1);
  });
});
