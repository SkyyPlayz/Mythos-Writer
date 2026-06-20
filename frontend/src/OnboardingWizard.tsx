import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type TruncatePathOptions } from './utils/truncatePath';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import { Button } from './components/ui/Button';
import './OnboardingWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

// SKY-2988: custom-location + custom-template are the v0.3 Custom Setup 2-screen path
// SKY-2990: step-import is the 3-section Import/Open picker screen
type WizardStep = 'step1' | 'step1b' | 'step1b-inner' | 'step1c' | 'step2' | 'step3' | 'custom-location' | 'custom-template' | 'step-import';
// SKY-2220: 'quick-start' is the one-click first-run path that bypasses the
// title/save-path form entirely. 'default-mythos-vault' is kept as a legacy
// backend alias during the onboarding v2.1 transition.
// SKY-2007: 'open-existing' opens a pre-existing Mythos vault parent dir.
type StartMode = 'blank' | 'sample' | 'template' | 'quick-start' | 'default-mythos-vault' | 'open-existing';

// SKY-2007: 7 inline validation states for the save-location path field.
type PathValidationState =
  | 'idle'             // no input yet / cleared
  | 'validating'       // debounce pending or IPC in-flight
  | 'valid'            // writable, no conflicts
  | 'new-path'         // path doesn't exist yet but parent is writable
  | 'not-writable'     // path exists but not writable
  | 'conflict-mythos'  // Story Vault/manifest.json found at this parent
  | 'path-too-long'    // > 200 chars on Windows
  | 'error';           // IPC threw or other failure

type SystemPaths = {
  homeDir: string;
  documentsDir: string;
  desktopDir: string;
  oneDriveDir: string | null;
  iCloudDir: string | null;
  suggestedSaveLocations?: string[];
};

// SKY-2008: genre IDs for the step1c sample picker
type SampleGenreId = 'cozy-fantasy' | 'sci-fi-noir' | 'mystery';

interface GenreOption {
  id: SampleGenreId;
  emoji: string;
  title: string;
  description: string;
  /** Displayed inside the "What's Inside" accordion */
  contents: string;
}

const GENRE_OPTIONS: GenreOption[] = [
  {
    id: 'cozy-fantasy',
    emoji: '🏰',
    title: 'The Hearthstone Witch',
    description: 'Whimsical magic in small towns and forests. Perfect for intimate stories of discovery.',
    contents:
      'Story Vault/\n└── The Hearthstone Witch\n    ├── Manuscript/ (3 chapters, 8 scenes)\n    └── (Outline, Synopsis sketched)\n\nNotes Vault/\n└── Universes/\n    ├── Characters/ (12 entries)\n    └── Systems/ (1 magic system)',
  },
  {
    id: 'sci-fi-noir',
    emoji: '🌃',
    title: 'Neon Rust',
    description: 'Neon-soaked cyberpunk. Dangerous, gritty, and chrome enough to cut yourself. For the rebels.',
    contents:
      'Story Vault/\n└── Neon Rust\n    ├── Manuscript/ (4 chapters, 10 scenes)\n    └── (Outline, Synopsis sketched)\n\nNotes Vault/\n└── Universes/\n    ├── Characters/ (6 entries)\n    └── Factions/ (1 faction map)',
  },
  {
    id: 'mystery',
    emoji: '🔍',
    title: 'The Last Wednesday Club',
    description: 'Secrets, clues, and code-breakers. A classic whodunit framework ready for your twists.',
    contents:
      'Story Vault/\n└── The Last Wednesday Club\n    ├── Manuscript/ (2 chapters, 6 scenes)\n    └── (Outline, Timeline sketched)\n\nNotes Vault/\n└── Universes/\n    ├── Characters/ (5 suspects)\n    └── Research/ (1 timeline)',
  },
];

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
  /** @internal Test-only prop: mount the wizard at a specific step */
  _testInitialStep?: WizardStep;
}

// ─── Typed window.api access ──────────────────────────────────────────────────

type Api = {
  pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean; registrationToken: string | null; error?: string }>;
  chooseVaultFolder: (title?: string, defaultPath?: string) => Promise<{ path: string | null; cancelled: boolean }>;
  validatePath: (path: string) => Promise<{ exists: boolean; isEmpty: boolean; writable: boolean }>;
  onboardingComplete: (payload?: {
    startMode: 'blank' | 'sample' | 'template' | 'skip' | 'quick-start' | 'default-mythos-vault' | 'open-existing';
    storyTitle?: string;
    authorName?: string;
    vaultParentPath?: string;
    templateId?: string;
    vaultName?: string;
    /** SKY-2008: genre selected on step1c; required for startMode=sample */
    sampleGenre?: SampleGenreId;
    /** template variant for custom/blank vault setup */
    customTemplate?: 'recommended' | 'blank';
  }) => Promise<{ ok: boolean; firstSceneId?: string; firstScenePath?: string; error?: string }>;
  templateList: () => Promise<{ templates: TemplateItem[] }>;
  templateRename: (id: string, name: string) => Promise<{ ok: true } | { error: string }>;
  templateDelete: (id: string) => Promise<{ ok: true } | { error: string }>;
  templateDuplicate: (id: string) => Promise<{ ok: true; id: string } | { error: string }>;
  vaultGetPaths?: () => Promise<{ homeDir?: string; pathSeparator?: '/' | '\\' }>;
  /** SKY-2005: returns OS-level directory paths for suggested vault locations. */
  vaultGetSystemPaths?: () => Promise<SystemPaths>;
  settingsSet?: (settings: AppSettings) => Promise<{ saved: boolean; error?: string }>;
  importDocxToStoryVault?: (filePaths: string[]) => Promise<{
    ok: boolean;
    importedStories: Array<{ filePath: string; storyId: string; storyTitle: string; sceneCount: number; firstScenePath?: string; firstSceneId?: string; warnings: string[] }>;
    errors: Array<{ filePath: string; error: string }>;
  }>;
};

