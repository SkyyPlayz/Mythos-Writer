// SKY-11152 (parent spec SKY-11141 §3c) — Settings "+ Add Notes Vault" /
// "+ Add Story Vault" dialog. ONE shared component parameterized by `kind`,
// matching the design's "Add a Notes Vault" mockup
// (owner-reports/2026-08-27-add-notes-vault-dialog-mockup.png) and the
// Settings Add-vault Vue data (nvTitle/nvBlurb/nvModes/nvTree, design HTML
// ~8960-9040) — MINUS the stale nvLocs location picker (This PC / Dropbox /
// Custom folder): the ticket explicitly forbids a location picker and any
// Dropbox/cloud wording here. Destination is always computed, never chosen.
//
// Creation goes through window.api.createVaultFromOptions — THE shared
// vault-creation primitive (SKY-11151) also used by the first-run wizard —
// per this ticket's explicit instruction ("+ Add Notes Vault…" dialogs
// *reusing the creation primitive*, AC-OB3-05). destinationParent is
// `<current Mythos vault root>/Notes` or `/Stories`, so each add-vault call
// scaffolds its own nested MythosVault folder under that container rather
// than writing into the primary "Story Vault"/"Notes Vault" pair — the same
// mechanism `New Mythos vault…` uses, just nested one level deeper. There is
// no visible list of these yet (that surface is SKY-11154's job); this
// dialog only has to create successfully and confirm.
import { useEffect, useState } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import VaultDestinationPicker from './VaultDestinationPicker';
import VaultCreateModePicker, { type VaultCreateMode } from './VaultCreateModePicker';
import { showLnToast } from '../../../theme/lnToast';
import './AddVaultDialog.css';

export type AddVaultKind = 'notes' | 'story';

interface Props {
  kind: AddVaultKind;
  open: boolean;
  onClose: () => void;
}

// The template / blank / import option set itself lives in the shared
// VaultCreateModePicker (SKY-11151 primitive UI) — same component Settings
// "New vault…" renders, so the three choices can't drift between surfaces.
type CreateMode = VaultCreateMode;

type DryRunPreview = {
  markdownCount: number;
  attachmentCount: number;
  totalFiles: number;
  topLevelFolders: string[];
  sampleFiles: string[];
};

/** Template-mode still shows a static skeleton; import uses real dry-run (C4). */
const NOTES_PREVIEW_TREE: { label: string; kids: string[] }[] = [
  { label: 'Characters', kids: ['Protagonists', 'Antagonists', 'Supporting'] },
  { label: 'Locations', kids: ['Cities', 'Wilds', 'Interiors'] },
  { label: 'Stories', kids: ['Drafts', 'Outlines'] },
  { label: 'Plot & Story', kids: ['Beats', 'Themes', 'Timelines'] },
  { label: 'Worldbuilding', kids: ['Magic & Rules', 'History', 'Factions'] },
  { label: 'Research', kids: [] },
];

