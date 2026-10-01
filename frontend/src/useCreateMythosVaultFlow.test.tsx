import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCreateMythosVaultFlow, type CreateVaultOutcome } from './useCreateMythosVaultFlow';

function TestHarness({
  onCreated,
  onOutcome,
}: {
  onCreated: (r: { vaultRoot: string; notesVaultRoot: string }) => void | Promise<void>;
  onOutcome?: (outcome: CreateVaultOutcome) => void;
}) {
  const { createVault, createVaultModal } = useCreateMythosVaultFlow(onCreated);
  return (
    <div>
      <button
        onClick={() => {
          void createVault().then((outcome) => onOutcome?.(outcome));
        }}
      >
        Open
      </button>
      <button
        onClick={() => {
          void createVault('openin').then((outcome) => onOutcome?.(outcome));
        }}
      >
        Open openin
      </button>
      {createVaultModal}
    </div>
  );
}

function setApi(overrides: Partial<Record<string, unknown>> = {}) {
  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: vi.fn().mockResolvedValue({ vaultsParentPath: '/current/vaults', defaultVaultsParentPath: '/default/vaults' }),
    chooseVaultFolder: vi.fn().mockResolvedValue({ path: '/picked/location', cancelled: false }),
    createVaultFromOptions: vi.fn().mockResolvedValue({
      ok: true,
      mode: 'template',
      mythosRoot: '/current/vaults/New',
      storyVaultPath: '/current/vaults/New/Stories/Story Vault',
      notesVaultPath: '/current/vaults/New/Notes/Notes Vault',
      vaultName: 'New',
    }),
    ...overrides,
  };
}

describe('useCreateMythosVaultFlow (Slice D five-path)', () => {
  beforeEach(() => setApi());

  it('defaults the destination to the current vaults parent path', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
  });

  it('creates via createVaultFromOptions with template mode by default', async () => {
    const onCreated = vi.fn();
    render(<TestHarness onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('/picked/location')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'My Vault' } });
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      vaultRoot: '/current/vaults/New/Stories/Story Vault',
      notesVaultRoot: '/current/vaults/New/Notes/Notes Vault',
    }));
    expect(window.api.createVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'template',
        name: 'My Vault',
        destinationParent: '/picked/location',
        activate: true,
      }),
    );
  });

  it('exposes all five Mythos create modes including Open Obsidian', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    expect(screen.getByTestId('rail-vault-mode-template')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-blank')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-import')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-restore')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-openin')).toBeInTheDocument();
  });

  it('openin preset skips destination and requires Obsidian path', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open openin'));
    await waitFor(() => expect(screen.getByTestId('rail-vault-mode-openin')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Obsidian vault/i));
  });

  it('Default folder resets the destination to defaultVaultsParentPath', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('/picked/location')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-default-folder'));
    await waitFor(() => expect(screen.getByText('/default/vaults')).toBeInTheDocument());
  });

  it('Cancel resolves createVault with cancelled', async () => {
    const onOutcome = vi.fn();
    render(<TestHarness onCreated={vi.fn()} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-cancel'));
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith('cancelled'));
    expect(screen.queryByRole('dialog', { name: 'Create a Mythos vault' })).not.toBeInTheDocument();
  });

  it('Escape resolves createVault with cancelled', async () => {
    const onOutcome = vi.fn();
    render(<TestHarness onCreated={vi.fn()} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog', { name: 'Create a Mythos vault' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith('cancelled'));
    expect(screen.queryByRole('dialog', { name: 'Create a Mythos vault' })).not.toBeInTheDocument();
  });

  it('successful create resolves createVault with created', async () => {
    const onOutcome = vi.fn();
    const onCreated = vi.fn().mockResolvedValue(undefined);
    render(<TestHarness onCreated={onCreated} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith('created'));
    expect(onCreated).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Create a Mythos vault' })).not.toBeInTheDocument();
  });

  it('onCreated rejection keeps modal open with inline error and re-enables submit', async () => {
    const onOutcome = vi.fn();
    const onCreated = vi.fn().mockRejectedValue(new Error('settingsSet failed'));
    render(<TestHarness onCreated={onCreated} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Could not create the vault/i));
    // Unblocks the waiter so WelcomeFirstRun setupBusy can clear.
    expect(onOutcome).toHaveBeenCalledWith('cancelled');
    // Modal stays up; cards/buttons re-enabled (busy cleared).
    expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument();
    expect(screen.getByTestId('create-vault-submit')).not.toBeDisabled();
    expect(screen.getByTestId('create-vault-cancel')).not.toBeDisabled();
    expect(screen.getByTestId('rail-vault-mode-template')).not.toBeDisabled();
  });
});
