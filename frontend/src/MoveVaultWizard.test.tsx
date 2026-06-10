import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MoveVaultWizard from './MoveVaultWizard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVaultGetPaths = vi.fn();
const mockPickFolder = vi.fn();
const mockValidatePath = vi.fn();
const mockVaultGuidedFolderMove = vi.fn();
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

  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: mockVaultGetPaths,
    pickFolder: mockPickFolder,
    validatePath: mockValidatePath,
    vaultGuidedFolderMove: mockVaultGuidedFolderMove,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderWizard() {
  return render(
    <MoveVaultWizard onClose={mockOnClose} onSuccess={mockOnSuccess} />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MoveVaultWizard', () => {
  // Step 0 — provider
  it('renders provider step with all four options', async () => {
    renderWizard();
    expect(screen.getByRole('dialog', { name: /move vault to cloud sync/i })).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-dropbox')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-icloud')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-onedrive')).toBeInTheDocument();
    expect(screen.getByTestId('provider-option-google-drive')).toBeInTheDocument();
  });

  it('Next button is disabled until a provider is chosen', () => {
    renderWizard();
    expect(screen.getByTestId('mv-next-provider')).toBeDisabled();

    const dropboxLabel = screen.getByTestId('provider-option-dropbox');
    const radio = dropboxLabel.querySelector('input[type="radio"]')!;
    fireEvent.click(radio);

    expect(screen.getByTestId('mv-next-provider')).not.toBeDisabled();
  });

  it('Stay local button calls onClose', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('mv-skip'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // Step 0 → 1 — folder
  it('advances to folder step after selecting provider', () => {
    renderWizard();

    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    expect(screen.getByTestId('mv-browse')).toBeInTheDocument();
    expect(screen.getByTestId('mv-default-hint')).toHaveTextContent('~/Dropbox');
  });

  it('shows provider-specific default path hint', () => {
    renderWizard();

    const radio = screen.getByTestId('provider-option-google-drive').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    expect(screen.getByTestId('mv-default-hint')).toHaveTextContent('~/Google Drive');
  });

  it('opens folder picker and updates display when folder is chosen', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('mv-browse'));
    });

    await waitFor(() => {
      expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe(
        '/home/user/Dropbox',
      );
    });
  });

  it('Next in folder step is disabled until folder is selected', () => {
    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    expect(screen.getByTestId('mv-next-folder')).toBeDisabled();
  });

  // Step 2 — confirm
  it('shows from/to paths in confirm step', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));

    fireEvent.click(screen.getByTestId('mv-next-folder'));

    await waitFor(() => expect(screen.getByTestId('mv-from-path')).toBeInTheDocument());
    expect(screen.getByTestId('mv-from-path')).toHaveTextContent('/home/user/Mythos/Story Vault');
    expect(screen.getByTestId('mv-to-path')).toHaveTextContent('/home/user/Dropbox');
  });

  it('Proceed button is disabled until sync checkbox is ticked', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => expect(screen.getByTestId('mv-proceed-confirm')).toBeInTheDocument());

    expect(screen.getByTestId('mv-proceed-confirm')).toBeDisabled();

    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    expect(screen.getByTestId('mv-proceed-confirm')).not.toBeDisabled();
  });

  // Step 3 — permission test
  it('auto-runs write test on entering test step', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
    expect(mockValidatePath).toHaveBeenCalledWith('/home/user/Dropbox');
  });

  it('shows error when write test fails and allows retry', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });
    mockValidatePath.mockResolvedValueOnce({ exists: true, isEmpty: false, writable: false });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-error')).toBeInTheDocument());
    expect(screen.getByTestId('mv-migrate')).toBeDisabled();

    // Retry restores success
    mockValidatePath.mockResolvedValueOnce({ exists: true, isEmpty: false, writable: true });
    fireEvent.click(screen.getByTestId('mv-retry-test'));
    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());
  });

  // Step 4 — result
  it('shows success message and calls onSuccess after migration', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    await waitFor(() => expect(screen.getByTestId('mv-success-message')).toBeInTheDocument());
    expect(screen.getByTestId('mv-new-path')).toHaveTextContent('/home/user/Dropbox/MythosVault');

    fireEvent.click(screen.getByTestId('mv-done'));
    expect(mockOnSuccess).toHaveBeenCalledWith('/home/user/Dropbox/MythosVault', 'dropbox');
  });

  it('shows migration error when IPC call fails', async () => {
    mockPickFolder.mockResolvedValue({ vaultRoot: '/home/user/Dropbox', cancelled: false, registrationToken: 'tok-abc' });
    mockVaultGuidedFolderMove.mockResolvedValue({ error: 'Move operation failed: disk full' });

    renderWizard();
    const radio = screen.getByTestId('provider-option-dropbox').querySelector('input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId('mv-next-provider'));

    await act(async () => { fireEvent.click(screen.getByTestId('mv-browse')); });
    await waitFor(() => expect((screen.getByTestId('mv-folder-display') as HTMLInputElement).value).toBe('/home/user/Dropbox'));
    fireEvent.click(screen.getByTestId('mv-next-folder'));
    await waitFor(() => screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('mv-proceed-confirm'));

    await waitFor(() => expect(screen.getByTestId('mv-test-ok')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('mv-migrate')); });

    await waitFor(() => expect(screen.getByTestId('mv-migration-error')).toBeInTheDocument());
    expect(screen.getByTestId('mv-migration-error')).toHaveTextContent('Move operation failed: disk full');
  });

  // Accessibility
  it('has WCAG-level aria-label on dialog', () => {
    renderWizard();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Move vault to cloud sync');
  });

  it('has aria-label on all provider radio inputs', () => {
    renderWizard();
    const radios = screen.getAllByRole('radio');
    radios.forEach((r) => expect(r).toHaveAttribute('aria-label'));
  });

  it('close button calls onClose', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
