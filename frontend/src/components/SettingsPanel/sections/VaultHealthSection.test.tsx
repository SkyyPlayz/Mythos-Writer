import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VaultHealthSection from './VaultHealthSection';

// SKY-5161 / GH#615 — cover the in-app "Clear all data" danger-zone control and
// its wiring to the `window.api.cleanUninstall` IPC binding.
const mockCleanUninstall = vi.fn();
const mockCheckVaultIntegrity = vi.fn();
const mockRebuildVaultManifest = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: {
      cleanUninstall: mockCleanUninstall,
      checkVaultIntegrity: mockCheckVaultIntegrity,
      rebuildVaultManifest: mockRebuildVaultManifest,
    },
    writable: true,
    configurable: true,
  });
});

describe('VaultHealthSection — Clear all data (SKY-5161 / GH#615)', () => {
  it('renders a discoverable danger-zone control', () => {
    render(<VaultHealthSection />);
    expect(screen.getByTestId('clear-data-danger-zone')).toBeTruthy();
    expect(screen.getByTestId('clear-data-btn')).toBeTruthy();
  });

  it('arms a confirmation step before calling the IPC', () => {
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    expect(screen.getByTestId('clear-data-confirm')).toBeTruthy();
    expect(mockCleanUninstall).not.toHaveBeenCalled();
  });

  it('cancelling the confirmation does not call the IPC', () => {
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-cancel-btn'));
    expect(screen.queryByTestId('clear-data-confirm')).toBeNull();
    expect(mockCleanUninstall).not.toHaveBeenCalled();
  });

  it('surfaces a success result with deleted count', async () => {
    mockCleanUninstall.mockResolvedValue({
      cancelled: false,
      deleted: ['/data/vaults'],
      errors: [],
      customPathsWarning: [],
    });
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(mockCleanUninstall).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('clear-data-success').textContent).toContain('Deleted 1 location');
  });

  // SKY-8882: on Windows a locked vault can survive the delete while the
  // settings files go — that outcome must read as a failure, never success.
  it('renders a failure headline (not success) when some entries could not be deleted', async () => {
    mockCleanUninstall.mockResolvedValue({
      cancelled: false,
      deleted: ['/data/app-settings.json'],
      errors: ['/data/vaults: Entry still exists after delete (a file may be locked by another program)'],
      customPathsWarning: [],
    });
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('clear-data-partial')).toBeTruthy());
    expect(screen.queryByTestId('clear-data-success')).toBeNull();
    expect(screen.getByTestId('clear-data-errors').textContent).toContain('/data/vaults');
  });

  it('surfaces the keep-vaults cancellation from the native dialog', async () => {
    mockCleanUninstall.mockResolvedValue({
      cancelled: true,
      deleted: [],
      errors: [],
      customPathsWarning: [],
    });
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('clear-data-cancelled')).toBeTruthy());
  });

  it('surfaces the custom-path warning', async () => {
    mockCleanUninstall.mockResolvedValue({
      cancelled: false,
      deleted: ['/data/vaults'],
      errors: [],
      customPathsWarning: ['/elsewhere/my-notes'],
    });
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('clear-data-custom-warning')).toBeTruthy());
    expect(screen.getByTestId('clear-data-custom-warning').textContent).toContain('/elsewhere/my-notes');
  });

  it('surfaces an error envelope from the IPC', async () => {
    mockCleanUninstall.mockResolvedValue({ error: 'Something went wrong.' });
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('clear-data-error')).toBeTruthy());
    expect(screen.getByTestId('clear-data-error').textContent).toContain('Something went wrong.');
  });

  it('surfaces a thrown error', async () => {
    mockCleanUninstall.mockRejectedValue(new Error('IPC bridge down'));
    render(<VaultHealthSection />);
    fireEvent.click(screen.getByTestId('clear-data-btn'));
    fireEvent.click(screen.getByTestId('clear-data-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('clear-data-error')).toBeTruthy());
    expect(screen.getByTestId('clear-data-error').textContent).toContain('IPC bridge down');
  });
});
