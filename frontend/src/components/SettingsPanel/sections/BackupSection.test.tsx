import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BackupSection from './BackupSection';

// MYT-346 — cover the Settings "Back up app data" / "Restore from backup"
// controls and their wiring to the `window.api.backupAppData` /
// `window.api.restoreAppData` IPC bindings, including the two-step restore
// confirmation handshake (requiresConfirmation → re-call with confirmed).
const mockBackupAppData = vi.fn();
const mockRestoreAppData = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: {
      backupAppData: mockBackupAppData,
      restoreAppData: mockRestoreAppData,
    },
    writable: true,
    configurable: true,
  });
});

describe('BackupSection — Back up app data (MYT-346)', () => {
  it('renders both controls', () => {
    render(<BackupSection />);
    expect(screen.getByTestId('backup-app-data-btn')).toBeTruthy();
    expect(screen.getByTestId('restore-app-data-btn')).toBeTruthy();
  });

  it('surfaces a success message with the archive size', async () => {
    mockBackupAppData.mockResolvedValue({ path: '/backups/my.mwbackup', bytes: 2048, cancelled: false });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('backup-app-data-btn'));
    await waitFor(() => expect(mockBackupAppData).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('backup-status').textContent).toContain('Backup saved (2.0 KB)');
  });

  it('surfaces the native save-dialog cancellation', async () => {
    mockBackupAppData.mockResolvedValue({ path: null, bytes: 0, cancelled: true });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('backup-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('backup-status')).toBeTruthy());
    expect(screen.getByTestId('backup-status').textContent).toContain('Backup cancelled.');
  });

  it('surfaces an error envelope from the IPC', async () => {
    mockBackupAppData.mockResolvedValue({ error: 'Permission denied.' });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('backup-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('backup-error')).toBeTruthy());
    expect(screen.getByTestId('backup-error').textContent).toContain('Permission denied.');
  });

  it('surfaces a thrown error', async () => {
    mockBackupAppData.mockRejectedValue(new Error('IPC bridge down'));
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('backup-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('backup-error')).toBeTruthy());
    expect(screen.getByTestId('backup-error').textContent).toContain('IPC bridge down');
  });

  it('disables both buttons while a backup is in flight', async () => {
    let resolveBackup!: (v: unknown) => void;
    mockBackupAppData.mockImplementation(() => new Promise((res) => { resolveBackup = res; }));
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('backup-app-data-btn'));
    expect((screen.getByTestId('backup-app-data-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('restore-app-data-btn') as HTMLButtonElement).disabled).toBe(true);
    resolveBackup({ path: '/backups/my.mwbackup', bytes: 10, cancelled: false });
    await waitFor(() =>
      expect((screen.getByTestId('backup-app-data-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    expect((screen.getByTestId('restore-app-data-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('BackupSection — Restore from backup (MYT-346)', () => {
  it('restores directly when no confirmation is required (fresh state)', async () => {
    mockRestoreAppData.mockResolvedValue({ restored: true, details: ['restored: userData/app-settings.json'] });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(mockRestoreAppData).toHaveBeenCalledTimes(1));
    expect(mockRestoreAppData).toHaveBeenCalledWith();
    expect(screen.getByTestId('restore-status').textContent).toContain('Restored 1 file from backup');
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
  });

  it('surfaces the native open-dialog cancellation', async () => {
    mockRestoreAppData.mockResolvedValue({ restored: false, cancelled: true, details: [] });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-status')).toBeTruthy());
    expect(screen.getByTestId('restore-status').textContent).toContain('Restore cancelled.');
  });

  it('shows the confirm step when the handler requires confirmation, without restoring', async () => {
    mockRestoreAppData.mockResolvedValue({ restored: false, requiresConfirmation: true, details: [] });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeTruthy());
    expect(mockRestoreAppData).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('restore-status')).toBeNull();
  });

  it('confirming re-calls the IPC with confirmed=true and surfaces success', async () => {
    mockRestoreAppData
      .mockResolvedValueOnce({ restored: false, requiresConfirmation: true, details: [] })
      .mockResolvedValueOnce({ restored: true, details: ['restored: a', 'restored: b'] });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('restore-confirm-btn'));
    await waitFor(() => expect(mockRestoreAppData).toHaveBeenCalledTimes(2));
    expect(mockRestoreAppData).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(screen.getByTestId('restore-status')).toBeTruthy());
    expect(screen.getByTestId('restore-status').textContent).toContain('Restored 2 files from backup');
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
  });

  it('cancelling the confirm step does not re-call the IPC', async () => {
    mockRestoreAppData.mockResolvedValue({ restored: false, requiresConfirmation: true, details: [] });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('restore-cancel-btn'));
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
    expect(mockRestoreAppData).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error envelope from the IPC and clears the confirm step', async () => {
    mockRestoreAppData
      .mockResolvedValueOnce({ restored: false, requiresConfirmation: true, details: [] })
      .mockResolvedValueOnce({ error: 'Internal error.' });
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('restore-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-error')).toBeTruthy());
    expect(screen.getByTestId('restore-error').textContent).toContain('Internal error.');
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
  });

  it('surfaces a thrown error', async () => {
    mockRestoreAppData.mockRejectedValue(new Error('IPC bridge down'));
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    await waitFor(() => expect(screen.getByTestId('restore-error')).toBeTruthy());
    expect(screen.getByTestId('restore-error').textContent).toContain('IPC bridge down');
  });

  it('disables both buttons while a restore is in flight', async () => {
    let resolveRestore!: (v: unknown) => void;
    mockRestoreAppData.mockImplementation(() => new Promise((res) => { resolveRestore = res; }));
    render(<BackupSection />);
    fireEvent.click(screen.getByTestId('restore-app-data-btn'));
    expect((screen.getByTestId('backup-app-data-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('restore-app-data-btn') as HTMLButtonElement).disabled).toBe(true);
    resolveRestore({ restored: false, cancelled: true, details: [] });
    await waitFor(() =>
      expect((screen.getByTestId('restore-app-data-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    expect((screen.getByTestId('backup-app-data-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});
