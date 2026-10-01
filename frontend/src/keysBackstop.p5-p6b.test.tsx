/**
 * P5 — paste masked preview into Model & keys → inline error; field not dirty.
 * P6b — keyReentryPaths for provider.apiKey → missing + re-enter line.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModelKeysSection from './partner/ModelKeysSection';
import { MASKED_API_KEY_PREVIEW_MESSAGE } from './lib/maskedApiKeyPreview';

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
