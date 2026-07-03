import {
  PROVIDER_OPTIONS,
  LISTABLE_PROVIDERS,
  type ProviderKind,
  type TestConnectionStatus,
  type ModelListStatus,
} from '../settingsPanelTypes';

interface ProviderSectionProps {
  providerKind: ProviderKind;
  setProviderKind: (kind: ProviderKind) => void;
  providerApiKey: string;
  setProviderApiKey: (key: string) => void;
  providerApiKeyDirty: boolean;
  setProviderApiKeyDirty: (dirty: boolean) => void;
  providerBaseUrl: string;
  setProviderBaseUrl: (url: string) => void;
  providerModel: string;
  setProviderModel: (model: string) => void;
  savedProviderApiKey: string;
  testStatus: TestConnectionStatus;
  testMsg: string;
  onTest: () => void;
  modelList: string[];
  modelListStatus: ModelListStatus;
  modelListError: string | null;
  useCustomInput: boolean;
  setUseCustomInput: (v: boolean) => void;
  onFetchModels: (kind: ProviderKind, baseUrl: string) => void;
  setSavedOk: (ok: boolean) => void;
  activeProviderSupportsVoice: boolean;
  setTestConnectionStatus: (status: TestConnectionStatus) => void;
  setModelList: (list: string[]) => void;
  setModelListStatus: (status: ModelListStatus) => void;
  setModelListError: (error: string | null) => void;
}

export default function ProviderSection({
  providerKind,
  setProviderKind,
  providerApiKey,
  setProviderApiKey,
  providerApiKeyDirty,
  setProviderApiKeyDirty,
  providerBaseUrl,
  setProviderBaseUrl,
  providerModel,
  setProviderModel,
  savedProviderApiKey,
  testStatus,
  testMsg,
  onTest,
  modelList,
  modelListStatus,
  modelListError,
  useCustomInput,
  setUseCustomInput,
  onFetchModels,
  setSavedOk,
  activeProviderSupportsVoice,
  setTestConnectionStatus,
  setModelList,
  setModelListStatus,
  setModelListError,
}: ProviderSectionProps) {
  return (
    <section className="settings-section provider-settings-section" aria-labelledby="section-providers" data-settings-cat="agents">
      <h3 className="settings-section-title" id="section-providers">Provider Configuration</h3>
      {activeProviderSupportsVoice && (
        <span
          className="provider-voice-badge"
          aria-label="This provider supports voice input and/or output"
          role="status"
        >
          Voice
        </span>
      )}
      <div className="settings-field">
        <label className="settings-label" htmlFor="provider-select">Provider</label>
        <select
          id="provider-select"
          className="settings-input settings-select"
          value={providerKind}
          aria-label="AI provider"
          onChange={(e) => {
            const next = e.target.value as ProviderKind;
            setProviderKind(next);
            setProviderApiKeyDirty(false);
            setTestConnectionStatus('idle');
            setSavedOk(false);
            // SKY-1501: reset model list and auto-fetch for new provider
            setModelList([]);
            setModelListStatus('idle');
            setModelListError(null);
            setUseCustomInput(false);
            onFetchModels(next, providerBaseUrl);
          }}
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {(() => {
        const def = PROVIDER_OPTIONS.find((p) => p.value === providerKind)!;
        return (
          <>
            {def.needsKey && (
              <div className="settings-field">
                <label className="settings-label" htmlFor="provider-api-key">API Key</label>
                <div className="settings-input-row">
                  <input
                    id="provider-api-key"
                    className="settings-input"
                    type="password"
                    value={providerApiKey}
                    placeholder={savedProviderApiKey ? 'Key configured — enter a new key to replace' : 'Paste API key…'}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Provider API key"
                    onChange={(e) => { setProviderApiKey(e.target.value); setProviderApiKeyDirty(true); setTestConnectionStatus('idle'); setSavedOk(false); }}
                  />
                </div>
                {!providerApiKeyDirty && savedProviderApiKey && (
                  <p className="settings-hint" data-testid="provider-key-configured-hint">Key is already configured.</p>
                )}
              </div>
            )}
            {def.needsUrl && (
              <div className="settings-field">
                <label className="settings-label" htmlFor="provider-base-url">Base URL</label>
                <input
                  id="provider-base-url"
                  className="settings-input"
                  type="url"
                  value={providerBaseUrl}
                  placeholder="http://localhost:11434"
                  spellCheck={false}
                  aria-label="Provider base URL"
                  onChange={(e) => { setProviderBaseUrl(e.target.value); setTestConnectionStatus('idle'); setSavedOk(false); }}
                />
              </div>
            )}
            <div className="settings-field">
              <label className="settings-label" htmlFor="provider-model">Default model</label>
              {LISTABLE_PROVIDERS.has(providerKind) && modelListStatus === 'ok' && modelList.length > 0 && !useCustomInput ? (
                <select
                  id="provider-model"
                  className="settings-input settings-select"
                  value={modelList.includes(providerModel) ? providerModel : ''}
                  aria-label="Default model for this provider"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__custom__') {
                      setUseCustomInput(true);
                      setProviderModel('');
                    } else {
                      setProviderModel(val);
                    }
                    setSavedOk(false);
                  }}
                >
                  {!modelList.includes(providerModel) && providerModel && (
                    <option value={providerModel}>{providerModel}</option>
                  )}
                  {modelList.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
              ) : (
                <input
                  id="provider-model"
                  className="settings-input"
                  type="text"
                  value={providerModel}
                  placeholder={providerKind === 'anthropic' ? 'claude-sonnet-4-6' : 'model name'}
                  spellCheck={false}
                  aria-label="Default model for this provider"
                  onChange={(e) => { setProviderModel(e.target.value); setSavedOk(false); }}
                />
              )}
              {modelListStatus === 'loading' && (
                <p className="settings-hint" data-testid="model-list-loading">Loading models…</p>
              )}
              {modelListStatus === 'error' && modelListError && (
                <p className="settings-hint settings-hint-warn" data-testid={providerKind === 'ollama' ? 'ollama-not-running-hint' : 'model-list-error'}>
                  {modelListError}
                </p>
              )}
              {LISTABLE_PROVIDERS.has(providerKind) && (
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  disabled={modelListStatus === 'loading'}
                  aria-label="Refresh model list"
                  data-testid="refresh-models-btn"
                  onClick={() => onFetchModels(providerKind, providerBaseUrl)}
                >
                  {modelListStatus === 'loading' ? 'Loading…' : 'Refresh models'}
                </button>
              )}
            </div>
            <div className="settings-field">
              <div className="settings-input-row">
                <button
                  className="settings-btn settings-btn-secondary"
                  type="button"
                  disabled={testStatus === 'testing'}
                  aria-label="Test provider connection"
                  onClick={onTest}
                >
                  {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {testStatus === 'ok' && (
                  <span className="settings-test-ok" role="status">{testMsg}</span>
                )}
                {testStatus === 'error' && (
                  <span className="settings-test-error" role="alert">{testMsg}</span>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </section>
  );
}
