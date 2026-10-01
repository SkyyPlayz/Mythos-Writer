import { useState } from 'react';
import { PROVIDER_OPTIONS, type ProviderKind } from '../settingsPanelTypes';
import {
  looksLikeMaskedApiKeyPreview,
  MASKED_API_KEY_PREVIEW_MESSAGE,
} from '../../../lib/maskedApiKeyPreview';

interface ApiKeySectionProps {
  providerKind: ProviderKind;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  apiKeyDirty: boolean;
  setApiKeyDirty: (v: boolean) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  keyIsConfigured: boolean;
  apiKeyError: string | null;
  setSavedOk: (ok: boolean) => void;
  /** Heal-on-read re-entry paths from main (path names only). */
  keyReentryPaths?: string[];
}

// SKY-11219: this legacy top-level key predates per-provider config (SKY-683)
// and is only consulted at runtime as a fallback when no provider has ever
// been saved. It must still adapt its copy to the selected provider — showing
// "Anthropic API Key" / sk-ant- guidance for a provider that needs no key at
// all falsely implies the app requires a cloud key to run locally.
export default function ApiKeySection({
  providerKind,
  apiKeyInput,
  setApiKeyInput,
  apiKeyDirty,
  setApiKeyDirty,
  showApiKey,
  setShowApiKey,
  keyIsConfigured,
  apiKeyError,
  setSavedOk,
  keyReentryPaths,
}: ApiKeySectionProps) {
  // Strip the parenthetical qualifier ("Anthropic (Claude)" -> "Anthropic",
  // "OpenAI" unchanged) — the full PROVIDER_OPTIONS label is meant for the
  // provider <select>, not for prefixing this field's short label.
  const providerLabel = (PROVIDER_OPTIONS.find((p) => p.value === providerKind)?.label ?? 'Provider').replace(/\s*\(.*\)$/, '');
  const hint = providerKind === 'anthropic'
    ? 'Used by all AI agents. Falls back to the ANTHROPIC_API_KEY environment variable if left empty.'
    : 'Used by all AI agents unless overridden per-agent below.';
  const needsReentry = (keyReentryPaths ?? []).includes('apiKey');
  const showConfigured = !apiKeyDirty && keyIsConfigured && !needsReentry;
  const [pasteMaskError, setPasteMaskError] = useState<string | null>(null);

  return (
    <section className="settings-section" aria-labelledby="section-api-key" data-settings-cat="agents">
      <h3 className="settings-section-title" id="section-api-key">API Key</h3>
      <div className="settings-field">
        <label className="settings-label" htmlFor="api-key-input">{providerLabel} API Key</label>
        <div className="settings-input-row">
          <input
            id="api-key-input"
            className={`settings-input${apiKeyError || pasteMaskError ? ' settings-input-error' : ''}`}
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => {
              const next = e.target.value;
              if (looksLikeMaskedApiKeyPreview(next)) {
                setPasteMaskError(MASKED_API_KEY_PREVIEW_MESSAGE);
                return;
              }
              setPasteMaskError(null);
              setApiKeyInput(next);
              setApiKeyDirty(true);
              setSavedOk(false);
            }}
            placeholder={keyIsConfigured && !needsReentry ? 'Key configured — enter a new key to replace' : (providerKind === 'anthropic' ? 'sk-ant-…' : 'Paste API key…')}
            aria-invalid={apiKeyError || pasteMaskError ? 'true' : 'false'}
            aria-describedby={apiKeyError || pasteMaskError ? 'api-key-error api-key-hint' : 'api-key-hint'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="settings-reveal-btn"
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {pasteMaskError && (
          <p className="settings-error-msg" id="api-key-error" role="alert" data-testid="legacy-api-key-mask-error">
            {pasteMaskError}
          </p>
        )}
        {apiKeyError && !pasteMaskError && (
          <p className="settings-error-msg" id="api-key-error" role="alert">{apiKeyError}</p>
        )}
        {needsReentry && !pasteMaskError && (
          <p className="settings-error-msg" role="status" data-testid="legacy-api-key-reentry">
            Please re-enter your key.
          </p>
        )}
        {showConfigured && (
          <p className="settings-hint" data-testid="key-configured-hint">Key is already configured.</p>
        )}
        <p className="settings-hint" id="api-key-hint">{hint}</p>
      </div>
    </section>
  );
}
