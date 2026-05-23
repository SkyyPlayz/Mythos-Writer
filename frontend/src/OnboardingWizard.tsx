import { useState } from 'react';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  initialSettings: AppSettings;
  onComplete: (settings: AppSettings) => void;
}

type VaultChoice = 'new' | 'existing';

const AGENT_LABELS: { key: keyof AppSettings['agents']; label: string; desc: string }[] = [
  { key: 'writingAssistant', label: 'Writing Assistant', desc: 'Inline style and continuity suggestions as you write.' },
  { key: 'brainstorm', label: 'Brainstorm Agent', desc: 'AI chat for plot, character, and world-building ideas.' },
  { key: 'archive', label: 'Archive Agent', desc: 'Continuity checks and automatic entity extraction.' },
];

export default function OnboardingWizard({ initialSettings, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [vaultChoice, setVaultChoice] = useState<VaultChoice>('new');
  const [vaultPath, setVaultPath] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [agentEnabled, setAgentEnabled] = useState<Record<keyof AppSettings['agents'], boolean>>({
    writingAssistant: initialSettings.agents.writingAssistant.enabled,
    brainstorm: initialSettings.agents.brainstorm.enabled,
    archive: initialSettings.agents.archive.enabled,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  async function handleVaultNext() {
    if (vaultChoice === 'existing') {
      const result = await window.api.openVaultFolder();
      if (result.cancelled || !result.vaultRoot) return;
      setVaultPath(result.vaultRoot);
    }
    setStep(3);
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
        agents: {
          writingAssistant: { ...initialSettings.agents.writingAssistant, enabled: agentEnabled.writingAssistant },
          brainstorm: { ...initialSettings.agents.brainstorm, enabled: agentEnabled.brainstorm },
          archive: { ...initialSettings.agents.archive, enabled: agentEnabled.archive },
        },
      };
      await window.api.settingsSet(updated);
      setStep(5);
      onComplete(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Onboarding wizard">
      <div className="onboarding-card">
        <div className="onboarding-steps" aria-label="Step indicator">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={`onboarding-step-dot ${step === n ? 'active' : step > n ? 'done' : ''}`}
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
            <p className="onboarding-subtitle">Where should Mythos Writer store your work?</p>
            <div className="onboarding-choices">
              <label className={`onboarding-choice ${vaultChoice === 'new' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="vault-choice"
                  value="new"
                  checked={vaultChoice === 'new'}
                  onChange={() => setVaultChoice('new')}
                />
                <span className="choice-title">Create a new vault</span>
                <span className="choice-desc">Start fresh in the default location.</span>
              </label>
              <label className={`onboarding-choice ${vaultChoice === 'existing' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="vault-choice"
                  value="existing"
                  checked={vaultChoice === 'existing'}
                  onChange={() => setVaultChoice('existing')}
                />
                <span className="choice-title">Use existing Obsidian vault</span>
                <span className="choice-desc">Point to a folder you already have.</span>
              </label>
            </div>
            {vaultPath && (
              <p className="onboarding-vault-path" data-testid="vault-path-display">
                {vaultPath}
              </p>
            )}
            <div className="onboarding-actions">
              <button className="btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn-primary" onClick={handleVaultNext}>
                {vaultChoice === 'existing' ? 'Browse…' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
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
              <button className="btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn-ghost"
                onClick={() => setStep(4)}
                data-testid="skip-api-key"
              >
                Skip for now
              </button>
              <button
                className="btn-primary"
                onClick={() => setStep(4)}
                disabled={!apiKey.trim()}
                data-testid="save-api-key"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-step" data-testid="step-agents">
            <h2 className="onboarding-title">Choose default agents</h2>
            <p className="onboarding-subtitle">
              Enable or disable the AI agents. You can change these any time in Settings.
            </p>
            <div className="onboarding-agent-list">
              {AGENT_LABELS.map(({ key, label, desc }) => (
                <label key={key} className="onboarding-agent-row">
                  <div className="onboarding-agent-info">
                    <span className="onboarding-agent-name">{label}</span>
                    <span className="onboarding-agent-desc">{desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    className="onboarding-agent-toggle"
                    checked={agentEnabled[key]}
                    onChange={(e) => setAgentEnabled((prev) => ({ ...prev, [key]: e.target.checked }))}
                    aria-label={`Enable ${label}`}
                    data-testid={`agent-toggle-${key}`}
                  />
                </label>
              ))}
            </div>
            {error && (
              <p className="onboarding-error" role="alert">
                {error}
              </p>
            )}
            <div className="onboarding-actions">
              <button className="btn-secondary" onClick={() => setStep(3)}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={() => handleFinish(apiKey.trim() === '')}
                disabled={saving}
                data-testid="finish-onboarding"
              >
                {saving ? 'Saving…' : 'Finish'}
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="onboarding-step" data-testid="step-done">
            <div className="onboarding-done-icon" aria-hidden="true">✓</div>
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
