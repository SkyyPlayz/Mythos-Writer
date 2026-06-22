import { useState, useCallback, useEffect } from 'react';
import type {
  ProviderKind, AgentName, AgentOverrideState, TestConnectionStatus, ModelListStatus,
} from './settingsPanelTypes';
import {
  PROVIDER_OPTIONS, LISTABLE_PROVIDERS, DEFAULT_BASE_URLS, MODEL_OPTIONS,
  modelListErrorCopy, isLocalhostUrl,
} from './settingsPanelTypes';

interface Props {
  agentName: AgentName;
  idPrefix: string;
  globalProviderKind: ProviderKind;
  override: AgentOverrideState;
  savedApiKey?: string;
  testStatus: TestConnectionStatus;
  testMsg: string;
  onChange: <K extends keyof AgentOverrideState>(field: K, value: AgentOverrideState[K]) => void;
  onTest: () => void;
}

export default function AgentProviderSection({
  agentName,
  idPrefix,
  globalProviderKind,
  override,
  savedApiKey,
  testStatus,
  testMsg,
  onChange,
  onTest,
}: Props) {
  const activeKind = override.enabled ? override.kind : globalProviderKind;
  const activeDef = PROVIDER_OPTIONS.find((p) => p.value === activeKind)!;
  const overrideDef = PROVIDER_OPTIONS.find((p) => p.value === override.kind)!;
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListStatus, setModelListStatus] = useState<ModelListStatus>('idle');
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [useCustomInput, setUseCustomInput] = useState(false);

  const fetchModels = useCallback(async (kind: ProviderKind, baseUrl: string) => {
    if (!LISTABLE_PROVIDERS.has(kind)) {
      setModelList([]);
      setModelListStatus('idle');
      setModelListError(null);
      setUseCustomInput(false);
      return;
    }
    setModelListStatus('loading');
    setModelListError(null);
    try {
      const result = await window.api.providerListModels({ kind, baseUrl: baseUrl || undefined });
      if (result.ok) {
        setModelList(result.models);
        setModelListStatus(result.models.length > 0 ? 'ok' : 'idle');
        setModelListError(null);
        setUseCustomInput(false);
      } else {
        setModelList([]);
        setModelListStatus('error');
        setModelListError(modelListErrorCopy(kind, result.error));
      }
    } catch {
      setModelList([]);
      setModelListStatus('error');
      setModelListError(modelListErrorCopy(kind));
    }
  }, []);

  useEffect(() => {
    if (!override.enabled) {
      setModelList([]);
      setModelListStatus('idle');
      setModelListError(null);
      setUseCustomInput(false);
      return;
    }
    void fetchModels(override.kind, override.baseUrl);
  }, [override.enabled, override.kind, override.baseUrl, fetchModels]);

  // activeDef used only for the "using global provider" hint message
  void activeDef;

  return (
    <>
      {!override.enabled && (
        <p className="settings-hint" style={{ marginTop: 2, marginBottom: 2 }}>
          Using global provider ({PROVIDER_OPTIONS.find((p) => p.value === globalProviderKind)?.label ?? globalProviderKind}). Defaults from provider settings above.
        </p>
      )}

      <div className="settings-field settings-field-inline settings-agent-provider-toggle">
        <label className="settings-toggle" htmlFor={`${idPrefix}-provider-toggle`}>
          <input
            id={`${idPrefix}-provider-toggle`}
            type="checkbox"
            aria-label={`Enable ${agentName} provider override`}
            checked={override.enabled}
            onChange={(e) => onChange('enabled', e.target.checked)}
          />
          <span className="settings-toggle-track" />
        </label>
        <span className="settings-label">Override provider for this agent</span>
      </div>

      {override.enabled && (
        <div className="settings-agent-provider-form">
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor={`${idPrefix}-provider-kind`}>Provider</label>
            <select
              id={`${idPrefix}-provider-kind`}
              className="settings-input settings-select settings-input-sm"
              value={override.kind}
              aria-label={`Provider for ${agentName}`}
              onChange={(e) => {
                const newKind = e.target.value as ProviderKind;
                onChange('kind', newKind);
                if (DEFAULT_BASE_URLS[newKind]) onChange('baseUrl', DEFAULT_BASE_URLS[newKind]);
              }}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {overrideDef.needsKey && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor={`${idPrefix}-api-key`}>API Key</label>
              <input
                id={`${idPrefix}-api-key`}
                className="settings-input settings-input-sm"
                type="password"
                value={override.apiKey}
                placeholder={savedApiKey ? 'Key configured — enter new key to replace' : 'Paste API key…'}
                aria-label={`API key for ${agentName}`}
                onChange={(e) => { onChange('apiKey', e.target.value); onChange('apiKeyDirty', true); }}
              />
              {!override.apiKeyDirty && savedApiKey && (
                <p className="settings-hint">Key is already configured.</p>
              )}
            </div>
          )}

          {overrideDef.needsUrl && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor={`${idPrefix}-base-url`}>Base URL</label>
              <input
                id={`${idPrefix}-base-url`}
                className="settings-input settings-input-sm"
                type="url"
                value={override.baseUrl}
                placeholder={DEFAULT_BASE_URLS[override.kind] || 'https://…/v1'}
                aria-label={`Base URL for ${agentName}`}
                onChange={(e) => onChange('baseUrl', e.target.value)}
              />
              {override.baseUrl && !isLocalhostUrl(override.baseUrl) && (
                <p className="settings-hint settings-hint-warn" role="alert">
                  ⚠ This endpoint is not on localhost — your text will be sent to a remote server. Only use endpoints you own or fully trust.
                </p>
              )}
            </div>
          )}

          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor={`${idPrefix}-model`}>Model</label>
            {override.kind === 'anthropic' ? (
              <select
                id={`${idPrefix}-model`}
                className="settings-input settings-select settings-input-sm"
                value={MODEL_OPTIONS.some((o) => o.value === override.model) ? override.model : ''}
                aria-label={`Model for ${agentName}`}
                onChange={(e) => onChange('model', e.target.value)}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : LISTABLE_PROVIDERS.has(override.kind) && modelListStatus === 'ok' && modelList.length > 0 && !useCustomInput ? (
              <select
                id={`${idPrefix}-model`}
                className="settings-input settings-select settings-input-sm"
                value={modelList.includes(override.model) ? override.model : ''}
                aria-label={`Model for ${agentName}`}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '__custom__') {
                    setUseCustomInput(true);
                    onChange('model', '');
                  } else {
                    onChange('model', value);
                  }
                }}
              >
                {!modelList.includes(override.model) && override.model && (
                  <option value={override.model}>{override.model}</option>
                )}
                {modelList.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
            ) : (
              <input
                id={`${idPrefix}-model`}
                className="settings-input settings-input-sm"
                type="text"
                value={override.model}
                placeholder="e.g. llama3-70b, gpt-4o-mini"
                aria-label={`Model for ${agentName}`}
                maxLength={128}
                onChange={(e) => onChange('model', e.target.value)}
              />
            )}
            {LISTABLE_PROVIDERS.has(override.kind) && modelListStatus === 'loading' && (
              <p className="settings-hint" data-testid={`${idPrefix}-model-list-loading`}>Loading models…</p>
            )}
            {LISTABLE_PROVIDERS.has(override.kind) && modelListStatus === 'error' && modelListError && (
              <p className="settings-hint settings-hint-warn" data-testid={`${idPrefix}-model-list-error`}>
                {modelListError}
              </p>
            )}
            {LISTABLE_PROVIDERS.has(override.kind) && (
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                disabled={modelListStatus === 'loading'}
                aria-label={`Refresh models for ${agentName}`}
                onClick={() => fetchModels(override.kind, override.baseUrl)}
              >
                {modelListStatus === 'loading' ? 'Loading…' : 'Refresh models'}
              </button>
            )}
          </div>

          <div className="settings-field settings-field-inline">
            <button
              type="button"
              className="settings-btn"
              disabled={testStatus === 'testing'}
              aria-label={`Test provider connection for ${agentName}`}
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
      )}
    </>
  );
}
