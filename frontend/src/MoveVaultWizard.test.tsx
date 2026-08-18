import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MoveVaultWizard from './MoveVaultWizard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVaultGetPaths = vi.fn();
const mockPickFolder = vi.fn();
const mockValidatePath = vi.fn();
const mockVaultGuidedFolderMove = vi.fn();
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
  mockVaultGuidedFolderMove.mockResolvedValue({ moved: true, newVaultPath: '/home/user/Dropbox/MythosVault' });
  mockVaultLocalFolderMove.mockResolvedValue({ moved: true, newVaultPath: '/home/user/Documents/MythosVault' });

  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: mockVaultGetPaths,
    pickFolder: mockPickFolder,
    validatePath: mockValidatePath,
    vaultGuidedFolderMove: mockVaultGuidedFolderMove,
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

async function advanceToCloudFolderStep(provider = 'dropbox') {
  fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));
  const radio = screen.getByTestId(`provider-option-${provider}`).querySelector('input[type="radio"]')!;
  fireEvent.click(radio);
  fireEvent.click(screen.getByTestId('mv-next-provider'));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MoveVaultWizard', () => {
  // Step 0 — local folder (default entry point, SKY-10367)
  it('opens directly to a local folder picker, not the cloud provider list', async () => {
    await renderWizard();
    expect(screen.getByRole('dialog', { name: /move vault to a different folder/i })).toBeInTheDocument();
    expect(screen.getByTestId('mv-browse')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-option-dropbox')).not.toBeInTheDocument();
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

  // Cloud path is an explicit secondary choice
  it('"Move to a cloud-synced folder instead" reveals the provider list', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));

    expect(screen.getByTestId('provider-option-dropbox')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-icloud')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-onedrive')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-google-drive')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /move vault to cloud sync/i })).toBeInTheDocument();
  });

  it('"Use a local folder instead" returns from the provider step to the local folder step', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));
    fireEvent.click(screen.getByTestId('mv-switch-to-local'));

    expect(screen.getByRole('dialog', { name: /move vault to a different folder/i })).toBeInTheDocument();
    expect(screen.getByTestId('mv-cancel')).toBeInTheDocument();
  });

  it('cloud Next is disabled until a provider is chosen', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));
    expect(screen.getByTestId('mv-next-provider')).toBeDisabled();

    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    expect(screen.getByTestId('mv-next-provider')).not.toBeDisabled();
  });

  it('advances to the cloud folder step with the provider hint after choosing a provider', async () => {
    await renderWizard();
    await advanceToCloudFolderStep('google-drive');

    expect(screen.getByTestId('mv-browse')).toBeInTheDocument();
    expect(screen.getByTestId('mv-default-hint')).toHaveTextContent('~/Google Drive');
    // Cloud folder step offers Back to the provider step, not the local Cancel button.
    expect(screen.getByTestId('mv-back-folder')).toBeInTheDocument();
    expect(screen.queryByTestId('mv-cancel')).not.toBeInTheDocument();
  });

  it('cloud folder step Next is disabled until a folder is selected', async () => {
    await renderWizard();
    await advanceToCloudFolderStep();
    expect(screen.getByTestId('mv-next-folder')).toBeDisabled();
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

  it('cloud confirm step keeps the sync checkbox gate on Proceed', async () => {
    await renderWizard();
    await advanceToCloudFolderStep();
    await pickLocalFolder('/home/user/Dropbox');
    fireEvent.click(screen.getByTestId('mv-next-folder'));

    await waitFor(() => expect(screen.getByTestId('mv-proceed-confirm')).toBeInTheDocument());
    expect(screen.getByTestId('mv-proceed-confirm')).toBeDisabled();

    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    expect(screen.getByTestId('mv-proceed-confirm')).not.toBeDisabled();
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
  it('local move calls vaultLocalFolderMove and reports success with a null provider', async () => {
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
    expect(mockVaultGuidedFolderMove).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByTestId('mv-success-message')).toBeInTheDocument());
    expect(screen.getByTestId('mv-new-path')).toHaveTextContent('/home/user/Documents/MythosVault');

    fireEvent.click(screen.getByTestId('mv-done'));
    expect(mockOnSuccess).toHaveBeenCalledWith('/home/user/Documents/MythosVault', null);
  });

  it('cloud move calls vaultGuidedFolderMove and reports success with the chosen provider', async () => {
    await renderWizard();
    await advanceToCloudFolderStep('dropbox');
    await pickLocalFolder('/home/user/Dropbox');
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    expect(mockVaultGuidedFolderMove).toHaveBeenCalledWith({
      targetPath: '/home/user/Dropbox',
      syncProvider: 'dropbox',
      sessionToken: 'tok-local',
    });

    await waitFor(() => expect(screen.getByTestId('mv-success-message')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mv-done'));
    expect(mockOnSuccess).toHaveBeenCalledWith('/home/user/Dropbox/MythosVault', 'dropbox');
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

  // Accessibility
  it('dialog aria-label matches the active flow (local by default, cloud after switching)', async () => {
    await renderWizard();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Move vault to a different folder');

    fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Move vault to cloud sync');
  });

  it('has aria-label on all provider radio inputs', async () => {
    await renderWizard();
    fireEvent.click(screen.getByTestId('mv-switch-to-cloud'));
    const radios = screen.getAllByRole('radio');
    radios.forEach((r) => expect(r).toHaveAttribute('aria-label'));
  });

  it('close button calls onClose', async () => {
    await renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
