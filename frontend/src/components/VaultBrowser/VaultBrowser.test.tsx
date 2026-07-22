import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  buildTree,
  flattenTree,
  isStoryInternalTreeItem,
  mapUuidNamesToTitles,
} from './treeUtils';
import { useTreeState } from './useTreeState';
import VaultBrowser from './index';
import type { Story } from '../../types';

// ─── ResizeObserver stub (jsdom has no layout engine; react-window v2 uses it
//     internally to measure the list container) ───

class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe() {
    this.cb(
      [{ contentRect: { height: 400, width: 240 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// ─── window.api mock ───

const mockListVault = vi.fn();
const mockListNotesVault = vi.fn();
const mockStartVaultWatch = vi.fn();
const mockOnVaultFileChanged = vi.fn();
const mockWriteVault = vi.fn();
const mockWriteNotesVault = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockListVault.mockResolvedValue({ items: [] });
  mockListNotesVault.mockResolvedValue({ items: [] });
  mockStartVaultWatch.mockResolvedValue({ watching: true });
  mockOnVaultFileChanged.mockReturnValue(vi.fn());
  mockWriteVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
  mockWriteNotesVault.mockResolvedValue({ path: 'x.md', bytes: 0 });

  (window as unknown as { api: unknown }).api = {
    listVault: mockListVault,
    listNotesVault: mockListNotesVault,
    startVaultWatch: mockStartVaultWatch,
    onVaultFileChanged: mockOnVaultFileChanged,
    writeVault: mockWriteVault,
    writeNotesVault: mockWriteNotesVault,
    notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
    notesTagRename: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
    notesTagMerge: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
    notesVaultReadIcons: vi.fn().mockResolvedValue({}),
    vaultReadIcons: vi.fn().mockResolvedValue({}),
    iconReadSvg: vi.fn().mockResolvedValue({ svg: null }),
  };
});

// ─── treeUtils: buildTree ───

describe('buildTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('builds a flat list of files', () => {
    const items = [
      { path: 'a.md', name: 'a.md', isDirectory: false, modifiedAt: '' },
      { path: 'b.md', name: 'b.md', isDirectory: false, modifiedAt: '' },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe('a.md');
    expect(tree[1].name).toBe('b.md');
  });

  it('nests children under their parent directory', () => {
    const items = [
      { path: 'folder', name: 'folder', isDirectory: true, modifiedAt: '' },
      { path: 'folder/note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('folder');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('note.md');
  });

  it('sorts directories before files alphabetically', () => {
    const items = [
      { path: 'z.md', name: 'z.md', isDirectory: false, modifiedAt: '' },
      { path: 'a-dir', name: 'a-dir', isDirectory: true, modifiedAt: '' },
      { path: 'a.md', name: 'a.md', isDirectory: false, modifiedAt: '' },
    ];
    const tree = buildTree(items);
    expect(tree[0].isDirectory).toBe(true);
    expect(tree[1].name).toBe('a.md');
    expect(tree[2].name).toBe('z.md');
  });

  it('handles deeply nested paths', () => {
    const items = [
      { path: 'a', name: 'a', isDirectory: true, modifiedAt: '' },
      { path: 'a/b', name: 'b', isDirectory: true, modifiedAt: '' },
      { path: 'a/b/c.md', name: 'c.md', isDirectory: false, modifiedAt: '' },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].name).toBe('c.md');
  });
});

// ─── treeUtils: flattenTree ───

describe('flattenTree', () => {
  const items = [
    { path: 'dir', name: 'dir', isDirectory: true, modifiedAt: '' },
    { path: 'dir/note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
    { path: 'root.md', name: 'root.md', isDirectory: false, modifiedAt: '' },
  ];
  const tree = buildTree(items);

  it('flattens only top-level when nothing expanded', () => {
    const rows = flattenTree(tree, new Set(), null);
    expect(rows).toHaveLength(2);
    expect(rows[0].node.name).toBe('dir');
    expect(rows[1].node.name).toBe('root.md');
  });

  it('includes children when parent is expanded', () => {
    const rows = flattenTree(tree, new Set(['dir']), null);
    expect(rows).toHaveLength(3);
    expect(rows[1].node.name).toBe('note.md');
    expect(rows[1].depth).toBe(1);
  });

  it('marks selected node correctly', () => {
    const rows = flattenTree(tree, new Set(['dir']), 'dir/note.md');
    const noteRow = rows.find((r) => r.node.name === 'note.md')!;
    expect(noteRow.isSelected).toBe(true);
  });

  it('marks expanded directories correctly', () => {
    const rows = flattenTree(tree, new Set(['dir']), null);
    expect(rows[0].isExpanded).toBe(true);
  });
});

// ─── useTreeState ───

describe('useTreeState', () => {
  it('starts with empty expansion state', () => {
    localStorage.clear();
    const { result } = renderHook(() => useTreeState('test-key'));
    expect(result.current.expanded.size).toBe(0);
    expect(result.current.selected).toBeNull();
  });

  it('toggles a path in and out of expanded', () => {
    localStorage.clear();
    const { result } = renderHook(() => useTreeState('test-key-toggle'));
    act(() => result.current.toggle('folder'));
    expect(result.current.expanded.has('folder')).toBe(true);
    act(() => result.current.toggle('folder'));
    expect(result.current.expanded.has('folder')).toBe(false);
  });

  it('persists expansion to localStorage', () => {
    localStorage.clear();
    const { result } = renderHook(() => useTreeState('test-key-persist'));
    act(() => result.current.toggle('my-folder'));
    const raw = localStorage.getItem('vb-expanded:test-key-persist');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toContain('my-folder');
  });

  it('restores expansion from localStorage on mount', () => {
    localStorage.setItem('vb-expanded:test-key-restore', JSON.stringify(['saved-folder']));
    const { result } = renderHook(() => useTreeState('test-key-restore'));
    expect(result.current.expanded.has('saved-folder')).toBe(true);
  });

  it('initExpand sets paths only when expansion is empty', () => {
    localStorage.clear();
    const { result } = renderHook(() => useTreeState('test-key-init'));
    act(() => result.current.initExpand(['dir-a', 'dir-b']));
    expect(result.current.expanded.has('dir-a')).toBe(true);
    expect(result.current.expanded.has('dir-b')).toBe(true);

    act(() => result.current.initExpand(['dir-c']));
    expect(result.current.expanded.has('dir-a')).toBe(true);
    expect(result.current.expanded.has('dir-c')).toBe(false);
  });

  it('select sets the selected path', () => {
    localStorage.clear();
    const { result } = renderHook(() => useTreeState('test-key-select'));
    act(() => result.current.select('my/note.md'));
    expect(result.current.selected).toBe('my/note.md');
  });
});

// ─── VaultBrowser component ───

const emptyStories: Story[] = [];

const baseProps = {
  stories: emptyStories,
  selectedSceneId: null,
  onSelectScene: vi.fn(),
  onCreateStory: vi.fn(),
  onCreateChapter: vi.fn(),
  onCreateScene: vi.fn(),
  onOpenFile: vi.fn(),
};

describe('VaultBrowser', () => {
  it('renders scope toggle buttons', async () => {
    render(<VaultBrowser {...baseProps} />);
    // Wait for async listVault/listNotesVault mount effects to settle
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('vb-scope-story')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-notes')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-both')).toBeInTheDocument();
  });

  it('"Both" scope is active by default', async () => {
    render(<VaultBrowser {...baseProps} />);
    // Wait for async listVault/listNotesVault mount effects to settle
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('vb-scope-both')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows both vault sections in Both scope', async () => {
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('vb-story-vault')).toBeInTheDocument();
      expect(screen.getByTestId('vb-notes-vault')).toBeInTheDocument();
    });
  });

  it('hides notes when Story scope is selected', async () => {
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-story'));
    await waitFor(() => {
      expect(screen.getByTestId('vb-story-vault')).toBeInTheDocument();
      expect(screen.queryByTestId('vb-notes-vault')).not.toBeInTheDocument();
    });
  });

  it('hides story when Notes scope is selected', async () => {
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => {
      expect(screen.queryByTestId('vb-story-vault')).not.toBeInTheDocument();
      expect(screen.getByTestId('vb-notes-vault')).toBeInTheDocument();
    });
  });

  it('shows empty state when no stories', async () => {
    render(<VaultBrowser {...baseProps} />);
    // Wait for async listVault/listNotesVault mount effects to settle
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('vb-story-empty')).toBeInTheDocument();
  });

  it('Story Vault empty state heading says "Create your first story"', async () => {
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('vb-story-empty')).toBeInTheDocument());
    expect(screen.getByText(/Create your first story/i)).toBeInTheDocument();
  });

  it('shows "No scenes yet" when chapter has no scenes', async () => {
    const stories: Story[] = [{
      id: 's1', title: 'Empty Chapter Story', path: 'stories/s1',
      chapters: [{
        id: 'ch1', title: 'Empty Chapter', path: 'ch1', order: 0, scenes: [], createdAt: '', updatedAt: '',
      }],
      createdAt: '', updatedAt: '',
    }];
    render(<VaultBrowser {...baseProps} stories={stories} />);
    // Single story auto-expands; click chapter to expand it
    const chapterToggle = await screen.findByText('Empty Chapter');
    fireEvent.click(chapterToggle);
    await waitFor(() => {
      expect(screen.getByTestId('vb-scenes-empty')).toBeInTheDocument();
      expect(screen.getByText(/No scenes yet\. Create one to start writing\./i)).toBeInTheDocument();
    });
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('calls onCreateStory when New Story button is clicked', async () => {
    render(<VaultBrowser {...baseProps} />);
    // Wait for async listVault/listNotesVault mount effects to settle
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('New Story'));
    expect(baseProps.onCreateStory).toHaveBeenCalledOnce();
  });

  it('renders story titles when stories provided', async () => {
    const stories: Story[] = [
      {
        id: 's1',
        title: 'My Great Novel',
        path: 'stories/s1',
        chapters: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    render(<VaultBrowser {...baseProps} stories={stories} />);
    // Wait for async listVault/listNotesVault mount effects to settle
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.getByText('My Great Novel')).toBeInTheDocument();
  });

  it('filters out hidden items from notes vault', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: '.git', name: '.git', isDirectory: true, modifiedAt: '' },
        { path: '.git/config', name: 'config', isDirectory: false, modifiedAt: '' },
        { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => {
      expect(screen.queryByText('.git')).not.toBeInTheDocument();
      expect(screen.queryByText('config')).not.toBeInTheDocument();
    });
  });

  it('calls listNotesVault (not listVault) for the Notes section', async () => {
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(mockListVault).not.toHaveBeenCalled();
  });

  it('Notes section shows items from listNotesVault, not listVault', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: 'my-note.md', name: 'my-note.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    mockListVault.mockResolvedValue({
      items: [
        { path: 'story-scene.md', name: 'story-scene.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    // VirtualTree strips .md extension from display names
    await waitFor(() => expect(screen.getByText('my-note')).toBeInTheDocument());
    expect(screen.queryByText('story-scene')).not.toBeInTheDocument();
  });

  it('shows notes empty state when Notes Vault has no items', async () => {
    mockListNotesVault.mockResolvedValue({ items: [] });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => {
      expect(screen.getByTestId('vb-notes-empty')).toBeInTheDocument();
    });
  });

  it('renders notes vault when notes items are loaded', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: 'note1.md', name: 'note1.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('vb-notes-vault')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
  });
});

