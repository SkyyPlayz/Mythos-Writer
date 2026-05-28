/**
 * MYT-804 — VaultBrowser keyboard navigation (WCAG 2.1.1)
 * Tests role="tree" structure, roving tabindex, and arrow/enter/space key handling.
 */
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import LeftRail from './LeftRail';

// ─── fixtures ────────────────────────────────────────────────────────────────

const VAULT_ITEMS = [
  { path: 'notes', name: 'notes', isDirectory: true, modifiedAt: '' },
  { path: 'notes/ideas.md', name: 'ideas.md', isDirectory: false, modifiedAt: '' },
  { path: 'notes/research.md', name: 'research.md', isDirectory: false, modifiedAt: '' },
  { path: 'archive', name: 'archive', isDirectory: true, modifiedAt: '' },
  { path: 'readme.md', name: 'readme.md', isDirectory: false, modifiedAt: '' },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function stubApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    listVault: vi.fn().mockResolvedValue({ items: VAULT_ITEMS }),
    startVaultWatch: vi.fn().mockResolvedValue({}),
    onVaultFileChanged: vi.fn().mockReturnValue(() => {}),
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    streamStart: vi.fn().mockResolvedValue({ streamId: 'stub' }),
    streamCancel: vi.fn().mockResolvedValue({ cancelled: true }),
    streamAck: vi.fn(),
    onStreamToken: vi.fn().mockReturnValue(() => {}),
    onStreamEnd: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    onSttResult: vi.fn().mockReturnValue(() => {}),
    onVaultNotesUpdated: vi.fn().mockReturnValue(() => {}),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    ...overrides,
  };
}

const defaultProps = {
  activeTab: 'vault' as const,
  onTabChange: vi.fn(),
  stories: [],
  selectedSceneId: null,
  selectedEntityId: null,
  onSelectScene: vi.fn(),
  onSelectEntity: vi.fn(),
  onCreateStory: vi.fn(),
  onCreateChapter: vi.fn(),
  onCreateScene: vi.fn(),
  onReorderScenes: vi.fn(),
};

async function renderVaultTree(overrides: Record<string, unknown> = {}) {
  stubApi(overrides);
  const result = render(<LeftRail {...defaultProps} />);
  // Wait for listVault to resolve and tree to render
  await waitFor(() => expect(result.container.querySelector('[role="tree"]')).not.toBeNull());
  return result;
}

// ─── ARIA structure ───────────────────────────────────────────────────────────