const STORY_PREVIEW_TREE: { label: string; kids: string[] }[] = [
  { label: 'Act I — Setup', kids: ['Chapter 1', 'Chapter 2'] },
  { label: 'Act II — Confrontation', kids: ['Chapter 3', 'Chapter 4', 'Chapter 5'] },
  { label: 'Act III — Resolution', kids: ['Chapter 6', 'Chapter 7'] },
];

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function AddVaultDialog({ kind, open, onClose }: Props) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<CreateMode>('template');
  const [importSrcPath, setImportSrcPath] = useState('');
  const [dryRun, setDryRun] = useState<DryRunPreview | null>(null);
  const [mythosRoot, setMythosRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset on every open (including switching notes<->story while a stray
  // instance lingers) so a prior attempt's state never leaks into the next.
  useEffect(() => {
    if (!open) return;
    setName('');
    setMode('template');
    setImportSrcPath('');
    setDryRun(null);
    setError('');
    setBusy(false);
    window.api?.vaultGetPaths?.().then((paths) => {
      setMythosRoot(paths.mythosRoot ?? null);
    }).catch(() => { /* leave mythosRoot null — submit surfaces the error */ });
  }, [open, kind]);

  if (!open) return null;

  const currentVaultName = mythosRoot ? basenameOf(mythosRoot) : '';
  const kindLabel = kind === 'notes' ? 'Notes' : 'Story';
  const title = `Add a ${kindLabel} Vault`;
  const nameLabel = `${kindLabel.toUpperCase()} VAULT NAME`;
  const subtitle = `A ${kindLabel} Vault inside ${currentVaultName || 'the current Mythos vault'} — ${
    kind === 'notes' ? 'folders, notes and boards.' : 'books, chapters and scenes.'
  }`;
  const submitLabel = kind === 'notes' ? 'Add Notes Vault' : 'Add Story Vault';
  const previewTree = kind === 'notes' ? NOTES_PREVIEW_TREE : STORY_PREVIEW_TREE;
  const previewLabel = kind === 'notes'
    ? 'A NOTES VAULT WITH THESE FOLDERS — EMPTY, READY TO FILL'
    : 'A MANUSCRIPT WITH THIS SPINE — EMPTY, READY TO WRITE';

  async function browseImportSource() {
    setBusy(true);
    setDryRun(null);
    try {
      const res = await window.api?.chooseVaultFolder?.(
        kind === 'notes'
          ? 'Select an Obsidian or Markdown notes folder'
          : 'Select a Scrivener project, Word or Markdown story folder',
      );
      if (res && !res.cancelled && res.path) {
        setImportSrcPath(res.path);
        // C4 — real dry-run before any write; Create stays disabled until report lands.
        const preview = await window.api?.dryRunObsidianImport?.(res.path, kind);
        if (!preview || preview.error || !preview.preview) {
          setError(preview?.error ?? 'Dry-run failed.');
          return;
        }
        setDryRun(preview.preview);
        setError('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (busy) return;
    if (!mythosRoot) {
      setError('Could not determine the current vault — try again once the vault finishes loading.');
      return;
    }
    if (mode === 'import' && !importSrcPath.trim()) {
      setError('Choose a folder to import from.');
      return;
    }
    if (mode === 'import' && !dryRun) {
      setError('Wait for the dry-run report before creating.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // SKY-11154: create through the notes/story REGISTRY (SKY-11058/11150),
      // never through createVaultFromOptions — that primitive always
      // scaffolds a whole new self-contained Mythos vault bundle, which is
      // wrong here and also never writes to notes-vaults.json/
      // story-vaults.json, so the result would not show up in this ticket's
      // Settings columns. Story vaults have no backend 'template' mode — a
      // UI 'template' selection becomes an empty blank story vault.
      const displayName = name.trim() || (kind === 'notes' ? 'Notes' : 'Story');
      const importSourcePath = mode === 'import' ? importSrcPath.trim() : undefined;
      // Inner NV/SV create only supports template|blank|import (Slice D five-path is Mythos-only).
      const notesMode: 'template' | 'blank' | 'import' =
        mode === 'blank' || mode === 'import' || mode === 'template' ? mode : 'template';
      const storyMode: 'blank' | 'import' = mode === 'import' ? 'import' : 'blank';
      if (kind === 'notes') {
        const res = await window.api?.notesVaultRegistryCreate?.({
          mode: notesMode,
          displayName,
          importSourcePath,
        });
        if (!res) throw new Error('Could not create the notes vault.');
        showLnToast(`Notes vault "${res.entry.displayName}" added`);
      } else {
        const res = await window.api?.storyVaultRegistryCreate?.({
          mode: storyMode,
          displayName,
          importSourcePath,
        });
        if (!res) throw new Error('Could not create the story vault.');
        showLnToast(`Story vault "${res.entry.displayName}" added`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the vault. Check the path and try again.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="form"
      aria-labelledby={`avd-title-${kind}`}
      testId={`avd-dialog-${kind}`}
      overlayTestId={`avd-overlay-${kind}`}
    >
      <DialogHeader onClose={onClose}>
        <h2 id={`avd-title-${kind}`} className="avd-title">{title}</h2>
        <p className="avd-subtitle">{subtitle}</p>
      </DialogHeader>
      <DialogBody>
        <div className="avd-field">
          <label className="avd-field-label" htmlFor={`avd-name-${kind}`}>{nameLabel}</label>
          <input
            id={`avd-name-${kind}`}
            className="avd-input"
            type="text"
            value={name}
            placeholder={kind === 'notes' ? 'Notes' : 'Story'}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            data-testid={`avd-name-${kind}`}
          />
        </div>

        <div className="avd-section-label">HOW TO START</div>
        <VaultCreateModePicker
          kind={kind}
          value={mode}
          onChange={setMode}
          disabled={busy}
          testIdPrefix={`avd-mode-${kind}`}
        />

        {mode === 'template' && (
          <div className="avd-preview" data-testid={`avd-preview-${kind}`}>
            <div className="avd-preview__label">{previewLabel}</div>
            <div className="avd-preview__tree">
              {previewTree.map((f) => (
                <div key={f.label} className="avd-preview__folder">
                  <div className="avd-preview__folder-head">
                    <span className="avd-preview__folder-icon" aria-hidden="true">&#128193;</span>
                    <span className="avd-preview__folder-label">{f.label}</span>
                  </div>
                  {f.kids.length > 0 && (
                    <div className="avd-preview__chips">
                      {f.kids.map((k) => <span key={k} className="avd-preview__chip">{k}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div className="avd-import">
            <VaultDestinationPicker
              variant="m24"
              path={importSrcPath}
              placeholder={
                kind === 'notes'
                  ? 'Pick an Obsidian, Notion or Markdown folder…'
                  : 'Pick a Scrivener project, .docx or Markdown folder…'
              }
              onBrowse={browseImportSource}
              disabled={busy}
              testIdPrefix={`avd-import-src-${kind}`}
            />
            <p className="avd-hint">
              Folder structure, note bodies and [[wiki-links]] come across as-is. Nothing is moved or modified at the source.
              A dry-run report appears before anything is written.
            </p>
            {dryRun && (
              <div className="avd-dryrun" data-testid={`avd-dryrun-${kind}`}>
                <div className="avd-preview__label">DRY-RUN — NOTHING WRITTEN YET</div>
                <ul>
                  <li data-testid={`avd-dryrun-md-${kind}`}>{dryRun.markdownCount} markdown</li>
                  <li data-testid={`avd-dryrun-att-${kind}`}>{dryRun.attachmentCount} attachments</li>
                  <li data-testid={`avd-dryrun-total-${kind}`}>{dryRun.totalFiles} total files</li>
                </ul>
                {dryRun.topLevelFolders.length > 0 && (
                  <p data-testid={`avd-dryrun-folders-${kind}`}>Folders: {dryRun.topLevelFolders.join(', ')}</p>
                )}
                {dryRun.sampleFiles.length > 0 && (
                  <p data-testid={`avd-dryrun-samples-${kind}`}>Sample: {dryRun.sampleFiles.slice(0, 5).join(', ')}</p>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'blank' && (
          <div className="avd-blank-hint">
            {kind === 'notes'
              ? 'One empty root folder. Add folders whenever you need them.'
              : 'One empty manuscript. Add your first chapter and scene when you are ready.'}
          </div>
        )}

        {error && (
          <p className="avd-error" role="alert" data-testid={`avd-error-${kind}`}>{error}</p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy} data-testid={`avd-cancel-${kind}`}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={busy || (mode === 'import' && (!importSrcPath.trim() || !dryRun))}
          data-testid={`avd-submit-${kind}`}
        >
          {busy ? 'Adding…' : submitLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