// ─── W0.1 (Beta 4, GAP #1): notes-tree hygiene ───

const SCENE_UUID = '3f6a804a-1c2b-4d3e-9f10-abcdef012345';

describe('isStoryInternalTreeItem (W0.1 GAP #1)', () => {
  it('excludes UUID-named directories and their subtrees', () => {
    expect(isStoryInternalTreeItem({ path: SCENE_UUID, isDirectory: true })).toBe(true);
    expect(isStoryInternalTreeItem({ path: `${SCENE_UUID}/draft.md`, isDirectory: false })).toBe(true);
    expect(isStoryInternalTreeItem({ path: `versions/${SCENE_UUID}`, isDirectory: true })).toBe(true);
  });

  it('excludes children of dot-dirs so they are never promoted to root rows', () => {
    expect(isStoryInternalTreeItem({ path: '.obsidian/plugins', isDirectory: true })).toBe(true);
    expect(isStoryInternalTreeItem({ path: '.snapshots/x/y.md', isDirectory: false })).toBe(true);
  });

  it('keeps normal notes content, including UUID-named .md files', () => {
    expect(isStoryInternalTreeItem({ path: 'Universes', isDirectory: true })).toBe(false);
    expect(isStoryInternalTreeItem({ path: 'Inbox/idea.md', isDirectory: false })).toBe(false);
    expect(isStoryInternalTreeItem({ path: `${SCENE_UUID}.md`, isDirectory: false })).toBe(false);
  });
});

