/**
 * F5 — Models & Keys Hands & files UI (location / Reveal / Open / Clear / Move vault…).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModelKeysSection from './ModelKeysSection';

function baseSettings(): AppSettings {
  return {
    provider: { kind: 'anthropic', apiKey: '', baseUrl: '' },
    writingPartner: {
      modelKeysProvider: 'claude',
      claudeCli: 'none',
      claudeCliMode: 'app',
      modelPartner: '',
      modelWriter: '',
      modelAnalyst: '',
      modelArchivist: '',
      telemetryLevel: 'off',
    },
  } as unknown as AppSettings;
}

describe('ModelKeysSection F5 Hands & files', () => {
  let modelKeysLocation: ReturnType<typeof vi.fn>;
  let modelKeysReveal: ReturnType<typeof vi.fn>;
  let modelKeysOpen: ReturnType<typeof vi.fn>;
  let modelKeysClearMemory: ReturnType<typeof vi.fn>;
  let onMoveVault: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    modelKeysLocation = vi.fn().mockResolvedValue({
      ok: true,
      path: '/vault/Agent Vault',
      name: 'Agent Vault',
      files: 4,
      chips: ['partner.md', 'Writer', 'Analyst', 'Archivist'],
      scope: 'Test Vault',
    });
    modelKeysReveal = vi.fn().mockResolvedValue({ opened: true });
    modelKeysOpen = vi.fn().mockResolvedValue({ opened: true });
    modelKeysClearMemory = vi.fn().mockResolvedValue({ ok: true, removed: ['Sessions'] });
    onMoveVault = vi.fn();
    (window as unknown as { api: unknown }).api = {
      modelKeysLocation,
      modelKeysReveal,
      modelKeysOpen,
      modelKeysClearMemory,
    };
  });

  function renderSection(props: { onMoveVault?: () => void } = {}) {
    return render(
      <ModelKeysSection
        settings={baseSettings()}
        setSettings={vi.fn()}
        onTestConnection={vi.fn()}
        testStatus="idle"
        testMsg=""
        providerApiKey=""
        setProviderApiKey={vi.fn()}
        providerApiKeyDirty={false}
        setProviderApiKeyDirty={vi.fn()}
        providerBaseUrl=""
        setProviderBaseUrl={vi.fn()}
        showApiKey={false}
        setShowApiKey={vi.fn()}
        setSavedOk={vi.fn()}
        onMoveVault={props.onMoveVault ?? onMoveVault}
      />,
    );
  }

  it('shows location path after location IPC resolves', async () => {
    renderSection();
    expect(await screen.findByTestId('mk-keys-path')).toHaveTextContent('/vault/Agent Vault');
    expect(screen.getByTestId('mk-keys-scope')).toHaveTextContent('Test Vault');
    expect(screen.getByTestId('mk-keys-file-count')).toHaveTextContent('4 files');
  });

  it('Reveal and Open call sandboxed IPC', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    fireEvent.click(screen.getByTestId('mk-keys-reveal'));
    await waitFor(() => expect(modelKeysReveal).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mk-keys-open'));
    await waitFor(() => expect(modelKeysOpen).toHaveBeenCalled());
  });

  it('Clear memory requires confirm then clears', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    fireEvent.click(screen.getByTestId('mk-keys-clear'));
    expect(modelKeysClearMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mk-keys-clear-confirm'));
    await waitFor(() => expect(modelKeysClearMemory).toHaveBeenCalled());
    expect(await screen.findByTestId('mk-keys-status')).toHaveTextContent(/Cleared agent memory/);
  });

  it('Move vault… opens the existing MoveVaultWizard via onMoveVault', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    expect(screen.getByTestId('mk-keys-move')).toHaveTextContent('Move vault…');
    expect(screen.getByTestId('mk-keys-move-hint')).toHaveTextContent(
      'Keys and memory move with the vault.',
    );
    fireEvent.click(screen.getByTestId('mk-keys-move'));
    expect(onMoveVault).toHaveBeenCalledTimes(1);
  });

  it('Move vault… is disabled when onMoveVault is omitted', async () => {
    render(
      <ModelKeysSection
        settings={baseSettings()}
        setSettings={vi.fn()}
        onTestConnection={vi.fn()}
        testStatus="idle"
        testMsg=""
        providerApiKey=""
        setProviderApiKey={vi.fn()}
        providerApiKeyDirty={false}
        setProviderApiKeyDirty={vi.fn()}
        providerBaseUrl=""
        setProviderBaseUrl={vi.fn()}
        showApiKey={false}
        setShowApiKey={vi.fn()}
        setSavedOk={vi.fn()}
      />,
    );
    await screen.findByTestId('mk-keys-path');
    expect(screen.getByTestId('mk-keys-move')).toBeDisabled();
  });
});
