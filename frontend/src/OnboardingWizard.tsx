import { useState, useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LayoutTemplate, FilePlus2, FolderInput } from 'lucide-react';
import { Button } from './components/ui/Button';
import VaultDestinationPicker from './components/SettingsPanel/sections/VaultDestinationPicker';
// Beta 3 M25 (welcome wizard v2): brand header assets (prototype welcome
// wizard, HTML 4580–4685).
import logoUrl from './assets/logo.png';
import './OnboardingWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

// SKY-11058: sessionStorage flag set by DesktopShell's 'mythos:import-notes-
// vault' listener right before the wizard-replay reload — it survives the
// window.location.reload() and the wizard consumes it (once) on mount to land
// directly on the Import screen.
export const WIZARD_OPEN_IMPORT_STEP_KEY = 'mythos.wizard.openImportStep';

// SKY-11152 (parent spec SKY-11141 §3b): the whole wizard is now exactly 3
// screens — Welcome (pick a mode) → Import (mode='import' only) → Name your
// vault (every mode lands here). Deliberately NOT named 'step2'/'step3' —
// those identifiers belonged to the deleted title/author story-creation form
// and would collide in meaning with the screens below.
type WizardStep = 'welcome' | 'import' | 'name';

// The 3 modes createVaultFromOptions understands (SKY-11151).
type VaultMode = 'template' | 'blank' | 'import';

interface OnboardingWizardProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
  onCancel?: () => void;
  /** @internal Test-only prop: mount the wizard at a specific step */
  _testInitialStep?: WizardStep;
}

// ─── Typed window.api access ──────────────────────────────────────────────────

/** SKY-2993 dry-run summary — carried forward from the pre-rewrite wizard's
 *  Obsidian import (see git history: onboarding:dryRunObsidianImport). */
interface ObsidianImportPreview {
  markdownCount: number;
  attachmentCount: number;
  totalFiles: number;
  topLevelFolders: string[];
  sampleFiles: string[];
}

type Api = {
  chooseVaultFolder: (title?: string, defaultPath?: string) => Promise<{ path: string | null; cancelled: boolean }>;
  vaultGetPaths?: () => Promise<{ homeDir?: string; pathSeparator?: '/' | '\\'; defaultVaultsParentPath?: string }>;
  /** SKY-2993: real (no-write) scan of a source folder — carried forward from
   *  the pre-SKY-11152 wizard so the new Import screen still shows a dry-run
   *  report before committing anything to disk. */
  dryRunObsidianImport: (srcPath: string, targetVaultKind: 'notes' | 'story') => Promise<{ preview?: ObsidianImportPreview; error?: string }>;
  /** SKY-11151: THE shared vault-creation primitive — one surface for first
   *  run, "New Mythos vault…", and Settings "Add vault…" (template/blank/import). */
  createVaultFromOptions: (payload: {
    mode: VaultMode;
    destinationParent?: string;
    name?: string;
    exactName?: boolean;
    defaultTheme?: string;
    importSources?: { kind: 'notes' | 'story'; srcPath: string }[];
    activate?: boolean;
  }) => Promise<{
    ok: boolean;
    mode?: VaultMode;
    mythosRoot?: string;
    storyVaultPath?: string;
    notesVaultPath?: string;
    vaultName?: string;
    importTally?: { imported: number; skipped: number; sourceCount: number; warnings: string[] };
    error?: string;
  }>;
};