describe('mapUuidNamesToTitles (W0.1 GAP #1)', () => {
  const titles = new Map([[SCENE_UUID, 'Scene One']]);

  it('maps a UUID-named directory to its manifest title', () => {
    const [mapped] = mapUuidNamesToTitles(
      [{ path: SCENE_UUID, name: SCENE_UUID, isDirectory: true, modifiedAt: '' }],
      titles,
    );
    expect(mapped.name).toBe('Scene One');
    expect(mapped.path).toBe(SCENE_UUID); // identity path is untouched
  });

  it('maps a UUID-named .md file, preserving the extension', () => {
    const [mapped] = mapUuidNamesToTitles(
      [{ path: `${SCENE_UUID}.md`, name: `${SCENE_UUID}.md`, isDirectory: false, modifiedAt: '' }],
      titles,
    );
    expect(mapped.name).toBe('Scene One.md');
  });

  it('leaves unknown UUIDs and normal names untouched', () => {
    const items = [
      { path: 'f8c62a1a-9b71-4f22-8f6f-0123456789ab', name: 'f8c62a1a-9b71-4f22-8f6f-0123456789ab', isDirectory: true, modifiedAt: '' },
      { path: 'Universes', name: 'Universes', isDirectory: true, modifiedAt: '' },
    ];
    expect(mapUuidNamesToTitles(items, titles)).toEqual(items);
  });
});

describe('VaultBrowser notes-tree hygiene (W0.1 GAP #1)', () => {
  it('never renders UUID-named folders in the Notes tree', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: SCENE_UUID, name: SCENE_UUID, isDirectory: true, modifiedAt: '' },
        { path: `${SCENE_UUID}/draft.md`, name: 'draft.md', isDirectory: false, modifiedAt: '' },
        { path: 'Universes', name: 'Universes', isDirectory: true, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => expect(screen.getByText('Universes')).toBeInTheDocument());
    expect(screen.queryByText(SCENE_UUID)).not.toBeInTheDocument();
    expect(screen.queryByText('draft')).not.toBeInTheDocument();
  });

  it('does not promote children of filtered dot-dirs to root rows', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: '.obsidian', name: '.obsidian', isDirectory: true, modifiedAt: '' },
        { path: '.obsidian/plugins', name: 'plugins', isDirectory: true, modifiedAt: '' },
        { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => expect(screen.getByText('note')).toBeInTheDocument());
    expect(screen.queryByText('plugins')).not.toBeInTheDocument();
  });

  it('display-maps a surviving UUID-named note to its story/scene title', async () => {
    const stories: Story[] = [{
      id: 's1', title: 'My Story', path: 'stories/s1',
      chapters: [{
        id: 'ch1', title: 'Chapter One', path: 'ch1', order: 0,
        scenes: [{
          id: SCENE_UUID, title: 'The Departure', path: 'x.md', order: 0,
          blocks: [], createdAt: '', updatedAt: '',
        }],
        createdAt: '', updatedAt: '',
      }],
      createdAt: '', updatedAt: '',
    }];
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: `${SCENE_UUID}.md`, name: `${SCENE_UUID}.md`, isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} stories={stories} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    // VirtualTree strips the .md extension from display names.
    await waitFor(() => expect(screen.getByText('The Departure')).toBeInTheDocument());
    expect(screen.queryByText(SCENE_UUID)).not.toBeInTheDocument();
  });
});

// ─── validateRenameName (SKY-115) ───

import { validateRenameName } from './renameUtils';

describe('validateRenameName', () => {
  it('returns null for a valid name', () => {
    expect(validateRenameName('My Scene')).toBeNull();
    expect(validateRenameName('scene-1')).toBeNull();
    expect(validateRenameName('  trimmed  ')).toBeNull();
  });

  it('returns error for empty string', () => {
    expect(validateRenameName('')).not.toBeNull();
    expect(validateRenameName('   ')).not.toBeNull();
  });

  it('returns error for name longer than 255 characters', () => {
    expect(validateRenameName('a'.repeat(256))).not.toBeNull();
  });

  it('returns null for exactly 255 characters', () => {
    expect(validateRenameName('a'.repeat(255))).toBeNull();
  });

  it('rejects invalid filesystem characters', () => {
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
      expect(validateRenameName(`bad${ch}name`)).not.toBeNull();
    }
  });

  it('allows hyphens, underscores, spaces, and dots', () => {
    expect(validateRenameName('my-scene_v1.2 final')).toBeNull();
  });
});

// ─── StoryVault inline rename (SKY-115) ───

const storyWithScene: Story[] = [
  {
    id: 'story1',
    title: 'Test Story',
    path: 'stories/story1',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter One',
        path: 'ch1',
        order: 0,
        scenes: [
          {
            id: 'sc1',
            title: 'Opening Scene',
            path: 'sc1.md',
            order: 0,
            blocks: [],
            createdAt: '',
            updatedAt: '',
          },
        ],
        createdAt: '',
        updatedAt: '',
      },
    ],
    createdAt: '',
    updatedAt: '',
  },
];

const mockSceneRename = vi.fn().mockResolvedValue({ scene: { id: 'sc1', title: 'New Title' } });

