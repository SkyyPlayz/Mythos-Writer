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
import { showLnToast } from '../../../theme/lnToast';
import './AddVaultDialog.css';

export type AddVaultKind = 'notes' | 'story';

interface Props {
  kind: AddVaultKind;
  open: boolean;
  onClose: () => void;
}

type CreateMode = 'template' | 'blank' | 'import';

interface ModeOption {
  key: CreateMode;
  label: string;
  desc: string;
  recommended?: boolean;
}

// Copy pulled verbatim from the design's nvModes (HTML ~8977-8989).
const MODES: Record<AddVaultKind, ModeOption[]> = {
  notes: [
    {
      key: 'template',
      label: 'From template',
      desc: 'A ready structure — empty folders for Characters, Locations, Stories, Plot, Worldbuilding and Research. No notes, just the shape.',
      recommended: true,
    },
    { key: 'blank', label: 'Start blank', desc: 'One empty folder. You build the structure yourself as you go.' },
    {
      key: 'import',
      label: 'Import existing',
      desc: 'Bring in an Obsidian or Notion vault, or a plain Markdown folder — folders, notes and wiki-links preserved.',
    },
  ],
  story: [
    {
      key: 'template',
      label: 'From template',
      desc: 'Three acts with placeholder chapters — a spine you can rename and reorder as the story finds its shape.',
      recommended: true,
    },
    { key: 'blank', label: 'Start blank', desc: 'One empty manuscript. Add your first chapter and scene when you are ready.' },
    {
      key: 'import',
      label: 'Import existing',
      desc: 'Bring in a Scrivener project, Word manuscript or Markdown folder — chapters and scenes preserved.',
    },
  ],
};

// Preview-only copy, matching the design's nvTemplateTree()/nvTree (HTML
// 6224-6233, 9000-9004). Informational: createVaultFromOptions' `template`
// mode (SKY-11151 TEMPLATE_NOTES_SKELETON) really does create these six
// top-level Notes folders, but it does not seed the per-folder example tag
// chips shown here (Protagonists/Antagonists/... etc), and there is no
// backend support yet for a Story-side Act I/II/III chapter spine — both are
// descriptive "what this will look like" previews, same as the design intends
// (a still-empty vault, "ready to fill"/"ready to write"). A follow-up ticket
// owns actually seeding either.
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
  const [mythosRoot, setMythosRoot] = useState<string | null>(null);
  const [pathSep, setPathSep] = useState<'/' | '\\'>('/');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset on every open (including switching notes<->story while a stray
  // instance lingers) so a prior attempt's state never leaks into the next.
  useEffect(() => {
    if (!open) return;
    setName('');
    setMode('template');
    setImportSrcPath('');
    setError('');
    setBusy(false);
    window.api?.vaultGetPaths?.().then((paths) => {
      setMythosRoot(paths.mythosRoot ?? null);
      if (paths.pathSeparator) setPathSep(paths.pathSeparator);
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
    const res = await window.api?.chooseVaultFolder?.(
      kind === 'notes'
        ? 'Select an Obsidian or Markdown notes folder'
        : 'Select a Scrivener project, Word or Markdown story folder',
    );
    if (res && !res.cancelled && res.path) setImportSrcPath(res.path);
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
    setBusy(true);
    setError('');
    try {
      const destinationParent =
        `${mythosRoot.replace(/[\\/]+$/, '')}${pathSep}${kind === 'notes' ? 'Notes' : 'Stories'}`;
      const res = await window.api.createVaultFromOptions({
        mode,
        destinationParent,
        name: name.trim() || (kind === 'notes' ? 'Notes' : 'Story'),
        importSources: mode === 'import' ? [{ kind, srcPath: importSrcPath.trim() }] : undefined,
        activate: false,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not create the vault. Check the name and try again.');
        setBusy(false);
        return;
      }
      showLnToast(`${kindLabel} vault "${res.vaultName ?? name.trim()}" added`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the vault.');
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
        <div className="avd-modes" role="radiogroup" aria-label="How to start">
          {MODES[kind].map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              className={`avd-mode${mode === m.key ? ' avd-mode--on' : ''}`}
              onClick={() => setMode(m.key)}
              disabled={busy}
              data-testid={`avd-mode-${kind}-${m.key}`}
            >
              <span className="avd-mode__head">
                <span className="avd-mode__dot" aria-hidden="true" />
                <span className="avd-mode__label">{m.label}</span>
                {m.recommended && <span className="avd-mode__tag">RECOMMENDED</span>}
              </span>
              <span className="avd-mode__desc">{m.desc}</span>
            </button>
          ))}
        </div>

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
            </p>
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
          disabled={busy || (mode === 'import' && !importSrcPath.trim())}
          data-testid={`avd-submit-${kind}`}
        >
          {busy ? 'Adding…' : submitLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
