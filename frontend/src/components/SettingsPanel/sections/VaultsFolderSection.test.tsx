// SKY-11154 — "Vaults folder" row: path display + Open folder + Move… flow.
// AC-VS-06 requires this flow to never surface Dropbox/cloud-provider copy.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VaultsFolderSection from './VaultsFolderSection';

const mockVaultGetPaths = vi.fn();
const mockReveal = vi.fn();
const mockMove = vi.fn();
const mockChooseVaultFolder = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockVaultGetPaths.mockResolvedValue({ storyVaultPath: '/s', notesVaultPath: '/n', vaultsParentPath: '/vaults' });
  mockReveal.mockResolvedValue({ opened: true });
  mockMove.mockResolvedValue({ moved: true, newPath: '/elsewhere/vaults' });
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  Object.defineProperty(window, 'api', {
    value: {
      vaultGetPaths: mockVaultGetPaths,
      vaultSurfaceRevealVaultsParent: mockReveal,
      vaultSurfaceMoveVaultsParent: mockMove,
      chooseVaultFolder: mockChooseVaultFolder,
    },
    writable: true,
    configurable: true,
  });
});

async function setup() {
  await act(async () => {
    render(<VaultsFolderSection />);
  });
  await waitFor(() => expect(screen.getByTestId('vaults-folder-path')).toHaveTextContent('/vaults'));
}

describe('VaultsFolderSection', () => {
  it('shows the current vaults parent path', async () => {
    await setup();
    expect(screen.getByTestId('vaults-folder-path')).toHaveTextContent('/vaults');
  });

  it('Open folder calls vaultSurfaceRevealVaultsParent', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('open-vaults-folder-btn'));
    await waitFor(() => expect(mockReveal).toHaveBeenCalled());
  });

  it('exposes data-testid="move-vault-btn" (AC-VS-06) and opens a dialog with no cloud-provider copy', async () => {
    await setup();
    const moveBtn = screen.getByTestId('move-vault-btn');
    expect(moveBtn).toBeInTheDocument();
    fireEvent.click(moveBtn);
    await waitFor(() => expect(screen.getByTestId('vaults-folder-move-dialog')).toBeInTheDocument());
    expect(screen.queryByText(/dropbox/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/synced via/i)).not.toBeInTheDocument();
  });

  it('Browse then Move calls vaultSurfaceMoveVaultsParent with the chosen destination', async () => {
    mockChooseVaultFolder.mockResolvedValue({ path: '/elsewhere/vaults', cancelled: false });
    await setup();
    fireEvent.click(screen.getByTestId('move-vault-btn'));
    fireEvent.click(screen.getByTestId('vaults-folder-move-dest-browse'));
    await waitFor(() => expect(screen.getByTestId('vaults-folder-move-dest-path')).toHaveTextContent('/elsewhere/vaults'));
    fireEvent.click(screen.getByTestId('vaults-folder-move-confirm'));
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith('/elsewhere/vaults'));
    await waitFor(() => expect(screen.queryByTestId('vaults-folder-move-dialog')).not.toBeInTheDocument());
  });

  it('a failed move shows the error and keeps the dialog open', async () => {
    mockChooseVaultFolder.mockResolvedValue({ path: '/elsewhere/vaults', cancelled: false });
    mockMove.mockResolvedValue({ moved: false, error: 'destination exists' });
    await setup();
    fireEvent.click(screen.getByTestId('move-vault-btn'));
    fireEvent.click(screen.getByTestId('vaults-folder-move-dest-browse'));
    await waitFor(() => expect(screen.getByTestId('vaults-folder-move-dest-path')).toHaveTextContent('/elsewhere/vaults'));
    fireEvent.click(screen.getByTestId('vaults-folder-move-confirm'));
    await waitFor(() => expect(screen.getByTestId('vaults-folder-move-error')).toHaveTextContent('destination exists'));
    expect(screen.getByTestId('vaults-folder-move-dialog')).toBeInTheDocument();
  });
});