describe('StoryVault inline rename', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSceneRename.mockClear();
    (window as unknown as { api: unknown }).api = {
      listVault: mockListVault,
      listNotesVault: mockListNotesVault,
      startVaultWatch: mockStartVaultWatch,
      onVaultFileChanged: mockOnVaultFileChanged,
      writeVault: mockWriteVault,
      writeNotesVault: mockWriteNotesVault,
      sceneRename: mockSceneRename,
      notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
      notesTagRename: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
      notesTagMerge: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
      notesVaultReadIcons: vi.fn().mockResolvedValue({}),
      vaultReadIcons: vi.fn().mockResolvedValue({}),
      iconReadSvg: vi.fn().mockResolvedValue({ svg: null }),
    };
  });

  async function renderWithScene() {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    // Story auto-expands (single story); expand chapter
    const chapterToggle = await screen.findByText('Chapter One');
    fireEvent.click(chapterToggle);
    return screen.findByTestId('vb-scene-sc1');
  }

  it('shows rename input on double-click of scene row', async () => {
    const sceneRow = await renderWithScene();
    fireEvent.doubleClick(sceneRow);
    const input = await screen.findByRole('textbox', { name: /rename scene/i });
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('Opening Scene');
  });

  it('cancels rename on Escape without calling IPC', async () => {
    const sceneRow = await renderWithScene();
    fireEvent.doubleClick(sceneRow);
    const input = await screen.findByRole('textbox', { name: /rename scene/i });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: /rename scene/i })).not.toBeInTheDocument();
    });
    expect(mockSceneRename).not.toHaveBeenCalled();
  });

  it('commits rename on Enter and calls sceneRename IPC', async () => {
    const sceneRow = await renderWithScene();
    fireEvent.doubleClick(sceneRow);
    const input = await screen.findByRole('textbox', { name: /rename scene/i });
    fireEvent.change(input, { target: { value: 'Renamed Scene' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(mockSceneRename).toHaveBeenCalledWith({ sceneId: 'sc1', title: 'Renamed Scene' });
    });
  });

  it('shows validation error for empty name and does not call IPC', async () => {
    const sceneRow = await renderWithScene();
    fireEvent.doubleClick(sceneRow);
    const input = await screen.findByRole('textbox', { name: /rename scene/i });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockSceneRename).not.toHaveBeenCalled();
  });
});

// ─── VirtualTree ARIA structure (Notes Vault) ───

const navItems = [
  { path: 'concepts', name: 'concepts', isDirectory: true, modifiedAt: '' },
  { path: 'concepts/magic.md', name: 'magic.md', isDirectory: false, modifiedAt: '' },
  { path: 'worldbuilding.md', name: 'worldbuilding.md', isDirectory: false, modifiedAt: '' },
];

async function renderNotesTree() {
  localStorage.clear();
  mockListNotesVault.mockResolvedValue({ items: navItems });
  render(<VaultBrowser {...baseProps} />);
  fireEvent.click(screen.getByTestId('vb-scope-notes'));
  // Wait for the virtualized tree rows to appear (concepts dir auto-expands)
  await waitFor(() => expect(screen.getByTestId('vb-row-concepts')).toBeInTheDocument());
  // Flush any remaining async state updates from the initial render
  await act(async () => {});
}

