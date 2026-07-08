// Beta 3 "Liquid Neon" M24 — Settings → Sync & Backup (prototype 1966–2002).
// Real surface only: cloud-provider detection on the vault path (Beta-2
// cloudSync lib), the existing app-data backup/restore IPC (SKY-699/700
// two-step restore handshake), and the recovery runbook. Scheduled cloud sync
// itself ships with a later milestone — no fake toggles here.
import { useCallback, useState } from 'react';
import type { detectCloudProvider } from '../../../lib/cloudSync';
import VaultSyncBadge from '../../VaultSyncBadge';
import { M24Card } from './M24Controls';
import './M24Sections.css';

interface Props {
  vaults: { storyVaultPath: string; notesVaultPath: string };
  vaultProvider: ReturnType<typeof detectCloudProvider>;
  onMoveVault: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SyncBackupSection({ vaults, vaultProvider, onMoveVault }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const handleBackup = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await window.api.backupAppData();
      if ('error' in res) setError(res.error || 'Backup failed.');
      else if (res.cancelled) setStatus('Backup cancelled.');
      else setStatus(`Backup saved (${formatBytes(res.bytes)}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const runRestore = useCallback(async (confirmed: boolean) => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = confirmed ? await window.api.restoreAppData(true) : await window.api.restoreAppData();
      if ('error' in res) {
        setError(res.error || 'Restore failed.');
        setNeedsConfirm(false);
      } else if (res.cancelled) {
        setStatus('Restore cancelled.');
        setNeedsConfirm(false);
      } else if (res.requiresConfirmation) {
        setNeedsConfirm(true);
      } else if (res.restored) {
        setStatus(`Restored ${res.details.length} file${res.details.length !== 1 ? 's' : ''} from backup. Restart the app to finish.`);
        setNeedsConfirm(false);
      } else {
        setError('Restore failed.');
        setNeedsConfirm(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
      setNeedsConfirm(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="settings-section m24-root" aria-labelledby="section-sync-backup" data-settings-cat="sync">
      <h3 className="settings-section-title" id="section-sync-backup">Sync &amp; Backup</h3>

      <M24Card title="Cloud sync">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#8e9db8' }}>
              Your vaults are plain files on disk — put them in a synced folder (Dropbox, OneDrive, iCloud
              Drive…) and every device stays current. Conflicting edits keep both versions.
            </div>
          </div>
          <VaultSyncBadge provider={vaultProvider} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }}>
          <span className="m24-path" title={vaults.storyVaultPath || undefined} data-testid="sync-vault-path">
            {vaults.storyVaultPath || 'No Story Vault configured'}
          </span>
          <button
            type="button"
            className="m24-btn m24-btn--primary"
            onClick={onMoveVault}
            disabled={busy}
            data-testid="sync-move-vault"
            aria-label="Move vault to a different folder"
          >
            Move vault…
          </button>
        </div>
        <p className="settings-hint" style={{ marginTop: 8 }}>
          The move wizard defaults to a local folder on this PC; pick a cloud-synced folder to turn sync on.
          Everything moves in one pass; links stay intact.
        </p>
      </M24Card>

      <M24Card title="Backup & restore points">
        <div style={{ fontSize: 11, color: '#8e9db8', marginBottom: 10 }}>
          One file with your settings, vault manifests and app-private data (snapshots, suggestion history).
          Scene and note markdown lives in your vault folders and copies with them.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="m24-btn m24-btn--primary" onClick={() => { void handleBackup(); }} disabled={busy} data-testid="sync-backup-btn">
            Back up now…
          </button>
          <button type="button" className="m24-btn" onClick={() => { setNeedsConfirm(false); void runRestore(false); }} disabled={busy} data-testid="sync-restore-btn">
            Restore from backup…
          </button>
        </div>
        {needsConfirm && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }} data-testid="sync-restore-confirm">
            <span className="settings-error-msg" role="alert">
              Restoring overwrites current settings and vault metadata. You&apos;ll pick the backup file again. Continue?
            </span>
            <button type="button" className="m24-btn m24-btn--danger" onClick={() => { void runRestore(true); }} disabled={busy} data-testid="sync-restore-confirm-btn">
              Continue
            </button>
            <button type="button" className="m24-btn" onClick={() => setNeedsConfirm(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        )}
        {status && (
          <p className="settings-saved-msg" role="status" aria-live="polite" data-testid="sync-status">{status}</p>
        )}
        {error && (
          <p className="settings-error-msg" role="alert" data-testid="sync-error">{error}</p>
        )}
        <p className="settings-hint" style={{ marginTop: 10 }}>
          Per-scene snapshot retention lives under Vaults → Snapshots; per-scene version history under
          Vaults → Version History.
        </p>
      </M24Card>

      <M24Card title="If things go wrong — recovery runbook">
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            'Nothing is ever deleted silently: scenes and notes are plain .md files inside your vault folders — open them in any editor.',
            'A broken scene? Every save keeps a snapshot: right-click the scene → History, or restore from Vaults → Snapshots.',
            'A broken app state? Restore from backup above — settings, manifests and history come back; your markdown is untouched.',
            'A moved or missing vault? Point Vaults → Vault paths at the folder, or use the move wizard to relocate it properly.',
          ].map((step) => (
            <li key={step} style={{ fontSize: 11, color: '#aebad0' }}>{step}</li>
          ))}
        </ol>
      </M24Card>
    </section>
  );
}
