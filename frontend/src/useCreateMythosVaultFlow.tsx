import { useCallback, useRef, useState } from 'react';
import Dialog, { DialogBody, DialogFooter, DialogHeader } from './components/ui/Dialog';

/**
 * SKY-11376: "Create a Mythos vault" modal (name + destination folder),
 * shared by DesktopShell's nav-rail "+" and the legacy ProjectSwitcher so
 * the two entry points can't drift the way they did before (both hardcoded
 * seedMode: 'default' and never passed parentPath). New vaults are blank —
 * sample content was removed from onboarding and shouldn't sneak back in here.
 *
 * Owner punch (Sep Liquid Neon Create-vault modal): title, Name, Where to
 * create, Browse…, Default folder chip, Cancel / Create vault. Settings
 * "New vault…" uses the same chrome in MythosVaultsSection.
 */
export function useCreateMythosVaultFlow(
  onCreated: (result: { vaultRoot: string; notesVaultRoot: string }) => void | Promise<void>,
): {
  createVault: () => void;
  createVaultModal: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dest, setDest] = useState('');
  const [defaultFolder, setDefaultFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const createVault = useCallback(() => {
    setName('');
    setError(null);
    setOpen(true);
    window.api?.vaultGetPaths?.().then((paths) => {
      const current = paths?.vaultsParentPath || paths?.defaultVaultsParentPath || '';
      const fallback = paths?.defaultVaultsParentPath || current;
      setDest(current);
      setDefaultFolder(fallback);
    }).catch(() => { /* non-fatal — Browse… still works with an empty start */ });
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const browse = useCallback(async () => {
    const res = await window.api?.chooseVaultFolder?.('Choose where to create the new vault', dest || undefined);
    if (res && !res.cancelled && res.path) setDest(res.path);
  }, [dest]);

  const useDefaultFolder = useCallback(() => {
    if (defaultFolder) setDest(defaultFolder);
  }, [defaultFolder]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed && (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..')) {
      setError('Vault name cannot contain slashes or path traversal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.api?.vaultCreateDefaultMythos?.({
        vaultName: trimmed || undefined,
        parentPath: dest || undefined,
        seedMode: 'blank',
      });
      if (!result || result.error) {
        setError(`Could not create vault: ${result?.error ?? 'unknown error'}`);
        return;
      }
      setOpen(false);
      await onCreatedRef.current({ vaultRoot: result.vaultRoot, notesVaultRoot: result.notesVaultRoot });
    } catch (err) {
      setError(`Create failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [name, dest]);

  const createVaultModal = (
    <Dialog
      open={open}
      onClose={close}
      variant="form"
      aria-label="Create a Mythos vault"
      className="create-vault-modal"
    >
      <DialogHeader>
        <h2>Create a Mythos vault</h2>
      </DialogHeader>
      <DialogBody>
        <label className="prompt-modal-label" htmlFor="create-vault-name">
          Name
        </label>
        <input
          id="create-vault-name"
          className="prompt-modal-input"
          autoFocus
          aria-label="Name for the new Mythos Vault"
          value={name}
          disabled={busy}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            else if (e.key === 'Escape') close();
          }}
        />
        <div className="create-vault-where-header">
          <label className="prompt-modal-label" htmlFor="create-vault-dest">
            Where to create
          </label>
          <button
            type="button"
            className="create-vault-default-folder"
            title="Use the default vaults folder"
            data-testid="create-vault-default-folder"
            onClick={useDefaultFolder}
            disabled={busy || !defaultFolder}
          >
            Default folder
          </button>
        </div>
        <div className="create-vault-dest-row">
          <span id="create-vault-dest" className="create-vault-dest-path" title={dest || undefined}>
            {dest || 'Choose a folder…'}
          </span>
          <button type="button" className="create-vault-browse-btn" onClick={() => void browse()} disabled={busy}>
            Browse&hellip;
          </button>
        </div>
        {error && <p className="create-vault-error" role="alert">{error}</p>}
      </DialogBody>
      <DialogFooter className="prompt-modal-actions">
        <button type="button" className="prompt-modal-cancel" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="prompt-modal-ok" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating…' : 'Create vault'}
        </button>
      </DialogFooter>
    </Dialog>
  );

  return { createVault, createVaultModal };
}
