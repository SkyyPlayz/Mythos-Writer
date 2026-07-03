import { useState, useCallback } from 'react';

// MYT-346 / PROJECT_PLAN "Data on Uninstall" — Settings controls for the
// existing app-data backup/restore IPC. Both native dialogs (save file /
// pick archive) are owned by the main process (SKY-699 / SKY-700), so this
// component never passes a filesystem path over the bridge — it only invokes
// the channel and renders the result.
//
// Restore is a two-step handshake: the first call returns
// `requiresConfirmation: true` when app data already exists on disk; the UI
// then shows an inline confirm step and re-calls with `confirmed: true`.
// The main process shows the file-picker again on the confirmed call, so the
// hint text warns the user they will choose the backup file a second time.

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupSection() {
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreNeedsConfirm, setRestoreNeedsConfirm] = useState(false);

  const busy = backupBusy || restoreBusy;

  const handleBackup = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus(null);
    setBackupError(null);
    try {
      const res = await window.api.backupAppData();
      if ('error' in res) {
        setBackupError(res.error || 'Backup failed.');
      } else if (res.cancelled) {
        setBackupStatus('Backup cancelled.');
      } else {
        setBackupStatus(`Backup saved (${formatBytes(res.bytes)}).`);
      }
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const runRestore = useCallback(async (confirmed: boolean) => {
    setRestoreBusy(true);
    setRestoreStatus(null);
    setRestoreError(null);
    try {
      const res = confirmed ? await window.api.restoreAppData(true) : await window.api.restoreAppData();
      if ('error' in res) {
        setRestoreError(res.error || 'Restore failed.');
        setRestoreNeedsConfirm(false);
      } else if (res.cancelled) {
        setRestoreStatus('Restore cancelled.');
        setRestoreNeedsConfirm(false);
      } else if (res.requiresConfirmation) {
        setRestoreNeedsConfirm(true);
      } else if (res.restored) {
        setRestoreStatus(
          `Restored ${res.details.length} file${res.details.length !== 1 ? 's' : ''} from backup. Restart the app to finish.`,
        );
        setRestoreNeedsConfirm(false);
      } else {
        setRestoreError('Restore failed.');
        setRestoreNeedsConfirm(false);
      }
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Restore failed.');
      setRestoreNeedsConfirm(false);
    } finally {
      setRestoreBusy(false);
    }
  }, []);

  return (
    <section className="settings-section" aria-labelledby="section-backup" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-backup">Back up &amp; restore</h3>
      <p className="settings-hint">
        Export your settings, vault manifests, and app-private data (snapshots, suggestion history)
        to a single backup file, or restore them from one. Your scene and note markdown files are
        not included — they live in your vault folders and can be copied separately.
      </p>
      <div className="settings-input-row">
        <button
          className="settings-btn settings-btn-secondary"
          type="button"
          onClick={handleBackup}
          disabled={busy}
          data-testid="backup-app-data-btn"
        >
          {backupBusy ? 'Backing up…' : 'Back up app data…'}
        </button>
        <button
          className="settings-btn settings-btn-secondary"
          type="button"
          onClick={() => { setRestoreNeedsConfirm(false); void runRestore(false); }}
          disabled={busy}
          data-testid="restore-app-data-btn"
        >
          {restoreBusy ? 'Restoring…' : 'Restore from backup…'}
        </button>
      </div>
      {restoreNeedsConfirm && (
        <div className="settings-input-row" data-testid="restore-confirm">
          <span className="settings-error-msg" role="alert">
            Restoring will overwrite your current settings and vault metadata. You&apos;ll be asked
            to pick the backup file again. Continue?
          </span>
          <button
            className="settings-btn settings-btn-danger"
            type="button"
            onClick={() => { void runRestore(true); }}
            disabled={busy}
            data-testid="restore-confirm-btn"
          >
            Continue
          </button>
          <button
            className="settings-btn settings-btn-secondary"
            type="button"
            onClick={() => setRestoreNeedsConfirm(false)}
            disabled={busy}
            data-testid="restore-cancel-btn"
          >
            Cancel
          </button>
        </div>
      )}
      {backupStatus && (
        <span className="settings-saved-msg" role="status" aria-live="polite" data-testid="backup-status">{backupStatus}</span>
      )}
      {backupError && (
        <span className="settings-error-msg" role="alert" data-testid="backup-error">{backupError}</span>
      )}
      {restoreStatus && (
        <span className="settings-saved-msg" role="status" aria-live="polite" data-testid="restore-status">{restoreStatus}</span>
      )}
      {restoreError && (
        <span className="settings-error-msg" role="alert" data-testid="restore-error">{restoreError}</span>
      )}
    </section>
  );
}
