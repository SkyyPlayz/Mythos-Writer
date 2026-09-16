import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MoveVaultWizard from './MoveVaultWizard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVaultGetPaths = vi.fn();
const mockPickFolder = vi.fn();
const mockValidatePath = vi.fn();
const mockVaultLocalFolderMove = vi.fn();
const mockOnClose = vi.fn();
const mockOnSuccess = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockVaultGetPaths.mockResolvedValue({
    storyVaultPath: '/home/user/Mythos/Story Vault',
    notesVaultPath: '/home/user/Mythos/Notes Vault',
  });
  mockPickFolder.mockResolvedValue({ vaultRoot: null, cancelled: true, registrationToken: null });
  mockValidatePath.mockResolvedValue({ exists: true, isEmpty: false, writable: true });
  mockVaultLocalFolderMove.mockResolvedValue({ moved: true, newVaultPath: '/home/user/Documents/MythosVault' });

  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: mockVaultGetPaths,
    pickFolder: mockPickFolder,
    validatePath: mockValidatePath,
    vaultLocalFolderMove: mockVaultLocalFolderMove,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function renderWizard() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MoveVaultWizard onClose={mockOnClose} onSuccess={mockOnSuccess} />,
    );
  });
  return view;
}

async function pickLocalFolder(path = '/home/user/Documents/MythosVault') {
  mockPickFolder.mockResolvedValueOnce({ vaultRoot: path, cancelled: false, registrationToken: 'tok-local' });
  await act(async () => {
    fireEvent.click(screen.getByTestId('mv-browse'));
  });
  await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe(path));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MoveVaultWizard', () => {
  // Step 0 — local folder (SKY-10367; the only destination after SKY-11804)
  it('opens directly to a local folder picker', async () => {
    await renderWizard();
    expect(screen.getByRole('dialog', { name: /move vault to a different folder/i })).toBeInTheDocument();
    expect(screen.getByTestId('mv-browse')).toBeInTheDocument();
  });

  // SKY-11804: the branded cloud destination is gone, not merely hidden.
  it('offers no cloud destination, provider list, or sync-client checkbox', async () => {
    const { container } = await renderWizard();
    expect(screen.queryByTestId('mv-switch-to-cloud')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mv-switch-to-local')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mv-next-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mv-default-hint')).not.toBeInTheDocument();
    for (const p of ['dropbox', 'icloud', 'onedrive', 'google-drive']) {
      expect(screen.queryByTestId(`provider-option-${p}`)).not.toBeInTheDocument();
    }
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/dropbox|icloud|onedrive|google drive|cloud/i);
  });

  it('exposes only the local move channel on window.api', async () => {
    await renderWizard();
    expect('vaultGuidedFolderMove' in window.api).toBe(false);
  });

  it('Next is disabled until a local folder is picked, then advances to confirm', async () => {
    await renderWizard();
    expect(screen.getByTestId('mv-next-folder')).toBeDisabled();

    await pickLocalFolder();
    expect(screen.getByTestId('mv-next-folder')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => expect(screen.getByTestId('mv-to-path')).toBeInTheDocument());
  });

  it('passes a title and a sensible default directory to the native folder dialog', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-browse'));
    await waitFor(() => expect(mockPickFolder).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String), defaultPath: '/home/user/Mythos' }),
    ));
  });

  it('Cancel button on the entry step calls onClose', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-cancel'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // Step — confirm
  it('local confirm step has no sync checkbox and Proceed is enabled immediately', async () => {
    await renderWizard();
    await pickLocalFolder();
    fireEvent.click(screen.getByTestId('mv-next-folder'));

    await waitFor(() => expect(screen.getByTestId('mv-to-path')).toBeInTheDocument());
    expect(screen.queryByTestId('mv-confirm-checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('mv-proceed-confirm')).not.toBeDisabled();
  });

  it('shows from/to paths in confirm step', async () => {
    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));

    await waitFor(() => expect(screen.getByTestId('mv-from-path')).toBeInTheDocument());
    expect(screen.getByTestId('mv-from-path')).toHaveTextContent('/home/user/Mythos/Story Vault');
    expect(screen.getByTestId('mv-to-path')).toHaveTextContent('/home/user/Documents/MythosVault');
  });

  // Step — permission test
  it('auto-runs write test on entering test step', async () => {
    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-proceed-confirm'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    expect(mockValidatePath).toHaveBeenCalledWith('/home/user/Documents/MythosVault');
  });

  it('shows error when write test fails and allows retry', async () => {
    mockValidatePath.mockResolvedValueOnce({ exists: true, isEmpty: false, writable: false });

    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-proceed-confirm'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-error')).toBeInTheDocument());
    expect(screen.getByTestId('mv-migrate')).toBeDisabled();

    mockValidatePath.mockResolvedValueOnce({ exists: true, isEmpty: false, writable: true });
    fireEvent.click(screen.getByTestId('mv-retry-test'));
    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
  });

  // Step — result
  it('local move calls vaultLocalFolderMove and reports success', async () => {
    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-proceed-confirm'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    expect(mockVaultLocalFolderMove).toHaveBeenCalledWith({
      targetPath: '/home/user/Documents/MythosVault',
      registrationToken: 'tok-local',
    });

    await waitFor(() => expect(screen.getByTestId('mv-success-message')).toBeInTheDocument());
    expect(screen.getByTestId('mv-new-path')).toHaveTextContent('/home/user/Documents/MythosVault');

    fireEvent.click(screen.getByTestId('mv-done'));
    expect(mockOnSuccess).toHaveBeenCalledWith('/home/user/Documents/MythosVault');
  });

  it('shows migration error when IPC call fails', async () => {
    mockVaultLocalFolderMove.mockResolvedValue({ error: 'Move operation failed: disk full' });

    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-proceed-confirm'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    await waitFor(() => expect(screen.getByTestId('mv-migration-error')).toBeInTheDocument());
    expect(screen.getByTestId('mv-migration-error')).toHaveTextContent('Move operation failed: disk full');
  });

  // SKY-10890: UNAUTHORIZED_PATH means the one-shot folder authorization is
  // gone, not a retryable permission error — the wizard must route the user
  // back to re-pick rather than show the raw error code as a dead end.
  it('UNAUTHORIZED_PATH sends the user back to the folder step with a recoverable message, and Next is blocked until they re-pick', async () => {
    mockVaultLocalFolderMove.mockResolvedValue({ error: 'UNAUTHORIZED_PATH' });

    await renderWizard();
    await pickLocalFolder('/home/user/Documents/MythosVault');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-proceed-confirm'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    // Bounced back to the folder step with an explanation, not a raw error code.
    await waitFor(() => expect(screen.getByTestId('mv-folder-auth-error')).toBeInTheDocument());
    expect(screen.getByTestId('mv-folder-auth-error')).not.toHaveTextContent('UNAUTHORIZED_PATH');
    expect(screen.getByRole('dialog', { name: /move vault to a different folder/i })).toBeInTheDocument();

    // The stale token is gone — proceeding without a fresh pick is blocked.
    expect(screen.getByTestId('mv-next-folder')).toBeDisabled();

    // Re-picking (even the same path) clears the error and issues a fresh token.
    await pickLocalFolder('/home/user/Documents/MythosVault');
    expect(screen.queryByTestId('mv-folder-auth-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('mv-next-folder')).not.toBeDisabled();
  });

  // Accessibility
  it('dialog is a labelled modal', async () => {
    await renderWizard();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Move vault to a different folder');
  });

  it('close button calls onClose', async () => {
    await renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
