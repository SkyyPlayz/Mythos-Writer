import { useCallback, useEffect, useId, useState } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './components/ui/Dialog';
import { truncatePath } from './utils/truncatePath';
import './AccountModal.css';

export interface AccountModalProps {
  open: boolean;
  onClose: () => void;
}

interface VaultPathsState {
  storyVaultPath: string;
  notesVaultPath: string;
  homeDir?: string;
  pathSeparator?: '/' | '\\';
}

type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'up-to-date' }
  | { status: 'error' };

const PATH_MAX_CHARS = 42;

export default function AccountModal({ open, onClose }: AccountModalProps) {
  const titleId = useId();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultPathsState | null>(null);
  const [revealError, setRevealError] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ status: 'idle' });

  // Refresh local-only info each time the modal is reopened; also clears
  // transient status from a prior open (e.g. a stale update-check result).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    window.api?.getAppInfo?.()
      .then((info) => { if (!cancelled) setAppVersion(info?.appVersion ?? null); })
      .catch(() => { if (!cancelled) setAppVersion(null); });

    window.api?.vaultGetPaths?.()
      .then((paths) => { if (!cancelled) setVaults(paths ?? null); })
      .catch(() => { if (!cancelled) setVaults(null); });

    setRevealError(false);
    setUpdateCheck({ status: 'idle' });

    return () => { cancelled = true; };
  }, [open]);

  const handleOpenVaultFolder = useCallback(async () => {
    setRevealError(false);
    try {
      const result = await window.api?.revealVaultFolder?.();
      if (!result?.opened) setRevealError(true);
    } catch {
      setRevealError(true);
    }
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateCheck({ status: 'checking' });
    try {
      const result = await window.api?.appCheckForUpdate?.();
      if (result?.available && result.version) {
        setUpdateCheck({ status: 'available', version: result.version });
      } else {
        setUpdateCheck({ status: 'up-to-date' });
      }
    } catch {
      setUpdateCheck({ status: 'error' });
    }
  }, []);

  const pathOptions = { homeDir: vaults?.homeDir, sep: vaults?.pathSeparator };
  const storyDisplay = vaults?.storyVaultPath
    ? truncatePath(vaults.storyVaultPath, PATH_MAX_CHARS, pathOptions)
    : 'Not configured';
  const notesDisplay = vaults?.notesVaultPath
    ? truncatePath(vaults.notesVaultPath, PATH_MAX_CHARS, pathOptions)
    : 'Not configured';

  const updateStatusText = ((): string | null => {
    switch (updateCheck.status) {
      case 'checking': return 'Checking for updates…';
      case 'available': return `Update available: v${updateCheck.version}`;
      case 'up-to-date': return 'No update available — you have the latest version.';
      case 'error': return 'Could not check for updates.';
      default: return null;
    }
  })();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId}>
      <DialogHeader onClose={onClose}>
        <h2 id={titleId} className="am-title">Mythos Account</h2>
      </DialogHeader>

      <DialogBody className="am-body">
        <div className="am-identity-row">
          <div className="am-brand-glyph" aria-hidden="true">M</div>
          <div className="am-identity-text">
            <p className="am-app-name">Mythos Writer</p>
            <p className="am-app-version">
              {appVersion ? `Version ${appVersion}` : 'Version unavailable'}
            </p>
          </div>
        </div>

        <section className="am-section" aria-labelledby={`${titleId}-vaults`}>
          <h3 className="am-section-title" id={`${titleId}-vaults`}>Vaults</h3>
          <dl className="am-vault-list">
            <div className="am-vault-row">
              <dt className="am-vault-label">Story Vault</dt>
              <dd className="am-vault-value" title={vaults?.storyVaultPath || undefined}>
                {storyDisplay}
              </dd>
            </div>
            <div className="am-vault-row">
              <dt className="am-vault-label">Notes Vault</dt>
              <dd className="am-vault-value" title={vaults?.notesVaultPath || undefined}>
                {notesDisplay}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="am-btn-secondary"
            onClick={handleOpenVaultFolder}
            disabled={!vaults?.storyVaultPath}
          >
            Open Vault Folder
          </button>
          {revealError && (
            <p className="am-inline-error" role="alert">Could not open the vault folder.</p>
          )}
        </section>

        <section className="am-section" aria-labelledby={`${titleId}-updates`}>
          <h3 className="am-section-title" id={`${titleId}-updates`}>Updates</h3>
          <button
            type="button"
            className="am-btn-secondary"
            onClick={handleCheckForUpdates}
            disabled={updateCheck.status === 'checking'}
          >
            {updateCheck.status === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
          {updateStatusText && (
            <p className="am-update-status" role="status" aria-live="polite">{updateStatusText}</p>
          )}
        </section>
      </DialogBody>

      <DialogFooter className="am-footer">
        <button type="button" className="am-dismiss" onClick={onClose} autoFocus>
          Close
        </button>
      </DialogFooter>
    </Dialog>
  );
}