describe('VirtualTree ARIA attributes', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockListVault.mockResolvedValue({ items: [] });
    mockListNotesVault.mockResolvedValue({ items: [] });
    mockStartVaultWatch.mockResolvedValue({ watching: true });
    mockOnVaultFileChanged.mockReturnValue(vi.fn());
    mockWriteVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
    mockWriteNotesVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
    (window as unknown as { api: unknown }).api = {
      listVault: mockListVault,
      listNotesVault: mockListNotesVault,
      startVaultWatch: mockStartVaultWatch,
      onVaultFileChanged: mockOnVaultFileChanged,
      writeVault: mockWriteVault,
      writeNotesVault: mockWriteNotesVault,
      notesVaultReadIcons: vi.fn().mockResolvedValue({}),
      notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
      noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    };
  });

  it('notes tree container has role="tree"', async () => {
    await renderNotesTree();
    const tree = screen.getByRole('tree', { name: 'Notes Vault' });
    expect(tree).toBeInTheDocument();
  });

  it('notes tree has aria-label="Notes Vault"', async () => {
    await renderNotesTree();
    expect(screen.getByTestId('vb-notes-tree')).toHaveAttribute('aria-label', 'Notes Vault');
  });

  it('directory row has role="treeitem"', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('role', 'treeitem');
  });

  it('file row has role="treeitem"', async () => {
    await renderNotesTree();
    // concepts is auto-expanded so magic.md is visible
    const fileRow = screen.getByTestId('vb-row-concepts/magic.md');
    expect(fileRow).toHaveAttribute('role', 'treeitem');
  });

  it('root-level rows have aria-level=1', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    const rootFileRow = screen.getByTestId('vb-row-worldbuilding.md');
    expect(folderRow).toHaveAttribute('aria-level', '1');
    expect(rootFileRow).toHaveAttribute('aria-level', '1');
  });

  it('nested rows have aria-level=2', async () => {
    await renderNotesTree();
    const nestedRow = screen.getByTestId('vb-row-concepts/magic.md');
    expect(nestedRow).toHaveAttribute('aria-level', '2');
  });

  it('directory has aria-expanded="true" when expanded', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('aria-expanded', 'true');
  });

  it('directory has aria-expanded="false" when collapsed', async () => {
    await renderNotesTree();
    // collapse the folder first
    fireEvent.click(screen.getByTestId('vb-row-concepts'));
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('file rows do not have aria-expanded', async () => {
    await renderNotesTree();
    const fileRow = screen.getByTestId('vb-row-worldbuilding.md');
    expect(fileRow).not.toHaveAttribute('aria-expanded');
  });

  it('selected file has aria-selected="true"', async () => {
    await renderNotesTree();
    const fileRow = screen.getByTestId('vb-row-worldbuilding.md');
    // click to select
    fireEvent.click(fileRow);
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-worldbuilding.md')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('unselected items have aria-selected="false"', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('aria-selected', 'false');
  });

  it('first row has tabIndex=0 (roving tabindex entry point)', async () => {
    await renderNotesTree();
    const firstRow = screen.getByTestId('vb-row-concepts');
    expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  it('non-first rows have tabIndex=-1 initially', async () => {
    await renderNotesTree();
    const nestedRow = screen.getByTestId('vb-row-concepts/magic.md');
    const rootRow = screen.getByTestId('vb-row-worldbuilding.md');
    expect(nestedRow).toHaveAttribute('tabindex', '-1');
    expect(rootRow).toHaveAttribute('tabindex', '-1');
  });
});

// ─── VirtualTree keyboard navigation ───

describe('VirtualTree keyboard navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockListVault.mockResolvedValue({ items: [] });
    mockListNotesVault.mockResolvedValue({ items: [] });
    mockStartVaultWatch.mockResolvedValue({ watching: true });
    mockOnVaultFileChanged.mockReturnValue(vi.fn());
    mockWriteVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
    mockWriteNotesVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
    (window as unknown as { api: unknown }).api = {
      listVault: mockListVault,
      listNotesVault: mockListNotesVault,
      startVaultWatch: mockStartVaultWatch,
      onVaultFileChanged: mockOnVaultFileChanged,
      writeVault: mockWriteVault,
      writeNotesVault: mockWriteNotesVault,
      notesVaultReadIcons: vi.fn().mockResolvedValue({}),
      notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
      noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    };
  });

  it('ArrowDown moves tabIndex=0 to next row', async () => {
    await renderNotesTree();
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts/magic.md')).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('tabindex', '-1');
    });
  });

  it('ArrowDown moves DOM focus to next row', async () => {
    await renderNotesTree();
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts/magic.md')).toHaveFocus();
    });
  });

  it('ArrowUp moves tabIndex=0 back to previous row', async () => {
    await renderNotesTree();
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('vb-row-concepts/magic.md')).toHaveAttribute('tabindex', '0'));

    const second = screen.getByTestId('vb-row-concepts/magic.md');
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('vb-row-concepts/magic.md')).toHaveAttribute('tabindex', '-1');
    });
  });

  it('ArrowUp at first row keeps focus on first row', async () => {
    await renderNotesTree();
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('tabindex', '0');
    });
  });

  it('ArrowDown at last row keeps focus on last row', async () => {
    await renderNotesTree();
    // Navigate to last row (worldbuilding.md = index 2)
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => screen.getByTestId('vb-row-concepts/magic.md').getAttribute('tabindex') === '0');

    const second = screen.getByTestId('vb-row-concepts/magic.md');
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('vb-row-worldbuilding.md')).toHaveAttribute('tabindex', '0'));

    const last = screen.getByTestId('vb-row-worldbuilding.md');
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-worldbuilding.md')).toHaveAttribute('tabindex', '0');
    });
  });

  it('ArrowRight expands a collapsed directory', async () => {
    await renderNotesTree();
    // first collapse the folder
    fireEvent.click(screen.getByTestId('vb-row-concepts'));
    await waitFor(() => expect(screen.queryByTestId('vb-row-concepts/magic.md')).not.toBeInTheDocument());

    const folderRow = screen.getByTestId('vb-row-concepts');
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('vb-row-concepts/magic.md')).toBeInTheDocument();
    });
  });

  it('ArrowRight on already-expanded directory does nothing', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'ArrowRight' });
    await waitFor(() => {
      // still expanded, children still present
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('vb-row-concepts/magic.md')).toBeInTheDocument();
    });
  });

  it('ArrowLeft collapses an expanded directory', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('vb-row-concepts/magic.md')).not.toBeInTheDocument();
    });
  });

  it('ArrowLeft on collapsed directory does nothing', async () => {
    await renderNotesTree();
    // collapse first
    fireEvent.click(screen.getByTestId('vb-row-concepts'));
    await waitFor(() => expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'false'));

    const folderRow = screen.getByTestId('vb-row-concepts');
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('Enter on directory toggles expand/collapse', async () => {
    await renderNotesTree();
    const folderRow = screen.getByTestId('vb-row-concepts');
    expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'false');
    });
    // Enter again re-expands
    fireEvent.keyDown(screen.getByTestId('vb-row-concepts'), { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('Enter on a file calls onOpenFile', async () => {
    await renderNotesTree();
    const fileRow = screen.getByTestId('vb-row-worldbuilding.md');
    await act(async () => { fileRow.focus(); });
    await act(async () => { fireEvent.keyDown(fileRow, { key: 'Enter' }); });
    expect(baseProps.onOpenFile).toHaveBeenCalledWith('worldbuilding.md');
  });

  it('Space on a file calls onOpenFile', async () => {
    await renderNotesTree();
    const fileRow = screen.getByTestId('vb-row-worldbuilding.md');
    await act(async () => { fileRow.focus(); });
    await act(async () => { fireEvent.keyDown(fileRow, { key: ' ' }); });
    expect(baseProps.onOpenFile).toHaveBeenCalledWith('worldbuilding.md');
  });

  it('clicking a row updates roving tabindex to that row', async () => {
    await renderNotesTree();
    const rootFile = screen.getByTestId('vb-row-worldbuilding.md');
    fireEvent.click(rootFile);
    await waitFor(() => {
      expect(rootFile).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('vb-row-concepts')).toHaveAttribute('tabindex', '-1');
    });
  });

  it('focusedIdx clamps when rows shrink after collapse', async () => {
    await renderNotesTree();
    // Navigate to magic.md (index 1)
    const first = screen.getByTestId('vb-row-concepts');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('vb-row-concepts/magic.md')).toHaveAttribute('tabindex', '0'));

    // Collapse the parent folder (removes magic.md from visible rows)
    fireEvent.click(screen.getByTestId('vb-row-concepts'));
    await waitFor(() => {
      // magic.md gone; focusedIdx clamped to last visible row
      expect(screen.queryByTestId('vb-row-concepts/magic.md')).not.toBeInTheDocument();
      // some row still has tabIndex=0 (either concepts or worldbuilding.md)
      const visibleRows = screen.getAllByRole('treeitem');
      const focusedRows = visibleRows.filter((r) => r.getAttribute('tabindex') === '0');
      expect(focusedRows).toHaveLength(1);
    });
  });
});

