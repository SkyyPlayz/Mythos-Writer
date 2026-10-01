import { useCallback, useRef, useState } from 'react';
import Dialog, { DialogBody, DialogFooter, DialogHeader } from './components/ui/Dialog';
import VaultCreateModePicker, {
  type VaultCreateMode,
} from './components/SettingsPanel/sections/VaultCreateModePicker';

export type CreateMythosVaultFlowOptions = {
  /**
   * When false, scaffold without activating on main — caller must flush-then
   * switch (Shield: Settings open must not see main commit first). Default true
   * keeps legacy auto-activate for callers that already flush via onCreated.
   */
  activate?: boolean;
};

/**
 * Slice D — "Create a Mythos vault" modal shared by nav-rail "+" and
 * Welcome path handoff. Five-path: Template / Blank / Import / Restore /
 * Open Obsidian vault in Mythos. Uses createVaultFromOptions (not blank-only).
 */
export function useCreateMythosVaultFlow(
  onCreated: (result: { vaultRoot: string; notesVaultRoot: string }) => void | Promise<void>,
  options?: CreateMythosVaultFlowOptions,
): {
  createVault: (presetMode?: VaultCreateMode) => void;
  createVaultModal: React.ReactNode;
} {
  const activate = options?.activate !== false;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dest, setDest] = useState('');
  const [defaultFolder, setDefaultFolder] = useState('');
  const [mode, setMode] = useState<VaultCreateMode>('template');
  const [openinPath, setOpeninPath] = useState('');
  const [importNotesSrc, setImportNotesSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const createVault = useCallback((presetMode?: VaultCreateMode) => {
    setName('');
    setError(null);
    setOpeninPath('');
    setImportNotesSrc('');
    setMode(presetMode ?? 'template');
    setOpen(true);
    window.api?.vaultGetPaths?.().then((paths) => {
      const current = paths?.vaultsParentPath || paths?.defaultVaultsParentPath || '';
      const fallback = paths?.defaultVaultsParentPath || current;
      setDest(current);
      setDefaultFolder(fallback);
    }).catch(() => { /* non-fatal */ });
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const browse = useCallback(async () => {
    const res = await window.api?.chooseVaultFolder?.('Choose where to create the new vault', dest || undefined);
    if (res && !res.cancelled && res.path) setDest(res.path);
  }, [dest]);

  const browseOpenin = useCallback(async () => {
    const res = await window.api?.chooseVaultFolder?.(
      'Choose an Obsidian vault to open in Mythos (in place)',
      openinPath || dest || undefined,
    );
    if (res && !res.cancelled && res.path) setOpeninPath(res.path);
  }, [openinPath, dest]);

  const browseImport = useCallback(async () => {
    const res = await window.api?.chooseVaultFolder?.(
      'Choose a folder to import as Notes Vault',
      importNotesSrc || dest || undefined,
    );
    if (res && !res.cancelled && res.path) setImportNotesSrc(res.path);
  }, [importNotesSrc, dest]);

  const useDefaultFolder = useCallback(() => {
    if (defaultFolder) setDest(defaultFolder);
  }, [defaultFolder]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed && (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..')) {
      setError('Vault name cannot contain slashes or path traversal.');
      return;
    }
    if (mode === 'openin' && !openinPath.trim()) {
      setError('Pick an Obsidian vault folder to open in place.');
      return;
    }
    if ((mode === 'import' || mode === 'restore') && mode === 'import' && !importNotesSrc.trim()) {
      setError('Pick a folder to import.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.api?.createVaultFromOptions?.({
        mode,
        name: trimmed || undefined,
        destinationParent: mode === 'openin' ? undefined : (dest || undefined),
        openinPath: mode === 'openin' ? openinPath.trim() : undefined,
        importSources:
          mode === 'import' || (mode === 'restore' && importNotesSrc.trim())
            ? [{ kind: 'notes' as const, srcPath: importNotesSrc.trim() }]
            : undefined,
        activate,
      });
      if (!result || !result.ok) {
        setError(`Could not create vault: ${result?.error ?? 'unknown error'}`);
        return;
      }
      setOpen(false);
      await onCreatedRef.current({
        vaultRoot: result.storyVaultPath ?? result.mythosRoot ?? '',
        notesVaultRoot: result.notesVaultPath ?? '',
      });
    } catch (err) {
      setError(`Create failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [name, dest, mode, openinPath, importNotesSrc, activate]);

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
        <VaultCreateModePicker
          kind="mythos"
          value={mode}
          onChange={setMode}
          disabled={busy}
          testIdPrefix="rail-vault-mode"
        />
        <label className="prompt-modal-label" htmlFor="create-vault-name">
          Name
        </label>
        <input
          id="create-vault-name"
          className="prompt-modal-input"
          autoFocus
          aria-label="Name for the new Mythos Vault"
          value={name}
          disabled={busy || mode === 'openin'}
          placeholder={mode === 'openin' ? 'Defaults to Obsidian folder name' : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            else if (e.key === 'Escape') close();
          }}
        />
        {mode === 'openin' ? (
          <>
            <label className="prompt-modal-label">Obsidian vault (in place)</label>
            <div className="create-vault-dest-row">
              <span className="create-vault-dest-path" data-testid="create-vault-openin-path" title={openinPath || undefined}>
                {openinPath || 'Choose Obsidian vault…'}
              </span>
              <button type="button" className="create-vault-browse-btn" onClick={() => void browseOpenin()} disabled={busy}>
                Browse&hellip;
              </button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
        {(mode === 'import' || mode === 'restore') && (
          <>
            <label className="prompt-modal-label">
              {mode === 'restore' ? 'Local snapshot folder (optional)' : 'Import Notes source'}
            </label>
            <div className="create-vault-dest-row">
              <span className="create-vault-dest-path" data-testid="create-vault-import-path" title={importNotesSrc || undefined}>
                {importNotesSrc || (mode === 'restore' ? 'Optional — leave empty for blank restore vault' : 'Choose folder…')}
              </span>
              <button type="button" className="create-vault-browse-btn" onClick={() => void browseImport()} disabled={busy}>
                Browse&hellip;
              </button>
            </div>
          </>
        )}
        {error && <p className="create-vault-error" role="alert">{error}</p>}
      </DialogBody>
      <DialogFooter className="prompt-modal-actions">
        <button type="button" className="prompt-modal-cancel" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="prompt-modal-ok" onClick={() => void submit()} disabled={busy} data-testid="create-vault-submit">
          {busy ? 'Creating…' : mode === 'openin' ? 'Open in Mythos' : 'Create vault'}
        </button>
      </DialogFooter>
    </Dialog>
  );

  return { createVault, createVaultModal };
}