function api(): Api {
  return (window as unknown as { api: Api }).api;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mirrors the prototype's `wFullPath` (HTML 9424–9426): strip trailing
 *  separators off the base, infer the separator from whatever's already in
 *  the base path, fall back to 'My Vault' for an empty name. */
function computeFullPath(basePath: string, name: string): string {
  const base = (basePath || '').replace(/[\\/]+$/, '');
  const sep = base.indexOf('/') >= 0 ? '/' : '\\';
  const trimmedName = (name || '').trim() || 'My Vault';
  return base ? `${base}${sep}${trimmedName}` : trimmedName;
}

/** Mirrors the prototype's `wCreateNote` (HTML 9427–9439) for the 3 modes
 *  this build actually supports (template / blank / import). */
function computeCreateNote(mode: VaultMode, notesFilled: boolean, storyFilled: boolean): string {
  if (mode === 'import') {
    const notesPart = notesFilled ? 'an imported Notes Vault' : 'a blank Notes Vault';
    const storyPart = storyFilled ? 'an imported Story Vault' : 'a blank Story Vault';
    return `Contains ${notesPart} and ${storyPart}.`;
  }
  if (mode === 'template') {
    return 'Contains a Notes Vault with the template folders — Characters, Locations, Stories, Plot, Worldbuilding, Research.';
  }
  return 'Starts empty — add a Notes or Story Vault whenever you like.';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Beta 3 M25: prototype wizard progress dots (HTML 4664) — filled up to
 *  `current`. Stays aria-hidden — the adjacent step content already gives
 *  screen readers the equivalent position. */
function WizardDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="wiz-dots" data-testid="wiz-dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`wiz-dot${current >= i + 1 ? ' wiz-dot--on' : ''}`} />
      ))}
    </div>
  );
}

interface StartingPointCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  ctaLabel: string;
  onActivate: () => void;
  testId: string;
  cardRef?: React.RefObject<HTMLButtonElement>;
  /** Beta 3 M25: prototype corner chip (e.g. "RECOMMENDED", HTML 4591). */
  chip?: string;
}

function StartingPointCard({ icon: Icon, title, description, ctaLabel, onActivate, testId, cardRef, chip }: StartingPointCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
  return (
    <button
      ref={cardRef}
      className="gs-card"
      onClick={() => onActivate()}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      aria-label={`${title}: ${description}`}
      type="button"
    >
      {chip && <span className="gs-card__chip" aria-hidden="true">{chip}</span>}
      <span className="gs-card__icon" aria-hidden="true"><Icon size={28} strokeWidth={1.75} /></span>
      <span className="gs-card__title">{title}</span>
      <span className="gs-card__desc">{description}</span>
      {/* Visual affordance only — the whole card is the interactive button,
          so this can't itself be a nested <Button> (invalid HTML, would
          double-fire onActivate). Same .btn classes as the real Button. */}
      <span className="gs-card__cta btn btn--primary btn--sm" aria-hidden="true">{ctaLabel}</span>
    </button>
  );
}

interface ConfirmDialogProps {
  onKeepGoing: () => void;
  onCancelSetup: () => void;
}

