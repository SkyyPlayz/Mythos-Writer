// SKY-11154 — Notes/Story columns + dot-linking. Covers: the dot-pairing
// call sequence (including the report-gate-then-confirm path with
// totalStems>0 and the immediate-switch path with totalStems===0), the
// manual-switch gate, and hidden-vault filtering.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VaultLinkingColumns from './VaultLinkingColumns';

const NOTES_A = { id: 'n1', displayName: 'Notes A', dirName: 'Notes A', createdAt: '', origin: 'created' as const };
const NOTES_B = { id: 'n2', displayName: 'Notes B', dirName: 'Notes B', createdAt: '', origin: 'created' as const };
const STORY_A = { id: 's1', displayName: 'Story A', dirName: 'Story A', createdAt: '', pairedNotesVaultId: null as string | null };
const STORY_B = { id: 's2', displayName: 'Story B', dirName: 'Story B', createdAt: '', pairedNotesVaultId: 'n1' as string | null };

const mockNotesList = vi.fn();
const mockStoryList = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockListHidden = vi.fn();
const mockPair = vi.fn();
const mockPreview = vi.fn();
const mockSetActiveNotes = vi.fn();
const mockSetActiveStory = vi.fn();
const mockUnhide = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockNotesList.mockResolvedValue({ vaults: [NOTES_A, NOTES_B], activeId: 'n1' });
  mockStoryList.mockResolvedValue({ vaults: [STORY_A, STORY_B], activeId: 's1' });
  mockVaultGetPaths.mockResolvedValue({
    storyVaultPath: '/mythos/Story A', notesVaultPath: '/mythos/Notes A', pathSeparator: '/', mythosRoot: '/mythos',
  });
  mockListHidden.mockResolvedValue({ hiddenVaultRoots: [] });
  mockPair.mockResolvedValue({ entry: { ...STORY_A, pairedNotesVaultId: 'n1' } });
  mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: [], totalStems: 0 });
  mockSetActiveNotes.mockResolvedValue({ entry: NOTES_B });
  mockSetActiveStory.mockResolvedValue({ entry: STORY_A });
  mockUnhide.mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'api', {
    value: {
      notesVaultRegistryList: mockNotesList,
      storyVaultRegistryList: mockStoryList,
      vaultGetPaths: mockVaultGetPaths,
      vaultSurfaceListHidden: mockListHidden,
      storyVaultRegistryPair: mockPair,
      notesVaultRegistrySetActivePreview: mockPreview,
      notesVaultRegistrySetActive: mockSetActiveNotes,
      storyVaultRegistrySetActive: mockSetActiveStory,
      vaultSurfaceUnhide: mockUnhide,
      onNotesVaultRegistryChanged: () => () => {},
      onStoryVaultRegistryChanged: () => () => {},
    },
    writable: true,
    configurable: true,
  });
});

async function setup() {
  await act(async () => {
    render(<VaultLinkingColumns />);
  });
  await waitFor(() => expect(screen.getByTestId('notes-vault-card-n1')).toBeInTheDocument());
}

describe('VaultLinkingColumns — layout + hard exclusions', () => {
  it('renders both "+ Add" buttons with the exact reused testids', async () => {
    await setup();
    expect(screen.getByTestId('add-notes-vault-btn')).toBeInTheDocument();
    expect(screen.getByTestId('add-story-vault-btn')).toBeInTheDocument();
  });

  it('renders a pair-dot per notes/story vault (AC-VS-07)', async () => {
    await setup();
    expect(screen.getByTestId('pair-dot-notes-n1')).toBeInTheDocument();
    expect(screen.getByTestId('pair-dot-story-s1')).toBeInTheDocument();
  });

  it('returns null (hides the whole surface) for a legacy vault with no registry', async () => {
    mockNotesList.mockResolvedValue({ vaults: null, activeId: null });
    const { container } = render(<VaultLinkingColumns />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.firstChild).toBeNull();
  });
});