describe('VaultBrowser — ARIA tree structure', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('vault-tree container has role="tree" and aria-label', async () => {
    const { container } = await renderVaultTree();
    const tree = container.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree?.getAttribute('aria-label')).toBe('Vault files');
  });

  it('directory rows have role="treeitem" and aria-expanded', async () => {
    const { container } = await renderVaultTree();
    // notes and archive are auto-expanded at root level
    const treeitems = container.querySelectorAll('[role="treeitem"]');
    expect(treeitems.length).toBeGreaterThan(0);

    const dirs = Array.from(treeitems).filter(el => el.hasAttribute('aria-expanded'));
    expect(dirs.length).toBeGreaterThanOrEqual(2); // notes + archive
  });

  it('file rows have role="treeitem" without aria-expanded', async () => {
    const { container } = await renderVaultTree();
    const treeitems = Array.from(container.querySelectorAll('[role="treeitem"]'));
    const files = treeitems.filter(el => !el.hasAttribute('aria-expanded'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('expanded directory children are wrapped in role="group"', async () => {
    const { container } = await renderVaultTree();
    // notes is auto-expanded so its children are in a group
    const groups = container.querySelectorAll('[role="group"]');
    expect(groups.length).toBeGreaterThan(0);
    // notes group should contain ideas.md and research.md treeitems
    const notesGroup = Array.from(groups).find(g =>
      g.querySelectorAll('[role="treeitem"]').length === 2,
    );
    expect(notesGroup).not.toBeNull();
  });

  it('all treeitems have aria-level', async () => {
    const { container } = await renderVaultTree();
    const treeitems = container.querySelectorAll('[role="treeitem"]');
    for (const item of treeitems) {
      expect(item.getAttribute('aria-level')).not.toBeNull();
    }
  });

  it('root treeitems have aria-level="1", children have aria-level="2"', async () => {
    const { container } = await renderVaultTree();
    const treeitems = Array.from(container.querySelectorAll('[role="treeitem"]'));
    const rootItems = treeitems.filter(el => el.getAttribute('aria-level') === '1');
    const childItems = treeitems.filter(el => el.getAttribute('aria-level') === '2');
    // archive, notes, readme.md are root items
    expect(rootItems.length).toBe(3);
    // ideas.md, research.md are children of notes
    expect(childItems.length).toBe(2);
  });
});

// ─── Roving tabindex ──────────────────────────────────────────────────────────

describe('VaultBrowser — roving tabindex', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('first visible node has tabIndex=0, all others have tabIndex=-1', async () => {
    const { container } = await renderVaultTree();
    const treeitems = Array.from(container.querySelectorAll('[role="treeitem"]'));
    const focusedItems = treeitems.filter(el => el.getAttribute('tabindex') === '0');
    const blurredItems = treeitems.filter(el => el.getAttribute('tabindex') === '-1');
    expect(focusedItems).toHaveLength(1);
    expect(blurredItems).toHaveLength(treeitems.length - 1);
  });

  it('tabIndex=0 is on the first visible node (archive, sorted first)', async () => {
    const { container } = await renderVaultTree();
    const focused = container.querySelector('[role="treeitem"][tabindex="0"]');
    // archive is sorted before notes alphabetically
    expect(focused?.getAttribute('title')).toBe('archive');
  });
});

// ─── Arrow key navigation ─────────────────────────────────────────────────────

describe('VaultBrowser — keyboard navigation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ArrowDown moves focus to the next visible node', async () => {
    const { container } = await renderVaultTree();
    const firstItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(firstItem?.getAttribute('title')).toBe('archive');

    await act(async () => {
      fireEvent.keyDown(firstItem, { key: 'ArrowDown' });
    });

    const newFocused = container.querySelector('[role="treeitem"][tabindex="0"]');
    expect(newFocused?.getAttribute('title')).toBe('notes');
  });

  it('ArrowUp moves focus to the previous visible node', async () => {
    const { container } = await renderVaultTree();
    // Move to notes first
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });

    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('title')).toBe('notes');

    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowUp' }); });
    const backToArchive = container.querySelector('[role="treeitem"][tabindex="0"]');
    expect(backToArchive?.getAttribute('title')).toBe('archive');
  });

  it('ArrowDown does not move past the last visible node', async () => {
    const { container } = await renderVaultTree();
    // readme.md is the last visible node; navigate to it
    // visible order: archive, notes, notes/ideas.md, notes/research.md, readme.md
    const treeitems = Array.from(container.querySelectorAll('[role="treeitem"]'));
    // last item is readme.md
    const lastItem = treeitems[treeitems.length - 1] as HTMLElement;
    // We need to get focus there; click triggers onFocus → setFocusedPath
    await act(async () => { fireEvent.focus(lastItem); });

    await act(async () => { fireEvent.keyDown(lastItem, { key: 'ArrowDown' }); });
    const focused = container.querySelector('[role="treeitem"][tabindex="0"]');
    expect(focused?.getAttribute('title')).toBe('readme.md');
  });

  it('ArrowRight expands a collapsed directory', async () => {
    const { container } = await renderVaultTree();
    // Move focus to notes (auto-expanded)
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('title')).toBe('notes');
    expect(notesItem?.getAttribute('aria-expanded')).toBe('true');

    // Collapse notes with ArrowLeft
    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowLeft' }); });
    await waitFor(() => {
      const n = container.querySelector('[title="notes"][role="treeitem"]');
      expect(n?.getAttribute('aria-expanded')).toBe('false');
    });

    // ArrowRight should expand it again
    const notesCollapsed = container.querySelector('[title="notes"][role="treeitem"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(notesCollapsed, { key: 'ArrowRight' }); });
    await waitFor(() => {
      const n = container.querySelector('[title="notes"][role="treeitem"]');
      expect(n?.getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('ArrowRight on expanded directory moves focus to first child', async () => {
    const { container } = await renderVaultTree();
    // notes is auto-expanded; move focus to it
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('title')).toBe('notes');
    expect(notesItem?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowRight' }); });
    // First child of notes alphabetically is ideas.md
    const focused = container.querySelector('[role="treeitem"][tabindex="0"]');
    expect(focused?.getAttribute('title')).toBe('notes/ideas.md');
  });

  it('ArrowLeft on collapsed directory moves focus to parent', async () => {
    const { container } = await renderVaultTree();
    // Navigate to notes/ideas.md and try ArrowLeft to reach notes
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); }); // → notes
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowRight' }); }); // → ideas.md
    const ideasItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(ideasItem?.getAttribute('title')).toBe('notes/ideas.md');

    await act(async () => { fireEvent.keyDown(ideasItem, { key: 'ArrowLeft' }); });
    const focused = container.querySelector('[role="treeitem"][tabindex="0"]');
    expect(focused?.getAttribute('title')).toBe('notes');
  });

  it('ArrowLeft on expanded directory collapses it', async () => {
    const { container } = await renderVaultTree();
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowLeft' }); });
    await waitFor(() => {
      const n = container.querySelector('[title="notes"][role="treeitem"]');
      expect(n?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('Enter on directory toggles expansion', async () => {
    const { container } = await renderVaultTree();
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => { fireEvent.keyDown(notesItem, { key: 'Enter' }); });
    await waitFor(() => {
      const n = container.querySelector('[title="notes"][role="treeitem"]');
      expect(n?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('Space on directory toggles expansion', async () => {
    const { container } = await renderVaultTree();
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); });
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(notesItem?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => { fireEvent.keyDown(notesItem, { key: ' ' }); });
    await waitFor(() => {
      const n = container.querySelector('[title="notes"][role="treeitem"]');
      expect(n?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('Enter on .md file calls onOpenPath', async () => {
    const onOpenVaultPath = vi.fn();
    stubApi();
    const { container } = render(<LeftRail {...defaultProps} onOpenVaultPath={onOpenVaultPath} />);
    await waitFor(() => expect(container.querySelector('[role="tree"]')).not.toBeNull());

    // Navigate to ideas.md
    const archiveItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(archiveItem, { key: 'ArrowDown' }); }); // notes
    const notesItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    await act(async () => { fireEvent.keyDown(notesItem, { key: 'ArrowRight' }); }); // ideas.md
    const ideasItem = container.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement;
    expect(ideasItem?.getAttribute('title')).toBe('notes/ideas.md');

    await act(async () => { fireEvent.keyDown(ideasItem, { key: 'Enter' }); });
    expect(onOpenVaultPath).toHaveBeenCalledWith('notes/ideas.md');
  });
});