function ConfirmDialog({ onKeepGoing, onCancelSetup }: ConfirmDialogProps) {
  return (
    <div
      className="gs-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gs-confirm-title"
      data-testid="gs-cancel-confirm"
    >
      <div className="gs-confirm">
        <h3 className="gs-confirm__title" id="gs-confirm-title">Cancel setup?</h3>
        <p className="gs-confirm__body">
          Your vault hasn&apos;t been created yet.<br />
          If you close now, you&apos;ll start fresh next time.
        </p>
        <div className="gs-confirm__actions">
          <Button
            variant="primary"
            onClick={onKeepGoing}
            data-testid="gs-keep-going"
          >
            Keep Going
          </Button>
          <Button
            variant="destructive"
            onClick={onCancelSetup}
            data-testid="gs-cancel-setup"
          >
            Cancel Setup
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingWizard({ initialSettings, onComplete, onCancel, _testInitialStep }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(_testInitialStep ?? 'welcome');
  const [mode, setMode] = useState<VaultMode | null>(null);

  // SKY-11058: NotesVaultPicker's "Import a vault…" replays the wizard with
  // this flag set — consume it exactly once and land on the (new) Import
  // screen, in import mode.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(WIZARD_OPEN_IMPORT_STEP_KEY)) {
        sessionStorage.removeItem(WIZARD_OPEN_IMPORT_STEP_KEY);
        setMode('import');
        setStep('import');
      }
    } catch { /* sessionStorage unavailable — start on welcome as usual */ }
  }, []);

  // ─── Step 2 (import) state ──────────────────────────────────────────────────
  const [notesPath, setNotesPath] = useState('');
  const [storyPath, setStoryPath] = useState('');
  // SKY-2993/SKY-11152: 'form' is the two browse rows; 'report' is the
  // dry-run (no-write) preview shown before the user commits. Carried
  // forward from the pre-rewrite wizard's Obsidian import — Continue now
  // triggers a real scan instead of jumping straight to the name step.
  const [importPhase, setImportPhase] = useState<'form' | 'report'>('form');
  const [obsDryRun, setObsDryRun] = useState<
    { kind: 'notes' | 'story'; path: string; preview: ObsidianImportPreview }[] | null
  >(null);
  const [obsDryRunError, setObsDryRunError] = useState('');
  const [obsDryRunRunning, setObsDryRunRunning] = useState(false);

  // ─── Step 3 (name) state ────────────────────────────────────────────────────
  const [vaultName, setVaultName] = useState('');
  const [vaultPath, setVaultPath] = useState('');
  const [defaultVaultsParentPath, setDefaultVaultsParentPath] = useState('');

  // SKY-10388-style default prefill: the destination starts at the default
  // vaults parent; the user can still edit/browse it before creating.
  useEffect(() => {
    api().vaultGetPaths?.().then((paths) => {
      if (paths.defaultVaultsParentPath) {
        setDefaultVaultsParentPath(paths.defaultVaultsParentPath);
        setVaultPath((prev) => prev || paths.defaultVaultsParentPath!);
      }
    }).catch(() => { /* non-fatal */ });
  }, []);

  const [creating, setCreating] = useState(false);
  const [scaffoldError, setScaffoldError] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // AC-L-05: first card gets initial focus when the welcome screen mounts.
  const firstCardRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (step === 'welcome') {
      firstCardRef.current?.focus();
    }
  }, [step]);

  // ─── Step 1 (welcome) actions ───────────────────────────────────────────────

  function pickMode(m: VaultMode) {
    setMode(m);
    setScaffoldError('');
    if (m === 'import') {
      setImportPhase('form');
      setObsDryRun(null);
      setObsDryRunError('');
    }
    setStep(m === 'import' ? 'import' : 'name');
  }

  // ─── Step 2 (import) actions ────────────────────────────────────────────────

  async function browseImportPath(slot: 'notes' | 'story') {
    const title = slot === 'notes' ? 'Select an Obsidian or Markdown notes folder' : 'Select an Obsidian or Markdown story folder';
    const picked = await api().chooseVaultFolder(title);
    if (picked.cancelled || !picked.path) return;
    if (slot === 'notes') setNotesPath(picked.path);
    else setStoryPath(picked.path);
  }

  const importHasInput = Boolean(notesPath.trim() || storyPath.trim());

  /** Filled Obsidian slots in a stable order: notes first, then story. */
  function obsidianTargets(): { kind: 'notes' | 'story'; path: string }[] {
    const targets: { kind: 'notes' | 'story'; path: string }[] = [];
    if (notesPath.trim()) targets.push({ kind: 'notes', path: notesPath.trim() });
    if (storyPath.trim()) targets.push({ kind: 'story', path: storyPath.trim() });
    return targets;
  }

  /** SKY-2993: scan each selected folder without writing anything, then show
   *  the dry-run report. On failure, the error stays inline on the form so
   *  the user can retry without re-picking folders (Continue stays enabled). */
  async function runObsidianDryRun() {
    if (obsDryRunRunning) return;
    setObsDryRunError('');
    setObsDryRunRunning(true);
    try {
      const scanned: { kind: 'notes' | 'story'; path: string; preview: ObsidianImportPreview }[] = [];
      for (const target of obsidianTargets()) {
        const res = await api().dryRunObsidianImport(target.path, target.kind);
        if (res.error || !res.preview) {
          setObsDryRunError(res.error ?? 'Could not scan this folder. Check the path and try again.');
          return;
        }
        scanned.push({ ...target, preview: res.preview });
      }
      setObsDryRun(scanned);
      setImportPhase('report');
    } catch (e) {
      setObsDryRunError(e instanceof Error ? e.message : 'Could not scan this folder. Check the path and try again.');
    } finally {
      setObsDryRunRunning(false);
    }
  }

  // ─── Step 3 (name) actions ──────────────────────────────────────────────────

  async function browseVaultPath() {
    const picked = await api().chooseVaultFolder('Choose where to create your vault', vaultPath || undefined);
    if (picked.cancelled || !picked.path) return;
    setVaultPath(picked.path);
  }

  const fullPath = computeFullPath(vaultPath, vaultName);
  const createNote = mode ? computeCreateNote(mode, Boolean(notesPath.trim()), Boolean(storyPath.trim())) : '';

  async function handleFinish() {
    if (!mode) return;
    setScaffoldError('');
    setCreating(true);
    try {
      const importSources = mode === 'import'
        ? [
            ...(notesPath.trim() ? [{ kind: 'notes' as const, srcPath: notesPath.trim() }] : []),
            ...(storyPath.trim() ? [{ kind: 'story' as const, srcPath: storyPath.trim() }] : []),
          ]
        : undefined;
      const res = await api().createVaultFromOptions({
        mode,
        destinationParent: vaultPath.trim() || undefined,
        name: vaultName.trim() || 'My Vault',
        importSources,
        activate: true,
      });
      if (!res.ok) {
        setScaffoldError(res.error ?? 'Something went wrong creating your vault.');
        setCreating(false);
        return;
      }
      // NOTE: createVaultFromOptions doesn't return firstSceneId/firstScenePath
      // (unlike the old onboardingComplete IPC) — a first-run vault created
      // this way just opens to an empty shell, no lastOpenedScene to seed.
      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        onboardingStartMode: mode,
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your vault.');
      setCreating(false);
    }
  }

  function goBackFromName() {
    if (mode === 'import') {
      // The dry-run report is still valid (nothing on disk has changed) —
      // land back on it rather than re-scanning.
      setImportPhase(obsDryRun ? 'report' : 'form');
      setStep('import');
      return;
    }
    setStep('welcome');
  }

  // ─── Keyboard / escape handling ─────────────────────────────────────────────
  // No close (X) affordance anywhere in the new 3-step flow (matches the
  // design's welcome/vault/theme panels, HTML 4580–4685 — none of them render
  // a close button, only Back / dots / Continue). Escape remains the only
  // way to reach the cancel-setup confirmation before a vault is created.

  function handleOverlayKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (creating) return; // close disabled while a vault is being created
    if (showCancelConfirm) {
      setShowCancelConfirm(false);
      return;
    }
    setShowCancelConfirm(true);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="gs-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Getting Started"
      onKeyDown={handleOverlayKeyDown}
      data-testid="gs-overlay"
    >
      {/* Beta 3 M25: prototype brand header (HTML 4584–4586) */}
      <div className="gs-brand" data-testid="gs-brand">
        <img className="gs-brand__logo" src={logoUrl} alt="" />
        <div className="gs-brand__name">Mythos Writer</div>
        <div className="gs-brand__tagline">Write the world before you write the book.</div>
      </div>

      {showCancelConfirm && (
        <ConfirmDialog
          onKeepGoing={() => setShowCancelConfirm(false)}
          onCancelSetup={() => {
            setShowCancelConfirm(false);
            onCancel?.();
          }}
        />
      )}

      {/* ── Step 1: Welcome — pick a starting point ── */}
      {step === 'welcome' && (
        <div className="gs-modal" data-testid="screen-welcome">
          <h1 className="gs-modal__title">Welcome to Mythos Writer</h1>
          <p className="gs-modal__subtitle">How would you like to begin?</p>

          <div className="gs-cards" role="group" aria-label="Choose how to get started">
            <StartingPointCard
              icon={LayoutTemplate}
              title="Start from a template"
              description="A ready structure — empty folders for Characters, Locations, Stories, Plot, Worldbuilding and Research. No notes, just the shape."
              ctaLabel="Use template &#x2192;"
              onActivate={() => pickMode('template')}
              testId="card-template"
              cardRef={firstCardRef}
              chip="RECOMMENDED"
            />
            <StartingPointCard
              icon={FilePlus2}
              title="Start blank"
              description="One empty vault. You build the structure yourself as you go."
              ctaLabel="Choose path &#x2192;"
              onActivate={() => pickMode('blank')}
              testId="card-start-blank"
            />
            <StartingPointCard
              icon={FolderInput}
              title="Import vault"
              description="Point at an existing vault. A dry-run report shows every change before anything is written."
              ctaLabel="Pick folder &#x2192;"
              onActivate={() => pickMode('import')}
              testId="card-import-obsidian"
            />
          </div>
        </div>
      )}

      {/* ── Step 2: Import — what should we import? (mode='import' only) ── */}
      {step === 'import' && importPhase === 'form' && (
        <div className="gs-modal" data-testid="screen-import">
          <h2 className="gs-modal__title">What should we import?</h2>
          <p className="gs-modal__subtitle">
            We create a new Mythos vault and fill it with what you point at. One is enough — leave the other empty and it starts blank.
          </p>

          <div className="wiz-import-row" data-testid="step2-notes-row">
            <div className="wiz-import-row__head">
              <span className="wiz-import-row__label">Import Notes Vault</span>
              <span className="wiz-import-row__tag">{notesPath.trim() ? 'WILL IMPORT' : 'OPTIONAL'}</span>
            </div>
            <VaultDestinationPicker
              variant="onboarding"
              path={notesPath}
              placeholder="Pick an Obsidian, Notion or Markdown folder…"
              onChange={setNotesPath}
              onBrowse={() => browseImportPath('notes')}
              disabled={obsDryRunRunning}
              ariaLabel="Notes vault import folder"
              testIdPrefix="step2-notes"
            />
            {/* SKY-11152 correctness note: the prototype claims Notion support
                too (HTML 9356) — the real importer (importObsidianToVaultDir)
                only does a byte-for-byte Obsidian/Markdown folder copy. */}
            <p className="wiz-import-row__hint">
              Folders, note bodies and [[wiki-links]] come across as-is. Nothing at the source is modified.
            </p>
          </div>

          <div className="wiz-import-row" data-testid="step2-story-row">
            <div className="wiz-import-row__head">
              <span className="wiz-import-row__label">Import Story Vault</span>
              <span className="wiz-import-row__tag">{storyPath.trim() ? 'WILL IMPORT' : 'OPTIONAL'}</span>
            </div>
            <VaultDestinationPicker
              variant="onboarding"
              path={storyPath}
              placeholder="Pick a Scrivener project, .docx or Markdown folder…"
              onChange={setStoryPath}
              onBrowse={() => browseImportPath('story')}
              disabled={obsDryRunRunning}
              ariaLabel="Story vault import folder"
              testIdPrefix="step2-story"
            />
            {/* SKY-11152 correctness note: the prototype claims Scrivener/.docx
                support with headings mapped into chapters (HTML 9360–9361) —
                the real importer does the same plain folder copy as the notes
                row, no manuscript parsing at first run. */}
            <p className="wiz-import-row__hint">
              Folders and files come across as-is — headings aren&apos;t parsed into chapters yet. Nothing at the source is modified.
            </p>
          </div>

          {obsDryRunError && (
            <p className="import-validation import-validation--invalid" role="alert" data-testid="step2-dryrun-error">
              {obsDryRunError}
            </p>
          )}

          <div className="wiz-footer">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => setStep('welcome')}
              disabled={obsDryRunRunning}
              data-testid="step2-back"
            >
              <span aria-hidden="true">&#x2039;</span> Back
            </button>
            <WizardDots total={2} current={1} />
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              disabled={!importHasInput || obsDryRunRunning}
              onClick={() => void runObsidianDryRun()}
              data-testid="step2-continue"
            >
              {obsDryRunRunning ? 'Scanning…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2b: dry-run report (mode='import' only) — SKY-2993, carried
          forward from the pre-rewrite wizard: a no-write scan report the user
          confirms before anything is created. Confirming lands on the shared
          Name-your-vault step, same as every other path — the actual create
          + copy only happens there, through createVaultFromOptions. ── */}
      {step === 'import' && importPhase === 'report' && obsDryRun && (
        <div className="gs-modal" data-testid="screen-import-report">
          <h2 className="gs-modal__title">Ready to import</h2>
          <p className="gs-modal__subtitle">Review what will be imported, then confirm. Nothing is written yet.</p>

          <div data-testid="step2-report">
            {obsDryRun.map((target) => (
              <section
                key={target.kind}
                className="import-section"
                aria-label={target.kind === 'notes' ? 'Notes vault import preview' : 'Story vault import preview'}
                data-testid={`step2-report-${target.kind}`}
              >
                <h3 className="import-section__title">{target.kind === 'notes' ? 'Notes vault' : 'Story vault'}</h3>
                <p className="obs-report__path">{target.path}</p>
                <ul className="obs-report__stats" aria-label="Import summary">
                  <li>{target.preview.markdownCount} markdown {target.preview.markdownCount === 1 ? 'note' : 'notes'}</li>
                  <li>{target.preview.attachmentCount} {target.preview.attachmentCount === 1 ? 'attachment' : 'attachments'}</li>
                  <li>{target.preview.totalFiles} {target.preview.totalFiles === 1 ? 'file' : 'files'} total</li>
                </ul>
                {target.preview.topLevelFolders.length > 0 && (
                  <p className="obs-report__meta">Top-level folders: {target.preview.topLevelFolders.join(', ')}</p>
                )}
              </section>
            ))}
          </div>

          <div className="wiz-footer">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => setImportPhase('form')}
              data-testid="step2-report-back"
            >
              <span aria-hidden="true">&#x2039;</span> Back
            </button>
            <WizardDots total={2} current={1} />
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={() => setStep('name')}
              data-testid="step2-report-confirm"
            >
              Confirm import &#x2192;
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Name your vault — every mode lands here ── */}
      {step === 'name' && mode && (
        <div className="gs-modal" data-testid="screen-name">
          <h2 className="gs-modal__title">Name your vault</h2>
          <p className="gs-modal__subtitle">A Mythos vault is one folder on disk. Plain Markdown inside — yours, portable, no lock-in.</p>

          <div className="gs-form__field">
            <label className="gs-form__label" htmlFor="wiz-vault-name">VAULT NAME</label>
            <input
              id="wiz-vault-name"
              className="gs-form__input"
              type="text"
              value={vaultName}
              placeholder="My Vault"
              onChange={(e) => setVaultName(e.target.value)}
              disabled={creating}
              data-testid="step3-vault-name"
            />
          </div>

          <div className="gs-form__field">
            <div className="wiz-field-header">
              <span className="gs-form__label">CREATE IT IN</span>
              <button
                type="button"
                className="wiz-default-folder-btn"
                title="Use the default vaults folder"
                onClick={() => setVaultPath(defaultVaultsParentPath)}
                disabled={creating || !defaultVaultsParentPath}
                data-testid="step3-path-reset"
              >
                Default folder
              </button>
            </div>
            <VaultDestinationPicker
              variant="onboarding"
              path={vaultPath}
              placeholder="Vault folder location…"
              onChange={setVaultPath}
              onBrowse={browseVaultPath}
              disabled={creating}
              ariaLabel="Vault location"
              testIdPrefix="step3-path"
            />
          </div>

          <div className="wiz-preview-box">
            <div className="wiz-preview-box__label">WILL BE CREATED AT</div>
            <div className="wiz-preview-box__path" data-testid="step3-full-path">{fullPath}</div>
            <div className="wiz-preview-box__note" data-testid="step3-create-note">{createNote}</div>
          </div>

          {scaffoldError && (
            <div className="gs-scaffold-error" data-testid="gs-scaffold-error" role="alert">
              <p className="gs-scaffold-error__msg">{scaffoldError}</p>
            </div>
          )}

          <div className="wiz-footer">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={goBackFromName}
              disabled={creating}
              data-testid="step3-back"
            >
              <span aria-hidden="true">&#x2039;</span> Back
            </button>
            <WizardDots total={mode === 'import' ? 2 : 1} current={mode === 'import' ? 2 : 1} />
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={() => void handleFinish()}
              disabled={creating}
              data-testid="step3-open-vault"
            >
              {creating ? 'Creating…' : 'Open my vault ✦'}
            </button>
          </div>
          {creating && <div className="gs-spinner" aria-label="Creating your vault" role="status" data-testid="gs-spinner" />}
        </div>
      )}
    </div>
  );
}
