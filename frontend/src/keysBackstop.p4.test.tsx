/**
 * P4 — MythosVaultsSection theme/rename payloads carry disk key values
 * (fresh settingsGet), not panel-held stale masks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MythosVaultsSection from './components/SettingsPanel/sections/MythosVaultsSection';
import { resetLiquidNeonV2Tokens } from './theme/liquidNeonEngine';

const VAULT_A = '/vaults/Alpha/Story Vault';
const VAULT_B = '/vaults/Beta/Story Vault';

const DISK_KEY = 'sk-ant-DiskKeyOnDiskZZZZ999999999999999999999999';
const DISK_MASK = 'sk-ant-...9999';
const STALE_PANEL_MASK = 'sk-ant-...AAAA';

const mockSettingsSet = vi.fn();
const mockSettingsGet = vi.fn();
const mockProjectList = vi.fn();
const mockGetVaultRoot = vi.fn();
const mockProjectStats = vi.fn();
const mockProjectNameSet = vi.fn();
const mockVaultSurfaceListHidden = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectList.mockResolvedValue({
    projects: [
      { vaultRoot: VAULT_A, mythosVaultRoot: '/vaults/Alpha', notesVaultRoot: '/vaults/Alpha/Notes Vault', name: 'Alpha', openedAt: '' },
      { vaultRoot: VAULT_B, mythosVaultRoot: '/vaults/Beta', notesVaultRoot: '/vaults/Beta/Notes Vault', name: 'Beta', openedAt: '' },
    ],
  });
  mockGetVaultRoot.mockResolvedValue({ vaultRoot: VAULT_A });
  mockProjectStats.mockResolvedValue({ stats: [] });
  mockVaultSurfaceListHidden.mockResolvedValue({ hiddenVaultRoots: [] });
  mockProjectNameSet.mockResolvedValue({ ok: true, name: 'Renamed' });
  mockSettingsGet.mockResolvedValue({
    apiKey: DISK_MASK,
    provider: { kind: 'anthropic', model: 'x', apiKey: DISK_MASK },
    agents: {},
    theme: 'dark',
    vaultThemes: {},
    vaultDisplayNames: {},
  });
  mockSettingsSet.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: {
      projectList: mockProjectList,
      getVaultRoot: mockGetVaultRoot,
      projectStats: mockProjectStats,
      settingsGet: mockSettingsGet,
      settingsSet: mockSettingsSet,
      projectNameSet: mockProjectNameSet,
      vaultSurfaceListHidden: mockVaultSurfaceListHidden,
      vaultSurfaceUnhide: vi.fn(),
      vaultGetPaths: vi.fn().mockResolvedValue({}),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  resetLiquidNeonV2Tokens();
});

describe('P4 — MythosVaultsSection fresh-get write chain', () => {
  it('theme payload carries disk key values, not panel stale mask', async () => {
    const panelSettings = {
      apiKey: STALE_PANEL_MASK,
      provider: { kind: 'anthropic', model: 'x', apiKey: STALE_PANEL_MASK },
      agents: {},
      theme: 'dark',
      vaultThemes: {},
    } as unknown as AppSettings;
    const setSettings = vi.fn();
    render(
      <MythosVaultsSection
        settings={panelSettings}
        setSettings={setSettings}
        setSavedOk={vi.fn()}
      />,
    );
    await screen.findByTestId(`mvs-theme-${VAULT_B}`);
    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_B}`), { target: { value: 'ice' } });
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    const payload = mockSettingsSet.mock.calls[0][0] as AppSettings;
    expect(payload.apiKey).toBe(DISK_MASK);
    expect(payload.provider?.apiKey).toBe(DISK_MASK);
    expect(payload.apiKey).not.toBe(STALE_PANEL_MASK);
    expect(payload.vaultThemes?.[VAULT_B]).toBe('ice');
    // Disk raw never appears — only the masked get result.
    expect(JSON.stringify(payload)).not.toContain(DISK_KEY);
  });

  it('rename payload carries disk key values on the same chain', async () => {
    const panelSettings = {
      apiKey: STALE_PANEL_MASK,
      provider: { kind: 'anthropic', model: 'x', apiKey: STALE_PANEL_MASK },
      agents: {},
      theme: 'dark',
    } as unknown as AppSettings;
    render(
      <MythosVaultsSection
        settings={panelSettings}
        setSettings={vi.fn()}
        setSavedOk={vi.fn()}
      />,
    );
    await screen.findByText('Alpha');
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: 'Renamed Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    const payload = mockSettingsSet.mock.calls[0][0] as AppSettings;
    expect(payload.apiKey).toBe(DISK_MASK);
    expect(payload.provider?.apiKey).toBe(DISK_MASK);
    expect(payload.vaultDisplayNames?.[VAULT_A]).toBe('Renamed Alpha');
  });
});
