interface ApiKeySectionProps {
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  apiKeyDirty: boolean;
  setApiKeyDirty: (v: boolean) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  keyIsConfigured: boolean;
  apiKeyError: string | null;
  setSavedOk: (ok: boolean) => void;
}

export default function ApiKeySection({
  apiKeyInput,
  setApiKeyInput,
  apiKeyDirty,
  setApiKeyDirty,
  showApiKey,
  setShowApiKey,
  keyIsConfigured,
  apiKeyError,
  setSavedOk,
}: ApiKeySectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-api-key" data-settings-cat="agents">
      <h3 className="settings-section-title" id="section-api-key">API Key</h3>
      <div className="settings-field">
        <label className="settings-label" htmlFor="api-key-input">Anthropic API Key</label>
        <div className="settings-input-row">
          <input
            id="api-key-input"
            className={`settings-input${apiKeyError ? ' settings-input-error' : ''}`}
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => { setApiKeyInput(e.target.value); setApiKeyDirty(true); setSavedOk(false); }}
            placeholder={keyIsConfigured ? 'Key configured — enter a new key to replace' : 'sk-ant-…'}
            aria-invalid={apiKeyError ? 'true' : 'false'}
            aria-describedby={apiKeyError ? 'api-key-error api-key-hint' : 'api-key-hint'}
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
        {apiKeyError && (
          <p className="settings-error-msg" id="api-key-error" role="alert">{apiKeyError}</p>
        )}
        {!apiKeyDirty && keyIsConfigured && (
          <p className="settings-hint" data-testid="key-configured-hint">Key is already configured.</p>
        )}
        <p className="settings-hint" id="api-key-hint">Used by all AI agents. Falls back to the ANTHROPIC_API_KEY environment variable if left empty.</p>
      </div>
    </section>
  );
}
