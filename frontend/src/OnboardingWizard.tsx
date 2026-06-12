import { useState, useEffect, useRef, useCallback } from 'react';
import { truncatePath, type TruncatePathOptions } from './utils/truncatePath';
import './OnboardingWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'step1' | 'step1b' | 'step2' | 'step3';
// SKY-906: 'default-mythos-vault' is the one-click first-run path that
// bypasses the title/save-path form entirely.
type StartMode = 'blank' | 'sample' | 'template' | 'default-mythos-vault';

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  story: Array<{ name: string; children?: Array<unknown>; starterNote?: string }>;
  notes: Array<{ name: string; children?: Array<unknown>; starterNote?: string }>;
  isUserTemplate?: boolean;
  savedAt?: string;
}

interface OnboardingWizardProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
  onCancel?: () => void;
}

// ─── Typed window.api access ──────────────────────────────────────────────────

type Api = {
  pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean; registrationToken: string | null; error?: string }>;
  chooseVaultFolder: (title?: string, defaultPath?: string) => Promise<{ path: string | null; cancelled: boolean }>;
  validatePath: (path: string) => Promise<{ exists: boolean; isEmpty: boolean; writable: boolean }>;
  onboardingComplete: (payload?: {
    startMode: 'blank' | 'sample' | 'template' | 'skip' | 'default-mythos-vault';
    storyTitle?: string;
    authorName?: string;
    vaultParentPath?: string;
    templateId?: string;
    vaultName?: string;
  }) => Promise<{ ok: boolean; firstSceneId?: string; firstScenePath?: string; error?: string }>;
  templateList: () => Promise<{ templates: TemplateItem[] }>;
  templateRename: (id: string, name: string) => Promise<{ ok: true } | { error: string }>;
  templateDelete: (id: string) => Promise<{ ok: true } | { error: string }>;
  templateDuplicate: (id: string) => Promise<{ ok: true; id: string } | { error: string }>;
  vaultGetPaths?: () => Promise<{ homeDir?: string; pathSeparator?: '/' | '\\' }>;
};

