import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { buildTree, flattenTree } from './treeUtils';
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
const mockStartVaultWatch = vi.fn();
const mockOnVaultFileChanged = vi.fn();
const mockWriteVault = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockListVault.mockResolvedValue({ items: [] });
  mockStartVaultWatch.mockResolvedValue({ watching: true });
  mockOnVaultFileChanged.mockReturnValue(vi.fn());
  mockWriteVault.mockResolvedValue({ path: 'x.md', bytes: 0 });

  (window as unknown as { api: unknown }).api = {
    listVault: mockListVault,
    startVaultWatch: mockStartVaultWatch,
    onVaultFileChanged: mockOnVaultFileChanged,
    writeVault: mockWriteVault,
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
  it('renders scope toggle buttons', () => {
    render(<VaultBrowser {...baseProps} />);
    expect(screen.getByTestId('vb-scope-story')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-notes')).toBeInTheDocument();
    expect(screen.getByTestId('vb-scope-both')).toBeInTheDocument();
  });

  it('"Both" scope is active by default', () => {
    render(<VaultBrowser {...baseProps} />);
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

  it('shows empty state when no stories', () => {
    render(<VaultBrowser {...baseProps} />);
    expect(screen.getByTestId('vb-story-empty')).toBeInTheDocument();
  });

  it('calls onCreateStory when New Story button is clicked', () => {
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByLabelText('New Story'));
    expect(baseProps.onCreateStory).toHaveBeenCalledOnce();
  });

  it('renders story titles when stories provided', () => {
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
    expect(screen.getByText('My Great Novel')).toBeInTheDocument();
  });

  it('filters out Manuscript items from notes vault', async () => {
    mockListVault.mockResolvedValue({
      items: [
        { path: 'Manuscript', name: 'Manuscript', isDirectory: true, modifiedAt: '' },
        { path: 'Manuscript/ch1', name: 'ch1', isDirectory: true, modifiedAt: '' },
        { path: 'note.md', name: 'note.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    render(<VaultBrowser {...baseProps} />);
    fireEvent.click(screen.getByTestId('vb-scope-notes'));
    await waitFor(() => {
      expect(screen.queryByText('Manuscript')).not.toBeInTheDocument();
    });
  });

  it('calls listVault on mount', async () => {
    render(<VaultBrowser {...baseProps} />);
    await waitFor(() => expect(mockListVault).toHaveBeenCalled());
  });

  it('renders notes vault when notes items are loaded', async () => {
    mockListVault.mockResolvedValue({
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

// ─── StoryVaultEmptyState ───

describe('StoryVaultEmptyState', () => {
  it('renders when stories count is 0', () => {
    render(<VaultBrowser {...baseProps} stories={[]} />);
    expect(screen.getByTestId('vb-story-empty')).toBeInTheDocument();
    expect(screen.getByText('Begin your first story')).toBeInTheDocument();
    expect(screen.getByTestId('vb-story-empty-cta')).toBeInTheDocument();
  });

  it('CTA click calls onCreate', () => {
    const onCreateStory = vi.fn();
    render(<VaultBrowser {...baseProps} stories={[]} onCreateStory={onCreateStory} />);
    fireEvent.click(screen.getByTestId('vb-story-empty-cta'));
    expect(onCreateStory).toHaveBeenCalledOnce();
  });

  it('does not render when stories count > 0', () => {
    const stories: Story[] = [
      {
        id: 's1',
        title: 'My Novel',
        path: 'stories/s1',
        chapters: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    render(<VaultBrowser {...baseProps} stories={stories} />);
    expect(screen.queryByTestId('vb-story-empty')).not.toBeInTheDocument();
  });
});
