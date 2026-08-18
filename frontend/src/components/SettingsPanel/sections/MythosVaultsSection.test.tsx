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

const NEW_ROOT = '/vaults/Second Vault';

const mockProjectList = vi.fn();
const mockGetVaultRoot = vi.fn();
const mockProjectSwitch = vi.fn();
const mockSettingsSet = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockChooseVaultFolder = vi.fn();
const mockVaultCreateDefaultMythos = vi.fn();

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
  mockVaultGetPaths.mockResolvedValue({
    storyVaultPath: VAULT_A,
    notesVaultPath: '/vaults/Alpha/Notes Vault',
    defaultVaultsParentPath: '/vaults',
  });
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  mockVaultCreateDefaultMythos.mockResolvedValue({
    mythosVaultRoot: NEW_ROOT,
    vaultRoot: `${NEW_ROOT}/Story Vault`,
    notesVaultRoot: `${NEW_ROOT}/Notes Vault`,
    name: 'Second Vault',
    created: true,
  });
  Object.defineProperty(window, 'api', {
    value: {
      projectList: mockProjectList,
      getVaultRoot: mockGetVaultRoot,
      projectSwitch: mockProjectSwitch,
      settingsSet: mockSettingsSet,
      vaultGetPaths: mockVaultGetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      vaultCreateDefaultMythos: mockVaultCreateDefaultMythos,
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

describe('MythosVaultsSection — New vault flow (SKY-10401)', () => {
  async function openCreateForm() {
    const result = await setup();
    fireEvent.click(screen.getByTestId('mvs-new-vault'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument());
    return result;
  }

  it('New vault… opens the form with the destination prefilled from defaultVaultsParentPath', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    expect(mockVaultGetPaths).toHaveBeenCalledTimes(1);
    // Name input is focused for immediate typing.
    expect(screen.getByTestId('mvs-create-name')).toHaveFocus();
  });

  it('Browse… replaces the destination with the picked folder', async () => {
    mockChooseVaultFolder.mockResolvedValue({ path: '/elsewhere/Vaults', cancelled: false });
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-dest-browse'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/elsewhere/Vaults'));
    expect(mockChooseVaultFolder).toHaveBeenCalledWith('Choose where to create the new vault', '/vaults');
  });

  it('a cancelled Browse leaves the destination untouched', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-dest-browse'));
    await waitFor(() => expect(mockChooseVaultFolder).toHaveBeenCalled());
    expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults');
  });

  it('Create vault calls the SKY-320 backend with activate:false and offers a switch', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.change(screen.getByTestId('mvs-create-name'), { target: { value: '  Second Vault  ' } });
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
    expect(mockVaultCreateDefaultMythos).toHaveBeenCalledWith({
      parentPath: '/vaults',
      vaultName: 'Second Vault',
      seedMode: 'default',
      activate: false,
    });
    // Form closed, offer visible, vault list refreshed to include the new card.
    expect(screen.queryByTestId('mvs-create-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('mvs-create-done').textContent).toContain('Second Vault');
    expect(mockProjectList).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('ln-toast').textContent).toContain('Vault "Second Vault" created');
  });

  it('an empty name is allowed — main falls back to its default vault name', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(mockVaultCreateDefaultMythos).toHaveBeenCalledWith({
      parentPath: '/vaults',
      vaultName: undefined,
      seedMode: 'default',
      activate: false,
    }));
  });

  it('Switch to it now runs a normal project:switch and marks the new vault current', async () => {
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mvs-create-switch'));
    await waitFor(() => expect(mockProjectSwitch).toHaveBeenCalledWith(`${NEW_ROOT}/Story Vault`, `${NEW_ROOT}/Notes Vault`));
    await waitFor(() => expect(screen.queryByTestId('mvs-create-done')).not.toBeInTheDocument());
  });

  it('Not now dismisses the offer without switching; the vault stays in the list', async () => {
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mvs-create-stay'));
    expect(screen.queryByTestId('mvs-create-done')).not.toBeInTheDocument();
    expect(mockProjectSwitch).not.toHaveBeenCalled();
  });

  it('a backend error keeps the form open and announces the failure', async () => {
    mockVaultCreateDefaultMythos.mockResolvedValue({
      mythosVaultRoot: '', vaultRoot: '', notesVaultRoot: '', name: '', created: false,
      error: 'Mythos Vault folder is not empty',
    });
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-error')).toHaveTextContent('Mythos Vault folder is not empty'));
    expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument();
    expect(screen.queryByTestId('mvs-create-done')).not.toBeInTheDocument();
  });

  it('a failed switch keeps the offer and shows the error', async () => {
    mockProjectSwitch.mockResolvedValue({ switched: false });
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mvs-create-switch'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-error')).toBeInTheDocument());
    expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument();
  });

  it('Cancel closes the form without creating anything', async () => {
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-cancel'));
    expect(screen.queryByTestId('mvs-create-form')).not.toBeInTheDocument();
    expect(mockVaultCreateDefaultMythos).not.toHaveBeenCalled();
  });
});