describe('VaultLinkingColumns — dot-pairing (§2/§4)', () => {
  it('clicking a notes dot then a story dot pairs them directly when the story vault is NOT active', async () => {
    await setup();
    // s2 is not the active story vault (active is s1) — pairing must not gate.
    fireEvent.click(screen.getByTestId('pair-dot-notes-n2'));
    fireEvent.click(screen.getByTestId('pair-dot-story-s2'));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith('s2', 'n2'));
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('order does not matter — an UNPAIRED story dot then a notes dot pairs the same way (s1 starts unpaired)', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('pair-dot-story-s1'));
    fireEvent.click(screen.getByTestId('pair-dot-notes-n2'));
    // s1 IS the active story vault and n2 is not the active notes vault, so
    // this path runs the preview report (totalStems===0 by default — commits
    // immediately, no dialog).
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('n2'));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith('s1', 'n2'));
  });

  it('clicking an already-paired story dot alone unpairs it (no notes dot involved)', async () => {
    await setup();
    // s2 is pre-paired to n1.
    fireEvent.click(screen.getByTestId('pair-dot-story-s2'));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith('s2', null));
  });

  it('pairing the ACTIVE story vault to a DIFFERENT notes vault gates behind the link report when totalStems > 0', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 2, unresolvedStems: ['missing'], totalStems: 3 });
    await setup();
    // s1 is active, pairing to n2 (currently active notes vault is n1).
    fireEvent.click(screen.getByTestId('pair-dot-story-s1'));
    fireEvent.click(screen.getByTestId('pair-dot-notes-n2'));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('n2'));
    // Gated — neither the pair nor the switch has committed yet.
    expect(mockPair).not.toHaveBeenCalled();
    expect(mockSetActiveNotes).not.toHaveBeenCalled();
    expect(screen.getByTestId('vault-linking-switch-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('vault-linking-switch-confirm'));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith('s1', 'n2'));
    expect(mockSetActiveNotes).toHaveBeenCalledWith('n2');
  });

  it('pairing the active story vault to a different notes vault commits immediately when totalStems === 0', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: [], totalStems: 0 });
    await setup();
    fireEvent.click(screen.getByTestId('pair-dot-story-s1'));
    fireEvent.click(screen.getByTestId('pair-dot-notes-n2'));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith('s1', 'n2'));
    expect(mockSetActiveNotes).toHaveBeenCalledWith('n2');
    expect(screen.queryByTestId('vault-linking-switch-dialog')).not.toBeInTheDocument();
  });

  it('cancelling the gate dialog leaves the pairing untouched', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: ['x'], totalStems: 1 });
    await setup();
    fireEvent.click(screen.getByTestId('pair-dot-story-s1'));
    fireEvent.click(screen.getByTestId('pair-dot-notes-n2'));
    await waitFor(() => expect(screen.getByTestId('vault-linking-switch-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockPair).not.toHaveBeenCalled();
    expect(mockSetActiveNotes).not.toHaveBeenCalled();
  });
});

describe('VaultLinkingColumns — manual notes-vault switch (§4)', () => {
  it('clicking a non-active notes card gates behind the link report', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 1, unresolvedStems: [], totalStems: 1 });
    await setup();
    fireEvent.click(screen.getByTestId('notes-vault-card-n2'));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('n2'));
    expect(screen.getByTestId('vault-linking-switch-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('vault-linking-switch-confirm'));
    await waitFor(() => expect(mockSetActiveNotes).toHaveBeenCalledWith('n2'));
  });

  it('clicking the already-active notes card is a no-op', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('notes-vault-card-n1'));
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

describe('VaultLinkingColumns — Show hidden (§4a)', () => {
  it('a "Show hidden" button is present in each column', async () => {
    await setup();
    expect(screen.getByTestId('notes-show-hidden-btn')).toHaveTextContent(/show hidden/i);
    expect(screen.getByTestId('story-show-hidden-btn')).toHaveTextContent(/show hidden/i);
  });

  it('hides a notes vault whose path is in the hidden list, and Unhide calls vaultSurfaceUnhide', async () => {
    mockListHidden.mockResolvedValue({ hiddenVaultRoots: ['/mythos/Notes B'] });
    await act(async () => { render(<VaultLinkingColumns />); });
    await waitFor(() => expect(screen.getByTestId('notes-vault-card-n1')).toBeInTheDocument());
    expect(screen.queryByTestId('notes-vault-card-n2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notes-show-hidden-btn'));
    expect(await screen.findByTestId('notes-unhide-n2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notes-unhide-n2'));
    await waitFor(() => expect(mockUnhide).toHaveBeenCalledWith('/mythos/Notes B'));
  });

  it('shows a "target hidden" reveal affordance on a story card paired to a hidden notes vault', async () => {
    mockListHidden.mockResolvedValue({ hiddenVaultRoots: ['/mythos/Notes A'] });
    await act(async () => { render(<VaultLinkingColumns />); });
    expect(await screen.findByTestId('story-target-hidden-s2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('story-target-hidden-s2'));
    await waitFor(() => expect(mockUnhide).toHaveBeenCalledWith('/mythos/Notes A'));
  });
});