function api(): Api {
  return (window as unknown as { api: Api }).api;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAVE_PATH = '~/Documents/MythosWriter';
const INVALID_TITLE_RE = /[/\\:*?"<>|]/;
const TITLE_MAX = 120;
const AUTHOR_MAX = 80;

// Exact error copy from spec
const ERR_EMPTY_TITLE = 'Please give your story a title before continuing.';
const ERR_INVALID_CHARS = 'Story titles can\'t contain these characters: / \\ : * ? " < > |';
const ERR_TITLE_EXISTS = (title: string) =>
  `A story called "${title}" already exists in that folder. Choose a different title or save location.`;
const ERR_UNWRITABLE_PATH = 'Can\'t save to that folder. Please choose a different location.';

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StartingPointCardProps {
  icon: string;
  title: string;
  description: string;
  ctaLabel: string;
  onActivate: () => void;
  testId: string;
}

function StartingPointCard({ icon, title, description, ctaLabel, onActivate, testId }: StartingPointCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
  return (
    <button
      className="gs-card"
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      type="button"
    >
      <span className="gs-card__icon" aria-hidden="true">{icon}</span>
      <span className="gs-card__title">{title}</span>
      <span className="gs-card__desc">{description}</span>
      <span className="gs-card__cta" aria-hidden="true">{ctaLabel}</span>
    </button>
  );
}

interface TemplateCardProps {
  template: TemplateItem;
  onSelect: () => void;
  testId: string;
  isChecked: boolean;
  tabIndex: number;
}

function TemplateCard({ template, onSelect, testId, isChecked, tabIndex }: TemplateCardProps) {
  return (
    <button
      role="radio"
      aria-checked={isChecked}
      className="gs-template-card"
      onClick={onSelect}
      data-testid={testId}
      type="button"
      tabIndex={tabIndex}
    >
      {template.isUserTemplate && <span className="gs-template-card__badge">Saved</span>}
      <span className="gs-template-card__name">{template.name}</span>
      <span className="gs-template-card__desc">{template.description}</span>
      <span className="gs-template-card__cta" aria-hidden="true">Use this &#x2192;</span>
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
          Your story hasn&apos;t been created yet.<br />
          If you close now, you&apos;ll start fresh next time.
        </p>
        <div className="gs-confirm__actions">
          <button
            className="btn-primary"
            type="button"
            onClick={onKeepGoing}
            data-testid="gs-keep-going"
          >
            Keep Going
          </button>
          <button
            className="btn-ghost btn-destructive"
            type="button"
            onClick={onCancelSetup}
            data-testid="gs-cancel-setup"
          >
            Cancel Setup
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingWizard({ initialSettings, onComplete, onCancel }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>('step1');
  const [startMode, setStartMode] = useState<StartMode | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateLoadError, setTemplateLoadError] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  // SKY-1399: template management state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Guard: prevents onBlur from calling templateRename a second time after Enter already committed it
  const templateRenamedRef = useRef(false);
  // SKY-1403: export / import toast feedback
  const [templateToast, setTemplateToast] = useState<string | null>(null);
  const templateToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SKY-1405: drag-drop visual feedback state
  const [isDragOver, setIsDragOver] = useState(false);

  // Step 2 form state
  const [storyTitle, setStoryTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [savePath, setSavePath] = useState(DEFAULT_SAVE_PATH);
  const [pathOptions, setPathOptions] = useState<TruncatePathOptions>({});

  useEffect(() => {
    api().vaultGetPaths?.().then((paths) => {
      setPathOptions({ homeDir: paths.homeDir, sep: paths.pathSeparator });
    }).catch(() => { /* non-fatal */ });
  }, []);

  // Error state
  const [titleError, setTitleError] = useState('');
  const [savePathError, setSavePathError] = useState('');
  const [scaffoldError, setScaffoldError] = useState('');

  // UI state
  const [scaffolding, setScaffolding] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const templateCardTriggerRef = useRef<HTMLElement | null>(null);

  // Auto-focus title input on step 2
  useEffect(() => {
    if (step === 'step2') {
      titleInputRef.current?.focus();
    }
  }, [step]);

  // SKY-1397: reload templates every time step1b is shown (not just first visit)
  const reloadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    api().templateList().then((res) => {
      if ('templates' in res) {
        setTemplates(res.templates);
        // Keep selection stable if the selected template still exists
        setSelectedTemplateId((prev) =>
          prev && res.templates.some((t) => t.id === prev) ? prev : null,
        );
      }
    }).catch(() => {
      setTemplateLoadError("Bundled templates couldn't be loaded. You can still create a blank story.");
    }).finally(() => setLoadingTemplates(false));
  }, []);

  // Load templates when step1b mounts
  useEffect(() => {
    if (step === 'step1b') reloadTemplates();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // SKY-1403: show a brief toast message in the template picker
  const showTemplateToast = useCallback((msg: string) => {
    setTemplateToast(msg);
    if (templateToastTimerRef.current) clearTimeout(templateToastTimerRef.current);
    templateToastTimerRef.current = setTimeout(() => setTemplateToast(null), 3000);
  }, []);

  // SKY-1405: drag-drop handlers for .mythostemplate import
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.endsWith('.mythostemplate')) {
      showTemplateToast('Drop a .mythostemplate file to import.');
      return;
    }
    const filePath = (file as File & { path?: string }).path;
    if (!filePath) return;
    const res = await (window.api as any).templateImportFromPath(filePath);
    if (res && 'error' in res) {
      showTemplateToast("This file doesn't appear to be a valid Mythos template.");
    } else if (res && !res.cancelled) {
      reloadTemplates();
      showTemplateToast(`Template imported: ${res.template?.name ?? 'Unknown'}`);
    }
  }, [showTemplateToast, reloadTemplates]);

  // ─── Keyboard helpers ───────────────────────────────────────────────────────

  function handleGridArrowKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const idx = cards.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % cards.length;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   next = (idx - 1 + cards.length) % cards.length;
    if (next !== -1) { e.preventDefault(); cards[next].focus(); }
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  // ─── Validation helpers ─────────────────────────────────────────────────────

  function validateTitle(raw: string): string {
    const t = raw.trim();
    if (!t) return ERR_EMPTY_TITLE;
    if (INVALID_TITLE_RE.test(t)) return ERR_INVALID_CHARS;
    if (t.length > TITLE_MAX) return ERR_INVALID_CHARS;
    return '';
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  function goToStep2FromMode(mode: StartMode, templateId?: string) {
    setStartMode(mode);
    if (templateId) setSelectedTemplateId(templateId);
    setTitleError('');
    setSavePathError('');
    setScaffoldError('');
    setStep('step2');
  }

  function goBackFromStep2() {
    setTitleError('');
    setSavePathError('');
    if (startMode === 'template') {
      setStep('step1b');
    } else {
      setStep('step1');
    }
  }

  // ─── Step 1 actions ─────────────────────────────────────────────────────────

  // SKY-906: one-click default Mythos Vault. Bypasses the title + save-path
  // form entirely — main creates ~/Mythos/Vaults/Mythos Vault/{Story,Notes} Vault,
  // seeds a "My First Story" scene, and persists onboardingComplete.
  // Re-running on a populated parent auto-suffixes ("Mythos Vault 2"), so the
  // button is safe to re-press after a kill-and-relaunch.
  async function handleOneClickDefaultMythosVault() {
    // Tracks the chosen start mode so the existing step3 "Try Again" button
    // retries the same one-click flow instead of falling through to the
    // blank/sample/template path that depends on user-entered title state.
    setStartMode('default-mythos-vault');
    setScaffoldError('');
    setStep('step3');
    setScaffolding(true);
    try {
      const res = await api().onboardingComplete({ startMode: 'default-mythos-vault' });
      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Something went wrong creating your default vault.');
        setScaffolding(false);
        return;
      }
      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your default vault.');
      setScaffolding(false);
    }
  }

  function handleSelectBlank() {
    goToStep2FromMode('blank');
  }

  function handleSelectSample() {
    goToStep2FromMode('sample');
  }

  function handleSelectTemplate() {
    templateCardTriggerRef.current = document.activeElement as HTMLElement;
    setStep('step1b');
  }

  function handleSkip() {
    api().onboardingComplete({ startMode: 'skip' }).catch(() => {});
    const updated: AppSettings = { ...initialSettings, onboardingComplete: true };
    onComplete(updated);
  }

  // ─── Step 2 actions ─────────────────────────────────────────────────────────

  async function handleChangeSaveLocation() {
    try {
      const res = await api().chooseVaultFolder('Choose save location');
      if (!res.cancelled && res.path) {
        setSavePath(res.path);
        setSavePathError('');
      }
    } catch {
      // folder picker cancelled or failed — keep current path
    }
  }

  async function handleCreateStory() {
    const trimmedTitle = storyTitle.trim();
    const err = validateTitle(storyTitle);
    if (err) {
      setTitleError(err);
      titleInputRef.current?.focus();
      return;
    }

    // Check writable path first
    let pathValidation: { exists: boolean; isEmpty: boolean; writable: boolean } | null = null;
    try {
      pathValidation = await api().validatePath(savePath);
    } catch {
      setSavePathError(ERR_UNWRITABLE_PATH);
      return;
    }

    if (pathValidation && !pathValidation.writable) {
      setSavePathError(ERR_UNWRITABLE_PATH);
      return;
    }

    // Check for title conflict — does vaultParentPath/storyTitle/ already exist?
    const storyDir = savePath.replace(/\/+$/, '') + '/' + trimmedTitle;
    try {
      const conflict = await api().validatePath(storyDir);
      if (conflict.exists && !conflict.isEmpty) {
        setTitleError(ERR_TITLE_EXISTS(trimmedTitle));
        titleInputRef.current?.focus();
        return;
      }
    } catch {
      // can't check — allow to proceed; main process will error if conflict
    }

    setTitleError('');
    setSavePathError('');
    setScaffoldError('');
    setStep('step3');
    setScaffolding(true);

    try {
      const res = await api().onboardingComplete({
        startMode: startMode!,
        storyTitle: trimmedTitle,
        authorName: authorName.trim() || undefined,
        vaultParentPath: savePath,
        templateId: selectedTemplateId || undefined,
      });

      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Something went wrong creating your story.');
        setScaffolding(false);
        return;
      }

      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        ...(authorName.trim() ? { authorName: authorName.trim() } : {}),
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your story.');
      setScaffolding(false);
    }
  }

  // Step 3 error recovery
  async function handleTryAgain() {
    setScaffoldError('');
    setScaffolding(true);

    try {
      // SKY-906: the one-click flow never collected a title/save path, so
      // retry must not echo those fields — re-issuing with empty strings
      // would be rejected by the main-side validator.
      const payload = startMode === 'default-mythos-vault'
        ? { startMode: 'default-mythos-vault' as const }
        : {
            startMode: startMode!,
            storyTitle: storyTitle.trim(),
            authorName: authorName.trim() || undefined,
            vaultParentPath: savePath,
            templateId: selectedTemplateId || undefined,
          };
      const res = await api().onboardingComplete(payload);

      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Something went wrong creating your story.');
        setScaffolding(false);
        return;
      }

      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        ...(authorName.trim() ? { authorName: authorName.trim() } : {}),
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your story.');
      setScaffolding(false);
    }
  }

  function handleOpenExistingStory() {
    api().onboardingComplete({ startMode: 'skip' }).catch(() => {});
    const updated: AppSettings = { ...initialSettings, onboardingComplete: true };
    onComplete(updated);
  }

  // ─── Keyboard / escape handling ─────────────────────────────────────────────

  function handleOverlayKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (step === 'step3') return; // close disabled during scaffolding
      if (showCancelConfirm) {
        setShowCancelConfirm(false);
        return;
      }
      // AC-6: first Esc on the template picker clears the selection; a second Esc shows cancel confirm.
      if (step === 'step1b' && selectedTemplateId !== null) {
        setSelectedTemplateId(null);
        return;
      }
      if (step === 'step1' || step === 'step1b' || step === 'step2') {
        setShowCancelConfirm(true);
      }
    }
  }

  const bundledTemplates = templates.filter((t) => !t.isUserTemplate);
  const userTemplates = templates.filter((t) => t.isUserTemplate);
  const hasBundledSelection = bundledTemplates.some((t) => t.id === selectedTemplateId);
  const hasUserSelection = userTemplates.some((t) => t.id === selectedTemplateId);

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
      {/* Confirm dialog */}
      {showCancelConfirm && (
        <ConfirmDialog
          onKeepGoing={() => setShowCancelConfirm(false)}
          onCancelSetup={() => {
            setShowCancelConfirm(false);
            onCancel?.();
          }}
        />
      )}

      {/* SKY-1399: Delete template confirm */}
      {deletingId && (() => {
        const tmpl = templates.find((t) => t.id === deletingId);
        return (
          <div
            className="gs-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gs-template-delete-title"
            data-testid="template-delete-confirm-dialog"
          >
            <div className="gs-confirm">
              <h3 className="gs-confirm__title" id="gs-template-delete-title">Delete template?</h3>
              <p className="gs-confirm__body">
                &ldquo;{tmpl?.name ?? 'This template'}&rdquo; will be permanently removed. This cannot be undone.
              </p>
              <div className="gs-confirm__actions">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => setDeletingId(null)}
                  data-testid="template-delete-cancel"
                >
                  Keep it
                </button>
                <button
                  className="btn-ghost btn-destructive"
                  type="button"
                  data-testid="template-delete-confirm"
                  onClick={async () => {
                    await api().templateDelete(deletingId);
                    if (selectedTemplateId === deletingId) setSelectedTemplateId(null);
                    setDeletingId(null);
                    reloadTemplates();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Step 1: Choose your starting point ── */}
      {step === 'step1' && (
        <div className="gs-modal" data-testid="screen-step1">
          <div className="gs-modal__header">
            <span className="gs-step-label">Step 1 of 3</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step1"
            >
              &#x2715;
            </button>
          </div>
          <h1 className="gs-modal__title">Welcome to Mythos Writer</h1>
          <p className="gs-modal__subtitle">How would you like to begin?</p>

          <div className="gs-cards" role="group" aria-label="Choose how to get started">
            <StartingPointCard
              icon="&#x2728;"
              title="Create default Mythos Vault"
              description="One click — we'll create your Mythos Vault with the standard Notes + Story Vault layout under your home folder. No path picker."
              ctaLabel="Create vault &#x2192;"
              onActivate={handleOneClickDefaultMythosVault}
              testId="card-default-mythos-vault"
            />
            <StartingPointCard
              icon="&#x2726;"
              title="Blank Story"
              description="Start with a clean slate. One empty scene, ready for your words."
              ctaLabel="Start &#x2192;"
              onActivate={handleSelectBlank}
              testId="card-blank"
            />
            <StartingPointCard
              icon="&#x1F4D6;"
              title="Sample Novel"
              description="Explore a pre-loaded demo project to see Mythos Writer in action."
              ctaLabel="Load &#x2192;"
              onActivate={handleSelectSample}
              testId="card-sample"
            />
            <StartingPointCard
              icon="&#x1F5C2;"
              title="From Template"
              description="Choose a structure: 3-act novel, short story, worldbuilding bible&#x2026;"
              ctaLabel="Browse &#x2192;"
              onActivate={handleSelectTemplate}
              testId="card-template"
            />
          </div>

          <button
            className="gs-skip-link"
            type="button"
            onClick={handleSkip}
            data-testid="gs-skip"
          >
            Skip &#x2014; open empty workspace
          </button>
        </div>
      )}

      {/* ── Step 1b: Template sub-picker ── */}
      {step === 'step1b' && (
        <div
          className={`gs-modal gs-modal--wide${isDragOver ? ' gs-modal--drag-over' : ''}`}
          data-testid="screen-step1b"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => {
                setStep('step1');
                requestAnimationFrame(() => {
                  // React unmounts/remounts step1 on each transition, so the captured
                  // element ref is stale. Look up the fresh element by data-testid.
                  const trigger = templateCardTriggerRef.current;
                  if (!trigger) return;
                  const testId = trigger.dataset['testid'];
                  const el = testId
                    ? (document.querySelector(`[data-testid="${testId}"]`) as HTMLElement)
                    : null;
                  (el ?? trigger).focus();
                });
              }}
              data-testid="gs-back-step1b"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Step 1 of 3</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step1b"
            >
              &#x2715;
            </button>
          </div>
          <h2 id="template-picker-heading" className="gs-modal__title">Choose a template</h2>

          {/* sr-only live region — announces selection to screen readers (F-13) */}
          <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="template-announcement">
            {selectedTemplate ? `Preview for ${selectedTemplate.name} is ready below.` : ''}
          </p>

          {loadingTemplates ? (
            <p className="gs-loading" role="status" aria-live="polite">Loading templates&#x2026;</p>
          ) : templateLoadError ? (
            <div className="gs-template-load-error" role="alert" data-testid="template-load-error">
              <p>{templateLoadError}</p>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => goToStep2FromMode('blank')}
                data-testid="template-error-blank-cta"
              >
                Create blank story
              </button>
            </div>
          ) : templates.length === 0 ? (
            <p className="gs-loading" role="status" aria-live="polite">
              No templates available. You can start blank or import a vault instead.
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-labelledby="template-picker-heading" className="gs-template-grid" onKeyDown={handleGridArrowKeys}>
                {bundledTemplates.map((tmpl, i) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    onSelect={() => setSelectedTemplateId(tmpl.id)}
                    testId={`template-card-${tmpl.id}`}
                    isChecked={selectedTemplateId === tmpl.id}
                    tabIndex={selectedTemplateId === tmpl.id || (!hasBundledSelection && i === 0) ? 0 : -1}
                  />
                ))}
              </div>
              <>
                <p id="template-picker-user-heading" className="gs-section-divider" data-testid="user-templates-heading">
                  Your Templates
                  {userTemplates.length > 0 && (
                    <span className="gs-section-divider__count" data-testid="user-template-count">
                      {' '}({userTemplates.length})
                    </span>
                  )}
                </p>
                {userTemplates.length > 0 ? (
                  <div role="radiogroup" aria-labelledby="template-picker-user-heading" className="gs-template-grid" onKeyDown={handleGridArrowKeys}>
                    {userTemplates.map((tmpl, i) => (
                      <div
                        key={tmpl.id}
                        role="radio"
                        tabIndex={selectedTemplateId === tmpl.id || (!hasUserSelection && i === 0) ? 0 : -1}
                        className={`gs-template-card gs-template-card--user${selectedTemplateId === tmpl.id ? ' gs-template-card--selected' : ''}`}
                        onClick={() => { if (renamingId !== tmpl.id) setSelectedTemplateId(tmpl.id); }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && renamingId !== tmpl.id) {
                            e.preventDefault();
                            setSelectedTemplateId(tmpl.id);
                          }
                        }}
                        aria-checked={selectedTemplateId === tmpl.id}
                        data-testid={`template-card-${tmpl.id}`}
                      >
                        {renamingId === tmpl.id ? (
                          <input
                            autoFocus
                            className="gs-template-card__rename-input"
                            value={renameValue}
                            maxLength={80}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Escape') { setRenamingId(null); return; }
                              if (e.key === 'Enter') {
                                const v = renameValue.trim();
                                if (!v) { setRenamingId(null); return; }
                                templateRenamedRef.current = true;
                                await api().templateRename(tmpl.id, v);
                                setRenamingId(null);
                                reloadTemplates();
                              }
                            }}
                            onBlur={async () => {
                              if (templateRenamedRef.current) { templateRenamedRef.current = false; return; }
                              const v = renameValue.trim();
                              if (v && v !== tmpl.name) await api().templateRename(tmpl.id, v);
                              setRenamingId(null);
                              reloadTemplates();
                            }}
                            data-testid={`template-rename-input-${tmpl.id}`}
                            aria-label={`Rename template ${tmpl.name}`}
                          />
                        ) : (
                          <span className="gs-template-card__name">{tmpl.name}</span>
                        )}
                        <span className="gs-template-card__desc">{tmpl.description}</span>
                        <div className="gs-template-card__actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="gs-template-card__action-btn"
                            title="Rename"
                            aria-label={`Rename ${tmpl.name}`}
                            data-testid={`template-rename-btn-${tmpl.id}`}
                            onClick={() => { setRenamingId(tmpl.id); setRenameValue(tmpl.name); }}
                          >&#x270E;</button>
                          <button
                            type="button"
                            className="gs-template-card__action-btn"
                            title="Export"
                            aria-label={`Export ${tmpl.name}`}
                            data-testid={`template-export-btn-${tmpl.id}`}
                            onClick={async () => {
                              const res = await (window.api as any).templateExport(tmpl.id);
                              if (res && 'error' in res) {
                                showTemplateToast(res.error);
                              } else if (res && !res.cancelled) {
                                showTemplateToast(`Exported "${tmpl.name}"`);
                              }
                            }}
                          >&#x2B07;</button>
                          <button
                            type="button"
                            className="gs-template-card__action-btn"
                            title="Duplicate"
                            aria-label={`Duplicate ${tmpl.name}`}
                            data-testid={`template-duplicate-btn-${tmpl.id}`}
                            onClick={async () => {
                              await api().templateDuplicate(tmpl.id);
                              reloadTemplates();
                            }}
                          >&#x29C9;</button>
                          <button
                            type="button"
                            className="gs-template-card__action-btn gs-template-card__action-btn--destructive"
                            title="Delete"
                            aria-label={`Delete ${tmpl.name}`}
                            data-testid={`template-delete-btn-${tmpl.id}`}
                            onClick={() => setDeletingId(tmpl.id)}
                          >&#x1F5D1;</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="gs-template-empty-hint" data-testid="template-empty-hint">
                      No saved templates yet.
                    </p>
                    <p className="gs-template-empty-hint-sub" data-testid="template-empty-hint-sub">
                      Save your vault structure from Settings &rarr; Templates after you create a story.
                    </p>
                  </>
                )}
                <div className="gs-template-import-row">
                  <button
                    type="button"
                    className="btn-secondary gs-template-import-btn"
                    data-testid="template-import-btn"
                    onClick={async () => {
                      const res = await (window.api as any).templateImport();
                      if (res && 'error' in res) {
                        showTemplateToast("This file doesn't appear to be a valid Mythos template.");
                      } else if (res && !res.cancelled) {
                        reloadTemplates();
                        showTemplateToast(`Template imported: ${res.template?.name ?? 'Unknown'}`);
                      }
                    }}
                  >
                    &#x2B06; Import template
                  </button>
                </div>
                {templateToast && (
                  <p
                    className="gs-template-toast"
                    role="status"
                    aria-live="polite"
                    data-testid="template-toast"
                  >
                    {templateToast}
                  </p>
                )}
                <div className="gs-template-import-row">
                  <button
                    type="button"
                    className="btn-secondary gs-template-import-btn"
                    data-testid="template-import-btn"
                    onClick={async () => {
                      const res = await (window.api as any).templateImport();
                      if (res && 'error' in res) {
                        showTemplateToast("This file doesn't appear to be a valid Mythos template.");
                      } else if (res && !res.cancelled) {
                        reloadTemplates();
                        showTemplateToast(`Template imported: ${res.template?.name ?? 'Unknown'}`);
                      }
                    }}
                  >
                    &#x2B06; Import template
                  </button>
                </div>
                {templateToast && (
                  <p
                    className="gs-template-toast"
                    role="status"
                    aria-live="polite"
                    data-testid="template-toast"
                  >
                    {templateToast}
                  </p>
                )}
              </>

              {selectedTemplate && (
                <div className="template-preview" data-testid="template-preview">
                  <p className="template-preview__desc">{selectedTemplate.description}</p>
                  <button
                    className="btn-primary template-preview__cta"
                    type="button"
                    data-testid="template-use-btn"
                    onClick={() => goToStep2FromMode('template', selectedTemplate.id)}
                  >
                    Use this template &#x2192;
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step 2: Name your story ── */}
      {step === 'step2' && (
        <div className="gs-modal" data-testid="screen-step2">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={goBackFromStep2}
              data-testid="gs-back-step2"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Step 2 of 3</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step2"
            >
              &#x2715;
            </button>
          </div>
          <h2 className="gs-modal__title">What&apos;s your story called?</h2>

          <div className="gs-form">
            {/* Story title */}
            <div className="gs-form__field">
              <label className="gs-form__label" htmlFor="gs-story-title">
                Story title <span aria-hidden="true">*</span>
              </label>
              <input
                id="gs-story-title"
                ref={titleInputRef}
                className={`gs-form__input${titleError ? ' gs-form__input--error' : ''}`}
                type="text"
                value={storyTitle}
                maxLength={TITLE_MAX}
                placeholder='e.g., "The Iron Garden"'
                aria-required="true"
                aria-describedby={titleError ? 'gs-title-error' : undefined}
                onChange={(e) => { setStoryTitle(e.target.value); setTitleError(''); }}
                onBlur={() => setTitleError(validateTitle(storyTitle))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateStory(); }}
                data-testid="gs-title-input"
              />
              {titleError && (
                <p className="gs-form__error" id="gs-title-error" role="alert" data-testid="gs-title-error">
                  {titleError}
                </p>
              )}
            </div>

            {/* Author name */}
            <div className="gs-form__field">
              <label className="gs-form__label" htmlFor="gs-author-name">
                Author name <span className="gs-form__label--optional">(optional)</span>
              </label>
              <input
                id="gs-author-name"
                className="gs-form__input"
                type="text"
                value={authorName}
                maxLength={AUTHOR_MAX}
                placeholder='e.g., "Alex Rivera"'
                onChange={(e) => setAuthorName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateStory(); }}
                data-testid="gs-author-input"
              />
            </div>

            {/* Save location */}
            <div className="gs-form__field">
              <label className="gs-form__label">Save location</label>
              <div className="gs-save-location">
                <span
                  className={`gs-save-location__path${savePathError ? ' gs-save-location__path--error' : ''}`}
                  title={savePath}
                  data-testid="gs-save-path"
                >
                  {truncatePath(savePath, 52, pathOptions)}
                </span>
                <button
                  className="btn-secondary gs-save-location__change"
                  type="button"
                  onClick={handleChangeSaveLocation}
                  data-testid="gs-change-location"
                >
                  Change&#x2026;
                </button>
              </div>
              {savePathError ? (
                <p className="gs-form__error" role="alert" data-testid="gs-path-error">{savePathError}</p>
              ) : (
                <p className="gs-form__hint">
                  Your story files will be created here. You can move them later from File &gt; Move Story.
                </p>
              )}
            </div>
          </div>

          <div className="gs-actions">
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={handleCreateStory}
              data-testid="gs-create-story"
            >
              Create Story &#x2192;
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Creating your story ── */}
      {step === 'step3' && (
        <div className="gs-modal" data-testid="screen-step3">
          {scaffolding && !scaffoldError ? (
            <>
              <h2 className="gs-modal__title">Setting up your story&#x2026;</h2>
              <div className="gs-spinner" aria-label="Creating story" role="status" data-testid="gs-spinner" />
              <p className="gs-modal__subtitle">Creating your folders and first scene&#x2026;</p>
            </>
          ) : scaffoldError ? (
            <div className="gs-scaffold-error" data-testid="gs-scaffold-error">
              <p className="gs-scaffold-error__msg">Something went wrong creating your story.</p>
              {scaffoldError && scaffoldError !== 'Something went wrong creating your story.' && (
                <p className="gs-scaffold-error__detail">{scaffoldError}</p>
              )}
              <div className="gs-actions gs-actions--center">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={handleTryAgain}
                  data-testid="gs-try-again"
                >
                  Try Again
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={handleOpenExistingStory}
                  data-testid="gs-open-existing"
                >
                  Open Existing Story
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
