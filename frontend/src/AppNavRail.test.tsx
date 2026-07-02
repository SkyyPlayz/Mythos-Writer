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
