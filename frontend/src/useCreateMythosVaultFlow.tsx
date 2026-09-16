import { useCallback, useRef, useState } from 'react';

/**
 * SKY-11376: "Create new Mythos Vault" flow (name + destination folder),
 * shared by DesktopShell's nav-rail "+" and the legacy ProjectSwitcher so
 * the two entry points can't drift the way they did before (both hardcoded
 * seedMode: 'default' and never passed parentPath). New vaults are blank —
 * sample content was removed from onboarding and shouldn't sneak back in here.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const createVault = useCallback(() => {
    setName('');
    setError(null);
    setOpen(true);
    window.api?.vaultGetPaths?.().then((paths) => {
      setDest(paths?.vaultsParentPath || paths?.defaultVaultsParentPath || '');
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

  const createVaultModal = !open ? null : (
    <div
      className="prompt-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Create new Mythos Vault"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="prompt-modal create-vault-modal">
        <label className="prompt-modal-label" htmlFor="create-vault-name">
          Name for the new Mythos Vault:
        </label>
        <input
          id="create-vault-name"
          className="prompt-modal-input"
          autoFocus
          value={name}
          disabled={busy}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            else if (e.key === 'Escape') close();
          }}
        />
        <label className="prompt-modal-label" htmlFor="create-vault-dest">
          Location:
        </label>
        <div className="create-vault-dest-row">
          <span id="create-vault-dest" className="create-vault-dest-path" title={dest || undefined}>
            {dest || 'Choose a folder…'}
          </span>
          <button type="button" className="create-vault-browse-btn" onClick={() => void browse()} disabled={busy}>
            Browse&hellip;
          </button>
        </div>
        {error && <p className="create-vault-error" role="alert">{error}</p>}
        <div className="prompt-modal-actions">
          <button type="button" className="prompt-modal-cancel" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="prompt-modal-ok" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );

  return { createVault, createVaultModal };
}
