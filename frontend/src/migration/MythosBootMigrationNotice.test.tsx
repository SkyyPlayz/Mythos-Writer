// SKY-10405 — boot-time silent migration failure notice (IPC mocked).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MythosBootMigrationNotice from './MythosBootMigrationNotice';

const cleanStatus: MythosMigrationStatus = {
  format: 'mythos-v2',
  shouldPrompt: false,
  storyVaultRoot: '/vaults/My Vault (MythosVault)/Story Vault',
  notesVaultRoot: '/vaults/My Vault (MythosVault)/Notes Vault',
  vaultName: 'My Vault',
  suggestedTarget: '/vaults/My Vault (MythosVault) 2',
};

const mockStatus = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue(cleanStatus);
  Object.defineProperty(window, 'api', {
    value: { mythosMigrationStatus: mockStatus },
    writable: true,
    configurable: true,
  });
});

describe('MythosBootMigrationNotice', () => {
  it('renders nothing on a clean boot (no bootMigrationError)', async () => {
    render(<MythosBootMigrationNotice />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('mythos-boot-migration-error')).toBeNull();
  });

  it('surfaces the boot migration error and dismisses on click', async () => {
    mockStatus.mockResolvedValue({
      ...cleanStatus,
      format: 'v0.4-twin-root',
      bootMigrationError: 'Could not read comments sidecar "…/comments.json"',
    });
    render(<MythosBootMigrationNotice />);
    const alert = await screen.findByTestId('mythos-boot-migration-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toContain('opened your original vault unchanged');
    expect(alert.textContent).toContain('comments sidecar');

    fireEvent.click(screen.getByTestId('mythos-boot-migration-error-dismiss'));
    expect(screen.queryByTestId('mythos-boot-migration-error')).toBeNull();
  });

  it('renders nothing when the status probe rejects', async () => {
    mockStatus.mockRejectedValue(new Error('ipc down'));
    render(<MythosBootMigrationNotice />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('mythos-boot-migration-error')).toBeNull();
  });
});
