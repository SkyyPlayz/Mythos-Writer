import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCreateMythosVaultFlow } from './useCreateMythosVaultFlow';

function TestHarness({ onCreated }: { onCreated: (r: { vaultRoot: string; notesVaultRoot: string }) => void }) {
  const { createVault, createVaultModal } = useCreateMythosVaultFlow(onCreated);
  return (
    <div>
      <button onClick={() => createVault()}>Open</button>
      <button onClick={() => createVault('openin')}>Open openin</button>
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

  it('activate:false scaffolds without committing main (Shield flush-first create)', async () => {
    function Harness() {
      const { createVault, createVaultModal } = useCreateMythosVaultFlow(vi.fn(), { activate: false });
      return (
        <>
          <button type="button" onClick={() => createVault()}>Open</button>
          {createVaultModal}
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(window.api.createVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false }),
    ));
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
});
