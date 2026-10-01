/**
 * F5 Critic Path A — Hands & files via agentsVault:* + modelKeysShowItemInFolder.
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

describe('ModelKeysSection F5 Hands & files (Path A)', () => {
  let agentsVaultStats: ReturnType<typeof vi.fn>;
  let agentsVaultReveal: ReturnType<typeof vi.fn>;
  let agentsVaultClearMemory: ReturnType<typeof vi.fn>;
  let modelKeysShowItemInFolder: ReturnType<typeof vi.fn>;
  let onMoveVault: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    agentsVaultStats = vi.fn().mockResolvedValue({
      ok: true,
      path: '/vault/Agent Vault',
      name: 'Agent Vault',
      files: 4,
      chips: ['partner.md', 'Writer', 'Analyst', 'Archivist'],
      scope: 'Test Vault',
    });
    agentsVaultReveal = vi.fn().mockResolvedValue({ opened: true });
    agentsVaultClearMemory = vi.fn().mockResolvedValue({ ok: true, removed: ['Sessions'] });
    modelKeysShowItemInFolder = vi.fn().mockResolvedValue({ opened: true });
    onMoveVault = vi.fn<() => void>();
    (window as unknown as { api: unknown }).api = {
      agentsVaultStats,
      agentsVaultReveal,
      agentsVaultClearMemory,
      modelKeysShowItemInFolder,
    };
  });

  function renderSection() {
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
        onMoveVault={onMoveVault}
      />,
    );
  }

  it('shows location path from agentsVaultStats', async () => {
    renderSection();
    expect(await screen.findByTestId('mk-keys-path')).toHaveTextContent('/vault/Agent Vault');
    expect(screen.getByTestId('mk-keys-scope')).toHaveTextContent('Test Vault');
    expect(screen.getByTestId('mk-keys-file-count')).toHaveTextContent('4 files');
    expect(agentsVaultStats).toHaveBeenCalled();
  });

  it('Clear copy mentions Sessions/ and Boards/brainstorm.board.json', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    expect(screen.getByTestId('mk-keys-files')).toHaveTextContent('Sessions/');
    expect(screen.getByTestId('mk-keys-files')).toHaveTextContent('Boards/brainstorm.board.json');
  });

  it('Reveal uses modelKeysShowItemInFolder; Open uses agentsVaultReveal', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    fireEvent.click(screen.getByTestId('mk-keys-reveal'));
    await waitFor(() => expect(modelKeysShowItemInFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mk-keys-open'));
    await waitFor(() => expect(agentsVaultReveal).toHaveBeenCalled());
  });

  it('Clear memory requires confirm then calls agentsVaultClearMemory', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    fireEvent.click(screen.getByTestId('mk-keys-clear'));
    expect(agentsVaultClearMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mk-keys-clear-confirm'));
    await waitFor(() => expect(agentsVaultClearMemory).toHaveBeenCalled());
    expect(await screen.findByTestId('mk-keys-status')).toHaveTextContent(/Cleared agent memory/);
  });

  it('Clear memory is disabled when Agent Vault is unavailable', async () => {
    agentsVaultStats.mockResolvedValue({ ok: false, error: 'No Mythos vault open' });
    renderSection();
    await screen.findByTestId('mk-keys-error');
    expect(screen.getByTestId('mk-keys-clear')).toBeDisabled();
  });

  it('refused Clear resets out of Confirm state', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    agentsVaultClearMemory.mockResolvedValueOnce({ ok: false, error: 'No Mythos vault open' });
    fireEvent.click(screen.getByTestId('mk-keys-clear'));
    fireEvent.click(screen.getByTestId('mk-keys-clear-confirm'));
    expect(await screen.findByTestId('mk-keys-error')).toHaveTextContent('No Mythos vault open');
    expect(screen.queryByTestId('mk-keys-clear-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('mk-keys-clear')).toBeInTheDocument();
  });

  it('Move vault… opens MoveVaultWizard via onMoveVault', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    expect(screen.getByTestId('mk-keys-move')).toHaveTextContent('Move vault…');
    fireEvent.click(screen.getByTestId('mk-keys-move'));
    expect(onMoveVault).toHaveBeenCalledTimes(1);
  });

  it('Move vault… is disabled without onMoveVault', async () => {
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

  it('Move copy states Story Vault only — Agent Vault sibling does not move', async () => {
    renderSection();
    await screen.findByTestId('mk-keys-path');
    const hint = screen.getByTestId('mk-keys-move-hint');
    expect(hint).toHaveTextContent(/Story Vault only/i);
    expect(hint).toHaveTextContent(/sibling/i);
    expect(hint).toHaveTextContent(/identity/i);
    expect(hint).not.toHaveTextContent(/Keys and memory move with the vault/);
  });

  it('shows plain inline error when agentsVaultStats reports no Mythos vault', async () => {
    agentsVaultStats.mockResolvedValue({ ok: false, error: 'No Mythos vault open' });
    renderSection();
    expect(await screen.findByTestId('mk-keys-error')).toHaveTextContent('No Mythos vault open');
    expect(screen.getByTestId('mk-keys-path')).toHaveTextContent('—');
  });
});
