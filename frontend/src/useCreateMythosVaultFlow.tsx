import { useCallback, useEffect, useRef, useState } from 'react';
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

type DryRunPreview = {
  markdownCount: number;
  attachmentCount: number;
  totalFiles: number;
  topLevelFolders: string[];
  sampleFiles: string[];
};

type ImportSlot = 'notes' | 'story';

/**
 * Slice D — "Create a Mythos vault" modal shared by nav-rail "+" and
 * Welcome path handoff. Five-path: Template / Blank / Import / Restore /
 * Open Obsidian vault in Mythos. Uses createVaultFromOptions (not blank-only).
 *
 * Probe C4/C6/C7 — real dryRunObsidianImport before write; Story folder slot;
 * onboardingStartMode; cancel confirm mid-flow.
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
  const [importStorySrc, setImportStorySrc] = useState('');
  const [notesPreview, setNotesPreview] = useState<DryRunPreview | null>(null);
  const [storyPreview, setStoryPreview] = useState<DryRunPreview | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const dirty = Boolean(
    name.trim()
    || openinPath.trim()
    || importNotesSrc.trim()
    || importStorySrc.trim()
    || notesPreview
    || storyPreview,
  );

  const reset = useCallback(() => {
    setName('');
    setError(null);
    setOpeninPath('');
    setImportNotesSrc('');
    setImportStorySrc('');
    setNotesPreview(null);
    setStoryPreview(null);
    setDryRunError(null);
    setCancelConfirm(false);
  }, []);

  const createVault = useCallback((presetMode?: VaultCreateMode) => {
    reset();
    setMode(presetMode ?? 'template');
    setOpen(true);
    window.api?.vaultGetPaths?.().then((paths) => {
      const current = paths?.vaultsParentPath || paths?.defaultVaultsParentPath || '';
      const fallback = paths?.defaultVaultsParentPath || current;
      setDest(current);
      setDefaultFolder(fallback);
    }).catch(() => { /* non-fatal */ });
  }, [reset]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) {
      setCancelConfirm(true);
      return;
    }
    setOpen(false);
  }, [busy, dirty]);

  const confirmClose = useCallback(() => {
    setCancelConfirm(false);
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (cancelConfirm) {
        setCancelConfirm(false);
        return;
      }
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cancelConfirm, requestClose]);

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

  const runDryRun = useCallback(async (slot: ImportSlot, srcPath: string) => {
    setDryRunError(null);
    if (slot === 'notes') setNotesPreview(null);
    else setStoryPreview(null);
    const res = await window.api?.dryRunObsidianImport?.(srcPath, slot);
    if (!res || res.error || !res.preview) {
      setDryRunError(res?.error ?? 'Dry-run failed.');
      return;
    }
    if (slot === 'notes') setNotesPreview(res.preview);
    else setStoryPreview(res.preview);
  }, []);

  const browseImport = useCallback(async (slot: ImportSlot) => {
    const res = await window.api?.chooseVaultFolder?.(
      slot === 'notes'
        ? 'Choose a folder to import as Notes Vault'
        : 'Choose a Story / manuscript folder to import',
      (slot === 'notes' ? importNotesSrc : importStorySrc) || dest || undefined,
    );
    if (!res || res.cancelled || !res.path) return;
    if (slot === 'notes') setImportNotesSrc(res.path);
    else setImportStorySrc(res.path);
    // C4 — dry-run first; nothing written until Create.
    await runDryRun(slot, res.path);
  }, [importNotesSrc, importStorySrc, dest, runDryRun]);

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
    if (mode === 'import' && !importNotesSrc.trim() && !importStorySrc.trim()) {
      setError('Pick a Notes and/or Story folder to import.');
      return;
    }
    if (mode === 'import' && (importNotesSrc.trim() || importStorySrc.trim()) && !notesPreview && !storyPreview) {
      setError('Wait for the dry-run report, or re-pick the import folder.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const importSources: { kind: 'notes' | 'story'; srcPath: string }[] = [];
      if ((mode === 'import' || mode === 'restore') && importNotesSrc.trim()) {
        importSources.push({ kind: 'notes', srcPath: importNotesSrc.trim() });
      }
      if (mode === 'import' && importStorySrc.trim()) {
        importSources.push({ kind: 'story', srcPath: importStorySrc.trim() });
      }
      const result = await window.api?.createVaultFromOptions?.({
        mode,
        name: trimmed || undefined,
        destinationParent: mode === 'openin' ? undefined : (dest || undefined),
        openinPath: mode === 'openin' ? openinPath.trim() : undefined,
        importSources: importSources.length > 0 ? importSources : undefined,
        activate,
      });
      if (!result || !result.ok) {
        setError(`Could not create vault: ${result?.error ?? 'unknown error'}`);
        return;
      }
      // C7 — persist start mode so relaunch / Getting Started match the path.
      // AFTER onCreated/switchToVault: activate:false flush-first can rewrite
      // settings from an open SettingsPanel mount snapshot and would clobber
      // onboardingStartMode if we wrote it before the switch flush.
      const startMode =
        mode === 'template' ? 'template'
          : mode === 'blank' ? 'blank'
            : mode === 'import' || mode === 'restore' ? 'import'
              : mode === 'openin' ? 'open-existing'
                : 'template';
      setOpen(false);
      reset();
      await onCreatedRef.current({
        vaultRoot: result.storyVaultPath ?? result.mythosRoot ?? '',
        notesVaultRoot: result.notesVaultPath ?? '',
      });
      try {
        const cur = await window.api?.settingsGet?.();
        if (cur) {
          await window.api?.settingsSet?.({
            ...cur,
            onboardingComplete: true,
            onboardingStartMode: startMode,
          });
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(`Create failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [name, dest, mode, openinPath, importNotesSrc, importStorySrc, notesPreview, storyPreview, reset, activate]);

  const renderPreview = (label: string, preview: DryRunPreview | null, testId: string) => {
    if (!preview) return null;
    return (
      <div className="create-vault-dryrun" data-testid={testId}>
        <div className="create-vault-dryrun__title">{label}</div>
        <ul className="create-vault-dryrun__counts">
          <li data-testid={`${testId}-md`}>{preview.markdownCount} markdown</li>
          <li data-testid={`${testId}-att`}>{preview.attachmentCount} attachments</li>
          <li data-testid={`${testId}-total`}>{preview.totalFiles} total files</li>
        </ul>
        {preview.topLevelFolders.length > 0 && (
          <div className="create-vault-dryrun__folders" data-testid={`${testId}-folders`}>
            Folders: {preview.topLevelFolders.join(', ')}
          </div>
        )}
        {preview.sampleFiles.length > 0 && (
          <div className="create-vault-dryrun__samples" data-testid={`${testId}-samples`}>
            Sample: {preview.sampleFiles.slice(0, 5).join(', ')}
          </div>
        )}
        <p className="create-vault-dryrun__note">Nothing is written until you confirm Create vault.</p>
      </div>
    );
  };

  const createVaultModal = (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
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
                <button type="button" className="create-vault-browse-btn" onClick={() => void browseImport('notes')} disabled={busy}>
                  Browse&hellip;
                </button>
              </div>
              {mode === 'import' && (
                <>
                  <label className="prompt-modal-label" data-testid="step2-story-row">
                    Import Story folder (optional)
                  </label>
                  <div className="create-vault-dest-row">
                    <span className="create-vault-dest-path" data-testid="create-vault-import-story-path" title={importStorySrc || undefined}>
                      {importStorySrc || 'Choose Story / manuscript folder…'}
                    </span>
                    <button type="button" className="create-vault-browse-btn" onClick={() => void browseImport('story')} disabled={busy}>
                      Browse&hellip;
                    </button>
                  </div>
                </>
              )}
              {renderPreview('Notes dry-run', notesPreview, 'create-vault-dryrun-notes')}
              {renderPreview('Story dry-run', storyPreview, 'create-vault-dryrun-story')}
              {dryRunError && (
                <p className="create-vault-error" role="alert" data-testid="create-vault-dryrun-error">{dryRunError}</p>
              )}
            </>
          )}
          {error && <p className="create-vault-error" role="alert">{error}</p>}
        </DialogBody>
        <DialogFooter className="prompt-modal-actions">
          <button type="button" className="prompt-modal-cancel" onClick={requestClose} disabled={busy} data-testid="create-vault-cancel">
            Cancel
          </button>
          <button type="button" className="prompt-modal-ok" onClick={() => void submit()} disabled={busy} data-testid="create-vault-submit">
            {busy ? 'Creating…' : mode === 'openin' ? 'Open in Mythos' : 'Create vault'}
          </button>
        </DialogFooter>
      </Dialog>

      {cancelConfirm && (
        <Dialog
          open
          onClose={() => setCancelConfirm(false)}
          variant="form"
          aria-label="Discard vault setup?"
          className="create-vault-cancel-confirm"
        >
          <DialogHeader>
            <h2>Discard setup?</h2>
          </DialogHeader>
          <DialogBody>
            <p data-testid="gs-cancel-confirm">
              Leave without creating a vault? Nothing has been written yet.
            </p>
          </DialogBody>
          <DialogFooter className="prompt-modal-actions">
            <button type="button" className="prompt-modal-cancel" onClick={() => setCancelConfirm(false)} data-testid="create-vault-cancel-keep">
              Keep editing
            </button>
            <button type="button" className="prompt-modal-ok" onClick={confirmClose} data-testid="create-vault-cancel-discard">
              Discard
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );

  return { createVault, createVaultModal };
}
