import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCreateMythosVaultFlow } from './useCreateMythosVaultFlow';

function TestHarness({ onCreated }: { onCreated: (r: { vaultRoot: string; notesVaultRoot: string }) => void }) {
  const { createVault, createVaultModal } = useCreateMythosVaultFlow(onCreated);
  return (
    <div>
      <button onClick={createVault}>Open</button>
      {createVaultModal}
    </div>
  );
}

function setApi(overrides: Partial<Record<string, unknown>> = {}) {
  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: vi.fn().mockResolvedValue({ vaultsParentPath: '/current/vaults', defaultVaultsParentPath: '/default/vaults' }),
    chooseVaultFolder: vi.fn().mockResolvedValue({ path: '/picked/location', cancelled: false }),
    vaultCreateDefaultMythos: vi.fn().mockResolvedValue({
      mythosVaultRoot: '/current/vaults/New', vaultRoot: '/current/vaults/New/Story Vault',
      notesVaultRoot: '/current/vaults/New/Notes Vault', name: 'New', created: true,
    }),
    ...overrides,
  };
}

describe('useCreateMythosVaultFlow (SKY-11376)', () => {
  beforeEach(() => setApi());

  it('defaults the destination to the current vaults parent path', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
  });

  it('lets the user browse to a different destination before creating', async () => {
    const onCreated = vi.fn();
    render(<TestHarness onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('/picked/location')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'My Vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      vaultRoot: '/current/vaults/New/Story Vault',
      notesVaultRoot: '/current/vaults/New/Notes Vault',
    }));
    expect(window.api.vaultCreateDefaultMythos).toHaveBeenCalledWith({
      vaultName: 'My Vault',
      parentPath: '/picked/location',
      seedMode: 'blank',
    });
  });

  it('never seeds sample content, even without touching the destination', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));

    await waitFor(() => expect(window.api.vaultCreateDefaultMythos).toHaveBeenCalled());
    const call = (window.api.vaultCreateDefaultMythos as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.seedMode).toBe('blank');
  });

  it('renders the Sep mockup Create a Mythos vault chrome', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    expect(screen.getByText('Where to create')).toBeInTheDocument();
    expect(screen.getByTestId('create-vault-default-folder')).toHaveTextContent('Default folder');
    expect(screen.getByRole('button', { name: 'Create vault' })).toBeInTheDocument();
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

  it('cancelling creates nothing', async () => {
    const onCreated = vi.fn();
    render(<TestHarness onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Cancel'));

    expect(window.api.vaultCreateDefaultMythos).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.queryByText('/current/vaults')).not.toBeInTheDocument();
  });
});
