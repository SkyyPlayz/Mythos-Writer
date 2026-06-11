import { useState, useEffect, useRef } from 'react';
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
  vaultGetPaths?: () => Promise<{ homeDir?: string; pathSeparator?: '/' | '\\' }>;
};

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  story: Array<{ name: string; children?: Array<unknown>; starterNote?: string }>;
  notes: Array<{ name: string; children?: Array<unknown>; starterNote?: string }>;
  isUserTemplate?: boolean;
  savedAt?: string;
}

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
}

function TemplateCard({ template, onSelect, testId }: TemplateCardProps) {
  return (
    <button
      className="gs-template-card"
      onClick={onSelect}
      data-testid={testId}
      type="button"
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

  // Auto-focus title input on step 2
  useEffect(() => {
    if (step === 'step2') {
      titleInputRef.current?.focus();
    }
  }, [step]);

  // Load templates when step1b mounts
  useEffect(() => {
    if (step === 'step1b' && templates.length === 0) {
      api().templateList().then((res) => {
        if ('templates' in res) setTemplates(res.templates);
      }).catch(() => {
        setTemplateLoadError("Bundled templates couldn't be loaded. You can still create a blank story.");
      });
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (step === 'step1' || step === 'step1b' || step === 'step2') {
        setShowCancelConfirm(true);
      }
    }
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
        <div className="gs-modal gs-modal--wide" data-testid="screen-step1b">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => { setStep('step1'); }}
              data-testid="gs-back-step1b"
            >
              &#x2190; Back
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
          <h2 className="gs-modal__title">Choose a template</h2>

          {templateLoadError ? (
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
            <p className="gs-loading">Loading templates&#x2026;</p>
          ) : (
            <>
              <div className="gs-template-grid">
                {templates.filter((t) => !t.isUserTemplate).map((tmpl) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    onSelect={() => goToStep2FromMode('template', tmpl.id)}
                    testId={`template-card-${tmpl.id}`}
                  />
                ))}
              </div>
              {templates.some((t) => t.isUserTemplate) && (
                <>
                  <p className="gs-section-divider">Your Templates</p>
                  <div className="gs-template-grid">
                    {templates.filter((t) => t.isUserTemplate).map((tmpl) => (
                      <TemplateCard
                        key={tmpl.id}
                        template={tmpl}
                        onSelect={() => goToStep2FromMode('template', tmpl.id)}
                        testId={`template-card-${tmpl.id}`}
                      />
                    ))}
                  </div>
                </>
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
              &#x2190; Back
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
