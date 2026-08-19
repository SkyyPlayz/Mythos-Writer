import { useState, useEffect, useCallback, useRef } from 'react';
import './MoveVaultWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncProvider = 'dropbox' | 'icloud' | 'google-drive' | 'onedrive';

// SKY-10367: local folder is the default entry point — cloud is an explicit
// secondary choice reached via a link from the folder step.
type Destination = 'local' | 'cloud';
type WizardStep = 'folder' | 'provider' | 'confirm' | 'test' | 'result';

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

const LOCAL_STEP_LABELS = ['Choose folder', 'Confirm move', 'Verify access', 'Done'];
const CLOUD_STEP_LABELS = ['Choose provider', 'Locate folder', 'Confirm move', 'Verify access', 'Done'];

function stepIndex(step: WizardStep, destination: Destination): number {
  if (destination === 'local') {
    switch (step) {
      case 'folder': return 0;
      case 'confirm': return 1;
      case 'test': return 2;
      case 'result': return 3;
      default: return 0;
    }
  }
  switch (step) {
    case 'provider': return 0;
    case 'folder': return 1;
    case 'confirm': return 2;
    case 'test': return 3;
    case 'result': return 4;
    default: return 0;
  }
}

// Best-effort parent directory for the local folder-picker's starting
// location — "a sensible local location" per SKY-10367, not a security
// boundary (the picker itself is the source of truth for the chosen path).
function parentDir(p: string): string | undefined {
  if (!p) return undefined;
  const trimmed = p.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx > 0 ? trimmed.slice(0, idx) : undefined;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onSuccess: (newVaultPath: string, provider: SyncProvider | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MoveVaultWizard({ onClose, onSuccess }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [destination, setDestination] = useState<Destination>('local');
  const [step, setStep] = useState<WizardStep>('folder');
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

  const providerDef = PROVIDERS.find((p) => p.value === provider) ?? null;

  const switchToCloud = useCallback(() => {
    setDestination('cloud');
    setTargetFolder('');
    setSessionToken(null);
    setTestStatus('idle');
    setSyncConfirmed(false);
    setStep('provider');
  }, []);

  const switchToLocal = useCallback(() => {
    setDestination('local');
    setTargetFolder('');
    setSessionToken(null);
    setTestStatus('idle');
    setSyncConfirmed(false);
    setStep('folder');
  }, []);

  const handlePickFolder = useCallback(async () => {
    const res = await window.api.pickFolder(
      destination === 'local'
        ? { title: 'Choose a new folder for your Story Vault', defaultPath: parentDir(currentVaultPath) }
        : { title: providerDef ? `Select your ${providerDef.label} folder` : 'Select your sync folder' }
    );
    if (!res.cancelled && res.vaultRoot) {
      setTargetFolder(res.vaultRoot);
      setSessionToken(res.registrationToken ?? null);
      setSyncConfirmed(false);
    }
  }, [destination, providerDef, currentVaultPath]);

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

  // Auto-run permission test on entering the test step
  useEffect(() => {
    if (step === 'test' && testStatus === 'idle') {
      void runWriteTest();
    }
  }, [step, testStatus, runWriteTest]);

  const handleMigrate = useCallback(async () => {
    if (!targetFolder || !sessionToken) return;
    if (destination === 'cloud' && !provider) return;
    setMigrating(true);
    setMigrationError(null);
    try {
      const result = destination === 'cloud'
        ? await window.api.vaultGuidedFolderMove({
            targetPath: targetFolder,
            syncProvider: provider!,
            sessionToken,
          })
        : await window.api.vaultLocalFolderMove({
            targetPath: targetFolder,
            registrationToken: sessionToken,
          });
      if ('error' in result) {
        setMigrationError(result.error ?? 'Move failed. Please try again.');
      } else if (result.moved) {
        setNewVaultPath(result.newVaultPath);
        setStep('result');
      } else {
        setMigrationError('Move failed. Please try again.');
      }
    } catch (e) {
      setMigrationError(
        e instanceof Error ? e.message : 'Move failed. Please try again.'
      );
    } finally {
      setMigrating(false);
    }
  }, [destination, provider, targetFolder, sessionToken]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !migrating) onClose();
  };

  const dialogTitle = destination === 'local' ? 'Move vault to a different folder' : 'Move vault to cloud sync';

  return (
    <div
      className="mv-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={dialogTitle}
      onClick={handleOverlayClick}
    >
      <div className="mv-panel" ref={dialogRef}>
        {/* Header */}
        <div className="mv-header">
          <h2 className="mv-title" id="mv-title">{dialogTitle}</h2>
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
        <StepBar step={step} destination={destination} />

        {/* Body */}
        <div className="mv-body">
          {step === 'folder' && (
            <StepFolder
              destination={destination}
              providerDef={providerDef}
              targetFolder={targetFolder}
              onPick={handlePickFolder}
              onBack={destination === 'cloud' ? () => setStep('provider') : null}
              onCancel={onClose}
              onSwitchToCloud={switchToCloud}
              onNext={() => setStep('confirm')}
            />
          )}

          {step === 'provider' && (
            <StepProvider
              selected={provider}
              onSelect={(p) => {
                setProvider(p);
                setSyncConfirmed(false);
              }}
              onSwitchToLocal={switchToLocal}
              onNext={() => setStep('folder')}
            />
          )}

          {step === 'confirm' && (
            <StepConfirm
              destination={destination}
              currentVaultPath={currentVaultPath}
              targetFolder={targetFolder}
              syncConfirmed={syncConfirmed}
              onConfirmChange={setSyncConfirmed}
              onBack={() => setStep('folder')}
              onNext={() => {
                setTestStatus('idle');
                setStep('test');
              }}
            />
          )}

          {step === 'test' && (
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
              onBack={() => setStep('confirm')}
              onProceed={handleMigrate}
            />
          )}

          {step === 'result' && newVaultPath && (
            <StepResult
              newVaultPath={newVaultPath}
              provider={destination === 'cloud' ? provider : null}
              onDone={() => onSuccess(newVaultPath, destination === 'cloud' ? provider : null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StepBar ─────────────────────────────────────────────────────────────────

function StepBar({ step, destination }: { step: WizardStep; destination: Destination }) {
  const labels = destination === 'local' ? LOCAL_STEP_LABELS : CLOUD_STEP_LABELS;
  const active = stepIndex(step, destination);
  return (
    <ol className="mv-stepbar" aria-label="Wizard progress">
      {labels.map((label, i) => {
        const done = i < active;
        const isActive = i === active;
        return (
          <li
            key={i}
            className={`mv-stepbar-item${isActive ? ' mv-stepbar-item--active' : ''}${done ? ' mv-stepbar-item--done' : ''}`}
            aria-current={isActive ? 'step' : undefined}
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

// ─── Step — Folder (local entry, or cloud folder-locate) ─────────────────────

function StepFolder({
  destination,
  providerDef,
  targetFolder,
  onPick,
  onBack,
  onCancel,
  onSwitchToCloud,
  onNext,
}: {
  destination: Destination;
  providerDef: ProviderDef | null;
  targetFolder: string;
  onPick: () => void;
  onBack: (() => void) | null;
  onCancel: () => void;
  onSwitchToCloud: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">
        {destination === 'local'
          ? "Choose a new folder for your Story Vault. Mythos Writer will move all your files there."
          : `Select the ${providerDef?.label ?? 'sync'} folder where your vault will be stored. Use the button to browse using the OS file picker.`}
      </p>

      {destination === 'cloud' && providerDef && (
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
          aria-label="Selected folder"
          data-testid="mv-folder-display"
        />
        <button
          type="button"
          className="settings-btn settings-btn-secondary"
          onClick={onPick}
          aria-label="Browse for folder"
          data-testid="mv-browse"
        >
          Browse…
        </button>
      </div>

      {destination === 'local' && (
        <button
          type="button"
          className="mv-secondary-action"
          onClick={onSwitchToCloud}
          data-testid="mv-switch-to-cloud"
        >
          Move to a cloud-synced folder instead
        </button>
      )}

      <div className="mv-footer">
        {onBack ? (
          <button
            type="button"
            className="settings-btn settings-btn-cancel"
            onClick={onBack}
            data-testid="mv-back-folder"
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            className="settings-btn settings-btn-cancel"
            onClick={onCancel}
            data-testid="mv-cancel"
          >
            Cancel
          </button>
        )}
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

// ─── Step — Provider (explicit secondary choice) ──────────────────────────────

function StepProvider({
  selected,
  onSelect,
  onSwitchToLocal,
  onNext,
}: {
  selected: SyncProvider | null;
  onSelect: (p: SyncProvider) => void;
  onSwitchToLocal: () => void;
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

      <button
        type="button"
        className="mv-secondary-action"
        onClick={onSwitchToLocal}
        data-testid="mv-switch-to-local"
      >
        Use a local folder instead
      </button>

      <div className="mv-footer">
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

// ─── Step — Confirm ────────────────────────────────────────────────────────

function StepConfirm({
  destination,
  currentVaultPath,
  targetFolder,
  syncConfirmed,
  onConfirmChange,
  onBack,
  onNext,
}: {
  destination: Destination;
  currentVaultPath: string;
  targetFolder: string;
  syncConfirmed: boolean;
  onConfirmChange: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canProceed = destination === 'cloud' ? syncConfirmed : true;

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

      {destination === 'cloud' ? (
        <>
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
        </>
      ) : (
        <p className="mv-hint">
          Your vault will be moved to the new folder. The old folder will be
          removed once the move completes.
        </p>
      )}

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
          disabled={!canProceed}
          data-testid="mv-proceed-confirm"
        >
          Proceed
        </button>
      </div>
    </div>
  );
}

// ─── Step — Test + Migrate ─────────────────────────────────────────────────

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

// ─── Step — Result ─────────────────────────────────────────────────────────

function StepResult({
  newVaultPath,
  provider,
  onDone,
}: {
  newVaultPath: string;
  provider: SyncProvider | null;
  onDone: () => void;
}) {
  const providerDef = provider ? PROVIDERS.find((p) => p.value === provider) : null;

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
        {providerDef
          ? 'Sync is now active. Your cloud provider will begin syncing the vault to other devices.'
          : 'Your vault now lives at this local folder. Keep writing as usual.'}
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
