/**
 * P5 — paste masked preview into Model & keys → inline error; field not dirty.
 * P6b — keyReentryPaths for provider.apiKey → missing + re-enter line.
 * S6 — same paste + re-enter coverage for legacy apiKey, ProviderSection, and
 *       per-agent AgentProviderSection inputs (voice/STT/TTS have no key inputs).
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModelKeysSection from './partner/ModelKeysSection';
import ApiKeySection from './components/SettingsPanel/sections/ApiKeySection';
import ProviderSection from './components/SettingsPanel/sections/ProviderSection';
import AgentProviderSection from './components/SettingsPanel/AgentProviderSection';
import { MASKED_API_KEY_PREVIEW_MESSAGE } from './lib/maskedApiKeyPreview';
import { DEFAULT_AGENT_OVERRIDE } from './components/SettingsPanel/settingsPanelTypes';

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    provider: { kind: 'anthropic', apiKey: '', model: '', baseUrl: '' },
    writingPartner: {
      modelKeysProvider: 'paste-key',
      claudeCli: 'none',
      claudeCliMode: 'app',
      modelPartner: '',
      modelWriter: '',
      modelAnalyst: '',
      modelArchivist: '',
      telemetryLevel: 'off',
    },
    ...overrides,
  } as unknown as AppSettings;
}

function renderMk(overrides: {
  settings?: AppSettings;
  setProviderApiKey?: (v: string) => void;
  setProviderApiKeyDirty?: (v: boolean) => void;
  setSavedOk?: (ok: boolean) => void;
} = {}) {
  const setProviderApiKey = overrides.setProviderApiKey ?? vi.fn<(v: string) => void>();
  const setProviderApiKeyDirty = overrides.setProviderApiKeyDirty ?? vi.fn<(v: boolean) => void>();
  const setSavedOk = overrides.setSavedOk ?? vi.fn<(ok: boolean) => void>();
  render(
    <ModelKeysSection
      settings={overrides.settings ?? baseSettings()}
      setSettings={vi.fn()}
      onTestConnection={vi.fn()}
      testStatus="idle"
      testMsg=""
      providerApiKey=""
      setProviderApiKey={setProviderApiKey}
      providerApiKeyDirty={false}
      setProviderApiKeyDirty={setProviderApiKeyDirty}
      providerBaseUrl=""
      setProviderBaseUrl={vi.fn()}
      showApiKey={false}
      setShowApiKey={vi.fn()}
      setSavedOk={setSavedOk}
    />,
  );
  return { setProviderApiKey, setProviderApiKeyDirty, setSavedOk };
}

describe('P5 — Model & keys paste mask guard', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = {
      agentsVaultStats: vi.fn().mockResolvedValue({ ok: false, error: 'No Mythos vault open' }),
    };
  });

  it('paste sk-ant-...ABCD shows error; does not dirty; Save would send no new value', async () => {
    const { setProviderApiKey, setProviderApiKeyDirty, setSavedOk } = renderMk();
    await screen.findByTestId('mk-keys-error');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-ant-...ABCD' } });
    });
    expect(screen.getByTestId('mk-api-key-mask-error')).toHaveTextContent(MASKED_API_KEY_PREVIEW_MESSAGE);
    expect(setProviderApiKey).not.toHaveBeenCalled();
    expect(setProviderApiKeyDirty).not.toHaveBeenCalled();
    expect(setSavedOk).not.toHaveBeenCalled();
  });
});

describe('P6b — keyReentryPaths shows re-enter line', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = {
      agentsVaultStats: vi.fn().mockResolvedValue({ ok: false, error: 'No Mythos vault open' }),
    };
  });

  it('provider.apiKey in keyReentryPaths → missing + Please re-enter your key', async () => {
    renderMk({
      settings: baseSettings({
        keyReentryPaths: ['provider.apiKey'],
        provider: { kind: 'anthropic', apiKey: '', model: '', baseUrl: '' },
      }),
    });
    await screen.findByTestId('mk-keys-error');
    expect(screen.getByTestId('mk-api-key-reentry')).toHaveTextContent('Please re-enter your key.');
    expect(screen.getByTestId('mk-api-key-missing')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mk-api-key-reentry')).toBeInTheDocument());
  });
});

describe('S6 — legacy apiKey field group', () => {
  it('apiKey in keyReentryPaths → Please re-enter your key (S3 legacy line)', () => {
    const setApiKeyInput = vi.fn();
    const setApiKeyDirty = vi.fn();
    const setSavedOk = vi.fn();
    render(
      <ApiKeySection
        providerKind="anthropic"
        apiKeyInput=""
        setApiKeyInput={setApiKeyInput}
        apiKeyDirty={false}
        setApiKeyDirty={setApiKeyDirty}
        showApiKey={false}
        setShowApiKey={vi.fn()}
        keyIsConfigured={false}
        apiKeyError={null}
        setSavedOk={setSavedOk}
        keyReentryPaths={['apiKey']}
      />,
    );
    expect(screen.getByTestId('legacy-api-key-reentry')).toHaveTextContent('Please re-enter your key.');
  });

  it('paste mask into legacy apiKey → inline error; field not dirty', () => {
    const setApiKeyInput = vi.fn();
    const setApiKeyDirty = vi.fn();
    const setSavedOk = vi.fn();
    render(
      <ApiKeySection
        providerKind="anthropic"
        apiKeyInput=""
        setApiKeyInput={setApiKeyInput}
        apiKeyDirty={false}
        setApiKeyDirty={setApiKeyDirty}
        showApiKey={false}
        setShowApiKey={vi.fn()}
        keyIsConfigured={false}
        apiKeyError={null}
        setSavedOk={setSavedOk}
      />,
    );
    fireEvent.change(document.getElementById('api-key-input') as HTMLInputElement, {
      target: { value: 'sk-ant-...ABCD' },
    });
    expect(screen.getByTestId('legacy-api-key-mask-error')).toHaveTextContent(MASKED_API_KEY_PREVIEW_MESSAGE);
    expect(setApiKeyInput).not.toHaveBeenCalled();
    expect(setApiKeyDirty).not.toHaveBeenCalled();
    expect(setSavedOk).not.toHaveBeenCalled();
  });
});

describe('S6 — per-agent key field group', () => {
  it('agents.writingAssistant.provider.apiKey flagged → re-enter line; paste mask refused', () => {
    const onChange = vi.fn();
    const override = {
      ...DEFAULT_AGENT_OVERRIDE,
      enabled: true,
      kind: 'anthropic' as const,
      apiKey: '',
      apiKeyDirty: false,
    };
    render(
      <AgentProviderSection
        agentName="writingAssistant"
        idPrefix="wa"
        globalProviderKind="anthropic"
        override={override}
        savedApiKey=""
        testStatus="idle"
        testMsg=""
        onChange={onChange}
        onTest={vi.fn()}
        keyReentryPaths={['agents.writingAssistant.provider.apiKey']}
      />,
    );
    expect(screen.getByTestId('wa-api-key-reentry')).toHaveTextContent('Please re-enter your key.');
    fireEvent.change(screen.getByLabelText('API key for writingAssistant'), {
      target: { value: 'sk-ant-...WXYZ' },
    });
    expect(screen.getByTestId('wa-api-key-mask-error')).toHaveTextContent(MASKED_API_KEY_PREVIEW_MESSAGE);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('S6 — ProviderSection group', () => {
  function renderProvider(opts: {
    keyReentryPaths?: string[];
    providerApiKey?: string;
    savedProviderApiKey?: string;
    setProviderApiKey?: (v: string) => void;
    setProviderApiKeyDirty?: (v: boolean) => void;
  } = {}) {
    const setProviderApiKey = opts.setProviderApiKey ?? vi.fn<(v: string) => void>();
    const setProviderApiKeyDirty = opts.setProviderApiKeyDirty ?? vi.fn<(v: boolean) => void>();
    render(
      <ProviderSection
        providerKind="anthropic"
        setProviderKind={vi.fn()}
        providerApiKey={opts.providerApiKey ?? ''}
        setProviderApiKey={setProviderApiKey}
        providerApiKeyDirty={false}
        setProviderApiKeyDirty={setProviderApiKeyDirty}
        providerBaseUrl=""
        setProviderBaseUrl={vi.fn()}
        providerModel=""
        setProviderModel={vi.fn()}
        savedProviderApiKey={opts.savedProviderApiKey ?? ''}
        testStatus="idle"
        testMsg=""
        onTest={vi.fn()}
        modelList={[]}
        modelListStatus="idle"
        modelListError={null}
        useCustomInput={false}
        setUseCustomInput={vi.fn()}
        onFetchModels={vi.fn()}
        setSavedOk={vi.fn()}
        activeProviderSupportsVoice={false}
        setTestConnectionStatus={vi.fn()}
        setModelList={vi.fn()}
        setModelListStatus={vi.fn()}
        setModelListError={vi.fn()}
        keyReentryPaths={opts.keyReentryPaths}
      />,
    );
    return { setProviderApiKey, setProviderApiKeyDirty };
  }

  it('(a) provider.apiKey in keyReentryPaths → Please re-enter your key; configured hint hidden', () => {
    renderProvider({
      keyReentryPaths: ['provider.apiKey'],
      // Would otherwise show "Key is already configured" if re-entry were dead.
      savedProviderApiKey: 'sk-ant-...ABCD',
    });
    expect(screen.getByTestId('provider-api-key-reentry')).toHaveTextContent('Please re-enter your key.');
    expect(screen.queryByTestId('provider-key-configured-hint')).not.toBeInTheDocument();
  });

  it('(b) paste mask → MASKED_API_KEY_PREVIEW_MESSAGE; provider key not dirty/saved', () => {
    const { setProviderApiKey, setProviderApiKeyDirty } = renderProvider();
    fireEvent.change(screen.getByLabelText('Provider API key'), {
      target: { value: 'sk-ant-...ABCD' },
    });
    expect(screen.getByTestId('provider-api-key-mask-error')).toHaveTextContent(MASKED_API_KEY_PREVIEW_MESSAGE);
    expect(setProviderApiKey).not.toHaveBeenCalled();
    expect(setProviderApiKeyDirty).not.toHaveBeenCalled();
  });
});
