import { useState, useEffect, useCallback, useRef } from 'react';
import './MoveVaultWizard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

// SKY-11804: a vault move goes to a plain local folder, full stop. The branded
// cloud-provider destination (Dropbox / iCloud / OneDrive / Google Drive) was
// removed — Mythos Writer is local-first, and a vault is just files on disk the
// user is free to put wherever they like.
type WizardStep = 'folder' | 'confirm' | 'test' | 'result';

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Choose folder', 'Confirm move', 'Verify access', 'Done'];

function stepIndex(step: WizardStep): number {
  switch (step) {
    case 'folder': return 0;
    case 'confirm': return 1;
    case 'test': return 2;
    case 'result': return 3;
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
  onSuccess: (newVaultPath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MoveVaultWizard({ onClose, onSuccess }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<WizardStep>('folder');
  const [targetFolder, setTargetFolder] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentVaultPath, setCurrentVaultPath] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [newVaultPath, setNewVaultPath] = useState<string | null>(null);
  // SKY-10890: UNAUTHORIZED_PATH means the one-shot folder authorization is
  // gone (expired, or already used) — not a permission problem the user can
  // fix by retrying the same move. Route it back to the folder step with an
  // explanation instead of showing the raw error code as a dead end.
  const [folderAuthError, setFolderAuthError] = useState<string | null>(null);

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
    const res = await window.api.pickFolder({
      title: 'Choose a new folder for your Story Vault',
      defaultPath: parentDir(currentVaultPath),
    });
    if (!res.cancelled && res.vaultRoot) {
      setTargetFolder(res.vaultRoot);
      setSessionToken(res.registrationToken ?? null);
      setFolderAuthError(null);
    }
  }, [currentVaultPath]);

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
    setMigrating(true);
    setMigrationError(null);
    try {
      const result = await window.api.vaultLocalFolderMove({
        targetPath: targetFolder,
        registrationToken: sessionToken,
      });
      if ('error' in result) {
        if (result.error === 'UNAUTHORIZED_PATH') {
          // SKY-10890: the folder authorization is gone (expired, or was
          // already consumed) — the "Move vault" button would just fail the
          // same way again. Send the user back to re-pick, which issues a
          // fresh one-shot token, rather than leaving them stuck on a raw
          // permission-sounding error with no path forward.
          setSessionToken(null);
          setFolderAuthError(
            'Your folder selection could not be re-verified. Please choose the folder again.'
          );
          setStep('folder');
        } else {
          setMigrationError(result.error ?? 'Move failed. Please try again.');
        }
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
  }, [targetFolder, sessionToken]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !migrating) onClose();
  };

  const dialogTitle = 'Move vault to a different folder';

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
        <StepBar step={step} />

        {/* Body */}
        <div className="mv-body">
          {step === 'folder' && (
            <StepFolder
              targetFolder={targetFolder}
              authError={folderAuthError}
              onPick={handlePickFolder}
              onCancel={onClose}
              onNext={() => setStep('confirm')}
            />
          )}

          {step === 'confirm' && (
            <StepConfirm
              currentVaultPath={currentVaultPath}
              targetFolder={targetFolder}
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
              onDone={() => onSuccess(newVaultPath)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StepBar ─────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: WizardStep }) {
  const active = stepIndex(step);
  return (
    <ol className="mv-stepbar" aria-label="Wizard progress">
      {STEP_LABELS.map((label, i) => {
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

// ─── Step — Folder ───────────────────────────────────────────────────────────

function StepFolder({
  targetFolder,
  authError,
  onPick,
  onCancel,
  onNext,
}: {
  targetFolder: string;
  authError: string | null;
  onPick: () => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mv-step">
      <p className="mv-step-intro">
        Choose a new folder for your Story Vault. Mythos Writer will move all your files there.
      </p>

      {authError && (
        <p className="mv-migration-error" role="alert" data-testid="mv-folder-auth-error">
          {authError}
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

      <div className="mv-footer">
        <button
          type="button"
          className="settings-btn settings-btn-cancel"
          onClick={onCancel}
          data-testid="mv-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-save"
          onClick={onNext}
          disabled={!targetFolder || !!authError}
          data-testid="mv-next-folder"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Step — Confirm ────────────────────────────────────────────────────────

function StepConfirm({
  currentVaultPath,
  targetFolder,
  onBack,
  onNext,
}: {
  currentVaultPath: string;
  targetFolder: string;
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

      <p className="mv-hint">
        Your vault will be moved to the new folder. The old folder will be
        removed once the move completes.
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
  onDone,
}: {
  newVaultPath: string;
  onDone: () => void;
}) {
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
      </dl>

      <p className="mv-hint">
        Your vault now lives at this local folder. Keep writing as usual.
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