// ─── StoryVault ARIA tree roles ───

describe('StoryVault ARIA tree roles', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockListVault.mockResolvedValue({ items: [] });
    mockListNotesVault.mockResolvedValue({ items: [] });
    mockStartVaultWatch.mockResolvedValue({ watching: true });
    mockOnVaultFileChanged.mockReturnValue(vi.fn());
    mockWriteVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
    (window as unknown as { api: unknown }).api = {
      listVault: mockListVault,
      listNotesVault: mockListNotesVault,
      startVaultWatch: mockStartVaultWatch,
      onVaultFileChanged: mockOnVaultFileChanged,
      writeVault: mockWriteVault,
      sceneRename: vi.fn().mockResolvedValue({ scene: { id: 'sc1', title: 'Opening Scene' } }),
      notesVaultReadIcons: vi.fn().mockResolvedValue({}),
      notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
      noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    };
  });

  async function renderStoryTree() {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    // Story auto-expands (single story)
    const chapterToggle = await screen.findByText('Chapter One');
    fireEvent.click(chapterToggle);
    await screen.findByTestId('vb-scene-sc1');
  }

  it('story content container has role="tree"', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const tree = screen.getByRole('tree', { name: 'Story Vault' });
    expect(tree).toBeInTheDocument();
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('story toggle button has role="treeitem"', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const storyBtn = screen.getByText('Test Story').closest('button');
    expect(storyBtn).toHaveAttribute('role', 'treeitem');
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('story toggle button has aria-level=1', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const storyBtn = screen.getByText('Test Story').closest('button');
    expect(storyBtn).toHaveAttribute('aria-level', '1');
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('story toggle has aria-expanded reflecting expansion state', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    // Single story auto-expands
    const storyBtn = screen.getByText('Test Story').closest('button');
    expect(storyBtn).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('chapter toggle button has role="treeitem"', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const chapterBtn = await screen.findByText('Chapter One');
    expect(chapterBtn.closest('button')).toHaveAttribute('role', 'treeitem');
  });

  it('chapter toggle button has aria-level=2', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const chapterBtn = await screen.findByText('Chapter One');
    expect(chapterBtn.closest('button')).toHaveAttribute('aria-level', '2');
  });

  it('chapter toggle has aria-expanded', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    const chapterBtn = await screen.findByText('Chapter One');
    const btn = chapterBtn.closest('button')!;
    // initially collapsed
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-expanded', 'true'));
  });

  it('expanded story chapters wrapped in role="group"', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} />);
    // story is auto-expanded, so a group should be present
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
  });

  it('scene row has role="treeitem"', async () => {
    await renderStoryTree();
    const sceneRow = screen.getByTestId('vb-scene-sc1');
    expect(sceneRow).toHaveAttribute('role', 'treeitem');
  });

  it('scene row has aria-level=3', async () => {
    await renderStoryTree();
    const sceneRow = screen.getByTestId('vb-scene-sc1');
    expect(sceneRow).toHaveAttribute('aria-level', '3');
  });

  it('selected scene has aria-selected="true"', async () => {
    render(<VaultBrowser {...baseProps} stories={storyWithScene} selectedSceneId="sc1" />);
    const chapterToggle = await screen.findByText('Chapter One');
    fireEvent.click(chapterToggle);
    await screen.findByTestId('vb-scene-sc1');
    expect(screen.getByTestId('vb-scene-sc1')).toHaveAttribute('aria-selected', 'true');
  });

  it('unselected scene has aria-selected="false"', async () => {
    await renderStoryTree();
    expect(screen.getByTestId('vb-scene-sc1')).toHaveAttribute('aria-selected', 'false');
  });

  it('expanded chapter scenes wrapped in role="group"', async () => {
    await renderStoryTree();
    // After expanding chapter, scenes are in a group
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  it('Enter on scene row calls onSelectScene', async () => {
    await renderStoryTree();
    const sceneRow = screen.getByTestId('vb-scene-sc1');
    fireEvent.keyDown(sceneRow, { key: 'Enter' });
    expect(baseProps.onSelectScene).toHaveBeenCalled();
  });

  it('Space on scene row calls onSelectScene', async () => {
    await renderStoryTree();
    const sceneRow = screen.getByTestId('vb-scene-sc1');
    fireEvent.keyDown(sceneRow, { key: ' ' });
    expect(baseProps.onSelectScene).toHaveBeenCalled();
  });
});

// ─── SKY-2976: lockScope hides the vault scope selector ───────────────────────

describe('VaultBrowser lockScope', () => {
  it('hides the scope selector bar when lockScope is true', async () => {
    render(<VaultBrowser {...baseProps} lockScope initialScope="notes" />);
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.queryByTestId('vb-scope-story')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vb-scope-notes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vb-scope-both')).not.toBeInTheDocument();
  });

  it('shows only the Notes Vault when lockScope + initialScope="notes"', async () => {
    render(<VaultBrowser {...baseProps} lockScope initialScope="notes" />);
    await waitFor(() => expect(screen.getByTestId('vb-notes-vault')).toBeInTheDocument());
    expect(screen.queryByTestId('vb-story-vault')).not.toBeInTheDocument();
  });

  it('keeps the scope selector visible when lockScope is false (default)', async () => {
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => expect(mockListNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('vb-scope-story')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-notes')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-both')).toBeInTheDocument();
  });
});

// ─── M15: notes-tree context menu (Liquid Neon prototype treeCtxItems) ────────

