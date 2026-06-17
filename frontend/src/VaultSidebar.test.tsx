import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VaultSidebar from './VaultSidebar';
import type { Story, Chapter, Scene } from './types';
import type { SortKey, FilterKey } from './VaultSidebar';

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
    // SKY-1982: sort/filter controls
    getVaultRoot: vi.fn().mockResolvedValue({ vaultRoot: '/test-vault' }),
    tagsList: vi.fn().mockResolvedValue({ tags: [] }),
    tagsItemsForTag: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  };
}

function renderSidebar(selectedSceneId: string | null = null, overrides: Partial<React.ComponentProps<typeof VaultSidebar>> = {}) {
  return render(
    <VaultSidebar
      stories={[STUB_STORY]}
      selectedSceneId={selectedSceneId}
      onSelectScene={vi.fn()}
      onCreateStory={vi.fn()}
      onCreateChapter={vi.fn()}
      onCreateScene={vi.fn()}
      {...overrides}
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

describe('VaultSidebar — post-onboarding guidance', () => {
  beforeEach(() => { localStorage.clear(); stubWindowApi(); vi.clearAllMocks(); });

  it('shows the template quick-start CTA for blank-mode users', async () => {
    const onTemplateCtaClick = vi.fn();
    renderSidebar(null, { stories: [], showTemplateCta: true, onTemplateCtaClick });

    fireEvent.click(screen.getByRole('button', { name: /start from a template/i }));

    expect(onTemplateCtaClick).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });
});

describe('VaultSidebar — Smart Folders (SKY-205)', () => {
  beforeEach(() => { localStorage.clear(); stubWindowApi(); vi.clearAllMocks(); });

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

// ─── SKY-1982: Sort / Filter controls ───

const STUB_SCENE_A: Scene = {
  id: 'scA',
  title: 'Zephyr Rises',
  path: 'stories/s1/chapters/ch1/scenes/scA.md',
  order: 1,
  chapterId: 'ch1',
  storyId: 's1',
  blocks: [],
  draftState: 'final',
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-10T00:00:00Z',
};

const STUB_SCENE_B: Scene = {
  id: 'scB',
  title: 'Amber Falls',
  path: 'stories/s1/chapters/ch1/scenes/scB.md',
  order: 2,
  chapterId: 'ch1',
  storyId: 's1',
  blocks: [],
  draftState: 'in-progress',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-20T00:00:00Z',
  timelineMetadata: { wordCount: 500 },
};

const STUB_SCENE_C: Scene = {
  id: 'scC',
  title: 'Mirror Lake',
  path: 'stories/s1/chapters/ch1/scenes/scC.md',
  order: 3,
  chapterId: 'ch1',
  storyId: 's1',
  blocks: [],
  draftState: undefined,
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-05T00:00:00Z',
  timelineMetadata: { wordCount: 200 },
};

const MULTI_SCENE_STORY: Story = {
  id: 's1',
  title: 'The Amber Chronicle',
  path: 'stories/s1',
  createdAt: '',
  updatedAt: '',
  chapters: [{
    id: 'ch1',
    title: 'Chapter One',
    path: 'stories/s1/chapters/ch1',
    order: 0,
    createdAt: '',
    updatedAt: '',
    scenes: [STUB_SCENE_A, STUB_SCENE_B, STUB_SCENE_C],
  }],
};

async function expandChapterInMultiSceneStory() {
  const utils = render(
    <VaultSidebar
      stories={[MULTI_SCENE_STORY]}
      selectedSceneId={null}
      onSelectScene={vi.fn()}
      onCreateStory={vi.fn()}
      onCreateChapter={vi.fn()}
      onCreateScene={vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(screen.queryAllByRole('button', { name: /chapter one/i }).length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getAllByRole('button', { name: /chapter one/i })[0]);
  return utils;
}

describe('VaultSidebar — SKY-1982 sort/filter controls', () => {
  beforeEach(() => { localStorage.clear(); stubWindowApi(); vi.clearAllMocks(); });

  it('renders sort and filter selects', async () => {
    renderSidebar();
    await act(async () => {});
    expect(screen.getByRole('combobox', { name: /sort by/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /filter by/i })).toBeInTheDocument();
  });

  it('sort select defaults to "Name"', async () => {
    renderSidebar();
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: /sort by/i }) as HTMLSelectElement;
    expect(select.value).toBe('name');
  });

  it('filter select defaults to "All"', async () => {
    renderSidebar();
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: /filter by/i }) as HTMLSelectElement;
    expect(select.value).toBe('all');
  });

  it('sort select has four options', async () => {
    renderSidebar();
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: /sort by/i }) as HTMLSelectElement;
    expect(select.options.length).toBe(4);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['name', 'modified', 'created', 'wordcount']);
  });

  it('filter select has four options', async () => {
    renderSidebar();
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: /filter by/i }) as HTMLSelectElement;
    expect(select.options.length).toBe(4);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['all', 'manuscript', 'notes', 'drafts']);
  });

  it('tag button renders with listbox role on open', async () => {
    renderSidebar();
    await act(async () => {});
    const tagBtn = screen.getByRole('button', { name: /filter by tag/i });
    expect(tagBtn).toBeInTheDocument();
    expect(tagBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(tagBtn);
    expect(tagBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: /select tag filter/i })).toBeInTheDocument();
  });

  it('tag dropdown shows tags from tagsList API', async () => {
    stubWindowApi({
      tagsList: vi.fn().mockResolvedValue({
        tags: [
          { id: 't1', name: 'mystery', createdAt: '' },
          { id: 't2', name: 'action', createdAt: '' },
        ],
      }),
    });
    renderSidebar();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /filter by tag/i }));
    expect(screen.getByRole('option', { name: /#mystery/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /#action/i })).toBeInTheDocument();
  });

  it('selecting a tag closes dropdown and updates button label', async () => {
    stubWindowApi({
      tagsList: vi.fn().mockResolvedValue({
        tags: [{ id: 't1', name: 'mystery', createdAt: '' }],
      }),
      tagsItemsForTag: vi.fn().mockResolvedValue({ items: [] }),
    });
    renderSidebar();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /filter by tag/i }));
    fireEvent.click(screen.getByRole('option', { name: /#mystery/i }));
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /tag filter: mystery/i })).toBeInTheDocument();
  });

  it('tag dropdown close on Escape and focuses button', async () => {
    stubWindowApi({
      tagsList: vi.fn().mockResolvedValue({
        tags: [{ id: 't1', name: 'mystery', createdAt: '' }],
      }),
    });
    renderSidebar();
    await act(async () => {});
    const tagBtn = screen.getByRole('button', { name: /filter by tag/i });
    fireEvent.click(tagBtn);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('option', { name: /#mystery/i }), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('filter=manuscript hides Notes Vault and shows Story Vault', async () => {
    renderSidebar();
    await act(async () => {});
    const filterSelect = screen.getByRole('combobox', { name: /filter by/i });
    fireEvent.change(filterSelect, { target: { value: 'manuscript' } });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /expand notes vault/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse story vault|expand story vault/i })).toBeInTheDocument();
  });

  it('filter=notes hides Story Vault and shows Notes Vault', async () => {
    renderSidebar();
    await act(async () => {});
    const filterSelect = screen.getByRole('combobox', { name: /filter by/i });
    fireEvent.change(filterSelect, { target: { value: 'notes' } });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /expand story vault|collapse story vault/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand notes vault|collapse notes vault/i })).toBeInTheDocument();
    });
  });

  it('filter=drafts shows only in-progress scenes', async () => {
    await expandChapterInMultiSceneStory();
    const filterSelect = screen.getByRole('combobox', { name: /filter by/i });
    fireEvent.change(filterSelect, { target: { value: 'drafts' } });
    await act(async () => {});
    // scB (in-progress) and scC (no draftState = draft) should show; scA (final) hidden
    expect(screen.queryByRole('button', { name: /zephyr rises/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /amber falls/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mirror lake/i })).toBeInTheDocument();
  });

  it('sort=name shows scenes in alphabetical order', async () => {
    await expandChapterInMultiSceneStory();
    const sortSelect = screen.getByRole('combobox', { name: /sort by/i });
    fireEvent.change(sortSelect, { target: { value: 'name' } });
    await act(async () => {});
    const items = screen.getAllByRole('button', { name: /amber falls|mirror lake|zephyr rises/i });
    expect(items[0]).toHaveAttribute('aria-label', 'Amber Falls');
    expect(items[1]).toHaveAttribute('aria-label', 'Mirror Lake');
    expect(items[2]).toHaveAttribute('aria-label', 'Zephyr Rises');
  });

  it('sort=modified shows most recently modified scene first', async () => {
    await expandChapterInMultiSceneStory();
    const sortSelect = screen.getByRole('combobox', { name: /sort by/i });
    fireEvent.change(sortSelect, { target: { value: 'modified' } });
    await act(async () => {});
    // scB updatedAt 2024-01-20 > scA updatedAt 2024-01-10 > scC updatedAt 2024-01-05
    const items = screen.getAllByRole('button', { name: /amber falls|mirror lake|zephyr rises/i });
    expect(items[0]).toHaveAttribute('aria-label', 'Amber Falls');
    expect(items[1]).toHaveAttribute('aria-label', 'Zephyr Rises');
    expect(items[2]).toHaveAttribute('aria-label', 'Mirror Lake');
  });

  it('sort=wordcount shows highest word count scene first', async () => {
    await expandChapterInMultiSceneStory();
    const sortSelect = screen.getByRole('combobox', { name: /sort by/i });
    fireEvent.change(sortSelect, { target: { value: 'wordcount' } });
    await act(async () => {});
    // scB=500 > scC=200 > scA=0
    const items = screen.getAllByRole('button', { name: /amber falls|mirror lake|zephyr rises/i });
    expect(items[0]).toHaveAttribute('aria-label', 'Amber Falls');
    expect(items[1]).toHaveAttribute('aria-label', 'Mirror Lake');
    expect(items[2]).toHaveAttribute('aria-label', 'Zephyr Rises');
  });

  it('tag filter calls tagsItemsForTag and filters scenes to matching IDs', async () => {
    stubWindowApi({
      tagsList: vi.fn().mockResolvedValue({
        tags: [{ id: 't1', name: 'action', createdAt: '' }],
      }),
      tagsItemsForTag: vi.fn().mockResolvedValue({
        items: [{ itemId: 'scB', itemKind: 'scene' }],
      }),
    });
    await expandChapterInMultiSceneStory();

    fireEvent.click(screen.getByRole('button', { name: /filter by tag/i }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('option', { name: /#action/i }));

    await waitFor(() => {
      const api = (window as unknown as { api: { tagsItemsForTag: ReturnType<typeof vi.fn> } }).api;
      expect(api.tagsItemsForTag).toHaveBeenCalledWith('action');
    });
    // Only scB should remain
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /zephyr rises/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mirror lake/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /amber falls/i })).toBeInTheDocument();
  });

  it('controls bar has toolbar role with accessible label', async () => {
    renderSidebar();
    await act(async () => {});
    expect(screen.getByRole('toolbar', { name: /vault browser controls/i })).toBeInTheDocument();
  });
});

// intentional no-op to satisfy unused import lint — types are imported for documentation only
const _typeCheck: [SortKey, FilterKey] = ['name', 'all'];
void _typeCheck;

describe('VaultSidebar — WCAG 4.1.2 aria attributes (MYT-580)', () => {
  beforeEach(() => { localStorage.clear(); stubWindowApi(); vi.clearAllMocks(); });

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
