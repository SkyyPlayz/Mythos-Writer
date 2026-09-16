// SKY-11154 (parent spec SKY-11141 §2) — the "Vaults folder" row at the top
// of Settings > Vault & Files: shows the parent folder holding every Mythos
// vault, an "Open folder" button, and a "Move…" flow. Deliberately does NOT
// import anything from MoveVaultWizard.tsx / cloudSync.ts / SyncConflictModal
// / VaultSyncBadge — that is a separate, pre-existing cloud-branded
// subsystem for moving a single (story, notes) vault pair and is explicitly
// out of scope here; this is a different move (the folder that CONTAINS every
// Mythos vault) with a small, narrowly-scoped IPC pair of its own
// (vaultSurfaceRevealVaultsParent / vaultSurfaceMoveVaultsParent).
import { useCallback, useEffect, useState } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { showLnToast } from '../../../theme/lnToast';

export default function VaultsFolderSection() {
  const [vaultsParentPath, setVaultsParentPath] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    window.api?.vaultGetPaths?.()
      .then((paths) => { if (paths.vaultsParentPath) setVaultsParentPath(paths.vaultsParentPath); })
      .catch(() => { /* non-fatal — row renders with an empty path */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onOpenFolder = useCallback(() => {
    window.api?.vaultSurfaceRevealVaultsParent?.().catch(() => { /* non-fatal */ });
  }, []);

  const onOpenMove = useCallback(() => {
    setDestination('');
    setError('');
    setMoveOpen(true);
  }, []);

  const onBrowseDestination = useCallback(async () => {
    try {
      const res = await window.api?.chooseVaultFolder?.('Choose a new location for your Vaults folder', vaultsParentPath || undefined);
      if (res && !res.cancelled && res.path) setDestination(res.path);
    } catch { /* picker unavailable */ }
  }, [vaultsParentPath]);

  const onConfirmMove = useCallback(async () => {
    if (busy || !destination) return;
    setBusy(true);
    setError('');
    try {
      const res = await window.api?.vaultSurfaceMoveVaultsParent?.(destination);
      if (!res?.moved) {
        setError(res?.error ?? 'Could not move the Vaults folder. Check the destination and try again.');
        setBusy(false);
        return;
      }
      setMoveOpen(false);
      showLnToast('Vaults folder moved');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move the Vaults folder.');
    } finally {
      setBusy(false);
    }
  }, [busy, destination, refresh]);

  return (
    <section className="settings-section" aria-labelledby="section-vaults-folder" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-vaults-folder">Vaults folder</h3>
      <p className="settings-hint">
        Every Mythos vault lives inside this folder on disk.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="m24-path"
          data-testid="vaults-folder-path"
          title={vaultsParentPath || undefined}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {vaultsParentPath || 'Loading…'}
        </span>
        <button type="button" className="m24-btn" data-testid="open-vaults-folder-btn" onClick={onOpenFolder}>
          Open folder
        </button>
        <button type="button" className="m24-btn" data-testid="move-vault-btn" onClick={onOpenMove}>
          Move…
        </button>
      </div>

      {moveOpen && (
        <Dialog
          open
          onClose={() => (busy ? undefined : setMoveOpen(false))}
          aria-labelledby="vaults-folder-move-title"
          testId="vaults-folder-move-dialog"
        >
          <DialogHeader onClose={() => (busy ? undefined : setMoveOpen(false))}>
            <span id="vaults-folder-move-title">Move Vaults folder</span>
          </DialogHeader>
          <DialogBody>
            <p className="settings-hint">
              Pick a new parent folder — every Mythos vault moves with it.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span
                className="m24-path"
                data-testid="vaults-folder-move-dest-path"
                title={destination || undefined}
              >
                {destination || 'Choose a destination folder…'}
              </span>
              <button
                type="button"
                className="m24-btn"
                data-testid="vaults-folder-move-dest-browse"
                onClick={() => { void onBrowseDestination(); }}
                disabled={busy}
              >
                Browse&hellip;
              </button>
            </div>
            {error && (
              <p className="settings-error-msg" role="alert" data-testid="vaults-folder-move-error">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMoveOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onConfirmMove()}
              disabled={busy || !destination}
              data-testid="vaults-folder-move-confirm"
            >
              {busy ? 'Moving…' : 'Move'}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
