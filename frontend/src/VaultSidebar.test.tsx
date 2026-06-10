import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VaultSidebar from './VaultSidebar';
import type { Story, Chapter, Scene } from './types';

const STUB_SCENE: Scene = {
  id: 'sc1',
  title: 'The Arrival',
  path: 'stories/s1/chapters/ch1/scenes/sc1.md',
  order: 0,
  chapterId: 'ch1',
  storyId: 's1',
  blocks: [],
  draftState: 'in-progress',
  createdAt: '',
  updatedAt: '',
};

const STUB_CHAPTER: Chapter = {
  id: 'ch1',
  title: 'Chapter One',
  path: 'stories/s1/chapters/ch1',
  order: 0,
  createdAt: '',
  updatedAt: '',
  scenes: [STUB_SCENE],
};

const STUB_STORY: Story = {
  id: 's1',
  title: 'The Amber Chronicle',
  path: 'stories/s1',
  createdAt: '',
  updatedAt: '',
  chapters: [STUB_CHAPTER],
};

const STUB_SMART_FOLDER = {
  id: 'sf1',
  name: 'Lyra POV Drafts',
  query: 'pov: Lyra AND status: draft',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function stubWindowApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    listVault: vi.fn().mockResolvedValue({
      items: [
        { path: 'Notes', name: 'Notes', isDirectory: true, modifiedAt: '' },
        { path: 'Notes/ideas.md', name: 'ideas.md', isDirectory: false, modifiedAt: '' },
      ],
    }),
    startVaultWatch: vi.fn().mockResolvedValue({}),
    onVaultFileChanged: vi.fn().mockReturnValue(() => {}),
    smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [] }),
    smartFolderCreate: vi.fn().mockResolvedValue({ smartFolder: STUB_SMART_FOLDER }),
    smartFolderUpdate: vi.fn().mockResolvedValue({ smartFolder: STUB_SMART_FOLDER }),
    smartFolderDelete: vi.fn().mockResolvedValue({ success: true }),
    smartFolderQuery: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  };
}

function renderSidebar(selectedSceneId: string | null = null) {
  return render(
    <VaultSidebar
      stories={[STUB_STORY]}
      selectedSceneId={selectedSceneId}
      onSelectScene={vi.fn()}
      onCreateStory={vi.fn()}
      onCreateChapter={vi.fn()}
      onCreateScene={vi.fn()}
    />,
  );
}

// Helper: expand the single story (auto-expanded) and its chapter, then return scene row
async function openToSceneRow(selectedSceneId: string | null = null) {
  const utils = renderSidebar(selectedSceneId);
  // The story auto-expands when there's exactly one story (useEffect) — wait for that
  await waitFor(() => {
    expect(screen.queryAllByRole('button', { name: /chapter one/i }).length).toBeGreaterThan(0);
  });
  // Expand the chapter
  fireEvent.click(screen.getAllByRole('button', { name: /chapter one/i })[0]);
  return utils;
}

