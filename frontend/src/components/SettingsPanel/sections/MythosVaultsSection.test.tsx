// Beta 4 M1 — Mythos vaults cards: per-vault default theme select (§3;
// prototype myVaultRows 7103–7121). Covers: dropdown persists vaultThemes,
// current-vault change applies live + toasts, card click switches vaults.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MythosVaultsSection from './MythosVaultsSection';
import { LIQUID_NEON_PRESETS } from '../../../theme/presets';
import { resetLiquidNeonV2Tokens } from '../../../theme/liquidNeonEngine';

const VAULT_A = '/vaults/Alpha/Story Vault';
const VAULT_B = '/vaults/Beta/Story Vault';

const mockProjectList = vi.fn();
const mockGetVaultRoot = vi.fn();
const mockProjectSwitch = vi.fn();
const mockSettingsSet = vi.fn();

const baseSettings = { apiKey: '', agents: {}, theme: 'dark' } as unknown as AppSettings;

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectList.mockResolvedValue({
    projects: [
      { vaultRoot: VAULT_A, notesVaultRoot: '/vaults/Alpha/Notes Vault', name: 'Alpha', openedAt: '' },
      { vaultRoot: VAULT_B, notesVaultRoot: '/vaults/Beta/Notes Vault', name: 'Beta', openedAt: '' },
    ],
  });
  mockGetVaultRoot.mockResolvedValue({ vaultRoot: VAULT_A });
  mockProjectSwitch.mockResolvedValue({ switched: true });
  mockSettingsSet.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: {
      projectList: mockProjectList,
      getVaultRoot: mockGetVaultRoot,
      projectSwitch: mockProjectSwitch,
      settingsSet: mockSettingsSet,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  resetLiquidNeonV2Tokens();
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((n) => n.remove());
});

async function setup(settings: AppSettings = baseSettings) {
  const setSettings = vi.fn();
  const setSavedOk = vi.fn();
  await act(async () => {
    render(<MythosVaultsSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />);
  });
  await waitFor(() => expect(screen.getByTestId(`mvs-card-${VAULT_A}`)).toBeInTheDocument());
  return { setSettings, setSavedOk };
}

describe('MythosVaultsSection (Beta 4 M1)', () => {
  it('renders a card per known vault with a VAULT THEME select and Current chip', async () => {
    await setup();
    expect(screen.getByTestId(`mvs-card-${VAULT_B}`)).toBeInTheDocument();
    expect(screen.getByTestId(`mvs-theme-${VAULT_A}`)).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Click to switch ›')).toBeInTheDocument();
  });

  it('choosing a theme for a NON-current vault stores it and persists, without recoloring now', async () => {
    const { setSettings, setSavedOk } = await setup();
    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_B}`), { target: { value: 'ice' } });
    expect(setSettings).toHaveBeenCalledTimes(1);
    const next = setSettings.mock.calls[0][0] as AppSettings;
    expect(next.vaultThemes).toEqual({ [VAULT_B]: 'ice' });
    expect(next.liquidNeonV2).toBeUndefined(); // current theme untouched
    expect(mockSettingsSet).toHaveBeenCalledWith(next); // applies on switch without a panel Save
    expect(setSavedOk).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('ln-toast').textContent).toContain('default theme — Ice Mono');
  });

  it('choosing a theme for the CURRENT vault also applies it live (setKey+slots+wp match)', async () => {
    const { setSettings } = await setup();
    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_A}`), { target: { value: 'ember' } });
    const next = setSettings.mock.calls[0][0] as AppSettings;
    expect(next.vaultThemes).toEqual({ [VAULT_A]: 'ember' });
    expect(next.liquidNeonV2?.setKey).toBe('ember');
    expect(next.liquidNeonV2?.slots).toEqual([...LIQUID_NEON_PRESETS.ember.c]);
    expect(next.liquidNeonV2?.wp).toBe('match');
    // Live token apply hit the document root with Emberfall's slot A.
    expect(document.documentElement.style.getPropertyValue('--n1')).toBe('#ff6b4d');
  });

  it('clicking a non-current card switches vaults (theme applies via the switch push)', async () => {
    await setup({ ...baseSettings, vaultThemes: { [VAULT_B]: 'ice' } } as AppSettings);
    fireEvent.click(screen.getByTestId(`mvs-card-${VAULT_B}`));
    await waitFor(() => expect(mockProjectSwitch).toHaveBeenCalledWith(VAULT_B, '/vaults/Beta/Notes Vault'));
  });

  it('clicking the current card is a no-op; the theme select never triggers a switch', async () => {
    await setup();
    fireEvent.click(screen.getByTestId(`mvs-card-${VAULT_A}`));
    fireEvent.click(screen.getByTestId(`mvs-theme-${VAULT_B}`));
    expect(mockProjectSwitch).not.toHaveBeenCalled();
  });

  it('cards are keyboard-activatable (CF-7): Enter switches', async () => {
    await setup();
    const card = screen.getByTestId(`mvs-card-${VAULT_B}`);
    expect(card).toHaveAttribute('tabIndex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(mockProjectSwitch).toHaveBeenCalledTimes(1));
  });

  it('shows the empty hint when no vaults are known', async () => {
    mockProjectList.mockResolvedValue({ projects: [] });
    const setSettings = vi.fn();
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={setSettings} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId('mvs-empty')).toBeInTheDocument());
  });
});
