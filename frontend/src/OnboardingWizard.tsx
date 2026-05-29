import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles, FilePlus, FolderInput, FolderOpen,
  Info, ShieldCheck, CircleCheck, ChevronRight,
  Eye, EyeOff, FolderPlus, FolderCheck, AlertTriangle, Lock, Loader2
} from 'lucide-react';
import './OnboardingWizard.css';

// suppress unused-import warnings for icons reserved for future screens
void FolderPlus; void FolderCheck; void AlertTriangle; void Lock; void Loader2;

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardScreen =
  | 'welcome'
  | 'blank-path'
  | 'import-source'
  | 'import-dryrun'
  | 'import-progress'
  | 'import-success'
  | 'sample-path'
  | 'api-key'
  | 'done';

type PathStatus = 'checking' | 'new' | 'empty-ok' | 'non-empty' | 'not-writable' | 'unknown';

interface DryRunReport {
  notesCount: number;
  brokenLinks: Array<{ file: string; target: string }>;
  nameCollisions: Array<{ name: string; file: string }>;
  missingFrontmatter: string[];
  fatalError: string | null;
  restructured?: Array<{ from: string; to: string }>;
  leftAsIs?: string[];
}

interface OnboardingWizardProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
}

// ─── Typed window.api access ──────────────────────────────────────────────────

type Api = {
  pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean; registrationToken: string | null; error?: string }>;
  obsidianDryRun: (path: string, token: string) => Promise<DryRunReport | { error: string }>;
  obsidianRegister: (path: string, token: string) => Promise<{ vaultRoot: string; notesIndexed: number; snapshotPath?: string } | { error: string }>;
  loadSampleProject: (targetPath?: string) => Promise<{ vaultRoot: string }>;
  createBlankVault: (targetPath: string) => Promise<{ vaultRoot: string } | { error: string }>;
  validatePath: (path: string) => Promise<{ exists: boolean; isEmpty: boolean; writable: boolean }>;
  obsidianPickFolderByPath: (sourcePath: string) => Promise<{ vaultRoot: string | null; registrationToken: string | null; error?: string }>;
  settingsSet: (settings: AppSettings) => Promise<{ saved: boolean }>;
  onObsidianImportProgress?: (cb: (data: { current: number; total: number; lastAction: string }) => void) => () => void;
};

function api(): Api {
  return (window as unknown as { api: Api }).api;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PickerCardProps {
  recommended?: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  onActivate: () => void;
  testId?: string;
}

function PickerCard({ recommended, icon, title, description, ctaLabel, onActivate, testId }: PickerCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <button
      className={`picker-card${recommended ? ' picker-card--recommended' : ''}`}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      aria-describedby={testId ? `${testId}-desc` : undefined}
    >
      {recommended && <span className="picker-card__badge">Recommended</span>}
      <span className="picker-card__icon" aria-hidden="true">{icon}</span>
      <span className="picker-card__title">{title}</span>
      <span className="picker-card__desc" id={testId ? `${testId}-desc` : undefined}>{description}</span>
      <span className="picker-card__cta" aria-hidden="true">{ctaLabel}</span>
    </button>
  );
}

interface FolderPathFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onBrowse: () => void;
  status: PathStatus;
  disabled?: boolean;
  testId?: string;
}

function FolderPathField({ label, value, onChange, onBlur, onBrowse, status, disabled, testId }: FolderPathFieldProps) {
  const hintMap: Record<PathStatus, { text: string; level: 'info' | 'warn' | 'error' }> = {
    new:          { text: "This folder doesn't exist yet — we'll create it.", level: 'info' },
    'empty-ok':   { text: "Folder exists and is empty — we'll use it.", level: 'info' },
    'non-empty':  { text: "Folder exists but isn't empty — pick a new folder or a sub-path.", level: 'warn' },
    'not-writable': { text: "This path isn't writable — pick a different folder.", level: 'error' },
    checking:     { text: 'Checking path…', level: 'info' },
    unknown:      { text: '', level: 'info' },
  };
  const hint = hintMap[status];

  return (
    <div className="folder-path-field">
      <label className="folder-path-field__label" htmlFor={testId}>{label}</label>
      <div className="folder-path-field__row">
        <input
          id={testId}
          className="folder-path-field__input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          data-testid={testId}
          aria-describedby={testId ? `${testId}-hint` : undefined}
        />
        <button
          className="btn-secondary"
          type="button"
          onClick={onBrowse}
          disabled={disabled}
          aria-label="Browse for folder"
        >
          Browse
        </button>
      </div>
      {hint.text && (
        <p
          className={`folder-path-field__hint folder-path-field__hint--${hint.level}`}
          id={testId ? `${testId}-hint` : undefined}
          aria-live="polite"
          data-testid={testId ? `${testId}-hint` : undefined}
        >
          {hint.text}
        </p>
      )}
    </div>
  );
}