describe('VaultSidebar — Smart Folders (SKY-205)', () => {
  beforeEach(() => { stubWindowApi(); vi.clearAllMocks(); });

  it('renders a "Smart Folders" section header', async () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /expand smart folders/i })).toBeInTheDocument();
    // Flush VaultSidebar's async NotesVault mount effect so state updates land inside act()
    await act(async () => {});
  });

  it('section starts collapsed', async () => {
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /expand smart folders/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/no smart folders yet/i)).not.toBeInTheDocument();
    // Flush VaultSidebar's async NotesVault mount effect so state updates land inside act()
    await act(async () => {});
  });

  it('expands on click and shows empty state when no folders', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => {
      expect(screen.getByText(/no smart folders yet/i)).toBeInTheDocument();
    });
  });

  it('shows + button when expanded and calls smartFolderList', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new smart folder/i })).toBeInTheDocument();
    });
    const api = (window as unknown as { api: { smartFolderList: ReturnType<typeof vi.fn> } }).api;
    expect(api.smartFolderList).toHaveBeenCalledTimes(1);
  });

  it('create form appears on + click with name and query inputs', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByRole('button', { name: /new smart folder/i }));
    fireEvent.click(screen.getByRole('button', { name: /new smart folder/i }));
    expect(screen.getByRole('form', { name: /new smart folder/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /folder name/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /query/i })).toBeInTheDocument();
  });

  it('submitting the create form calls smartFolderCreate', async () => {
    stubWindowApi({
      smartFolderList: vi.fn()
        .mockResolvedValueOnce({ smartFolders: [] })
        .mockResolvedValueOnce({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderCreate: vi.fn().mockResolvedValue({ smartFolder: STUB_SMART_FOLDER }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByRole('button', { name: /new smart folder/i }));
    fireEvent.click(screen.getByRole('button', { name: /new smart folder/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'Lyra POV Drafts' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /query/i }), {
      target: { value: 'pov: Lyra AND status: draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const api = (window as unknown as { api: { smartFolderCreate: ReturnType<typeof vi.fn> } }).api;
      expect(api.smartFolderCreate).toHaveBeenCalledWith('Lyra POV Drafts', 'pov: Lyra AND status: draft');
    });
  });

  it('cancel button hides the create form', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByRole('button', { name: /new smart folder/i }));
    fireEvent.click(screen.getByRole('button', { name: /new smart folder/i }));
    expect(screen.getByRole('form', { name: /new smart folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('form', { name: /new smart folder/i })).not.toBeInTheDocument();
  });

  it('renders existing smart folder and runs query on click', async () => {
    stubWindowApi({
      smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderQuery: vi.fn().mockResolvedValue({
        results: [{ path: 'scenes/lyra-arrives.md', title: 'Lyra Arrives' }],
      }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByText('Lyra POV Drafts'));

    // Click the smart folder item row
    const folderItem = screen.getByText('Lyra POV Drafts').closest('[role="button"]')!;
    fireEvent.click(folderItem);

    await waitFor(() => {
      const api = (window as unknown as { api: { smartFolderQuery: ReturnType<typeof vi.fn> } }).api;
      expect(api.smartFolderQuery).toHaveBeenCalledWith('pov: Lyra AND status: draft');
    });
  });

  it('query results appear after folder selected', async () => {
    stubWindowApi({
      smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderQuery: vi.fn().mockResolvedValue({
        results: [{ path: 'scenes/lyra-arrives.md', title: 'Lyra Arrives' }],
      }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByText('Lyra POV Drafts'));

    const folderItem = screen.getByText('Lyra POV Drafts').closest('[role="button"]')!;
    fireEvent.click(folderItem);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /lyra arrives/i })).toBeInTheDocument();
    });
  });

  it('empty results show "No notes match" message', async () => {
    stubWindowApi({
      smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderQuery: vi.fn().mockResolvedValue({ results: [] }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByText('Lyra POV Drafts'));

    const folderItem = screen.getByText('Lyra POV Drafts').closest('[role="button"]')!;
    fireEvent.click(folderItem);

    await waitFor(() => {
      expect(screen.getByText(/no notes match this query/i)).toBeInTheDocument();
    });
  });

  it('delete button calls smartFolderDelete', async () => {
    stubWindowApi({
      smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderDelete: vi.fn().mockResolvedValue({ success: true }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByRole('button', { name: /delete lyra pov drafts/i }));

    fireEvent.click(screen.getByRole('button', { name: /delete lyra pov drafts/i }));

    await waitFor(() => {
      const api = (window as unknown as { api: { smartFolderDelete: ReturnType<typeof vi.fn> } }).api;
      expect(api.smartFolderDelete).toHaveBeenCalledWith('sf1');
    });
  });

  it('smart folder item has correct aria-pressed attribute', async () => {
    stubWindowApi({
      smartFolderList: vi.fn().mockResolvedValue({ smartFolders: [STUB_SMART_FOLDER] }),
      smartFolderQuery: vi.fn().mockResolvedValue({ results: [] }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /expand smart folders/i }));
    await waitFor(() => screen.getByText('Lyra POV Drafts'));

    const folderItem = screen.getByText('Lyra POV Drafts').closest('[role="button"]')!;
    expect(folderItem).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(folderItem);
    await waitFor(() => expect(folderItem).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('VaultSidebar — WCAG 4.1.2 aria attributes (MYT-580)', () => {
  beforeEach(() => { stubWindowApi(); vi.clearAllMocks(); });

  describe('Scene rows — aria-pressed (Issue 2)', () => {
    it('unselected scene row carries aria-pressed="false"', async () => {
      await openToSceneRow(null);
      const sceneRow = screen.getByRole('button', { name: 'The Arrival' });
      expect(sceneRow).toHaveAttribute('aria-pressed', 'false');
    });

    it('selected scene row carries aria-pressed="true"', async () => {
      await openToSceneRow('sc1');
      const sceneRow = screen.getByRole('button', { name: 'The Arrival' });
      expect(sceneRow).toHaveAttribute('aria-pressed', 'true');
    });

    it('scene row carries an aria-label matching its title', async () => {
      await openToSceneRow(null);
      expect(screen.getByRole('button', { name: 'The Arrival' })).toBeInTheDocument();
    });
  });

  describe('NotesTreeNode directory rows — aria-expanded (Issue 1)', () => {
    it('root Notes directory starts expanded with aria-expanded="true"', async () => {
      // Root-level directories are auto-expanded on initial tree load
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      expect(notesDir).toHaveAttribute('aria-expanded', 'true');
    });

    it('collapsed directory row has aria-expanded="false"', async () => {
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      fireEvent.click(notesDir);
      expect(notesDir).toHaveAttribute('aria-expanded', 'false');
    });

    it('directory row aria-label switches from Collapse to Expand on click', async () => {
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      fireEvent.click(notesDir);
      expect(notesDir).toHaveAttribute('aria-label', 'Expand Notes');
    });
  });
});
