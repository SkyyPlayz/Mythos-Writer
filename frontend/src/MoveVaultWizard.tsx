import { useState, useEffect, useCallback, useRef } from 'react';
import './MoveVaultWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncProvider = 'dropbox' | 'icloud' | 'google-drive' | 'onedrive';

type WizardStep = 0 | 1 | 2 | 3 | 4;
// 0 = provider, 1 = folder, 2 = confirm, 3 = permission test, 4 = result

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface ProviderDef {
  value: SyncProvider;
  label: string;
  description: string;
  defaultHint: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS: ProviderDef[] = [
  {
    value: 'dropbox',
    label: 'Dropbox',
    description: 'Works everywhere, requires Dropbox account.',
    defaultHint: '~/Dropbox',
  },
  {
    value: 'icloud',
    label: 'iCloud Drive',
    description: 'Free for macOS + iOS, Apple only.',
    defaultHint: '~/Library/Mobile Documents/com~apple~CloudDocs',
  },
  {
    value: 'onedrive',
    label: 'OneDrive',
    description: 'Windows and macOS, requires Microsoft account.',
    defaultHint: '~/OneDrive',
  },
  {
    value: 'google-drive',
    label: 'Google Drive',
    description: 'Works with Google Drive for Desktop.',
    defaultHint: '~/Google Drive',
  },
];

const STEP_LABELS = [
  'Choose provider',
  'Locate folder',
  'Confirm move',
  'Verify access',
  'Done',
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onSuccess: (newVaultPath: string, provider: SyncProvider) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MoveVaultWizard({ onClose, onSuccess }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<WizardStep>(0);
  const [provider, setProvider] = useState<SyncProvider | null>(null);
  const [targetFolder, setTargetFolder] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentVaultPath, setCurrentVaultPath] = useState('');
  const [syncConfirmed, setSyncConfirmed] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [newVaultPath, setNewVaultPath] = useState<string | null>(null);

  useEffect(() => {
    window.api.vaultGetPaths().then((paths) => {
      setCurrentVaultPath(paths.storyVaultPath);
    }).catch(() => {});
  }, []);

  // Focus first focusable element on step change
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, [step]);

  // Close on Escape (not during active migration)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !migrating) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, migrating]);

  const handlePickFolder = useCallback(async () => {
    const res = await window.api.pickFolder();
    if (!res.cancelled && res.vaultRoot) {
      setTargetFolder(res.vaultRoot);
      setSessionToken(res.registrationToken ?? null);
    }
  }, []);

  const runWriteTest = useCallback(async () => {
    if (!targetFolder) return;
    setTestStatus('testing');
    setTestError(null);
    try {
      const result = await window.api.validatePath(targetFolder);
      if (result.writable) {
        setTestStatus('ok');
      } else {
        setTestStatus('error');
        setTestError(
          `Cannot write to ${targetFolder}. Check folder permissions and try again.`
        );
      }
    } catch (e) {
      setTestStatus('error');
      setTestError(
        e instanceof Error ? e.message : 'Permission check failed. Try again.'
      );
    }
  }, [targetFolder]);

  // Auto-run permission test on entering step 3
  useEffect(() => {
    if (step === 3 && testStatus === 'idle') {
      void runWriteTest();
    }
  }, [step, testStatus, runWriteTest]);

  const handleMigrate = useCallback(async () => {
    if (!provider || !targetFolder || !sessionToken) return;
    setMigrating(true);
    setMigrationError(null);
    try {
      const result = await window.api.vaultGuidedFolderMove({
        targetPath: targetFolder,
        syncProvider: provider,
        sessionToken,
      });
      if ('error' in result) {
        setMigrationError(result.error ?? 'Migration failed. Please try again.');
      } else if (result.moved) {
        setNewVaultPath(result.newVaultPath);
        setStep(4);
      } else {
        setMigrationError('Migration failed. Please try again.');
      }
    } catch (e) {
      setMigrationError(
        e instanceof Error ? e.message : 'Migration failed. Please try again.'
      );
    } finally {
      setMigrating(false);
    }
  }, [provider, targetFolder, sessionToken]);

  const providerDef = PROVIDERS.find((p) => p.value === provider) ?? null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !migrating) onClose();
  };

  return (
    <div
      className="mv-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Move vault to cloud sync"
      onClick={handleOverlayClick}
    >
      <div className="mv-panel" ref={dialogRef}>
        {/* Header */}
        <div className="mv-header">
          <h2 className="mv-title" id="mv-title">Move vault to cloud sync</h2>
          {!migrating && (
            <button
              type="button"
              className="settings-close"
              onClick={onClose}
              aria-label="Close wizard"
            >
              ✕
            </button>
          )}
        </div>

        {/* Step bar */}
        <StepBar step={step} />

        {/* Body */}
        <div className="mv-body">
          {step === 0 && (
            <StepProvider
              selected={provider}
              onSelect={setProvider}
              onSkip={onClose}
              onNext={() => setStep(1)}
            />
          )}

          {step === 1 && (
            <StepFolder
              providerDef={providerDef}
              targetFolder={targetFolder}
              onPick={handlePickFolder}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <StepConfirm
              currentVaultPath={currentVaultPath}
              targetFolder={targetFolder}
              syncConfirmed={syncConfirmed}
              onConfirmChange={setSyncConfirmed}
              onBack={() => setStep(1)}
              onNext={() => {
                setTestStatus('idle');
                setStep(3);
              }}
            />
          )}

          {step === 3 && (
            <StepTest
              targetFolder={targetFolder}
              testStatus={testStatus}
              testError={testError}
              migrating={migrating}
              migrationError={migrationError}
              onRetry={() => {
                setTestStatus('idle');
                void runWriteTest();
              }}
              onBack={() => setStep(2)}
              onProceed={handleMigrate}
            />
          )}

          {step === 4 && newVaultPath && (
            <StepResult
              newVaultPath={newVaultPath}
              provider={provider!}
              onDone={() => onSuccess(newVaultPath, provider!)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StepBar ─────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: WizardStep }) {
  return (
    <ol className="mv-stepbar" aria-label="Wizard progress">
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li
            key={i}
            className={`mv-stepbar-item${active ? ' mv-stepbar-item--active' : ''}${done ? ' mv-stepbar-item--done' : ''}`}
            aria-current={active ? 'step' : undefined}
          >
            <span className="mv-stepbar-dot" aria-hidden="true">
              {done ? '✓' : i + 1}
            </span>
            <span className="mv-stepbar-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 0 — Provider ────────────────────────────────────────────────────────

function StepProvider({
  selected,
  onSelect,
  onSkip,
  onNext,
}: {
  selected: SyncProvider | null;
  onSelect: (p: SyncProvider) => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">
        Choose a cloud sync provider. Mythos Writer will move your vault to the
        provider&apos;s folder so all your devices stay in sync.
      </p>

      <fieldset className="mv-provider-fieldset">
        <legend className="mv-provider-legend">Sync provider</legend>
        {PROVIDERS.map((p) => (
          <label
            key={p.value}
            className={`mv-provider-card${selected === p.value ? ' mv-provider-card--selected' : ''}`}
            data-testid={`provider-option-${p.value}`}
          >
            <input
              type="radio"
              name="mv-provider"
              value={p.value}
              checked={selected === p.value}
              onChange={() => onSelect(p.value)}
              aria-label={`${p.label}: ${p.description}`}
            />
            <span className="mv-provider-label">{p.label}</span>
            <span className="mv-provider-desc">{p.description}</span>
          </label>
        ))}
      </fieldset>

      <div className="mv-footer">
        <button
          type="button"
          className="settings-btn settings-btn-cancel"
          onClick={onSkip}
          data-testid="mv-skip"
        >
          Stay local
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onNext}
          disabled={!selected}
          data-testid="mv-next-provider"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Step 1 — Folder ─────────────────────────────────────────────────────────

function StepFolder({
  providerDef,
  targetFolder,
  onPick,
  onBack,
  onNext,
}: {
  providerDef: ProviderDef | null;
  targetFolder: string;
  onPick: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">
        Select the {providerDef?.label ?? 'sync'} folder where your vault will be
        stored. Use the button to browse using the OS file picker.
      </p>

      {providerDef && (
        <p className="mv-hint" data-testid="mv-default-hint">
          Default location: <code className="mv-code">{providerDef.defaultHint}</code>
        </p>
      )}

      <div className="mv-folder-row">
        <input
          className="settings-input mv-folder-input"
          type="text"
          readOnly
          value={targetFolder}
          placeholder="No folder selected"
          aria-label="Selected cloud sync folder"
          data-testid="mv-folder-display"
        />
        <button
          type="button"
          className="settings-btn settings-btn-secondary"
          onClick={onPick}
          aria-label="Browse for sync folder"
          data-testid="mv-browse"
        >
          Browse…
        </button>
      </div>

      <div className="mv-footer">
        <button
          type="button"
          className="settings-btn settings-btn-cancel"
          onClick={onBack}
          data-testid="mv-back-folder"
        >
          Back
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onNext}
          disabled={!targetFolder}
          data-testid="mv-next-folder"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Step 2 — Confirm ────────────────────────────────────────────────────────

function StepConfirm({
  currentVaultPath,
  targetFolder,
  syncConfirmed,
  onConfirmChange,
  onBack,
  onNext,
}: {
  currentVaultPath: string;
  targetFolder: string;
  syncConfirmed: boolean;
  onConfirmChange: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">Review the move before proceeding.</p>

      <dl className="mv-path-dl">
        <div className="mv-path-row">
          <dt className="mv-path-dt">From</dt>
          <dd className="mv-path-dd" data-testid="mv-from-path">
            <code className="mv-code">{currentVaultPath || '(current vault)'}</code>
          </dd>
        </div>
        <div className="mv-path-row">
          <dt className="mv-path-dt">To</dt>
          <dd className="mv-path-dd" data-testid="mv-to-path">
            <code className="mv-code">{targetFolder}</code>
          </dd>
        </div>
      </dl>

      <label className="mv-confirm-label" data-testid="mv-confirm-label">
        <input
          type="checkbox"
          checked={syncConfirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
          aria-label="I have confirmed the sync client is set up and syncing"
          data-testid="mv-confirm-checkbox"
        />
        <span>I&apos;ve confirmed the sync client is set up and syncing on this machine.</span>
      </label>

      <p className="mv-hint">
        Mythos Writer will not start syncing — your cloud provider handles that.
        Don&apos;t move vault files manually while this wizard is running.
      </p>

      <div className="mv-footer">
        <button
          type="button"
          className="settings-btn settings-btn-cancel"
          onClick={onBack}
          data-testid="mv-back-confirm"
        >
          Back
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onNext}
          disabled={!syncConfirmed}
          data-testid="mv-proceed-confirm"
        >
          Proceed
        </button>
      </div>
    </div>
  );
}

// ─── Step 3 — Test + Migrate ─────────────────────────────────────────────────

function StepTest({
  targetFolder,
  testStatus,
  testError,
  migrating,
  migrationError,
  onRetry,
  onBack,
  onProceed,
}: {
  targetFolder: string;
  testStatus: TestStatus;
  testError: string | null;
  migrating: boolean;
  migrationError: string | null;
  onRetry: () => void;
  onBack: () => void;
  onProceed: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">
        Checking that{' '}
        <code className="mv-code">{targetFolder}</code>{' '}
        is writable.
      </p>

      <div className="mv-test-status" role="status" aria-live="polite" data-testid="mv-test-status">
        {testStatus === 'testing' && (
          <span className="mv-test-testing">Checking permissions…</span>
        )}
        {testStatus === 'ok' && (
          <span className="mv-test-ok" data-testid="mv-test-ok">
            ✓ Folder is writable. Ready to move.
          </span>
        )}
        {testStatus === 'error' && testError && (
          <span className="mv-test-error" role="alert" data-testid="mv-test-error">
            {testError}
          </span>
        )}
      </div>

      {migrationError && (
        <p className="mv-migration-error" role="alert" data-testid="mv-migration-error">
          {migrationError}
        </p>
      )}

      <div className="mv-footer">
        <button
          type="button"
          className="settings-btn settings-btn-cancel"
          onClick={onBack}
          disabled={migrating}
          data-testid="mv-back-test"
        >
          Back
        </button>

        {testStatus === 'error' && (
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={onRetry}
            disabled={migrating}
            data-testid="mv-retry-test"
          >
            Retry
          </button>
        )}

        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onProceed}
          disabled={testStatus !== 'ok' || migrating}
          data-testid="mv-migrate"
        >
          {migrating ? 'Moving…' : 'Move vault'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — Result ─────────────────────────────────────────────────────────

function StepResult({
  newVaultPath,
  provider,
  onDone,
}: {
  newVaultPath: string;
  provider: SyncProvider;
  onDone: () => void;
}) {
  const providerDef = PROVIDERS.find((p) => p.value === provider);

  return (
    <div className="mv-step" data-testid="mv-step-result">
      <p className="mv-result-success" aria-live="polite" data-testid="mv-success-message">
        ✓ Vault moved successfully.
      </p>

      <dl className="mv-path-dl">
        <div className="mv-path-row">
          <dt className="mv-path-dt">New location</dt>
          <dd className="mv-path-dd" data-testid="mv-new-path">
            <code className="mv-code">{newVaultPath}</code>
          </dd>
        </div>
        {providerDef && (
          <div className="mv-path-row">
            <dt className="mv-path-dt">Provider</dt>
            <dd className="mv-path-dd">{providerDef.label}</dd>
          </div>
        )}
      </dl>

      <p className="mv-hint">
        Sync is now active. Your cloud provider will begin syncing the vault to
        other devices.
      </p>

      <div className="mv-footer mv-footer--center">
        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onDone}
          data-testid="mv-done"
        >
          Done
        </button>
      </div>
    </div>
  );
}