interface FolderDropZoneProps {
  onPickFolder: () => void;
  onDrop: (path: string) => void;
  scanning?: boolean;
  testId?: string;
}

function FolderDropZone({ onPickFolder, onDrop, scanning, testId }: FolderDropZoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    // Electron exposes .path on File objects for dragged OS items
    const file = e.dataTransfer.files[0];
    if (file) {
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) onDrop(filePath);
    }
  };

  return (
    <div
      className={`folder-drop-zone${dragging ? ' folder-drop-zone--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={testId}
      aria-label="Drop vault folder here or pick folder"
    >
      {scanning ? (
        <>
          <span className="folder-drop-zone__spinner" aria-hidden="true" />
          <span className="folder-drop-zone__scanning">Scanning vault…</span>
        </>
      ) : (
        <>
          <FolderOpen size={40} className="folder-drop-zone__icon" aria-hidden="true" />
          <span className="folder-drop-zone__hint">Drop a vault folder here</span>
          <span className="folder-drop-zone__or" aria-hidden="true">— or —</span>
          <button
            className="btn-secondary"
            type="button"
            onClick={onPickFolder}
            data-testid={testId ? `${testId}-btn` : undefined}
          >
            Pick folder
          </button>
        </>
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  primaryLabel: string;
  destructiveLabel: string;
  onPrimary: () => void;
  onDestructive: () => void;
  testId?: string;
}

function ConfirmDialog({ title, body, primaryLabel, destructiveLabel, onPrimary, onDestructive, testId }: ConfirmDialogProps) {
  return (
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <div className="confirm-dialog">
        <h3 className="confirm-dialog__title">{title}</h3>
        <p className="confirm-dialog__body">{body}</p>
        <div className="confirm-dialog__actions">
          <button
            className="btn-primary"
            type="button"
            onClick={onPrimary}
            data-testid={testId ? `${testId}-primary` : undefined}
          >
            {primaryLabel}
          </button>
          <button
            className="btn-ghost btn-destructive"
            type="button"
            onClick={onDestructive}
            data-testid={testId ? `${testId}-destructive` : undefined}
          >
            {destructiveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator helpers ───────────────────────────────────────────────────

const STEP_MAP: Partial<Record<WizardScreen, [number, number]>> = {
  'blank-path':       [1, 2],
  'import-source':    [1, 3],
  'import-dryrun':    [2, 3],
  'import-progress':  [3, 3],
  'sample-path':      [1, 2],
};

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingWizard({ initialSettings, onComplete }: OnboardingWizardProps) {
  // Navigation
  const [screen, setScreen] = useState<WizardScreen>('welcome');

  // Blank vault flow
  const [blankPath, setBlankPath] = useState('~/Documents/Mythos Vault');
  const [blankPathStatus, setBlankPathStatus] = useState<PathStatus>('new');

  // Import flow
  const [importSourcePath, setImportSourcePath] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [dryRun, setDryRun] = useState<DryRunReport | null>(null);
  const [importNotesCount, setImportNotesCount] = useState(0);
  const [importSnapshotPath, setImportSnapshotPath] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, lastAction: '' });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const cancelledRef = useRef(false);
  const [dryRunBanner, setDryRunBanner] = useState('');

  // Sample flow
  const [samplePath, setSamplePath] = useState('~/Documents/Mythos Sample');
  const [samplePathStatus, setSamplePathStatus] = useState<PathStatus>('new');

  // API key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const apiKeyValid = !apiKey.trim() || /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim());

  // Done screen
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null);

  // Shared
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Focus management
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  // Esc handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (screen === 'welcome' || screen === 'done') return;
      if (screen === 'import-progress') { setShowCancelConfirm(true); return; }
      if (screen === 'blank-path' || screen === 'sample-path' || screen === 'api-key') {
        setError('');
        setScreen('welcome');
        return;
      }
      if (screen === 'import-source') { setError(''); setScreen('welcome'); return; }
      if (screen === 'import-dryrun') {
        setError('');
        setDryRun(null);
        setDryRunBanner('');
        setRegistrationToken('');
        setScreen('import-source');
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [screen]);

  // ─── Validation helpers ─────────────────────────────────────────────────────

  const validatePathStatus = useCallback(async (path: string, setter: (s: PathStatus) => void) => {
    if (!path.trim()) { setter('unknown'); return; }
    setter('checking');
    try {
      const res = await api().validatePath(path);
      if (!res.writable) { setter('not-writable'); return; }
      if (!res.exists)   { setter('new'); return; }
      if (res.isEmpty)   { setter('empty-ok'); return; }
      setter('non-empty');
    } catch {
      setter('unknown');
    }
  }, []);

  // ─── Blank vault flow ───────────────────────────────────────────────────────

  const handleBlankBrowse = useCallback(async () => {
    try {
      const res = await api().pickFolder();
      if (res.error === 'permission-denied') {
        setError("macOS blocked access to that folder. Pick a folder in your home directory, or grant access in System Settings → Privacy & Security → Files and Folders.");
        return;
      }
      if (res.cancelled || !res.vaultRoot) return;
      setBlankPath(res.vaultRoot);
      await validatePathStatus(res.vaultRoot, setBlankPathStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open folder picker');
    }
  }, [validatePathStatus]);

  const handleBlankPathChange = (v: string) => {
    setBlankPath(v);
    setBlankPathStatus('unknown');
  };

  const handleBlankPathBlur = async () => {
    await validatePathStatus(blankPath, setBlankPathStatus);
  };

  const isBlankCTADisabled = blankPathStatus === 'non-empty' || blankPathStatus === 'not-writable' || busy;

  const handleCreateBlankVault = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await api().createBlankVault(blankPath);
      if ('error' in res) throw new Error(res.error);
      setScreen('api-key');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vault');
    } finally {
      setBusy(false);
    }
  };

  // ─── Import flow ────────────────────────────────────────────────────────────

  const handleImportPickFolder = useCallback(async () => {
    setError('');
    try {
      const res = await api().pickFolder();
      if (res.error === 'permission-denied') {
        setError("macOS blocked access to that folder. Pick a folder in your home directory, or grant access in System Settings → Privacy & Security → Files and Folders.");
        return;
      }
      if (res.cancelled || !res.vaultRoot || !res.registrationToken) return;
      await runDryRun(res.vaultRoot, res.registrationToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open folder picker');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImportDrop = useCallback(async (droppedPath: string) => {
    setError('');
    try {
      const res = await api().obsidianPickFolderByPath(droppedPath);
      if (!res.vaultRoot || !res.registrationToken) {
        setError(res.error ?? 'Could not access the dropped folder.');
        return;
      }
      await runDryRun(res.vaultRoot, res.registrationToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to access dropped folder');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runDryRun = async (sourcePath: string, token: string) => {
    setImportSourcePath(sourcePath);
    setRegistrationToken(token);
    setBusy(true);
    try {
      const report = await api().obsidianDryRun(sourcePath, token);
      if ('error' in report) {
        setError(report.error);
        return;
      }
      if (report.fatalError) {
        const isNotObsidian = report.fatalError.toLowerCase().includes('no .obsidian') ||
          report.fatalError.toLowerCase().includes('no .md');
        if (isNotObsidian) {
          setError("This doesn't look like an Obsidian vault. Pick the folder that contains your notes.");
        } else {
          setError(`We couldn't scan that vault.\n\nDetails: ${report.fatalError}`);
        }
        return;
      }
      setDryRun(report);
      setScreen('import-dryrun');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setBusy(false);
    }
  };

  const handleStartImport = async () => {
    if (!registrationToken) {
      setError('Folder selection expired — please pick the folder again.');
      setScreen('import-source');
      setDryRun(null);
      return;
    }
    setError('');
    cancelledRef.current = false;
    setImportProgress({ current: 0, total: dryRun?.notesCount ?? 0, lastAction: '' });
    setScreen('import-progress');

    // Subscribe to progress events if supported
    let unsubscribe: (() => void) | undefined;
    if (typeof api().onObsidianImportProgress === 'function') {
      unsubscribe = api().onObsidianImportProgress!((data) => {
        setImportProgress(data);
      });
    }

    try {
      const res = await api().obsidianRegister(importSourcePath, registrationToken);
      if ('error' in res) throw new Error(res.error);
      setRegistrationToken('');
      setImportNotesCount(res.notesIndexed);
      setImportSnapshotPath(res.snapshotPath ?? null);
      if (cancelledRef.current) {
        // User confirmed cancel while import was running
        setDryRunBanner('Import cancelled. The original vault is unchanged.');
        setScreen('import-dryrun');
      } else {
        setScreen('import-success');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      const isDiskFull = msg.toLowerCase().includes('enospc') || msg.toLowerCase().includes('no space left');
      if (isDiskFull) {
        setDryRunBanner("Out of disk space. We stopped before writing. The original vault is untouched.");
      } else {
        setDryRunBanner(`Import failed. We're rolling back to the original vault.\n\nDetails: ${msg}`);
      }
      setScreen('import-dryrun');
    } finally {
      unsubscribe?.();
    }
  };

  const handleCancelConfirm = () => {
    cancelledRef.current = true;
    setShowCancelConfirm(false);
    // The obsidianRegister promise will resolve and we'll handle transition in handleStartImport
  };

  // ─── Sample flow ────────────────────────────────────────────────────────────

  const handleSampleBrowse = useCallback(async () => {
    try {
      const res = await api().pickFolder();
      if (res.error === 'permission-denied') {
        setError("macOS blocked access to that folder. Pick a folder in your home directory, or grant access in System Settings → Privacy & Security → Files and Folders.");
        return;
      }
      if (res.cancelled || !res.vaultRoot) return;
      setSamplePath(res.vaultRoot);
      await validatePathStatus(res.vaultRoot, setSamplePathStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open folder picker');
    }
  }, [validatePathStatus]);

  const isSampleCTADisabled = samplePathStatus === 'not-writable' || busy;

  const handleOpenSample = async () => {
    setError('');
    setBusy(true);
    try {
      await api().loadSampleProject(samplePath);
      setScreen('api-key');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sample project';
      const isDiskFull = msg.toLowerCase().includes('enospc') || msg.toLowerCase().includes('no space left');
      setError(isDiskFull
        ? "Out of disk space. Pick a folder with more room."
        : `We couldn't copy the sample project. Try a different folder, or restart Mythos Writer.\n\nDetails: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  // ─── API key flow ───────────────────────────────────────────────────────────

  const handleFinish = async (skipApiKey = false) => {
    setBusy(true);
    setError('');
    try {
      const key = skipApiKey ? initialSettings.apiKey : apiKey.trim();
      const updated: AppSettings = { ...initialSettings, apiKey: key, onboardingComplete: true };
      await api().settingsSet(updated);
      if (savedSettings === null) setSavedSettings(updated);
      setScreen('done');
      onComplete(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  };

  // ─── Validate blank/sample path on change (blur) ───────────────────────────

  useEffect(() => {
    // Pre-validate default paths when the respective screens mount
    if (screen === 'blank-path' && blankPathStatus === 'new') {
      validatePathStatus(blankPath, setBlankPathStatus).catch(() => {});
    }
    if (screen === 'sample-path' && samplePathStatus === 'new') {
      validatePathStatus(samplePath, setSamplePathStatus).catch(() => {});
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Step indicator ─────────────────────────────────────────────────────────

  const stepInfo = STEP_MAP[screen];

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function renderProgressBar() {
    const { current, total } = importProgress;
    const pct = total > 0 ? Math.round((current / total) * 100) : null;
    if (pct !== null) {
      return (
        <div
          className="import-progress-bar-wrap"
          style={{ '--progress-pct': `${pct}%` } as React.CSSProperties}
        >
          <div
            className="import-progress-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <span className="import-progress-bar__pct">{pct}%</span>
        </div>
      );
    }
    return <div className="import-progress-bar-wrap import-progress-bar-wrap--indeterminate" role="progressbar" aria-label="Importing…" />;
  }

  // ─── Screen renders ─────────────────────────────────────────────────────────

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Onboarding wizard">
      {/* Cancel confirm dialog (renders above everything during S2c) */}
      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel import?"
          body={`Files moved so far will be restored${importSnapshotPath ? ` to ${importSnapshotPath}` : ''}.`}
          primaryLabel="Keep going"
          destructiveLabel="Yes, cancel"
          onPrimary={() => setShowCancelConfirm(false)}
          onDestructive={handleCancelConfirm}
          testId="cancel-confirm-dialog"
        />
      )}

      {/* ── S0 Welcome ── */}
      {screen === 'welcome' && (
        <div className="onboarding-welcome" data-testid="screen-welcome">
          <div className="onboarding-brand">
            <div className="onboarding-brand__wordmark">
              <span className="onboarding-brand__glyph" aria-hidden="true">✦</span>
              Mythos Writer
            </div>
            <p className="onboarding-brand__tagline">Write the world before you write the book.</p>
          </div>

          <div className="picker-grid" role="group" aria-label="Choose how to get started">
            <PickerCard
              recommended
              icon={<Sparkles size={32} />}
              title="Open sample project"
              description="Tour the editor with a small worldbuilding demo — characters, lore, and a one-chapter draft."
              ctaLabel="Open sample →"
              onActivate={() => { setError(''); setScreen('sample-path'); }}
              testId="card-sample"
            />
            <PickerCard
              icon={<FilePlus size={32} />}
              title="Start blank"
              description="Create an empty vault in ~/Documents/Mythos Vault. Change the location on the next screen."
              ctaLabel="Choose path →"
              onActivate={() => { setError(''); setScreen('blank-path'); }}
              testId="card-blank"
            />
            <PickerCard
              icon={<FolderInput size={32} />}
              title="Import Obsidian vault"
              description="Point us at an existing vault. We'll show a dry-run report of what changes before anything is written."
              ctaLabel="Pick folder →"
              onActivate={() => { setError(''); setScreen('import-source'); }}
              testId="card-import"
            />
          </div>

          {error && <p className="onboarding-error" role="alert">{error}</p>}

          <p className="onboarding-footer">
            <Info size={14} aria-hidden="true" />
            Need help? See the{' '}
            <a
              href="https://docs.mythoswriter.app/quick-start"
              target="_blank"
              rel="noreferrer"
              className="onboarding-footer__link"
            >
              quick-start guide ↗
            </a>
          </p>
        </div>
      )}

      {/* ── S1 Start blank ── */}
      {screen === 'blank-path' && (
        <div className="onboarding-card" data-testid="screen-blank-path">
          <div className="onboarding-top-bar">
            <button className="btn-back" onClick={() => { setError(''); setScreen('welcome'); }}>← Back</button>
            {stepInfo && (
              <div className="step-indicator" role="progressbar"
                   aria-valuemin={1} aria-valuemax={stepInfo[1]} aria-valuenow={stepInfo[0]}
                   aria-label={`Step ${stepInfo[0]} of ${stepInfo[1]}`}>
                {Array.from({length: stepInfo[1]}, (_, i) => (
                  <span key={i} className={`step-indicator__dot${
                    i + 1 < stepInfo[0] ? ' step-indicator__dot--done'
                    : i + 1 === stepInfo[0] ? ' step-indicator__dot--current' : ''
                  }`} />
                ))}
                <span className="step-indicator__label">{stepInfo[0]} / {stepInfo[1]}</span>
              </div>
            )}
          </div>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Where should we put your new vault?</h2>
          <p className="onboarding-subtitle">We&apos;ll create an empty Mythos Vault here. You can move it later from Settings.</p>

          <FolderPathField
            label="Target folder"
            value={blankPath}
            onChange={handleBlankPathChange}
            onBlur={handleBlankPathBlur}
            onBrowse={handleBlankBrowse}
            status={blankPathStatus}
            disabled={busy}
            testId="blank-path-input"
          />

          {error && <p className="onboarding-error" role="alert">{error}</p>}

          <div className="onboarding-actions">
            <button
              className="btn-primary"
              onClick={handleCreateBlankVault}
              disabled={isBlankCTADisabled}
              data-testid="create-blank-vault"
            >
              {busy ? 'Creating…' : 'Create vault →'}
            </button>
          </div>
        </div>
      )}

      {/* ── S2a Import source picker ── */}
      {screen === 'import-source' && (
        <div className="onboarding-card" data-testid="screen-import-source">
          <div className="onboarding-top-bar">
            <button className="btn-back" onClick={() => { setError(''); setScreen('welcome'); }}>← Back</button>
            {stepInfo && (
              <div className="step-indicator" role="progressbar"
                   aria-valuemin={1} aria-valuemax={stepInfo[1]} aria-valuenow={stepInfo[0]}
                   aria-label={`Step ${stepInfo[0]} of ${stepInfo[1]}`}>
                {Array.from({length: stepInfo[1]}, (_, i) => (
                  <span key={i} className={`step-indicator__dot${
                    i + 1 < stepInfo[0] ? ' step-indicator__dot--done'
                    : i + 1 === stepInfo[0] ? ' step-indicator__dot--current' : ''
                  }`} />
                ))}
                <span className="step-indicator__label">{stepInfo[0]} / {stepInfo[1]}</span>
              </div>
            )}
          </div>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Choose the Obsidian vault to import</h2>
          <p className="onboarding-subtitle">Nothing is written until you confirm the dry-run report.</p>

          <FolderDropZone
            onPickFolder={handleImportPickFolder}
            onDrop={handleImportDrop}
            scanning={busy}
            testId="import-drop-zone"
          />

          {error && <p className="onboarding-error" role="alert">{error}</p>}
        </div>
      )}

      {/* ── S2b Dry-run report ── */}
      {screen === 'import-dryrun' && dryRun && (
        <div className="onboarding-card onboarding-card--wide" data-testid="screen-import-dryrun">
          <div className="onboarding-top-bar">
            <button
              className="btn-back"
              onClick={() => { setError(''); setDryRun(null); setDryRunBanner(''); setRegistrationToken(''); setScreen('import-source'); }}
            >
              ← Back
            </button>
            {stepInfo && (
              <div className="step-indicator" role="progressbar"
                   aria-valuemin={1} aria-valuemax={stepInfo[1]} aria-valuenow={stepInfo[0]}
                   aria-label={`Step ${stepInfo[0]} of ${stepInfo[1]}`}>
                {Array.from({length: stepInfo[1]}, (_, i) => (
                  <span key={i} className={`step-indicator__dot${
                    i + 1 < stepInfo[0] ? ' step-indicator__dot--done'
                    : i + 1 === stepInfo[0] ? ' step-indicator__dot--current' : ''
                  }`} />
                ))}
                <span className="step-indicator__label">{stepInfo[0]} / {stepInfo[1]}</span>
              </div>
            )}
          </div>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Vault scan report</h2>
          <p className="onboarding-vault-path">{importSourcePath}</p>

          {dryRunBanner && (
            <div className="dry-run-banner" role="alert" data-testid="dry-run-banner">{dryRunBanner}</div>
          )}

          <div className="dry-run-report" data-testid="dry-run-report">
            <div className="dry-run-stat">
              <span className="dry-run-stat-value">{dryRun.notesCount}</span>
              <span className="dry-run-stat-label">notes found</span>
            </div>

            {/* Restructured section — always shown when data present */}
            {dryRun.restructured !== undefined && (
              <details className="dry-run-section" open={dryRun.restructured.length > 0} data-testid="section-restructured">
                <summary className="dry-run-section-title">
                  <ChevronRight size={14} className="dry-run-chevron" aria-hidden="true" /> Restructured
                </summary>
                {dryRun.restructured.length > 0 ? (
                  <div className="dry-run-section__body">
                    <p className="dry-run-section__count">{dryRun.restructured.length} notes will be moved into the Notes Vault layout</p>
                    <ul className="dry-run-list">
                      {dryRun.restructured.slice(0, 5).map((r, i) => (
                        <li key={i}>
                          <span className="dry-run-file">{r.from}</span>
                          {' → '}
                          <span className="dry-run-file">{r.to}</span>
                        </li>
                      ))}
                      {dryRun.restructured.length > 5 && (
                        <li className="dry-run-more">…and {dryRun.restructured.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="dry-run-section__empty">No notes require restructuring.</p>
                )}
              </details>
            )}

            {/* Left as-is section */}
            {dryRun.leftAsIs !== undefined && (
              <details className="dry-run-section" open={false} data-testid="section-left-as-is">
                <summary className="dry-run-section-title">
                  <ChevronRight size={14} className="dry-run-chevron" aria-hidden="true" /> Left as-is — {dryRun.leftAsIs.length} notes
                </summary>
                <p className="dry-run-section__body dry-run-section__count">
                  {dryRun.leftAsIs.length} notes will keep their current path
                </p>
              </details>
            )}

            {dryRun.brokenLinks.length > 0 && (
              <details className="dry-run-section" open>
                <summary className="dry-run-section-title dry-run-warn">
                  {dryRun.brokenLinks.length} broken [[link{dryRun.brokenLinks.length !== 1 ? 's' : ''}]]
                </summary>
                <ul className="dry-run-list">
                  {dryRun.brokenLinks.slice(0, 20).map((l, i) => (
                    <li key={i}>
                      <span className="dry-run-file">{l.file}</span>{' → '}
                      <code className="dry-run-link">[[{l.target}]]</code>
                    </li>
                  ))}
                  {dryRun.brokenLinks.length > 20 && (
                    <li className="dry-run-more">…and {dryRun.brokenLinks.length - 20} more</li>
                  )}
                </ul>
              </details>
            )}

            {dryRun.nameCollisions.length > 0 && (
              <details className="dry-run-section" open>
                <summary className="dry-run-section-title dry-run-warn">
                  {dryRun.nameCollisions.length} name collision{dryRun.nameCollisions.length !== 1 ? 's' : ''} with built-in entities
                </summary>
                <ul className="dry-run-list">
                  {dryRun.nameCollisions.map((c, i) => (
                    <li key={i}>
                      <span className="dry-run-file">{c.file}</span>{' — '}<strong>{c.name}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {dryRun.missingFrontmatter.length > 0 && (
              <details className="dry-run-section">
                <summary className="dry-run-section-title dry-run-info">
                  {dryRun.missingFrontmatter.length} note{dryRun.missingFrontmatter.length !== 1 ? 's' : ''} missing frontmatter
                </summary>
                <ul className="dry-run-list">
                  {dryRun.missingFrontmatter.slice(0, 20).map((f, i) => (
                    <li key={i}><span className="dry-run-file">{f}</span></li>
                  ))}
                  {dryRun.missingFrontmatter.length > 20 && (
                    <li className="dry-run-more">…and {dryRun.missingFrontmatter.length - 20} more</li>
                  )}
                </ul>
              </details>
            )}

            {dryRun.brokenLinks.length === 0 && dryRun.nameCollisions.length === 0 &&
              dryRun.missingFrontmatter.length === 0 && !dryRun.restructured?.length && (
              <p className="dry-run-ok" data-testid="dry-run-ok">No issues found — vault looks great!</p>
            )}

            <div className="dry-run-snapshot-promise">
              <ShieldCheck size={16} aria-hidden="true" style={{flexShrink: 0, color: 'var(--accent)'}} />
              <span>A snapshot is taken before any change. Rollback is one click during and immediately after the import.</span>
            </div>
          </div>

          {error && <p className="onboarding-error" role="alert">{error}</p>}

          <div className="onboarding-actions">
            <button
              className="btn-secondary"
              onClick={() => { setDryRun(null); setDryRunBanner(''); setRegistrationToken(''); setScreen('import-source'); }}
            >
              Pick a different folder
            </button>
            {!dryRun.fatalError && (
              <button
                className="btn-primary"
                onClick={handleStartImport}
                disabled={busy}
                data-testid="confirm-import"
              >
                {busy ? 'Preparing…' : 'Import →'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── S2c Import progress ── */}
      {screen === 'import-progress' && (
        <div className="onboarding-card" data-testid="screen-import-progress">
          <div className="onboarding-top-bar">
            <span />
            {stepInfo && (
              <div className="step-indicator" role="progressbar"
                   aria-valuemin={1} aria-valuemax={stepInfo[1]} aria-valuenow={stepInfo[0]}
                   aria-label={`Step ${stepInfo[0]} of ${stepInfo[1]}`}>
                {Array.from({length: stepInfo[1]}, (_, i) => (
                  <span key={i} className={`step-indicator__dot${
                    i + 1 < stepInfo[0] ? ' step-indicator__dot--done'
                    : i + 1 === stepInfo[0] ? ' step-indicator__dot--current' : ''
                  }`} />
                ))}
                <span className="step-indicator__label">{stepInfo[0]} / {stepInfo[1]}</span>
              </div>
            )}
          </div>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Importing your vault…</h2>
          <p className="onboarding-vault-path">{importSourcePath}</p>

          {renderProgressBar()}

          {importProgress.total > 0 && (
            <p className="import-progress-status">
              Restructuring {importProgress.current} of {importProgress.total} notes
            </p>
          )}

          {importProgress.lastAction && (
            <p className="import-progress-last-action">Last action: {importProgress.lastAction}</p>
          )}

          <div className="import-progress-hint dry-run-snapshot-promise">
            <ShieldCheck size={14} aria-hidden="true" style={{flexShrink: 0, color: 'var(--accent)'}} />
            <span>Safe to cancel — we&apos;ll roll back to before the import.</span>
          </div>

          <div className="onboarding-actions onboarding-actions--center">
            <button
              className="btn-secondary"
              onClick={() => setShowCancelConfirm(true)}
              data-testid="cancel-import"
            >
              Cancel and roll back
            </button>
          </div>
        </div>
      )}

      {/* ── S2d Import success ── */}
      {screen === 'import-success' && (
        <div className="onboarding-card" data-testid="screen-import-success">
          <CircleCheck size={48} className="import-success-icon" aria-hidden="true" />
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Vault imported</h2>
          <p className="onboarding-subtitle">{importNotesCount} notes are now in your Mythos Vault.</p>
          {importSnapshotPath && (
            <>
              <p className="import-snapshot-path">
                A snapshot of the original is saved at{' '}
                <span className="import-snapshot-path__value">{importSnapshotPath}</span>
              </p>
              <p className="import-snapshot-footnote">
                <Info size={14} aria-hidden="true" />
                <span>You can delete the snapshot from Settings → Vault later.</span>
              </p>
            </>
          )}
          <div className="onboarding-actions">
            <button
              className="btn-primary"
              onClick={() => setScreen('api-key')}
              data-testid="import-success-continue"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── S3a Sample project ── */}
      {screen === 'sample-path' && (
        <div className="onboarding-card" data-testid="screen-sample-path">
          <div className="onboarding-top-bar">
            <button className="btn-back" onClick={() => { setError(''); setScreen('welcome'); }}>← Back</button>
            {stepInfo && (
              <div className="step-indicator" role="progressbar"
                   aria-valuemin={1} aria-valuemax={stepInfo[1]} aria-valuenow={stepInfo[0]}
                   aria-label={`Step ${stepInfo[0]} of ${stepInfo[1]}`}>
                {Array.from({length: stepInfo[1]}, (_, i) => (
                  <span key={i} className={`step-indicator__dot${
                    i + 1 < stepInfo[0] ? ' step-indicator__dot--done'
                    : i + 1 === stepInfo[0] ? ' step-indicator__dot--current' : ''
                  }`} />
                ))}
                <span className="step-indicator__label">{stepInfo[0]} / {stepInfo[1]}</span>
              </div>
            )}
          </div>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Where should we put the sample project?</h2>

          <FolderPathField
            label="Target folder"
            value={samplePath}
            onChange={(v) => { setSamplePath(v); setSamplePathStatus('unknown'); }}
            onBrowse={handleSampleBrowse}
            status={samplePathStatus}
            disabled={busy}
            testId="sample-path-input"
          />

          <div className="sample-contents">
            <p className="sample-contents__header">The sample includes:</p>
            <ul className="sample-contents__list">
              <li>1 universe (&ldquo;Acheron&rdquo;)</li>
              <li>2 stories with 3 chapters between them</li>
              <li>18 characters, 6 locations, 4 lore notes</li>
              <li>A populated Scene Crafter board</li>
            </ul>
          </div>

          <p className="sample-footnote">
            <Info size={14} aria-hidden="true" style={{flexShrink: 0}} />
            <span>You can keep working in the sample, or start your own vault from File → New project at any time.</span>
          </p>

          {error && <p className="onboarding-error" role="alert">{error}</p>}

          <div className="onboarding-actions">
            <button
              className="btn-primary"
              onClick={handleOpenSample}
              disabled={isSampleCTADisabled}
              data-testid="open-sample"
            >
              {busy ? 'Copying sample project…' : 'Open sample →'}
            </button>
          </div>
        </div>
      )}

      {/* ── S4 API key ── */}
      {screen === 'api-key' && (
        <div className="onboarding-card" data-testid="screen-api-key">
          <p className="onboarding-phase-label">Add your API key — optional</p>
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>Connect to Anthropic Claude</h2>
          <p className="onboarding-subtitle">
            Mythos Writer uses the Anthropic Claude API for AI features. You can skip this and add it later in Settings.
          </p>
          <label className="onboarding-label" htmlFor="api-key-input">Anthropic API key</label>
          <div style={{position: 'relative'}}>
            <input
              id="api-key-input"
              type={showKey ? 'text' : 'password'}
              className="onboarding-input"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="api-key-input"
              style={{paddingRight: '40px'}}
            />
            <button
              type="button"
              className="btn-ghost"
              style={{position:'absolute',right:0,top:0,bottom:0,padding:'0 var(--space-3)'}}
              onClick={() => setShowKey(v => !v)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          {apiKey.trim() && !apiKeyValid && (
            <p className="folder-path-field__hint folder-path-field__hint--warn">
              Key format looks wrong — should start with sk-ant-
            </p>
          )}
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <button
              className="btn-ghost"
              onClick={() => handleFinish(true)}
              disabled={busy}
              data-testid="skip-api-key"
            >
              Skip for now
            </button>
            <button
              className="btn-primary"
              onClick={() => handleFinish(false)}
              disabled={busy || !apiKey.trim()}
              data-testid="save-api-key"
            >
              {busy ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── S5 Done ── */}
      {screen === 'done' && (
        <div className="onboarding-card onboarding-card--done" data-testid="screen-done">
          <CircleCheck size={64} className="onboarding-done-icon" aria-hidden="true" />
          <h2 className="onboarding-title" ref={titleRef} tabIndex={-1}>You&apos;re all set</h2>
          <p className="onboarding-subtitle">Mythos Writer is ready. Start writing your story.</p>
          <p className="onboarding-hint">
            Tip: press <kbd>⌘K</kbd> (or <kbd>Ctrl K</kbd>) to open the command palette.
          </p>
          <div className="onboarding-actions">
            <button className="btn-primary" onClick={() => onComplete(savedSettings ?? initialSettings)}>
              Start writing →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
