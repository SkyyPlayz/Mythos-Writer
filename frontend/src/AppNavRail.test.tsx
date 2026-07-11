import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppNavRail from './AppNavRail';
import AccountModal from './AccountModal';

function stubApi(overrides: Partial<Window['api']> = {}) {
  (window as unknown as { api: Partial<Window['api']> }).api = overrides;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NAV_ITEMS: NavRailItem[] = [
  { id: 'story', label: 'Story', icon: '📖' },
  { id: 'notes', label: 'Notes', icon: '📝' },
];

// Beta 3 M7: Stories popover fixtures.
const STORIES = [
  { id: 's1', title: 'The Last City of Veynn', active: true },
  { id: 's2', title: 'The Aether Cycle', active: false },
];

function makeProps(overrides: Partial<Parameters<typeof AppNavRail>[0]> = {}) {
  return {
    activeSection: 'story' as AppTab,
    onSectionChange: vi.fn(),
    onOpenAccount: vi.fn(),
    onOpenSettings: vi.fn(),
    navItems: NAV_ITEMS,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
}

// ─── AppNavRail ───────────────────────────────────────────────────────────────

describe('AppNavRail', () => {
  it('renders a navigation landmark with correct label', () => {
    render(<AppNavRail {...makeProps()} />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('renders all nav items', () => {
    render(<AppNavRail {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Story' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
  });

  it('renders brand and settings buttons', () => {
    render(<AppNavRail {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Open account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
  });

  // ─── Section switch ──────────────────────────────────────────────────────────

  it('calls onSectionChange with the correct tab when a nav item is clicked', () => {
    const onSectionChange = vi.fn();
    render(<AppNavRail {...makeProps({ onSectionChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onSectionChange).toHaveBeenCalledWith('notes');
  });

  it('calls onSectionChange with "story" when the Story button is clicked', () => {
    const onSectionChange = vi.fn();
    render(<AppNavRail {...makeProps({ activeSection: 'notes', onSectionChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(onSectionChange).toHaveBeenCalledWith('story');
  });

  // ─── Active state ────────────────────────────────────────────────────────────

  it('marks the active section with aria-current="page"', () => {
    render(<AppNavRail {...makeProps({ activeSection: 'notes' })} />);
    const notesBtn = screen.getByRole('button', { name: 'Notes' });
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    expect(notesBtn).toHaveAttribute('aria-current', 'page');
    expect(storyBtn).not.toHaveAttribute('aria-current');
  });

  it('adds the active CSS class to the active section button', () => {
    render(<AppNavRail {...makeProps({ activeSection: 'story' })} />);
    expect(screen.getByRole('button', { name: 'Story' })).toHaveClass('nav-rail__item--active');
    expect(screen.getByRole('button', { name: 'Notes' })).not.toHaveClass('nav-rail__item--active');
  });

  // ─── Collapse toggle ─────────────────────────────────────────────────────────

  it('applies the collapsed CSS class when collapsed=true', () => {
    render(<AppNavRail {...makeProps({ collapsed: true })} />);
    expect(screen.getByRole('navigation')).toHaveClass('nav-rail--collapsed');
  });

  it('does not apply the collapsed CSS class when collapsed=false', () => {
    render(<AppNavRail {...makeProps({ collapsed: false })} />);
    expect(screen.getByRole('navigation')).not.toHaveClass('nav-rail--collapsed');
  });

  it('hides item labels when collapsed', () => {
    render(<AppNavRail {...makeProps({ collapsed: true })} />);
    expect(screen.queryByText('Story')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('shows item labels when not collapsed', () => {
    render(<AppNavRail {...makeProps({ collapsed: false })} />);
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  // ─── SKY-3218: navConfig showLabels / showIcons ──────────────────────────────

  it('hides item labels when showLabels=false (icons remain)', () => {
    render(<AppNavRail {...makeProps({ showLabels: false })} />);
    expect(screen.queryByText('Story')).not.toBeInTheDocument();
    expect(screen.getByText('📖')).toBeInTheDocument();
    // Buttons stay accessible via aria-label.
    expect(screen.getByRole('button', { name: 'Story' })).toBeInTheDocument();
  });

  it('hides item icons when showIcons=false (labels remain)', () => {
    render(<AppNavRail {...makeProps({ showIcons: false })} />);
    expect(screen.queryByText('📖')).not.toBeInTheDocument();
    expect(screen.getByText('Story')).toBeInTheDocument();
  });

  it('still renders icons when collapsed even if showIcons=false', () => {
    render(<AppNavRail {...makeProps({ showIcons: false, collapsed: true })} />);
    expect(screen.getByText('📖')).toBeInTheDocument();
    expect(screen.queryByText('Story')).not.toBeInTheDocument();
  });

  it('falls back to icons when both labels and icons are hidden', () => {
    render(<AppNavRail {...makeProps({ showLabels: false, showIcons: false })} />);
    expect(screen.getByText('📖')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Story' })).toBeInTheDocument();
  });

  // ─── Account modal trigger ───────────────────────────────────────────────────

  it('calls onOpenAccount when the brand glyph button is clicked', () => {
    const onOpenAccount = vi.fn();
    render(<AppNavRail {...makeProps({ onOpenAccount })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings when the settings button is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<AppNavRail {...makeProps({ onOpenSettings })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapsed when toggle button is clicked', () => {
    const onToggleCollapsed = vi.fn();
    render(<AppNavRail {...makeProps({ onToggleCollapsed })} />);
    fireEvent.click(screen.getByRole('button', { name: /collapse navigation/i }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('collapse toggle shows expand label when collapsed', () => {
    render(<AppNavRail {...makeProps({ collapsed: true })} />);
    expect(screen.getByRole('button', { name: /expand navigation/i })).toBeInTheDocument();
  });

  // ─── Keyboard navigation ─────────────────────────────────────────────────────

  it('moves focus to the next item on ArrowDown', () => {
    render(<AppNavRail {...makeProps()} />);
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    const notesBtn = screen.getByRole('button', { name: 'Notes' });
    storyBtn.focus();
    fireEvent.keyDown(storyBtn, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(notesBtn);
  });

  it('moves focus to the previous item on ArrowUp', () => {
    render(<AppNavRail {...makeProps()} />);
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    const notesBtn = screen.getByRole('button', { name: 'Notes' });
    notesBtn.focus();
    fireEvent.keyDown(notesBtn, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(storyBtn);
  });

  it('does not crash on ArrowUp from the first item', () => {
    render(<AppNavRail {...makeProps()} />);
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    storyBtn.focus();
    expect(() => {
      fireEvent.keyDown(storyBtn, { key: 'ArrowUp' });
    }).not.toThrow();
    expect(document.activeElement).toBe(storyBtn);
  });

  it('does not crash on ArrowDown from the last item', () => {
    render(<AppNavRail {...makeProps()} />);
    const notesBtn = screen.getByRole('button', { name: 'Notes' });
    notesBtn.focus();
    expect(() => {
      fireEvent.keyDown(notesBtn, { key: 'ArrowDown' });
    }).not.toThrow();
    expect(document.activeElement).toBe(notesBtn);
  });

  // ─── Beta 3 M7: prototype restyle hooks ──────────────────────────────────────

  it('tags nav items with their neon slot class (story/notes → slot 1)', () => {
    render(<AppNavRail {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Story' })).toHaveClass('nav-rail__item--slot-1');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveClass('nav-rail__item--slot-1');
  });

  it('tags the brainstorm item with slot 2', () => {
    render(
      <AppNavRail
        {...makeProps({
          navItems: [...NAV_ITEMS, { id: 'brainstorm', label: 'Brainstorm', icon: '💡' }],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Brainstorm' })).toHaveClass('nav-rail__item--slot-2');
  });

  it('exposes tooltip titles on nav items (slim-mode affordance)', () => {
    render(<AppNavRail {...makeProps({ collapsed: true })} />);
    expect(screen.getByRole('button', { name: 'Story' })).toHaveAttribute('title', 'Story');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('title', 'Notes');
  });

  it('shows the prototype slim-rail glyphs (« expanded, » slim)', () => {
    const { rerender } = render(<AppNavRail {...makeProps({ collapsed: false })} />);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveTextContent('«');
    rerender(<AppNavRail {...makeProps({ collapsed: true })} />);
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveTextContent('»');
  });

  // ─── Beta 3 M7: Stories popover ──────────────────────────────────────────────

  it('keeps legacy click behavior and renders no popover when stories are absent', () => {
    const onSectionChange = vi.fn();
    render(<AppNavRail {...makeProps({ onSectionChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(onSectionChange).toHaveBeenCalledWith('story');
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('opens the Stories popover when the active Story item is re-clicked', () => {
    const onSectionChange = vi.fn();
    render(<AppNavRail {...makeProps({ onSectionChange, stories: STORIES })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(screen.getByTestId('nav-rail-stories')).toBeInTheDocument();
    expect(screen.getByText('STORIES — THIS VAULT')).toBeInTheDocument();
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it('re-clicking the active Story item toggles the popover closed', () => {
    render(<AppNavRail {...makeProps({ stories: STORIES })} />);
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    fireEvent.click(storyBtn);
    expect(screen.getByTestId('nav-rail-stories')).toBeInTheDocument();
    fireEvent.click(storyBtn);
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('navigates without opening the popover when Story is not active', () => {
    const onSectionChange = vi.fn();
    render(
      <AppNavRail {...makeProps({ activeSection: 'notes', onSectionChange, stories: STORIES })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(onSectionChange).toHaveBeenCalledWith('story');
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('exposes aria-haspopup/aria-expanded on the Story item when stories are provided', () => {
    render(<AppNavRail {...makeProps({ stories: STORIES })} />);
    const storyBtn = screen.getByRole('button', { name: 'Story' });
    expect(storyBtn).toHaveAttribute('aria-haspopup', 'true');
    expect(storyBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(storyBtn);
    expect(storyBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists stories and calls onStorySelect with the picked id', () => {
    const onStorySelect = vi.fn();
    render(<AppNavRail {...makeProps({ stories: STORIES, onStorySelect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    fireEvent.click(screen.getByRole('button', { name: 'The Aether Cycle' }));
    expect(onStorySelect).toHaveBeenCalledWith('s2');
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('marks only the active story with the neon dot', () => {
    render(<AppNavRail {...makeProps({ stories: STORIES })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(
      screen.getByTestId('nav-rail-story-s1').querySelector('.nav-rail__story-dot'),
    ).not.toBeNull();
    expect(
      screen.getByTestId('nav-rail-story-s2').querySelector('.nav-rail__story-dot'),
    ).toBeNull();
  });

  it('calls onNewStory from the "+ New Story" row and closes the popover', () => {
    const onNewStory = vi.fn();
    render(<AppNavRail {...makeProps({ stories: STORIES, onNewStory })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Story' }));
    expect(onNewStory).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('closes the popover when the backdrop is clicked', () => {
    render(<AppNavRail {...makeProps({ stories: STORIES })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    fireEvent.click(screen.getByTestId('nav-rail-stories-backdrop'));
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  it('closes the popover when Escape is pressed inside it', () => {
    render(<AppNavRail {...makeProps({ stories: STORIES })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    fireEvent.keyDown(screen.getByTestId('nav-rail-stories'), { key: 'Escape' });
    expect(screen.queryByTestId('nav-rail-stories')).not.toBeInTheDocument();
  });

  // ─── Beta 4 M3: six-module rail ──────────────────────────────────────────────

  it('renders all six §4 modules and routes their clicks', () => {
    const onSectionChange = vi.fn();
    render(
      <AppNavRail
        {...makeProps({
          onSectionChange,
          navItems: [
            { id: 'story', label: 'Story Writer', icon: '✍' },
            { id: 'notes', label: 'Notes Editor', icon: '📝' },
            { id: 'crafter', label: 'Scene Crafter', icon: '🗂️' },
            { id: 'brainstorm', label: 'Brainstorm', icon: '💡' },
            { id: 'timeline', label: 'Timeline', icon: '📅' },
            { id: 'graph', label: 'Vault Graph', icon: '🕸️' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scene Crafter' }));
    expect(onSectionChange).toHaveBeenCalledWith('crafter');
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(onSectionChange).toHaveBeenCalledWith('timeline');
    fireEvent.click(screen.getByRole('button', { name: 'Vault Graph' }));
    expect(onSectionChange).toHaveBeenCalledWith('graph');
  });

  it('tags crafter/timeline with slot 2 and graph with slot 3 (prototype modDefs)', () => {
    render(
      <AppNavRail
        {...makeProps({
          navItems: [
            { id: 'crafter', label: 'Scene Crafter', icon: '🗂️' },
            { id: 'timeline', label: 'Timeline', icon: '📅' },
            { id: 'graph', label: 'Vault Graph', icon: '🕸️' },
          ],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Scene Crafter' })).toHaveClass('nav-rail__item--slot-2');
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveClass('nav-rail__item--slot-2');
    expect(screen.getByRole('button', { name: 'Vault Graph' })).toHaveClass('nav-rail__item--slot-3');
  });

  it('shows the story subtitle line (genre · voice · POV) in the switcher', () => {
    render(
      <AppNavRail
        {...makeProps({
          stories: [{ id: 's1', title: 'Veynn', active: true, subtitle: 'Epic Fantasy · Dark & Gritty · Third Limited' }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(screen.getByText('Epic Fantasy · Dark & Gritty · Third Limited')).toBeInTheDocument();
  });
});

// ─── Beta 4 M3: rail edit popover ─────────────────────────────────────────────

describe('AppNavRail edit popover', () => {
  const EDIT_ITEMS: NavRailItemConfig[] = [
    { id: 'story', enabled: true, label: 'Story Writer', icon: '✍', order: 0 },
    { id: 'notes', enabled: true, label: 'Notes Editor', icon: '📝', order: 1 },
    { id: 'crafter', enabled: false, label: 'Scene Crafter', icon: '🗂️', order: 2 },
  ];

  function makeEditProps(onEditableItemsChange = vi.fn()) {
    return {
      ...makeProps(),
      editableItems: EDIT_ITEMS.map((i) => ({ ...i })),
      onEditableItemsChange,
    };
  }

  it('renders no pencil button when editableItems are absent', () => {
    render(<AppNavRail {...makeProps()} />);
    expect(screen.queryByTestId('nav-rail-edit-btn')).not.toBeInTheDocument();
  });

  it('opens the CUSTOMIZE NAVIGATION popover from the pencil button', () => {
    render(<AppNavRail {...makeEditProps()} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    expect(screen.getByTestId('nav-rail-edit')).toBeInTheDocument();
    expect(screen.getByText('CUSTOMIZE NAVIGATION')).toBeInTheDocument();
    // Hidden modules stay listed so they can be re-shown.
    expect(screen.getByTestId('nav-rail-edit-row-crafter')).toBeInTheDocument();
  });

  it('toggles a module hidden via the eye button', () => {
    const onChange = vi.fn();
    render(<AppNavRail {...makeEditProps(onChange)} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Notes Editor' }));
    const items = onChange.mock.calls[0][0] as NavRailItemConfig[];
    expect(items.find((i) => i.id === 'notes')?.enabled).toBe(false);
    // Other rows untouched.
    expect(items.find((i) => i.id === 'story')?.enabled).toBe(true);
  });

  it('re-shows a hidden module via the eye button', () => {
    const onChange = vi.fn();
    render(<AppNavRail {...makeEditProps(onChange)} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    fireEvent.click(screen.getByRole('button', { name: 'Show Scene Crafter' }));
    const items = onChange.mock.calls[0][0] as NavRailItemConfig[];
    expect(items.find((i) => i.id === 'crafter')?.enabled).toBe(true);
  });

  it('reorders with the move-down button and renormalizes order values', () => {
    const onChange = vi.fn();
    render(<AppNavRail {...makeEditProps(onChange)} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    fireEvent.click(screen.getByRole('button', { name: 'Move Story Writer down' }));
    const items = onChange.mock.calls[0][0] as NavRailItemConfig[];
    expect(items.map((i) => i.id)).toEqual(['notes', 'story', 'crafter']);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('disables move-up on the first row and move-down on the last row', () => {
    render(<AppNavRail {...makeEditProps()} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    expect(screen.getByRole('button', { name: 'Move Story Writer up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Scene Crafter down' })).toBeDisabled();
  });

  it('drag-reorders a row onto another row', () => {
    const onChange = vi.fn();
    render(<AppNavRail {...makeEditProps(onChange)} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    const source = screen.getByTestId('nav-rail-edit-row-crafter');
    const target = screen.getByTestId('nav-rail-edit-row-story');
    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    const items = onChange.mock.calls[0][0] as NavRailItemConfig[];
    expect(items.map((i) => i.id)).toEqual(['crafter', 'story', 'notes']);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('closes on backdrop click and on Escape', () => {
    render(<AppNavRail {...makeEditProps()} />);
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    fireEvent.click(screen.getByTestId('nav-rail-edit-backdrop'));
    expect(screen.queryByTestId('nav-rail-edit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('nav-rail-edit-btn'));
    fireEvent.keyDown(screen.getByTestId('nav-rail-edit'), { key: 'Escape' });
    expect(screen.queryByTestId('nav-rail-edit')).not.toBeInTheDocument();
  });

  it('closes on Escape while focus is still on the pencil button', () => {
    render(<AppNavRail {...makeEditProps()} />);
    const pencil = screen.getByTestId('nav-rail-edit-btn');
    fireEvent.click(pencil);
    expect(screen.getByTestId('nav-rail-edit')).toBeInTheDocument();
    // Focus never entered the popover — Escape from the trigger must work.
    fireEvent.keyDown(pencil, { key: 'Escape' });
    expect(screen.queryByTestId('nav-rail-edit')).not.toBeInTheDocument();
  });
});

// ─── AccountModal ─────────────────────────────────────────────────────────────

describe('AccountModal', () => {
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('renders nothing when open=false', () => {
    render(<AccountModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when open=true', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows "Mythos Account" title', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getByText('Mythos Account')).toBeInTheDocument();
  });

  // ─── App version (AC-1) ────────────────────────────────────────────────────

  it('shows the app version from getAppInfo', async () => {
    stubApi({
      getAppInfo: vi.fn().mockResolvedValue({ platform: 'linux', electronVersion: '30.0.0', appVersion: '0.4.2' }),
    });
    render(<AccountModal open onClose={vi.fn()} />);
    expect(await screen.findByText('Version 0.4.2')).toBeInTheDocument();
  });

  it('shows a fallback when getAppInfo is unavailable', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getByText('Version unavailable')).toBeInTheDocument();
  });

  // ─── Vault names (AC-2) ─────────────────────────────────────────────────────

  it('shows Story Vault and Notes Vault paths from vaultGetPaths', async () => {
    stubApi({
      vaultGetPaths: vi.fn().mockResolvedValue({
        storyVaultPath: '/home/user/Mythos/My Novel/Story Vault',
        notesVaultPath: '/home/user/Mythos/My Novel/Notes Vault',
        homeDir: '/home/user',
        pathSeparator: '/',
      }),
    });
    render(<AccountModal open onClose={vi.fn()} />);
    expect(await screen.findByTitle('/home/user/Mythos/My Novel/Story Vault')).toBeInTheDocument();
    expect(screen.getByTitle('/home/user/Mythos/My Novel/Notes Vault')).toBeInTheDocument();
    expect(screen.getByText('Story Vault')).toBeInTheDocument();
    expect(screen.getByText('Notes Vault')).toBeInTheDocument();
  });

  it('shows "Not configured" when no vault paths are available', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
  });

  // ─── Open Vault Folder (AC-3) ───────────────────────────────────────────────

  it('disables "Open Vault Folder" when no vault is configured', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open Vault Folder' })).toBeDisabled();
  });

  it('calls revealVaultFolder when "Open Vault Folder" is clicked', async () => {
    const revealVaultFolder = vi.fn().mockResolvedValue({ opened: true });
    stubApi({
      vaultGetPaths: vi.fn().mockResolvedValue({ storyVaultPath: '/vault/story', notesVaultPath: '/vault/notes' }),
      revealVaultFolder,
    });
    render(<AccountModal open onClose={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Open Vault Folder' });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(revealVaultFolder).toHaveBeenCalledTimes(1));
  });

  it('shows an inline error when revealVaultFolder fails', async () => {
    stubApi({
      vaultGetPaths: vi.fn().mockResolvedValue({ storyVaultPath: '/vault/story', notesVaultPath: '/vault/notes' }),
      revealVaultFolder: vi.fn().mockResolvedValue({ opened: false }),
    });
    render(<AccountModal open onClose={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Open Vault Folder' });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the vault folder.');
  });

  // ─── Check for Updates (AC-4) ───────────────────────────────────────────────

  it('calls appCheckForUpdate and reports when already up to date', async () => {
    const appCheckForUpdate = vi.fn().mockResolvedValue({ available: false, version: null, releaseNotes: null });
    stubApi({ appCheckForUpdate });
    render(<AccountModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(await screen.findByText(/no update available/i)).toBeInTheDocument();
    expect(appCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows the available version when an update is available', async () => {
    stubApi({
      appCheckForUpdate: vi.fn().mockResolvedValue({ available: true, version: '0.5.0', releaseNotes: null }),
    });
    render(<AccountModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(await screen.findByText('Update available: v0.5.0')).toBeInTheDocument();
  });

  it('reports an error when appCheckForUpdate rejects', async () => {
    stubApi({ appCheckForUpdate: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<AccountModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(await screen.findByText('Could not check for updates.')).toBeInTheDocument();
  });

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn();
    render(<AccountModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<AccountModal open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<AccountModal open onClose={onClose} />);
    const overlay = document.querySelector('.ln-dialog-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the X close button in the header', () => {
    render(<AccountModal open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
  });
});
