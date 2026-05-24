import { useState } from 'react';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
}

type VaultChoice = 'blank' | 'existing' | 'sample';

// Steps: 1=welcome, 2=vault choice, 3=dry-run report (existing only), 4=api key, 5=done
type WizardStep = 1 | 2 | 3 | 4 | 5;

interface DryRunReport {
  notesCount: number;
  brokenLinks: Array<{ file: string; target: string }>;
  nameCollisions: Array<{ name: string; file: string }>;
  missingFrontmatter: string[];
  fatalError: string | null;
}

export default function OnboardingWizard({ initialSettings, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [vaultChoice, setVaultChoice] = useState<VaultChoice>('sample');
  const [vaultPath, setVaultPath] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string>('');
  const [dryRun, setDryRun] = useState<DryRunReport | null>(null);

  // For existing vault, show dry-run step (3→4); blank/sample skip straight to API key
  const apiKeyStep: WizardStep = vaultChoice === 'existing' ? 4 : 3;
  const doneStep: WizardStep = vaultChoice === 'existing' ? 5 : 4;

  // Dot count adapts to path chosen
  const totalDots = vaultChoice === 'existing' ? 5 : 4;

  async function handleVaultNext() {
    setError('');
    if (vaultChoice === 'existing') {
      const result = await (window.api as unknown as { pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean }> }).pickFolder();
      if (result.cancelled || !result.vaultRoot) return;
      const chosenPath = result.vaultRoot;
      setVaultPath(chosenPath);
      setScanning(true);
      try {
        const report = await (window.api as unknown as { obsidianDryRun: (p: string) => Promise<DryRunReport> }).obsidianDryRun(chosenPath);
        setDryRun(report);
        setStep(3);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Scan failed');
      } finally {
        setScanning(false);
      }
    } else if (vaultChoice === 'sample') {
      setLoading(true);
      try {
        await (window.api as unknown as { loadSampleProject: () => Promise<{ vaultRoot: string }> }).loadSampleProject();
        setStep(apiKeyStep);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load sample project');
      } finally {
        setLoading(false);
      }
    } else {
      setStep(apiKeyStep);
    }
  }

  async function handleConfirmImport() {
    setError('');
    setRegistering(true);
    try {
      await (window.api as unknown as { obsidianRegister: (p: string) => Promise<unknown> }).obsidianRegister(vaultPath);
      setStep(apiKeyStep);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register vault');
    } finally {
      setRegistering(false);
    }
  }

  async function handleFinish(skipApiKey = false) {
    setSaving(true);
    setError('');
    try {
      const key = skipApiKey ? initialSettings.apiKey : apiKey.trim();
      const updated: AppSettings = {
        ...initialSettings,
        apiKey: key,
        onboardingComplete: true,
      };
      await window.api.settingsSet(updated);
      setStep(doneStep);
      onComplete(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function dotClass(dotN: number): string {
    if (step === dotN) return 'active';
    if (step > dotN) return 'done';
    return '';
  }

  const isBusy = scanning || loading || registering;
  const nextLabel = isBusy
    ? (scanning ? 'Scanning…' : loading ? 'Loading…' : 'Importing…')
    : vaultChoice === 'existing'
      ? 'Browse…'
      : 'Next';

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Onboarding wizard">
      <div className="onboarding-card">
        <div className="onboarding-steps" aria-label="Step indicator">
          {Array.from({ length: totalDots }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`onboarding-step-dot ${dotClass(n)}`}
              aria-current={step === n ? 'step' : undefined}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="onboarding-step" data-testid="step-welcome">
            <h1 className="onboarding-title">Welcome to Mythos Writer</h1>
            <p className="onboarding-subtitle">Your AI-powered creative writing companion.</p>
            <ul className="onboarding-features">
              <li>Block-based manuscript editor</li>
              <li>AI writing assistant &amp; brainstorm chat</li>
              <li>Entity vault with relationship graph</li>
              <li>Obsidian-compatible vault format</li>
            </ul>
            <div className="onboarding-actions">
              <button className="btn-primary" onClick={() => setStep(2)}>
                Get started
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step" data-testid="step-vault">
            <h2 className="onboarding-title">Choose your vault</h2>
            <p className="onboarding-subtitle">How would you like to get started?</p>
            <div className="onboarding-choices">
              <label className={`onboarding-choice ${vaultChoice === 'sample' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="vault-choice"
                  value="sample"
                  checked={vaultChoice === 'sample'}
                  onChange={() => setVaultChoice('sample')}
                  aria-label="Open sample project"
                />
                <span className="choice-header">
                  <span className="choice-title">Open sample project</span>
                  <span className="choice-recommended" aria-label="Recommended">Recommended</span>
                </span>
                <span className="choice-desc">Explore Mythos Writer with a ready-made story and characters.</span>
              </label>
              <label className={`onboarding-choice ${vaultChoice === 'blank' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="vault-choice"
                  value="blank"
                  checked={vaultChoice === 'blank'}
                  onChange={() => setVaultChoice('blank')}
                  aria-label="Start with a blank vault"
                />
                <span className="choice-title">Start blank</span>
                <span className="choice-desc">Create a fresh vault in the default location.</span>
              </label>
              <label className={`onboarding-choice ${vaultChoice === 'existing' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="vault-choice"
                  value="existing"
                  checked={vaultChoice === 'existing'}
                  onChange={() => setVaultChoice('existing')}
                  aria-label="Use existing Obsidian vault"
                />
                <span className="choice-title">Use existing Obsidian vault</span>
                <span className="choice-desc">Point to a folder you already have.</span>
              </label>
            </div>
            {error && (
              <p className="onboarding-error" role="alert">{error}</p>
            )}
            <div className="onboarding-actions">
              <button className="btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn-primary" onClick={handleVaultNext} disabled={isBusy}>
                {nextLabel}
              </button>
            </div>
          </div>
        )}

        {step === 3 && vaultChoice === 'existing' && dryRun && (
          <div className="onboarding-step" data-testid="step-dry-run">
            <h2 className="onboarding-title">Vault scan report</h2>
            <p className="onboarding-subtitle onboarding-vault-path" data-testid="vault-path-display">
              {vaultPath}
            </p>

            {dryRun.fatalError ? (
              <div className="dry-run-fatal" role="alert" data-testid="dry-run-fatal">
                <p className="onboarding-error">{dryRun.fatalError}</p>
                <p className="dry-run-hint">Check that the folder is readable and try again.</p>
              </div>
            ) : (
              <div className="dry-run-report" data-testid="dry-run-report">
                <div className="dry-run-stat">
                  <span className="dry-run-stat-value">{dryRun.notesCount}</span>
                  <span className="dry-run-stat-label">notes found</span>
                </div>

                {dryRun.brokenLinks.length > 0 && (
                  <details className="dry-run-section" open>
                    <summary className="dry-run-section-title dry-run-warn">
                      {dryRun.brokenLinks.length} broken [[link{dryRun.brokenLinks.length !== 1 ? 's' : ''}]]
                    </summary>
                    <ul className="dry-run-list">
                      {dryRun.brokenLinks.slice(0, 20).map((l, i) => (
                        <li key={i}>
                          <span className="dry-run-file">{l.file}</span>
                          {' → '}
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
                      {dryRun.nameCollisions.length} name collision{dryRun.nameCollisions.length !== 1 ? 's' : ''} with manifest
                    </summary>
                    <ul className="dry-run-list">
                      {dryRun.nameCollisions.map((c, i) => (
                        <li key={i}>
                          <span className="dry-run-file">{c.file}</span>
                          {' — '}
                          <strong>{c.name}</strong> already exists as an entity
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

                {dryRun.brokenLinks.length === 0 && dryRun.nameCollisions.length === 0 && dryRun.missingFrontmatter.length === 0 && (
                  <p className="dry-run-ok" data-testid="dry-run-ok">No issues found — vault looks great!</p>
                )}
              </div>
            )}

            {error && (
              <p className="onboarding-error" role="alert">{error}</p>
            )}
            <div className="onboarding-actions">
              <button className="btn-secondary" onClick={() => { setStep(2); setDryRun(null); }}>
                Back
              </button>
              {!dryRun.fatalError && (
                <button
                  className="btn-primary"
                  onClick={handleConfirmImport}
                  disabled={registering}
                  data-testid="confirm-import"
                >
                  {registering ? 'Importing…' : 'Import vault'}
                </button>
              )}
            </div>
          </div>
        )}

        {step === apiKeyStep && (
          <div className="onboarding-step" data-testid="step-apikey">
            <h2 className="onboarding-title">Add your API key</h2>
            <p className="onboarding-subtitle">
              Mythos Writer uses the Anthropic Claude API for AI features. You can skip this and add
              it later in Settings.
            </p>
            <label className="onboarding-label" htmlFor="api-key-input">
              Anthropic API key
            </label>
            <input
              id="api-key-input"
              type="password"
              className="onboarding-input"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="api-key-input"
            />
            {error && (
              <p className="onboarding-error" role="alert">
                {error}
              </p>
            )}
            <div className="onboarding-actions">
              <button className="btn-secondary" onClick={() => setStep(vaultChoice === 'existing' ? 3 : 2)}>
                Back
              </button>
              <button
                className="btn-ghost"
                onClick={() => handleFinish(true)}
                disabled={saving}
                data-testid="skip-api-key"
              >
                Skip for now
              </button>
              <button
                className="btn-primary"
                onClick={() => handleFinish(false)}
                disabled={saving || !apiKey.trim()}
                data-testid="save-api-key"
              >
                {saving ? 'Saving…' : 'Save & continue'}
              </button>
            </div>
          </div>
        )}

        {step === doneStep && (
          <div className="onboarding-step" data-testid="step-done">
            <div className="onboarding-done-icon" aria-hidden="true">&#x2713;</div>
            <h2 className="onboarding-title">You&apos;re all set!</h2>
            <p className="onboarding-subtitle">
              Mythos Writer is ready. Start writing your story.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