function api(): Api {
  return (window as unknown as { api: Api }).api;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAVE_PATH = '~/Documents/MythosWriter';

// SKY-2988: extract last path segment as a vault display name
function deriveVaultName(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return last === '~' ? '' : last;
}
const INVALID_TITLE_RE = /[/\\:*?"<>|]/;
const TITLE_MAX = 120;
const AUTHOR_MAX = 80;

// Exact error copy from spec
const ERR_EMPTY_TITLE = 'Please give your story a title before continuing.';
const ERR_INVALID_CHARS = 'Story titles can\'t contain these characters: / \\ : * ? " < > |';
const ERR_TITLE_EXISTS = (title: string) =>
  `A story called "${title}" already exists in that folder. Choose a different title or save location.`;
const ERR_UNWRITABLE_PATH = 'Can\'t save to that folder. Please choose a different location.';

// ─── Vault picker helpers (SKY-2007) ─────────────────────────────────────────

/** Substitute the home directory prefix with ~ for cleaner display. */
function tildeify(absPath: string, homeDir?: string): string {
  if (!homeDir || !absPath.startsWith(homeDir)) return absPath;
  return '~' + absPath.slice(homeDir.length);
}

/** Build up to 3 suggested save-location paths from OS paths, deduping against recents. */
function buildSuggestedLocations(
  sys: SystemPaths,
  sep: '/' | '\\',
  recents: readonly string[],
): string[] {
  const candidates: string[] = [];
  if (sep === '\\') {
    // Windows
    candidates.push(`${sys.documentsDir}${sep}MythosWriter`);
    candidates.push(`${sys.desktopDir}${sep}MythosWriter`);
    if (sys.oneDriveDir) candidates.push(`${sys.oneDriveDir}${sep}MythosWriter`);
  } else if (sys.iCloudDir) {
    // macOS (iCloud present)
    candidates.push(`${sys.documentsDir}${sep}MythosWriter`);
    candidates.push(`${sys.desktopDir}${sep}MythosWriter`);
    candidates.push(`${sys.iCloudDir}${sep}MythosWriter`);
  } else {
    // Linux
    candidates.push(`${sys.documentsDir}${sep}MythosWriter`);
    candidates.push(`${sys.homeDir}${sep}MythosWriter`);
  }
  const recentSet = new Set(recents.map((r) => r.trim()));
  return candidates.filter((c) => !recentSet.has(c.trim())).slice(0, 3);
}

// ─── ConflictDialog (SKY-2007 §3.3.4) ────────────────────────────────────────

interface ConflictDialogProps {
  savePath: string;
  onOpenExisting: () => void;
  onNewFolder: () => void;
  onCreateAlongside: (newPath: string) => void;
  onDismiss: () => void;
}

function ConflictDialog({ savePath, onOpenExisting, onNewFolder, onCreateAlongside, onDismiss }: ConflictDialogProps) {
  // Strip trailing number suffix so re-clicking "create alongside" increments cleanly
  const base = savePath.replace(/\s+\d+$/, '');
  const alongsidePath = `${base} 2`;

  return (
    <div
      className="gs-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gs-conflict-title"
      data-testid="gs-conflict-dialog"
    >
      <div className="gs-confirm">
        <h3 className="gs-confirm__title" id="gs-conflict-title">Vault already exists here</h3>
        <p className="gs-confirm__body">
          A Mythos vault already exists at this location. Choose how to proceed:
        </p>
        <div className="gs-conflict-actions">
          <button
            className="btn-secondary gs-conflict-actions__btn"
            type="button"
            onClick={onOpenExisting}
            data-testid="gs-conflict-open-existing"
          >
            Open existing vault
          </button>
          <button
            className="btn-secondary gs-conflict-actions__btn"
            type="button"
            onClick={onNewFolder}
            data-testid="gs-conflict-new-folder"
          >
            Choose a different folder
          </button>
          <button
            className="btn-secondary gs-conflict-actions__btn"
            type="button"
            onClick={() => onCreateAlongside(alongsidePath)}
            data-testid="gs-conflict-create-alongside"
          >
            Create alongside <span className="gs-conflict-alongside-path">({alongsidePath.split(/[/\\]/).pop()})</span>
          </button>
        </div>
        <button
          className="btn-ghost"
          type="button"
          onClick={onDismiss}
          data-testid="gs-conflict-dismiss"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StartingPointCardProps {
  icon: string;
  title: string;
  description: string;
  ctaLabel: string;
  onActivate: () => void;
  testId: string;
  isSecondary?: boolean;
  cardRef?: React.RefObject<HTMLButtonElement>;
}

function StartingPointCard({ icon, title, description, ctaLabel, onActivate, testId, isSecondary, cardRef }: StartingPointCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
  return (
    <button
      ref={cardRef}
      className={`gs-card${isSecondary ? ' gs-card--secondary' : ''}`}
      onClick={() => onActivate()}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      aria-label={`${title}: ${description}`}
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

// ─── GenreCard (step1c) ──────────────────────────────────────────────────────

interface GenreCardProps {
  genre: GenreOption;
  isSelected: boolean;
  isAccordionOpen: boolean;
  tabIndex: number;
  onSelect: () => void;
  onToggleAccordion: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

function GenreCard({ genre, isSelected, isAccordionOpen, tabIndex, onSelect, onToggleAccordion }: GenreCardProps) {
  const panelId = `gp-panel-${genre.id}`;
  const accordionBtnId = `gp-accordion-btn-${genre.id}`;

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  function handleAccordionKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleAccordion(e);
    }
    if (e.key === 'Escape' && isAccordionOpen) {
      e.stopPropagation();
      onToggleAccordion(e);
    }
  }

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      className="gp-card"
      onClick={onSelect}
      onKeyDown={handleCardKeyDown}
      tabIndex={tabIndex}
      data-testid={`genre-card-${genre.id}`}
    >
      <div className="gp-card-header">
        <span className="gp-card-emoji" aria-hidden="true">{genre.emoji}</span>
        <span className="gp-card-title">{genre.title}</span>
        <span className="gp-radio" aria-hidden="true" />
      </div>
      <p className="gp-card-description">{genre.description}</p>
      <button
        id={accordionBtnId}
        type="button"
        className="gp-card-accordion"
        aria-expanded={isAccordionOpen}
        aria-controls={panelId}
        onClick={(e) => { e.stopPropagation(); onToggleAccordion(e); }}
        onKeyDown={(e) => { e.stopPropagation(); handleAccordionKeyDown(e); }}
        data-testid={`genre-accordion-btn-${genre.id}`}
      >
        <span className={`gp-card-accordion-icon${isAccordionOpen ? ' gp-card-accordion-icon--open' : ''}`} aria-hidden="true">▼</span>
        {isAccordionOpen ? 'Hide contents' : 'What\'s inside ›'}
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={accordionBtnId}
        aria-hidden={!isAccordionOpen}
        className="gp-card-accordion-panel"
        data-testid={`genre-accordion-panel-${genre.id}`}
      >
        <div className="gp-card-accordion-inner">
          <pre>{genre.contents}</pre>
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingWizard({ initialSettings, onComplete, onCancel, _testInitialStep }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(_testInitialStep ?? 'step1');
  const [startMode, setStartMode] = useState<StartMode | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // SKY-2008: step1c genre picker state
  const [selectedSampleGenre, setSelectedSampleGenre] = useState<SampleGenreId | null>(null);
  const [openAccordionGenre, setOpenAccordionGenre] = useState<SampleGenreId | null>(null);
  const [sampleError, setSampleError] = useState('');
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
  const { toast: templateToastState, showToast: showTemplateToast } = useToast(3000);
  // SKY-1405: drag-drop visual feedback state
  const [isDragOver, setIsDragOver] = useState(false);

  // Step 2 form state
  const [storyTitle, setStoryTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [savePath, setSavePath] = useState(DEFAULT_SAVE_PATH);
  const [pathOptions, setPathOptions] = useState<TruncatePathOptions>({});

  useEffect(() => {
    api().vaultGetPaths?.().then((paths) => {
      const opts = { homeDir: paths.homeDir, sep: paths.pathSeparator };
      // Update the ref immediately so async handlers see the latest homeDir
      // before the next render flushes (pathOptionsRef.current = pathOptions runs on render).
      pathOptionsRef.current = opts;
      setPathOptions(opts);
    }).catch(() => { /* non-fatal */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Error state
  const [titleError, setTitleError] = useState('');
  const [savePathError, setSavePathError] = useState('');
  const [scaffoldError, setScaffoldError] = useState('');

  // UI state
  const [scaffolding, setScaffolding] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showMigrationDialog, setShowMigrationDialog] = useState(
    Boolean(initialSettings.legacyVaultDetected && !initialSettings.legacyVaultDismissed),
  );

  // SKY-2007: vault picker polish state
  const [pathValidationState, setPathValidationState] = useState<PathValidationState>('idle');
  const [pathValidationMsg, setPathValidationMsg] = useState('');
  const [systemPaths, setSystemPaths] = useState<SystemPaths | null>(null);
  const [showRecents, setShowRecents] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // ─── SKY-2988: Custom Setup v0.3 state ─────────────────────────────────────
  const [customVaultPath, setCustomVaultPath] = useState(DEFAULT_SAVE_PATH);
  const [customVaultName, setCustomVaultName] = useState(() => deriveVaultName(DEFAULT_SAVE_PATH));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- pending SKY-2988 custom-setup JSX
  const [, setCustomPathValidation] = useState<PathValidationState>('idle');
  const [, setCustomPathMsg] = useState('');
  const [fromCustomSetup] = useState(false);
  const customPathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const vaultNameManuallyEditedRef = useRef(false);

  // ─── SKY-2990: Import / Open screen state ──────────────────────────────────
  const [importMwPath, setImportMwPath] = useState('');
  const [importMwValidation, setImportMwValidation] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [importMwMsg, setImportMwMsg] = useState('');
  const [importObsNotesPath, setImportObsNotesPath] = useState('');
  const [importObsStoryPath, setImportObsStoryPath] = useState('');
  const [importDocxFiles, setImportDocxFiles] = useState<File[]>([]);
  const [importRunning, setImportRunning] = useState(false);
  const [importErrorModal, setImportErrorModal] = useState<{ title: string; message: string } | null>(null);
  const docxFileInputRef = useRef<HTMLInputElement>(null);
  const importMwDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultNameManuallyEditedRef = useRef(false);

  // ─── SKY-2990: Import / Open screen state ──────────────────────────────────
  const [importMwPath, setImportMwPath] = useState('');
  const [importMwValidation, setImportMwValidation] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [importMwMsg, setImportMwMsg] = useState('');
  const [importObsNotesPath, setImportObsNotesPath] = useState('');
  const [importObsStoryPath, setImportObsStoryPath] = useState('');
  const [importDocxFiles, setImportDocxFiles] = useState<File[]>([]);
  const [importRunning, setImportRunning] = useState(false);
  const [importErrorModal, setImportErrorModal] = useState<{ title: string; message: string } | null>(null);
  const docxFileInputRef = useRef<HTMLInputElement>(null);
  const importMwDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SKY-2007: load system path suggestions when the save-location step opens
  // SKY-2988: also load for the Custom Setup location picker
  useEffect(() => {
    if (step !== 'step2' && step !== 'custom-location') return;
    api().vaultGetSystemPaths?.().then((sys) => {
      setSystemPaths(sys);
    }).catch(() => { /* non-fatal — suggestions stay hidden */ });
  }, [step]);

  // SKY-2007: derive up to 3 suggested paths, deduped against recents
  const suggestedLocations = useMemo<string[]>(() => {
    if (!systemPaths) return [];
    const sep = (pathOptions.sep as '/' | '\\') ?? '/';
    const recents = initialSettings.recentVaultParentPaths ?? [];
    return buildSuggestedLocations(systemPaths, sep, recents);
  }, [systemPaths, pathOptions.sep, initialSettings.recentVaultParentPaths]);

  // Always-fresh ref so async handlers see the latest pathOptions without closure staleness
  const pathOptionsRef = useRef(pathOptions);
  pathOptionsRef.current = pathOptions;

  const titleInputRef = useRef<HTMLInputElement>(null);
  const templateCardTriggerRef = useRef<HTMLElement | null>(null);

  // ─── SKY-2988: Custom Setup path validators ─────────────────────────────────

  const validateCustomPathNow = useCallback(async (rawPath: string) => {
    const opts = pathOptionsRef.current;
    const expanded = rawPath.startsWith('~/')
      ? (opts.homeDir ?? '') + rawPath.slice(1)
      : rawPath.startsWith('~\\')
      ? (opts.homeDir ?? '') + rawPath.slice(1)
      : rawPath;

    setCustomPathValidation('validating');
    setCustomPathMsg('');
    try {
      const sep = opts.sep ?? '/';
      const [base, mythosCheck] = await Promise.all([
        api().validatePath(expanded),
        api().validatePath(`${expanded}${sep}Story Vault${sep}manifest.json`),
      ]);

      if (!base.writable) {
        setCustomPathValidation('not-writable');
        setCustomPathMsg('This location is not writable. Choose a different folder.');
        return;
      }
      if (mythosCheck.exists) {
        setCustomPathValidation('conflict-mythos');
        setCustomPathMsg('A Mythos vault already exists here.');
        return;
      }
      setCustomPathValidation(base.exists ? 'valid' : 'new-path');
      setCustomPathMsg('');
    } catch {
      setCustomPathValidation('error');
      setCustomPathMsg('Could not validate this path. Check the folder and try again.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- wired in pending custom-setup JSX
  const handleCustomPathChange = useCallback((value: string) => {
    setCustomVaultPath(value);
    if (!vaultNameManuallyEditedRef.current) {
      setCustomVaultName(deriveVaultName(value));
    }

    if (customPathDebounceRef.current) clearTimeout(customPathDebounceRef.current);

    const isWindows = pathOptionsRef.current.sep === '\\';
    if (isWindows && value.length > 200) {
      setCustomPathValidation('path-too-long');
      setCustomPathMsg('Path must be 200 characters or fewer on Windows.');
      return;
    }

    if (!value.trim()) {
      setCustomPathValidation('idle');
      setCustomPathMsg('');
      return;
    }

    setCustomPathValidation('validating');
    customPathDebounceRef.current = setTimeout(() => {
      validateCustomPathNow(value);
    }, 500);
  }, [validateCustomPathNow]);

  function handleCustomUsePath(path: string) {
    const display = tildeify(path, pathOptionsRef.current.homeDir);
    setCustomVaultPath(display);
    if (!vaultNameManuallyEditedRef.current) {
      setCustomVaultName(deriveVaultName(display));
    }
    validateCustomPathNow(path);
  }

  async function handleCustomBrowse() {
    try {
      const res = await api().chooseVaultFolder('Choose vault location');
      if (!res.cancelled && res.path) {
        const display = tildeify(res.path, pathOptionsRef.current.homeDir);
        setCustomVaultPath(display);
        if (!vaultNameManuallyEditedRef.current) {
          setCustomVaultName(deriveVaultName(display));
        }
        validateCustomPathNow(res.path);
      }
    } catch { /* picker cancelled or failed */ }
  }

  function handleCustomNext() {
    if (customVaultName.trim() === '') {
      customVaultNameInputRef.current?.focus();
      return;
    }
    if (customPathValidation !== 'valid' && customPathValidation !== 'new-path') return;
    setStep('custom-template');
  }

  async function handleCustomFinish() {
    setScaffoldError('');
    setFromCustomSetup(true);
    setStartMode('blank');
    setStep('step3');
    setScaffolding(true);
    try {
      const expanded = customVaultPath.startsWith('~/')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath.startsWith('~\\')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath;
      // SKY-2988: BE-1 (SKY-2991) will differentiate 'recommended' from 'blank'.
      // Until it lands, both use startMode:'blank' at the chosen path.
      const res = await api().onboardingComplete({
        startMode: 'blank',
        vaultParentPath: expanded,
        vaultName: customVaultName.trim() || deriveVaultName(expanded),
      });
      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Something went wrong creating your vault.');
        setScaffolding(false);
        return;
      }
      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        onboardingStartMode: 'blank',
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your vault.');
      setScaffolding(false);
    }
  }


  async function handleCustomFinish() {
    setScaffoldError('');
    setFromCustomSetup(true);
    setStartMode('blank');
    setStep('step3');
    setScaffolding(true);
    try {
      const expanded = customVaultPath.startsWith('~/')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath.startsWith('~\\')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath;
      const res = await api().onboardingComplete({
        startMode: 'blank',
        customTemplate,
        vaultParentPath: expanded,
        vaultName: customVaultName.trim() || deriveVaultName(expanded),
      });
      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Something went wrong creating your vault.');
        setScaffolding(false);
        return;
      }
      const updated: AppSettings = {
        ...initialSettings,
        onboardingComplete: true,
        onboardingStartMode: 'blank',
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : 'Something went wrong creating your vault.');
      setScaffolding(false);
    }
  }


  // AC-L-05: first card gets initial focus when step1 mounts or returns
  const quickStartRef = useRef<HTMLButtonElement>(null);

  // AC-L-05: auto-focus first card when landing screen mounts or returns
  useEffect(() => {
    if (step === 'step1') {
      quickStartRef.current?.focus();
    }
  }, [step]);

  // Auto-focus title input on step 2
  useEffect(() => {
    if (step === 'step2') {
      titleInputRef.current?.focus();
    }
    // SKY-2988: auto-focus path input on custom-location screen
    if (step === 'custom-location') {
      customPathInputRef.current?.focus();
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

  // Load templates when the template gallery mounts
  useEffect(() => {
    if (step === 'step1b-inner') reloadTemplates();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const res = await window.api.templateImportFromPath(filePath);
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
      setStep('step1b-inner');
    } else {
      setStep('step1b');
    }
  }

  function handleGenreToggleAccordion(genreId: SampleGenreId) {
    setOpenAccordionGenre((prev) => prev === genreId ? null : genreId);
  }

  function handleGenreArrowKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const idx = cards.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % cards.length;
    if (e.key === 'ArrowUp')   next = (idx - 1 + cards.length) % cards.length;
    if (next !== -1) { e.preventDefault(); cards[next].focus(); }
  }

  // ─── Step 1 actions ─────────────────────────────────────────────────────────

  function handleCreateCustom() {
    setStartMode(null);
    setSelectedTemplateId(null);
    setSelectedSampleGenre(null);
    setOpenAccordionGenre(null);
    setSampleError('');
    setScaffoldError('');
    setStep('step1b');
  }

  async function handleOpenExistingVault(vaultPath?: string) {
    setStartMode('open-existing');
    setScaffoldError('');
    try {
      const picked = vaultPath?.trim()
        ? { cancelled: false, path: vaultPath.trim() }
        : await api().chooseVaultFolder('Open existing Mythos vault');
      if (picked.cancelled || !picked.path) return;
      setStep('step3');
      setScaffolding(true);
      const res = await api().onboardingComplete({ startMode: 'open-existing', vaultParentPath: picked.path });
      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? "This folder doesn't look like a Mythos Writer vault…");
        setScaffolding(false);
        return;
      }
      const updated: AppSettings = {
        ...initialSettings,
        ...(typeof initialSettings.rightSidebarVisible !== 'boolean' ? { rightSidebarVisible: true } : {}),
        gettingStartedProgress: initialSettings.gettingStartedProgress ?? { completedItems: [], dismissed: false },
        onboardingComplete: true,
        onboardingStartMode: 'open-existing',
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : "This folder doesn't look like a Mythos Writer vault…");
      setScaffolding(false);
    }
  }

  // ─── SKY-2990: Import / Open screen handlers ────────────────────────────────

  function resetImportState() {
    setImportMwPath('');
    setImportMwValidation('idle');
    setImportMwMsg('');
    setImportObsNotesPath('');
    setImportObsStoryPath('');
    setImportDocxFiles([]);
    setImportErrorModal(null);
    if (importMwDebounceRef.current) clearTimeout(importMwDebounceRef.current);
  }

  async function validateImportMwPath(raw: string) {
    try {
      const result = await api().validatePath(raw);
      if (!result.exists) {
        setImportMwValidation('invalid');
        setImportMwMsg('Folder not found.');
      } else if (!result.writable) {
        setImportMwValidation('invalid');
        setImportMwMsg('Folder is not accessible.');
      } else {
        setImportMwValidation('valid');
        setImportMwMsg('Folder looks good.');
      }
    } catch {
      setImportMwValidation('invalid');
      setImportMwMsg('Could not check this path.');
    }
  }

  function handleImportMwPathChange(value: string) {
    setImportMwPath(value);
    if (!value.trim()) {
      setImportMwValidation('idle');
      setImportMwMsg('');
      return;
    }
    setImportMwValidation('validating');
    setImportMwMsg('Checking…');
    if (importMwDebounceRef.current) clearTimeout(importMwDebounceRef.current);
    importMwDebounceRef.current = setTimeout(() => { void validateImportMwPath(value); }, 400);
  }

  async function handleImportMwBrowse() {
    const picked = await api().chooseVaultFolder('Open existing Mythos vault');
    if (picked.cancelled || !picked.path) return;
    setImportMwPath(picked.path);
    void validateImportMwPath(picked.path);
  }

  async function handleImportObsBrowse(slot: 'notes' | 'story') {
    const title = slot === 'notes' ? 'Select Obsidian notes folder' : 'Select Obsidian story folder';
    const picked = await api().chooseVaultFolder(title);
    if (picked.cancelled || !picked.path) return;
    if (slot === 'notes') setImportObsNotesPath(picked.path);
    else setImportObsStoryPath(picked.path);
  }

  function handleDocxFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setImportDocxFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...files.filter((f) => !existing.has(f.name))];
    });
    e.target.value = '';
  }

  function handleRemoveDocxFile(index: number) {
    setImportDocxFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleImportOrOpen() {
    setImportRunning(true);
    try {
      if (importMwPath.trim()) {
        const res = await api().onboardingComplete({ startMode: 'open-existing', vaultParentPath: importMwPath.trim() });
        if (!res.ok || res.error) {
          setImportErrorModal({
            title: "Can't open vault",
            message: res.error ?? "This folder doesn't look like a Mythos Writer vault. Check the path and try again.",
          });
          return;
        }
        const updated: AppSettings = {
          ...initialSettings,
          onboardingComplete: true,
          onboardingStartMode: 'open-existing',
          ...(res.firstSceneId && res.firstScenePath
            ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
            : {}),
        };
        onComplete(updated);
        return;
      }
      if (importObsNotesPath || importObsStoryPath) {
        setImportErrorModal({
          title: 'Obsidian import coming soon',
          message: 'Full Obsidian vault import is on the way. Stay tuned for updates!',
        });
        return;
      }
      if (importDocxFiles.length > 0) {
        const filePaths = importDocxFiles.map((f) => (f as File & { path?: string }).path ?? f.name);
        const res = await api().importDocxToStoryVault?.(filePaths);
        if (!res || !res.ok || res.errors?.length) {
          const detail = res?.errors?.map((e) => `${e.filePath}: ${e.error}`).join('\n') ?? '';
          setImportErrorModal({
            title: 'Import failed',
            message: detail || 'Some files could not be imported.',
          });
          return;
        }
        onComplete({ ...initialSettings, onboardingComplete: true });
        return;
      }
    } catch (e) {
      setImportErrorModal({
        title: 'Something went wrong',
        message: e instanceof Error ? e.message : 'An unexpected error occurred.',
      });
    } finally {
      setImportRunning(false);
    }
  }


  function handleSelectBlank() {
    goToStep2FromMode('blank');
  }

  function handleSelectSample() {
    // SKY-2008: go to genre picker (step1c) instead of form (step2)
    setStartMode('sample');
    setSampleError('');
    setSelectedSampleGenre(null);
    setOpenAccordionGenre(null);
    setStep('step1c');
  }

  async function handleStartSample() {
    if (!selectedSampleGenre) return;
    setScaffoldError('');
    setSampleError('');
    setStep('step3');
    setScaffolding(true);
    try {
      const res = await api().onboardingComplete({ startMode: 'sample', sampleGenre: selectedSampleGenre });
      if (!res.ok || res.error) {
        setScaffoldError(res.error ?? 'Sample content couldn\'t be loaded. Try starting blank instead.');
        setScaffolding(false);
        setStep('step1c');
        setSampleError(res.error ?? 'Sample content couldn\'t be loaded. Try starting blank instead.');
        return;
      }
      const updated: AppSettings = {
        ...initialSettings,
        ...(typeof initialSettings.rightSidebarVisible !== 'boolean' ? { rightSidebarVisible: true } : {}),
        gettingStartedProgress: initialSettings.gettingStartedProgress ?? { completedItems: [], dismissed: false },
        onboardingComplete: true,
        onboardingStartMode: 'sample',
        ...(res.firstSceneId && res.firstScenePath
          ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
          : {}),
      };
      onComplete(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sample content couldn\'t be loaded. Try starting blank instead.';
      setScaffoldError(msg);
      setScaffolding(false);
      setStep('step1c');
      setSampleError(msg);
    }
  }

  function handleSelectTemplate() {
    templateCardTriggerRef.current = document.activeElement as HTMLElement;
    setStep('step1b-inner');
  }

  // ─── Step 2 actions ─────────────────────────────────────────────────────────

  // SKY-2007: validate a fully-resolved path via IPC and set pathValidationState
  const validatePathNow = useCallback(async (rawPath: string) => {
    const opts = pathOptionsRef.current;
    const expanded = rawPath.startsWith('~/')
      ? (opts.homeDir ?? '') + rawPath.slice(1)
      : rawPath.startsWith('~\\')
      ? (opts.homeDir ?? '') + rawPath.slice(1)
      : rawPath;

    setPathValidationState('validating');
    setPathValidationMsg('');
    try {
      // Check for an existing Mythos vault. Obsidian import is deferred and is no longer surfaced here.
      const sep = opts.sep ?? '/';
      const [base, mythosCheck] = await Promise.all([
        api().validatePath(expanded),
        api().validatePath(`${expanded}${sep}Story Vault${sep}manifest.json`),
      ]);

      if (!base.writable) {
        setPathValidationState('not-writable');
        setPathValidationMsg('This location is not writable. Choose a different folder.');
        return;
      }
      if (mythosCheck.exists) {
        setPathValidationState('conflict-mythos');
        setPathValidationMsg('A Mythos vault already exists here.');
        return;
      }
      if (base.exists && !base.isEmpty) {
        setPathValidationState('new-path');
        setPathValidationMsg('');
      } else if (!base.exists) {
        setPathValidationState('new-path');
        setPathValidationMsg('');
      } else {
        setPathValidationState('valid');
        setPathValidationMsg('');
      }
    } catch {
      setPathValidationState('error');
      setPathValidationMsg('Could not validate this path. Check the folder and try again.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SKY-2007: debounced path change handler — synchronous path-too-long check, then debounce IPC
  const handleSavePathChange = useCallback((value: string) => {
    setSavePath(value);
    setSavePathError('');
    if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current);

    // Windows path-too-long: synchronous, no IPC needed
    const isWindows = pathOptionsRef.current.sep === '\\';
    if (isWindows && value.length > 200) {
      setPathValidationState('path-too-long');
      setPathValidationMsg('Path must be 200 characters or fewer on Windows.');
      return;
    }

    if (!value.trim()) {
      setPathValidationState('idle');
      setPathValidationMsg('');
      return;
    }

    setPathValidationState('validating');
    pathDebounceRef.current = setTimeout(() => {
      validatePathNow(value);
    }, 500);
  }, [validatePathNow]); // pathOptionsRef.current.sep is always fresh via the ref

  // SKY-2007: fill input from a suggestion or recent, then immediately validate
  function handleUsePath(path: string) {
    const display = tildeify(path, pathOptionsRef.current.homeDir);
    setSavePath(display);
    setSavePathError('');
    setShowRecents(false);
    validatePathNow(path);
  }

  async function handleChangeSaveLocation() {
    try {
      const res = await api().chooseVaultFolder('Choose save location');
      if (!res.cancelled && res.path) {
        const display = tildeify(res.path, pathOptionsRef.current.homeDir);
        setSavePath(display);
        setSavePathError('');
        validatePathNow(res.path);
      }
    } catch {
      // folder picker cancelled or failed — keep current path
    }
  }

  // SKY-2007: conflict dialog actions
  function handleConflictOpenExisting() {
    const expanded = savePath.startsWith('~')
      ? (pathOptionsRef.current.homeDir ?? '') + savePath.slice(1)
      : savePath;
    setShowConflictDialog(false);
    setScaffoldError('');
    setStep('step3');
    setScaffolding(true);
    api().onboardingComplete({ startMode: 'open-existing', vaultParentPath: expanded })
      .then((res) => {
        if (!res.ok || res.error) {
          setScaffoldError(res.error ?? 'Could not open this vault.');
          setScaffolding(false);
          return;
        }
        const updated: AppSettings = {
          ...initialSettings,
          ...(typeof initialSettings.rightSidebarVisible !== 'boolean' ? { rightSidebarVisible: true } : {}),
          gettingStartedProgress: initialSettings.gettingStartedProgress ?? { completedItems: [], dismissed: false },
          onboardingComplete: true,
          onboardingStartMode: 'open-existing',
          ...(res.firstSceneId && res.firstScenePath
            ? { lastOpenedScene: { sceneId: res.firstSceneId, scenePath: res.firstScenePath, scrollTop: 0, cursorLine: 0 } }
            : {}),
        };
        onComplete(updated);
      })
      .catch((e) => {
        setScaffoldError(e instanceof Error ? e.message : 'Could not open this vault.');
        setScaffolding(false);
      });
  }

  function handleConflictNewFolder() {
    setShowConflictDialog(false);
    setTimeout(() => pathInputRef.current?.focus(), 50);
  }

  function handleConflictCreateAlongside(newPath: string) {
    setShowConflictDialog(false);
    const display = tildeify(newPath, pathOptionsRef.current.homeDir);
    setSavePath(display);
    setSavePathError('');
    validatePathNow(newPath);
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
    const sep = pathOptionsRef.current.sep ?? '/';
    const storyDir = savePath.replace(sep === '\\' ? /\\+$/ : /\/+$/, '') + sep + trimmedTitle;
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
        ...(typeof initialSettings.rightSidebarVisible !== 'boolean' ? { rightSidebarVisible: true } : {}),
        gettingStartedProgress: initialSettings.gettingStartedProgress ?? { completedItems: [], dismissed: false },
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
      // SKY-2008: sample mode also skips the form — pass sampleGenre instead.
      // SKY-2007: open-existing uses the saved path directly.
      const expanded = savePath.startsWith('~')
        ? (pathOptionsRef.current.homeDir ?? '') + savePath.slice(1)
        : savePath;
      const customExpanded = customVaultPath.startsWith('~/')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath.startsWith('~\\')
        ? (pathOptionsRef.current.homeDir ?? '') + customVaultPath.slice(1)
        : customVaultPath;
      const payload = fromCustomSetup
        ? {
            startMode: 'blank' as const,
            customTemplate,
            vaultParentPath: customExpanded,
            vaultName: customVaultName.trim() || deriveVaultName(customExpanded),
          }
        : startMode === 'quick-start' || startMode === 'default-mythos-vault'
        ? { startMode: 'quick-start' as const }
        : startMode === 'sample'
        ? { startMode: 'sample' as const, sampleGenre: selectedSampleGenre ?? undefined }
        : startMode === 'open-existing'
        ? { startMode: 'open-existing' as const, vaultParentPath: expanded }
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
        ...(typeof initialSettings.rightSidebarVisible !== 'boolean' ? { rightSidebarVisible: true } : {}),
        gettingStartedProgress: initialSettings.gettingStartedProgress ?? { completedItems: [], dismissed: false },
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
      if (showConflictDialog) {
        setShowConflictDialog(false);
        return;
      }
      if (showCancelConfirm) {
        setShowCancelConfirm(false);
        return;
      }
      // AC-6: first Esc on the template picker clears the selection; a second Esc shows cancel confirm.
      if (step === 'step1b-inner' && selectedTemplateId !== null) {
        setSelectedTemplateId(null);
        return;
      }
      if (step === 'step1' || step === 'step1b' || step === 'step1b-inner' || step === 'step1c' || step === 'step2' || step === 'custom-location' || step === 'custom-template' || step === 'step-import') {
        setShowCancelConfirm(true);
      }
    }
  }

  const bundledTemplates = templates.filter((t) => !t.isUserTemplate);
  const userTemplates = templates.filter((t) => t.isUserTemplate);
  const hasBundledSelection = bundledTemplates.some((t) => t.id === selectedTemplateId);
  const hasUserSelection = userTemplates.some((t) => t.id === selectedTemplateId);

  const importHasInput = Boolean(
    importMwPath.trim() || importObsNotesPath || importObsStoryPath || importDocxFiles.length > 0,
  );

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
      <Toast message={templateToastState?.message ?? null} level={templateToastState?.level} />
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

      {showMigrationDialog && (
        <div
          className="gs-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gs-migration-title"
          data-testid="gs-migration-dialog"
        >
          <div className="gs-confirm">
            <h3 className="gs-confirm__title" id="gs-migration-title">We found an older Mythos vault</h3>
            <p className="gs-confirm__body">
              Use your existing ~/Mythos vaults, start fresh, or hide this migration prompt permanently.
            </p>
            <div className="gs-confirm__actions">
              <Button
                variant="primary"
                onClick={() => { setShowMigrationDialog(false); handleOpenExistingVault(initialSettings.legacyVaultPath); }}
                data-testid="gs-migration-use"
              >
                Use them
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowMigrationDialog(false)}
                data-testid="gs-migration-start-fresh"
              >
                Start fresh
              </Button>
              <Button
                variant="tertiary"
                onClick={() => {
                  const updated = { ...initialSettings, legacyVaultDismissed: true };
                  api().settingsSet?.(updated).catch(() => {});
                  setShowMigrationDialog(false);
                }}
                data-testid="gs-migration-never"
              >
                Never show again
              </Button>
            </div>
          </div>
        </div>
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
                <Button
                  variant="primary"
                  onClick={() => setDeletingId(null)}
                  data-testid="template-delete-cancel"
                >
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  data-testid="template-delete-confirm"
                  onClick={async () => {
                    await api().templateDelete(deletingId);
                    if (selectedTemplateId === deletingId) setSelectedTemplateId(null);
                    setDeletingId(null);
                    reloadTemplates();
                  }}
                >
                  Delete
                </Button>
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
              title="Quick Start"
              description="One click — we set everything up for you."
              ctaLabel="Start &#x2192;"
              onActivate={handleSelectBlank}
              testId="card-path-default"
              cardRef={quickStartRef}
            />
            <StartingPointCard
              icon="&#x270F;&#xFE0F;"
              title="Blank"
              description="Start with an empty vault — choose your save location."
              ctaLabel="Set up &#x2192;"
              onActivate={handleSelectBlank}
              testId="card-path-blank"
            />
            <StartingPointCard
              icon="&#x1F4DA;"
              title="Sample Project"
              description="Start with a genre-specific sample vault to explore the app."
              ctaLabel="Browse &#x2192;"
              onActivate={handleSelectSample}
              testId="card-path-sample"
            />
            <StartingPointCard
              icon="&#x1F527;"
              title="Custom"
              description="Fine-grained control: pick your location and starting point."
              ctaLabel="Set up &#x2192;"
              onActivate={handleCreateCustom}
              testId="card-create-custom"
            />
            <StartingPointCard
              icon="&#x1F4C2;"
              title="Import / Open Existing"
              description="Open an existing vault, or bring in Obsidian or Word files."
              ctaLabel="Import &#x2192;"
              onActivate={() => { resetImportState(); setStep('step-import'); }}
              testId="card-import"
              isSecondary
            />
          </div>

          {/* AC-L-07/AC-L-08: footer links */}
          <div className="gs-landing-footer">
            <button
              className="gs-footer-link"
              type="button"
              onClick={() => { resetImportState(); setStep('step-import'); }}
              data-testid="gs-restart-link"
            >
              Restart an existing project?
            </button>
            <span className="gs-footer-link-sep" aria-hidden="true">&#xB7;</span>
            <a
              className="gs-footer-link"
              href="https://mythoswriter.com/help"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="gs-learn-more"
            >
              Learn more
            </a>
          </div>
        </div>
      )}

      {/* ── Step 1b: Create Custom sub-selector ── */}
      {step === 'step1b' && (
        <div className="gs-modal" data-testid="screen-step1b-options">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => {
                setStartMode(null);
                setSelectedTemplateId(null);
                setSelectedSampleGenre(null);
                setStep('step1');
              }}
              data-testid="gs-back-step1b-options"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Step 1 of 3</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step1b-options"
            >
              &#x2715;
            </button>
          </div>
          <h2 className="gs-modal__title">Create a custom vault</h2>
          <p className="gs-modal__subtitle">Choose what you want to start with.</p>
          <div className="gs-cards" role="group" aria-label="Choose a custom vault starting point">
            <StartingPointCard
              icon="&#x1F4DD;"
              title="Blank Slate"
              description="Minimal vault, no pre-seeded content."
              ctaLabel="Start blank &#x2192;"
              onActivate={handleSelectBlank}
              testId="card-blank"
            />
            <StartingPointCard
              icon="&#x1F4DA;"
              title="Sample Project"
              description="Pre-loaded story and notes example."
              ctaLabel="Preview samples &#x2192;"
              onActivate={handleSelectSample}
              testId="card-sample"
            />
            <StartingPointCard
              icon="&#x1F4CB;"
              title="From Template"
              description="Choose a reusable story, notes, or worldbuilding structure."
              ctaLabel="Browse templates &#x2192;"
              onActivate={handleSelectTemplate}
              testId="card-template"
            />
          </div>
        </div>
      )}

      {/* ── Step 1b-inner: Template sub-picker ── */}
      {step === 'step1b-inner' && (
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
                setStep('step1b');
                requestAnimationFrame(() => {
                  const el = document.querySelector('[data-testid="card-template"]') as HTMLElement | null;
                  el?.focus();
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
                              const res = await window.api.templateExport(tmpl.id);
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
                      const res = await window.api.templateImport();
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

      {/* ── Step 1c: Genre picker (sample projects) ── */}
      {step === 'step1c' && (
        <div className="gs-modal" data-testid="screen-step1c">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              aria-label="Back to mode selection"
              onClick={() => {
                setSelectedSampleGenre(null);
                setOpenAccordionGenre(null);
                setSampleError('');
                setStep('step1');
              }}
              data-testid="gs-back-step1c"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Step 1 of 3</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step1c"
            >
              &#x2715;
            </button>
          </div>

          <div className="genre-picker">
            <h2 className="gp-title">Pick a sample world</h2>
            <p className="gp-subtitle">You can explore any of these — they won&apos;t affect your own files.</p>

            {/* sr-only live region for genre selection announcement */}
            <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="genre-announcement">
              {selectedSampleGenre
                ? `${GENRE_OPTIONS.find((g) => g.id === selectedSampleGenre)?.title ?? ''} selected.`
                : ''}
            </p>

            <div
              role="radiogroup"
              aria-label="Choose a sample genre"
              className="gp-radiogroup"
              onKeyDown={handleGenreArrowKeys}
              data-testid="genre-radiogroup"
            >
              {GENRE_OPTIONS.map((genre, i) => (
                <GenreCard
                  key={genre.id}
                  genre={genre}
                  isSelected={selectedSampleGenre === genre.id}
                  isAccordionOpen={openAccordionGenre === genre.id}
                  tabIndex={selectedSampleGenre === genre.id || (selectedSampleGenre === null && i === 0) ? 0 : -1}
                  onSelect={() => setSelectedSampleGenre(genre.id)}
                  onToggleAccordion={() => handleGenreToggleAccordion(genre.id)}
                />
              ))}
            </div>

            {sampleError && (
              <div className="gp-error" role="alert" data-testid="genre-sample-error">
                <p>{sampleError}</p>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => { setSampleError(''); setStartMode('blank'); setStep('step2'); }}
                  data-testid="genre-error-blank-cta"
                >
                  Start blank instead
                </button>
              </div>
            )}

            <div className="gp-footer">
              <button
                type="button"
                className="btn-primary gp-start-button"
                disabled={!selectedSampleGenre}
                onClick={handleStartSample}
                data-testid="genre-start-btn"
              >
                {selectedSampleGenre
                  ? `Start with ${GENRE_OPTIONS.find((g) => g.id === selectedSampleGenre)?.title ?? ''} →`
                  : 'Start with… →'}
              </button>
              <p className="gp-note">Sampling won&apos;t affect your own files.</p>
            </div>
          </div>
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

            {/* Save location — SKY-2007 vault picker polish */}
            <div className="gs-form__field">
              <label className="gs-form__label" htmlFor="gs-save-path-input">Save location</label>
              <div className="gs-path-row">
                <input
                  id="gs-save-path-input"
                  ref={pathInputRef}
                  className={`gs-form__input gs-path-input${
                    pathValidationState === 'not-writable' || pathValidationState === 'path-too-long' || pathValidationState === 'error' || savePathError
                      ? ' gs-form__input--error'
                      : pathValidationState === 'valid' ? ' gs-form__input--valid'
                      : ''
                  }`}
                  type="text"
                  value={savePath}
                  onChange={(e) => handleSavePathChange(e.target.value)}
                  data-testid="gs-save-path"
                  aria-label="Save location path"
                  aria-describedby="gs-path-hint"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="btn-secondary gs-path-row__browse"
                  type="button"
                  onClick={handleChangeSaveLocation}
                  data-testid="gs-change-location"
                >
                  Browse&#x2026;
                </button>
              </div>

              {/* Validation hint */}
              {savePathError ? (
                <p className="gs-form__error" role="alert" id="gs-path-hint" data-testid="gs-path-error">{savePathError}</p>
              ) : pathValidationMsg ? (
                <p
                  className={`gs-path-hint gs-path-hint--${
                    pathValidationState === 'conflict-mythos' ? 'warn'
                    : pathValidationState === 'error' || pathValidationState === 'not-writable' || pathValidationState === 'path-too-long' ? 'error'
                    : 'info'
                  }`}
                  id="gs-path-hint"
                  role="alert"
                  data-testid="gs-path-validation-hint"
                >
                  {pathValidationMsg}
                  {pathValidationState === 'conflict-mythos' && (
                    <button
                      className="btn-link gs-path-hint__action"
                      type="button"
                      onClick={() => setShowConflictDialog(true)}
                      data-testid="gs-conflict-see-options"
                    >
                      {' '}See options &rsaquo;
                    </button>
                  )}
                </p>
              ) : (
                <p className="gs-form__hint" id="gs-path-hint">
                  Your story files will be created here. You can move them later from File &gt; Move Story.
                </p>
              )}

              {/* Suggested locations */}
              {suggestedLocations.length > 0 && (
                <div className="gs-suggestions" data-testid="gs-suggestions">
                  <span className="gs-suggestions__label">Suggested:</span>
                  {suggestedLocations.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className="gs-suggestion-pill"
                      onClick={() => handleUsePath(loc)}
                      data-testid="gs-suggestion-pill"
                      title={loc}
                    >
                      {tildeify(loc, pathOptions.homeDir)}
                    </button>
                  ))}
                </div>
              )}

              {/* Recents */}
              {(initialSettings.recentVaultParentPaths ?? []).length > 0 && (
                <div className="gs-recents">
                  <button
                    type="button"
                    className="gs-recents__toggle"
                    aria-expanded={showRecents}
                    onClick={() => setShowRecents((v) => !v)}
                    data-testid="gs-recents-toggle"
                  >
                    {showRecents ? '▾' : '▸'} Recent locations
                  </button>
                  {showRecents && (
                    <ul className="gs-recents__list" data-testid="gs-recents-list">
                      {[...(initialSettings.recentVaultParentPaths ?? [])].reverse().map((p) => (
                        <li key={p} className="gs-recents__item">
                          <span className="gs-recents__path" title={p}>{tildeify(p, pathOptions.homeDir)}</span>
                          <button
                            type="button"
                            className="btn-link gs-recents__use"
                            onClick={() => handleUsePath(p)}
                            data-testid="gs-recent-use"
                          >
                            Use this
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Conflict dialog (non-blocking, renders inside overlay) */}
          {showConflictDialog && (
            <ConflictDialog
              savePath={savePath.startsWith('~') ? (pathOptions.homeDir ?? '') + savePath.slice(1) : savePath}
              onOpenExisting={handleConflictOpenExisting}
              onNewFolder={handleConflictNewFolder}
              onCreateAlongside={handleConflictCreateAlongside}
              onDismiss={() => setShowConflictDialog(false)}
            />
          )}

          <div className="gs-actions">
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={handleCreateStory}
              disabled={
                pathValidationState === 'validating' ||
                pathValidationState === 'not-writable' ||
                pathValidationState === 'path-too-long' ||
                pathValidationState === 'error'
              }
              data-testid="gs-create-story"
            >
              Create Story &#x2192;
            </button>
          </div>
        </div>
      )}

      {/* ── Custom Setup: Screen 1 — Install Location (SKY-2988) ── */}
      {step === 'custom-location' && (
        <div className="gs-modal" data-testid="screen-custom-location">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => setStep('step1')}
              data-testid="custom-location-back"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Custom Setup · 1 of 2</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="custom-location-close"
            >
              &#x2715;
            </button>
          </div>
          <h2 className="gs-modal__title">Where should your vault live?</h2>

          <div className="gs-form">
            <div className="gs-form__field">
              <label className="gs-form__label" htmlFor="custom-vault-path-input">
                Vault location <span aria-hidden="true">*</span>
              </label>
              <div className="gs-path-row">
                <input
                  id="custom-vault-path-input"
                  ref={customPathInputRef}
                  className={`gs-form__input gs-path-input${
                    customPathValidation === 'not-writable' || customPathValidation === 'path-too-long' || customPathValidation === 'error'
                      ? ' gs-form__input--error'
                      : customPathValidation === 'valid' || customPathValidation === 'new-path'
                      ? ' gs-form__input--valid'
                      : ''
                  }`}
                  type="text"
                  value={customVaultPath}
                  onChange={(e) => handleCustomPathChange(e.target.value)}
                  data-testid="custom-vault-path-input"
                  aria-label="Vault location path"
                  aria-describedby="custom-path-hint"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="btn-secondary gs-path-row__browse"
                  type="button"
                  onClick={handleCustomBrowse}
                  data-testid="custom-vault-browse"
                >
                  Browse…
                </button>
              </div>

              {customPathMsg ? (
                <p
                  className={`gs-path-hint gs-path-hint--${
                    customPathValidation === 'conflict-mythos' ? 'warn'
                    : customPathValidation === 'error' || customPathValidation === 'not-writable' || customPathValidation === 'path-too-long' ? 'error'
                    : 'info'
                  }`}
                  id="custom-path-hint"
                  role="alert"
                  data-testid="custom-path-validation-hint"
                >
                  {customPathMsg}
                </p>
              ) : (
                <p className="gs-form__hint" id="custom-path-hint">
                  Your vault files will be created here. You can move them later.
                </p>
              )}

              {suggestedLocations.length > 0 && (
                <div className="gs-suggestions" data-testid="custom-location-suggestions">
                  <span className="gs-suggestions__label">Suggested:</span>
                  {suggestedLocations.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className="gs-suggestion-pill"
                      onClick={() => handleCustomUsePath(loc)}
                      data-testid="custom-suggestion-pill"
                      title={loc}
                    >
                      {tildeify(loc, pathOptions.homeDir)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="gs-form__field">
              <label className="gs-form__label" htmlFor="custom-vault-name-input">
                Vault name <span aria-hidden="true">*</span>
              </label>
              <input
                id="custom-vault-name-input"
                ref={customVaultNameInputRef}
                className="gs-form__input"
                type="text"
                value={customVaultName}
                maxLength={TITLE_MAX}
                placeholder="e.g., My Writing Vault"
                aria-required="true"
                onChange={(e) => {
                  vaultNameManuallyEditedRef.current = true;
                  setCustomVaultName(e.target.value);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCustomNext(); }}
                data-testid="custom-vault-name-input"
              />
              <p className="gs-form__hint">Auto-filled from your path — edit freely.</p>
            </div>
          </div>

          <div className="gs-actions">
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={handleCustomNext}
              disabled={
                customPathValidation === 'idle' ||
                customPathValidation === 'validating' ||
                customPathValidation === 'not-writable' ||
                customPathValidation === 'path-too-long' ||
                customPathValidation === 'error' ||
                customPathValidation === 'conflict-mythos' ||
                !customVaultName.trim()
              }
              data-testid="custom-location-next"
            >
              Next &#x2192;
            </button>
          </div>
        </div>
      )}

      {/* ── Custom Setup: Screen 2 — Template Picker (SKY-2988) ── */}
      {step === 'custom-template' && (
        <div className="gs-modal" data-testid="screen-custom-template">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => setStep('custom-location')}
              data-testid="custom-template-back"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <span className="gs-step-label">Custom Setup · 2 of 2</span>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="custom-template-close"
            >
              &#x2715;
            </button>
          </div>
          <h2 className="gs-modal__title">Choose a starting template</h2>
          <p className="gs-modal__subtitle">You can always change this later.</p>

          <div
            role="radiogroup"
            aria-label="Starting template"
            className="custom-template-options"
            onKeyDown={handleGridArrowKeys}
          >
            <button
              type="button"
              role="radio"
              aria-checked={customTemplate === 'recommended'}
              className={`custom-template-card${customTemplate === 'recommended' ? ' custom-template-card--selected' : ''}`}
              onClick={() => setCustomTemplate('recommended')}
              data-testid="custom-template-recommended"
            >
              <span className="custom-template-card__icon" aria-hidden="true">&#x2728;</span>
              <div className="custom-template-card__body">
                <span className="custom-template-card__title">
                  Recommended
                  <span className="custom-template-card__badge">Default</span>
                </span>
                <span className="custom-template-card__desc">
                  A ready-made structure with example scenes and notes to get you started.
                </span>
              </div>
              <span className="custom-template-card__radio" aria-hidden="true" />
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={customTemplate === 'blank'}
              className={`custom-template-card${customTemplate === 'blank' ? ' custom-template-card--selected' : ''}`}
              onClick={() => setCustomTemplate('blank')}
              data-testid="custom-template-blank"
            >
              <span className="custom-template-card__icon" aria-hidden="true">&#x1F4DD;</span>
              <div className="custom-template-card__body">
                <span className="custom-template-card__title">Start Blank</span>
                <span className="custom-template-card__desc">
                  An empty vault — pure canvas, no sample content.
                </span>
              </div>
              <span className="custom-template-card__radio" aria-hidden="true" />
            </button>
          </div>

          <div className="gs-actions">
            <button
              className="btn-primary gs-actions__cta"
              type="button"
              onClick={handleCustomFinish}
              data-testid="custom-template-finish"
            >
              Finish &#x2192;
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Creating your story ── */}
      {step === 'step3' && (
        <div className="gs-modal" data-testid="screen-step3">
          {scaffolding && !scaffoldError ? (
            <>
              <h2 className="gs-modal__title">
                {startMode === 'sample' && selectedSampleGenre
                  ? `Loading ${GENRE_OPTIONS.find((g) => g.id === selectedSampleGenre)?.title ?? 'sample'}…`
                  : startMode === 'quick-start' || startMode === 'default-mythos-vault'
                  ? 'Setting up your vault…'
                  : startMode === 'open-existing'
                  ? 'Opening your vault…'
                  : fromCustomSetup
                  ? 'Setting up your vault…'
                  : 'Setting up your story…'}
              </h2>
              <div className="gs-spinner" aria-label="Creating story" role="status" data-testid="gs-spinner" />
              <p className="gs-modal__subtitle">
                {startMode === 'sample'
                  ? 'Copying sample files…'
                  : startMode === 'quick-start' || startMode === 'default-mythos-vault'
                  ? 'Setting up your vault…'
                  : startMode === 'open-existing'
                  ? 'Validating the selected folder…'
                  : fromCustomSetup
                  ? 'Creating your vault structure…'
                  : 'Creating your folders and first scene…'}
              </p>
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

      {/* ── Import / Open ── */}
      {step === 'step-import' && (
        <div className="gs-modal gs-modal--import" data-testid="screen-step-import">
          <div className="gs-modal__header">
            <button
              className="btn-ghost btn-back"
              type="button"
              onClick={() => { resetImportState(); setStep('step1'); }}
              data-testid="gs-back-step-import"
            >
              <span aria-hidden="true">&#x2190;</span> Back
            </button>
            <button
              className="gs-close-btn"
              type="button"
              aria-label="Close setup"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="gs-close-btn-step-import"
            >
              &#x2715;
            </button>
          </div>
          <h2 className="gs-modal__title">Import / Open</h2>
          <p className="gs-modal__subtitle">Fill in at least one section, then click Import / Open.</p>

          {/* Section 1: Open MW vault */}
          <section className="import-section" aria-label="Open Mythos Writer vault" data-testid="import-section-mw">
            <h3 className="import-section__title">Open Mythos Writer vault</h3>
            <div className="import-field-row">
              <input
                type="text"
                className="import-field-row__input"
                placeholder="Path to vault folder…"
                value={importMwPath}
                onChange={(e) => handleImportMwPathChange(e.target.value)}
                aria-label="Vault folder path"
                data-testid="import-mw-path"
              />
              <button
                type="button"
                className="btn-secondary import-field-row__browse"
                onClick={() => { void handleImportMwBrowse(); }}
                data-testid="import-mw-browse"
              >
                Browse…
              </button>
            </div>
            {importMwMsg && (
              <p
                className={`import-validation import-validation--${importMwValidation}`}
                data-testid="import-mw-msg"
                role="status"
              >
                {importMwMsg}
              </p>
            )}
          </section>

          {/* Section 2: Import Obsidian */}
          <section className="import-section" aria-label="Import from Obsidian" data-testid="import-section-obs">
            <h3 className="import-section__title">Import from Obsidian</h3>
            <div className="import-slot">
              <span className="import-slot__label">Notes vault</span>
              <div className="import-field-row">
                <input
                  type="text"
                  className="import-field-row__input"
                  placeholder="Obsidian notes folder…"
                  value={importObsNotesPath}
                  readOnly
                  aria-label="Obsidian notes vault folder"
                  data-testid="import-obs-notes-path"
                />
                <button
                  type="button"
                  className="btn-secondary import-field-row__browse"
                  onClick={() => { void handleImportObsBrowse('notes'); }}
                  data-testid="import-obs-notes-browse"
                >
                  Browse…
                </button>
              </div>
            </div>
            <div className="import-slot">
              <span className="import-slot__label">Story vault</span>
              <div className="import-field-row">
                <input
                  type="text"
                  className="import-field-row__input"
                  placeholder="Obsidian story folder…"
                  value={importObsStoryPath}
                  readOnly
                  aria-label="Obsidian story vault folder"
                  data-testid="import-obs-story-path"
                />
                <button
                  type="button"
                  className="btn-secondary import-field-row__browse"
                  onClick={() => { void handleImportObsBrowse('story'); }}
                  data-testid="import-obs-story-browse"
                >
                  Browse…
                </button>
              </div>
            </div>
          </section>

          {/* Section 3: Word docs */}
          <section className="import-section" aria-label="Import Word documents" data-testid="import-section-docx">
            <h3 className="import-section__title">Import Word documents (.docx)</h3>
            <button
              type="button"
              className="btn-secondary import-section__file-btn"
              onClick={() => docxFileInputRef.current?.click()}
              data-testid="import-docx-browse"
            >
              Add .docx files…
            </button>
            <input
              ref={docxFileInputRef}
              type="file"
              multiple
              accept=".docx"
              style={{ display: 'none' }}
              onChange={handleDocxFileChange}
              data-testid="import-docx-input"
              aria-label="Select Word documents to import"
            />
            {importDocxFiles.length > 0 && (
              <ul className="import-docx-list" aria-label="Selected Word documents">
                {importDocxFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="import-docx-list__item">
                    <span className="import-docx-list__name">{f.name}</span>
                    <button
                      type="button"
                      className="btn-ghost import-docx-list__remove"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => handleRemoveDocxFile(i)}
                      data-testid={`import-docx-remove-${i}`}
                    >
                      &#x2715;
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="import-tip" data-testid="import-tip">
            Tip: fill in one section above, then click Import / Open.
          </p>
          <div className="import-actions">
            <button
              type="button"
              className="btn-primary import-actions__submit"
              disabled={!importHasInput || importRunning}
              onClick={() => { void handleImportOrOpen(); }}
              data-testid="import-action-btn"
            >
              {importRunning ? 'Importing…' : 'Import / Open →'}
            </button>
          </div>
        </div>
      )}

      {/* Import error modal */}
      {importErrorModal && (
        <div
          className="gs-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-error-title"
          data-testid="import-error-modal"
        >
          <div className="gs-confirm">
            <h3 className="gs-confirm__title" id="import-error-title">{importErrorModal.title}</h3>
            <p className="gs-confirm__body">{importErrorModal.message}</p>
            <div className="gs-confirm__actions">
              <button
                className="btn-primary"
                type="button"
                onClick={() => setImportErrorModal(null)}
                data-testid="import-error-dismiss"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