describe('NotesVault context menu (M15)', () => {
  const mockDeleteNotesVault = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    mockDeleteNotesVault.mockReset().mockResolvedValue({ path: 'note.md', deleted: true });
    mockListNotesVault.mockResolvedValue({
      items: [
        { path: 'folder', name: 'folder', isDirectory: true, modifiedAt: '' },
        { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    (window as unknown as { api: unknown }).api = {
      ...((window as unknown as { api: Record<string, unknown> }).api),
      deleteNotesVault: mockDeleteNotesVault,
      noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    };
  });

  async function openFileContextMenu(extraProps: Record<string, unknown> = {}) {
    render(<VaultBrowser {...baseProps} lockScope initialScope="notes" {...extraProps} />);
    await waitFor(() => expect(screen.getByTestId('vb-row-note.md')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('vb-row-note.md'));
    await screen.findByTestId('vb-context-menu');
  }

  it('shows the five prototype items on a file row', async () => {
    await openFileContextMenu();
    expect(screen.getByTestId('menu-item-open-tab')).toHaveTextContent('Open in new tab');
    expect(screen.getByTestId('menu-item-beta-read')).toHaveTextContent('Beta read');
    expect(screen.getByTestId('menu-item-continuity-check')).toHaveTextContent('Continuity check');
    expect(screen.getByTestId('menu-item-rename')).toHaveTextContent('Rename…');
    expect(screen.getByTestId('menu-item-delete')).toHaveTextContent('Delete');
  });

  it('preserves New Note / New Folder below a separator on file rows', async () => {
    await openFileContextMenu();
    expect(screen.getByTestId('menu-item-new-note')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-new-folder')).toBeInTheDocument();
    expect(screen.getByTestId('ln-menu-separator')).toBeInTheDocument();
  });

  // SKY-7995: directories get Obsidian-parity Rename/Delete now — they just
  // don't get the file-only actions (open-tab / beta-read / continuity-check).
  it('directory rows get Rename/Delete but not the file-only actions', async () => {
    render(<VaultBrowser {...baseProps} lockScope initialScope="notes" />);
    await waitFor(() => expect(screen.getByTestId('vb-row-folder')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('vb-row-folder'));
    await screen.findByTestId('vb-context-menu');
    expect(screen.getByTestId('menu-item-new-note')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-new-folder')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-rename')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-open-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-beta-read')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-continuity-check')).not.toBeInTheDocument();
  });

  it('"Open in new tab" falls back to onOpenFile with the note path', async () => {
    const onOpenFile = vi.fn();
    await openFileContextMenu({ onOpenFile });
    // act-wrapped: selecting the note mounts BacklinksPane (async fetch)
    await act(async () => { fireEvent.click(screen.getByTestId('menu-item-open-tab')); });
    expect(onOpenFile).toHaveBeenCalledWith('note.md');
  });

  it('"Open in new tab" prefers the onOpenInNewTab prop when provided', async () => {
    const onOpenFile = vi.fn();
    const onOpenInNewTab = vi.fn();
    await openFileContextMenu({ onOpenFile, onOpenInNewTab });
    await act(async () => { fireEvent.click(screen.getByTestId('menu-item-open-tab')); });
    expect(onOpenInNewTab).toHaveBeenCalledWith('note.md');
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('"Beta read" / "Continuity check" call their optional props with the path', async () => {
    const onBetaRead = vi.fn();
    const onContinuityCheck = vi.fn();
    await openFileContextMenu({ onBetaRead, onContinuityCheck });
    fireEvent.click(screen.getByTestId('menu-item-beta-read'));
    expect(onBetaRead).toHaveBeenCalledWith('note.md');

    fireEvent.contextMenu(screen.getByTestId('vb-row-note.md'));
    fireEvent.click(await screen.findByTestId('menu-item-continuity-check'));
    expect(onContinuityCheck).toHaveBeenCalledWith('note.md');
  });

  it('"Beta read" / "Continuity check" are disabled when unwired', async () => {
    await openFileContextMenu();
    expect(screen.getByTestId('menu-item-beta-read')).toBeDisabled();
    expect(screen.getByTestId('menu-item-continuity-check')).toBeDisabled();
  });

  it('"Rename…" opens the inline rename input', async () => {
    await openFileContextMenu();
    fireEvent.click(screen.getByTestId('menu-item-rename'));
    const input = await screen.findByLabelText('Rename');
    expect((input as HTMLInputElement).value).toBe('note');
  });

  it('"Delete" is destructive-styled and deletes after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await openFileContextMenu();
      const deleteItem = screen.getByTestId('menu-item-delete');
      expect(deleteItem.className).toContain('ln-menu-item--destructive');
      fireEvent.click(deleteItem);
      await waitFor(() => expect(mockDeleteNotesVault).toHaveBeenCalledWith('note.md'));
      expect(confirmSpy).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('"Delete" does nothing when the confirm is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await openFileContextMenu();
      fireEvent.click(screen.getByTestId('menu-item-delete'));
      await act(async () => {});
      expect(mockDeleteNotesVault).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('context menu carries the prototype popover class', async () => {
    await openFileContextMenu();
    expect(screen.getByTestId('vb-context-menu').className).toContain('vb-ctx-menu');
  });
});

// ─── SKY-2976: moveNotesVault used for rename (not moveVault) ─────────────────

describe('NotesVault rename uses moveNotesVault', () => {
  it('calls moveNotesVault when renaming a note', async () => {
    const mockMoveNotesVault = vi.fn().mockResolvedValue({ fromPath: 'note.md', toPath: 'renamed.md' });
    (window as unknown as { api: unknown }).api = {
      ...((window as unknown as { api: Record<string, unknown> }).api),
      moveNotesVault: mockMoveNotesVault,
      noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    };

    mockListNotesVault.mockResolvedValue({
      items: [{ path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' }],
    });

    render(<VaultBrowser {...baseProps} lockScope initialScope="notes" />);
    await waitFor(() => expect(screen.getByTestId('vb-row-note.md')).toBeInTheDocument());

    // Trigger double-click to start rename
    fireEvent.doubleClick(screen.getByTestId('vb-row-note.md'));

    const input = await screen.findByLabelText('Rename');
    fireEvent.change(input, { target: { value: 'renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockMoveNotesVault).toHaveBeenCalledWith('note.md', 'renamed.md'));
  });
});

// ─── M16: Explorer toolbar + tree parity ─────────────────────────────────────

// Helper: render the notes vault with one or more notes and wait for the tree to appear.
async function renderNotesVaultWithItems(items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }>, extraProps: Record<string, unknown> = {}) {
  mockListNotesVault.mockResolvedValue({ items });
  // Ensure noteBacklinks is always mocked (BacklinksPane mounts when a .md is selected)
  const apiMock = (window as unknown as { api: Record<string, unknown> }).api;
  if (!apiMock.noteBacklinks) {
    apiMock.noteBacklinks = vi.fn().mockResolvedValue({ backlinks: [] });
  }
  const onOpenFile = vi.fn();
  render(<VaultBrowser {...baseProps} lockScope initialScope="notes" onOpenFile={onOpenFile} {...extraProps} />);
  // Wait for at least the toolbar to render (it renders even with no items via empty state)
  await waitFor(() => expect(screen.getByTestId('vb-notes-toolbar')).toBeInTheDocument());
  return { onOpenFile };
}

describe('M16: sort cycle', () => {
  it('cycles manual → A-Z → Z-A → manual', async () => {
    await renderNotesVaultWithItems([]);
    const btn = screen.getByTestId('vb-btn-sort');
    // default is 'az' (↑A)
    expect(btn.textContent).toBe('↑A');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('↓Z');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('↕');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('↑A');
  });

  it('persists sort mode to localStorage', async () => {
    localStorage.removeItem('vb-sort-mode-notes');
    await renderNotesVaultWithItems([]);
    const btn = screen.getByTestId('vb-btn-sort');
    fireEvent.click(btn); // az → za
    expect(localStorage.getItem('vb-sort-mode-notes')).toBe('za');
  });
});

describe('M16: collapse all', () => {
  it('collapses all expanded directories when collapse-all clicked', async () => {
    // Clear stored expansion state so initExpand auto-expands on first render
    localStorage.removeItem('vb-expanded:notes');
    await renderNotesVaultWithItems([
      { path: 'folder', name: 'folder', isDirectory: true, modifiedAt: '' },
      { path: 'folder/note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
    ]);
    // initExpand auto-expands all dirs on first render; wait for child to appear
    await waitFor(() => expect(screen.getByTestId('vb-row-folder/note.md')).toBeInTheDocument());

    // Collapse all
    fireEvent.click(screen.getByTestId('vb-btn-collapse-all'));
    await waitFor(() => expect(screen.queryByTestId('vb-row-folder/note.md')).not.toBeInTheDocument());
  });
});

describe('M16: search filter', () => {
  it('filters the notes tree by search query', async () => {
    await renderNotesVaultWithItems([
      { path: 'alpha.md', name: 'alpha.md', isDirectory: false, modifiedAt: '' },
      { path: 'beta.md', name: 'beta.md', isDirectory: false, modifiedAt: '' },
    ]);
    await waitFor(() => expect(screen.getByTestId('vb-row-alpha.md')).toBeInTheDocument());

    const searchInput = screen.getByTestId('vb-search-input');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    await waitFor(() => expect(screen.queryByTestId('vb-row-beta.md')).not.toBeInTheDocument());
    expect(screen.getByTestId('vb-row-alpha.md')).toBeInTheDocument();
  });

  it('shows clear button when query is non-empty and clears on click', async () => {
    await renderNotesVaultWithItems([]);
    const searchInput = screen.getByTestId('vb-search-input');
    expect(screen.queryByTestId('vb-search-clear')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'foo' } });
    expect(screen.getByTestId('vb-search-clear')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('vb-search-clear'));
    expect((searchInput as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('vb-search-clear')).not.toBeInTheDocument();
  });
});

describe('M16: RECENT list', () => {
  beforeEach(() => {
    localStorage.removeItem('vb-notes-recent');
  });

  it('adds an opened note to the recent list', async () => {
    const { onOpenFile } = await renderNotesVaultWithItems([
      { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
    ]);
    await waitFor(() => expect(screen.getByTestId('vb-row-note.md')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('vb-row-note.md')); });
    expect(onOpenFile).toHaveBeenCalledWith('note.md');

    // RECENT section should appear
    await waitFor(() => expect(screen.getByTestId('vb-recent')).toBeInTheDocument());
    expect(screen.getByTestId('vb-recent-item-note.md')).toBeInTheDocument();
  });

  it('stores recent paths in localStorage', async () => {
    await renderNotesVaultWithItems([
      { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
    ]);
    await waitFor(() => expect(screen.getByTestId('vb-row-note.md')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('vb-row-note.md')); });

    const stored = JSON.parse(localStorage.getItem('vb-notes-recent') ?? '[]') as string[];
    expect(stored).toContain('note.md');
  });
});

describe('M16: auto-reveal', () => {
  beforeEach(() => {
    localStorage.removeItem('vb-auto-reveal');
  });

  it('toggle button updates aria-pressed', async () => {
    await renderNotesVaultWithItems([]);
    const btn = screen.getByTestId('vb-btn-auto-reveal');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects the matching node when activeFilePath changes and auto-reveal is on', async () => {
    mockListNotesVault.mockResolvedValue({
      items: [{ path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' }],
    });
    const apiMock = (window as unknown as { api: Record<string, unknown> }).api;
    apiMock.noteBacklinks = vi.fn().mockResolvedValue({ backlinks: [] });
    const { rerender } = render(
      <VaultBrowser {...baseProps} lockScope initialScope="notes" activeFilePath={null} />,
    );
    await waitFor(() => expect(screen.getByTestId('vb-notes-toolbar')).toBeInTheDocument());

    // Enable auto-reveal
    fireEvent.click(screen.getByTestId('vb-btn-auto-reveal'));

    // Change active file path
    rerender(<VaultBrowser {...baseProps} lockScope initialScope="notes" activeFilePath="note.md" />);

    // Note row should become selected
    await waitFor(() => {
      const row = screen.queryByTestId('vb-row-note.md');
      if (row) expect(row).toHaveAttribute('aria-selected', 'true');
    });
  });
});

