// Beta 4 M1 — Mythos vaults cards: per-vault default theme select (§3;
// prototype myVaultRows 7103–7121). Covers: dropdown persists vaultThemes,
// current-vault change applies live + toasts, card click switches vaults.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MythosVaultsSection from './MythosVaultsSection';
import { LIQUID_NEON_PRESETS } from '../../../theme/presets';
import { resetLiquidNeonV2Tokens } from '../../../theme/liquidNeonEngine';
import {
  enqueueSettingsWrite,
  __resetSettingsWriteSerialForTests,
} from '../../../settingsWriteSerial';

const VAULT_A = '/vaults/Alpha/Story Vault';
const VAULT_B = '/vaults/Beta/Story Vault';

const NEW_ROOT = '/vaults/Second Vault';

const mockProjectList = vi.fn();
const mockGetVaultRoot = vi.fn();
const mockProjectSwitch = vi.fn();
const mockSettingsSet = vi.fn();
const mockSettingsGet = vi.fn();
const mockProjectNameSet = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockChooseVaultFolder = vi.fn();
const mockCreateVaultFromOptions = vi.fn();
// SKY-11452: the legacy demo-seeding backend must never be reached from here.
const mockVaultCreateDefaultMythos = vi.fn();
const mockProjectStats = vi.fn();
const mockVaultSurfaceListHidden = vi.fn();
const mockVaultSurfaceUnhide = vi.fn();
const mockVaultSurfaceHide = vi.fn();
const mockVaultSurfaceTrash = vi.fn();
const mockVaultSurfaceBlastRadius = vi.fn();
const mockVaultSurfaceRevealMythos = vi.fn();
const mockNotesVaultRegistryList = vi.fn();
const mockStoryVaultRegistryList = vi.fn();

const baseSettings = { apiKey: '', agents: {}, theme: 'dark' } as unknown as AppSettings;

beforeEach(() => {
  vi.clearAllMocks();
  __resetSettingsWriteSerialForTests();
  mockProjectList.mockResolvedValue({
    projects: [
      { vaultRoot: VAULT_A, mythosVaultRoot: '/vaults/Alpha', notesVaultRoot: '/vaults/Alpha/Notes Vault', name: 'Alpha', openedAt: '' },
      { vaultRoot: VAULT_B, mythosVaultRoot: '/vaults/Beta', notesVaultRoot: '/vaults/Beta/Notes Vault', name: 'Beta', openedAt: '' },
    ],
  });
  mockGetVaultRoot.mockResolvedValue({ vaultRoot: VAULT_A });
  mockProjectSwitch.mockResolvedValue({ switched: true });
  mockSettingsSet.mockResolvedValue({ saved: true });
  mockSettingsGet.mockResolvedValue(baseSettings);
  mockProjectNameSet.mockResolvedValue({ ok: true, name: 'Renamed' });
  mockVaultGetPaths.mockResolvedValue({
    storyVaultPath: VAULT_A,
    notesVaultPath: '/vaults/Alpha/Notes Vault',
    defaultVaultsParentPath: '/vaults',
  });
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  mockCreateVaultFromOptions.mockResolvedValue({
    ok: true,
    mode: 'template',
    mythosRoot: NEW_ROOT,
    storyVaultPath: `${NEW_ROOT}/Story Vault`,
    notesVaultPath: `${NEW_ROOT}/Notes Vault`,
    vaultName: 'Second Vault',
  });
  mockProjectStats.mockResolvedValue({
    stats: [
      { vaultRoot: VAULT_A, storyFileCount: 3, noteCount: 2, notesVaultCount: 2, storyVaultCount: 1 },
      { vaultRoot: VAULT_B, storyFileCount: 1, noteCount: 0, notesVaultCount: 1, storyVaultCount: 1 },
    ],
  });
  mockVaultSurfaceListHidden.mockResolvedValue({ hiddenVaultRoots: [] });
  mockVaultSurfaceUnhide.mockResolvedValue({ ok: true });
  mockVaultSurfaceHide.mockResolvedValue({ hidden: true });
  mockVaultSurfaceTrash.mockResolvedValue({ trashed: true });
  // SKY-11322: must match VAULT_A's own mockProjectStats sum
  // (notesVaultCount:2 + storyVaultCount:1 = 3) — the same as the card's
  // displayed "2 notes vaults · 1 story vault" — so a real getBlastRadius
  // regression that disagreed with the card is caught by the cross-reference
  // assertion below, not masked by a mock that never has to agree with it.
  mockVaultSurfaceBlastRadius.mockResolvedValue({ vaultName: 'Alpha', innerCount: 3 });
  mockVaultSurfaceRevealMythos.mockResolvedValue({ opened: true });
  mockNotesVaultRegistryList.mockResolvedValue({ vaults: [], activeId: null });
  mockStoryVaultRegistryList.mockResolvedValue({ vaults: [], activeId: null });
  Object.defineProperty(window, 'api', {
    value: {
      projectList: mockProjectList,
      getVaultRoot: mockGetVaultRoot,
      projectSwitch: mockProjectSwitch,
      settingsSet: mockSettingsSet,
      settingsGet: mockSettingsGet,
      projectNameSet: mockProjectNameSet,
      vaultGetPaths: mockVaultGetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      createVaultFromOptions: mockCreateVaultFromOptions,
      vaultCreateDefaultMythos: mockVaultCreateDefaultMythos,
      projectStats: mockProjectStats,
      vaultSurfaceListHidden: mockVaultSurfaceListHidden,
      vaultSurfaceUnhide: mockVaultSurfaceUnhide,
      vaultSurfaceHide: mockVaultSurfaceHide,
      vaultSurfaceTrash: mockVaultSurfaceTrash,
      vaultSurfaceBlastRadius: mockVaultSurfaceBlastRadius,
      vaultSurfaceRevealMythos: mockVaultSurfaceRevealMythos,
      notesVaultRegistryList: mockNotesVaultRegistryList,
      storyVaultRegistryList: mockStoryVaultRegistryList,
      vaultAccessGetState: vi.fn().mockResolvedValue({ ok: true, mythosId: 'mid', vaultAccess: {}, crossLinks: [] }),
      onNotesVaultRegistryChanged: () => () => {},
      onStoryVaultRegistryChanged: () => () => {},
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  resetLiquidNeonV2Tokens();
  __resetSettingsWriteSerialForTests();
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

  // SKY-11815 repro 1: `vaults`/`activeRoot` were fetched once on mount and
  // never re-fetched after a Vault & Files "Move…" — cards kept the pre-move
  // paths for the rest of the session, so clicking a non-current card to
  // switch would target a vaultRoot the recent-projects allowlist no longer
  // recognized (main already remapped it to the post-move path).
  it('SKY-11815: a vaultsParent:moved push re-fetches the vault list and active root', async () => {
    let movedHandler: ((data: { vaultRoot: string; notesVaultRoot?: string }) => void) | undefined;
    const onVaultsParentMoved = vi.fn((cb: typeof movedHandler) => {
      movedHandler = cb;
      return () => {};
    });
    Object.defineProperty(window, 'api', {
      value: { ...window.api, onVaultsParentMoved },
      writable: true,
      configurable: true,
    });

    await setup();
    expect(onVaultsParentMoved).toHaveBeenCalledTimes(1);
    expect(mockProjectList).toHaveBeenCalledTimes(1);
    expect(mockGetVaultRoot).toHaveBeenCalledTimes(1);

    const VAULT_B_MOVED = '/vaults_moved/vaults/Beta/Story Vault';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: VAULT_A.replace('/vaults/', '/vaults_moved/vaults/'), mythosVaultRoot: '/vaults_moved/vaults/Alpha', notesVaultRoot: '', name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B_MOVED, mythosVaultRoot: '/vaults_moved/vaults/Beta', notesVaultRoot: '', name: 'Beta', openedAt: '' },
      ],
    });
    mockGetVaultRoot.mockResolvedValue({ vaultRoot: VAULT_A.replace('/vaults/', '/vaults_moved/vaults/') });

    await act(async () => { movedHandler?.({ vaultRoot: VAULT_A }); });

    expect(mockProjectList).toHaveBeenCalledTimes(2);
    expect(mockGetVaultRoot).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${VAULT_B_MOVED}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`mvs-card-${VAULT_B}`)).not.toBeInTheDocument();
  });

  it('choosing a theme for a NON-current vault stores it and persists, without recoloring now', async () => {
    const { setSettings, setSavedOk } = await setup();
    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_B}`), { target: { value: 'ice' } });
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
    const next = typeof updater === 'function' ? updater(baseSettings) : updater;
    expect(next.vaultThemes).toEqual({ [VAULT_B]: 'ice' });
    expect(next.liquidNeonV2).toBeUndefined(); // current theme untouched
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    expect(mockSettingsSet).toHaveBeenCalledWith({
      ...baseSettings,
      vaultThemes: { [VAULT_B]: 'ice' },
    });
    expect(setSavedOk).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('ln-toast').textContent).toContain('default theme — Ice Mono');
  });

  it('choosing a theme for the CURRENT vault also applies it live (setKey+slots+wp match)', async () => {
    const { setSettings } = await setup();
    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_A}`), { target: { value: 'ember' } });
    const updater = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
    const next = typeof updater === 'function' ? updater(baseSettings) : updater;
    expect(next.vaultThemes).toEqual({ [VAULT_A]: 'ember' });
    expect(next.liquidNeonV2?.setKey).toBe('ember');
    expect(next.liquidNeonV2?.slots).toEqual([...LIQUID_NEON_PRESETS.ember.c]);
    expect(next.liquidNeonV2?.wp).toBe('match');
    // Live token apply hit the document root with Emberfall's slot A.
    expect(document.documentElement.style.getPropertyValue('--n1')).toBe('#ff6b4d');
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    // Exact payload: disk + vaultThemes + liquidNeonV2 only (each field own write).
    expect(mockSettingsSet).toHaveBeenCalledWith({
      ...baseSettings,
      vaultThemes: { [VAULT_A]: 'ember' },
      liquidNeonV2: next.liquidNeonV2,
    });
  });

  // K4 (re-pointed): theme/rename must use shared enqueueSettingsWrite — not a
  // local persistChain, and not a bare settingsGet/set. Block the shared chain
  // with a pending op; vault theme must not touch get/set until the block resolves.
  it('K4: vault theme write waits on shared enqueueSettingsWrite until blocker resolves', async () => {
    let releaseBlock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseBlock = resolve;
    });
    const blockOp = enqueueSettingsWrite(async () => {
      await blocked;
    });

    await setup();
    mockSettingsGet.mockClear();
    mockSettingsSet.mockClear();

    fireEvent.change(screen.getByTestId(`mvs-theme-${VAULT_B}`), { target: { value: 'ice' } });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(
      mockSettingsGet,
      'K4 RED if theme write left shared enqueue (local chain or direct get)',
    ).not.toHaveBeenCalled();
    expect(
      mockSettingsSet,
      'K4 RED if theme write left shared enqueue (local chain or direct set)',
    ).not.toHaveBeenCalled();

    releaseBlock();
    await blockOp;
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockSettingsSet).toHaveBeenCalledWith({
        ...baseSettings,
        vaultThemes: { [VAULT_B]: 'ice' },
      }),
    );
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

describe('MythosVaultsSection — New vault flow (SKY-10401 / SKY-11452)', () => {
  async function openCreateForm(mode?: 'blank' | 'import' | 'template') {
    const result = await setup();
    fireEvent.click(screen.getByTestId('mvs-new-vault'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument());
    if (mode === 'import') {
      fireEvent.click(screen.getByTestId('mvs-vault-mode-import'));
    } else if (mode === 'blank') {
      fireEvent.click(screen.getByTestId('mvs-vault-mode-blank'));
    } else if (mode === 'template') {
      fireEvent.click(screen.getByTestId('mvs-vault-mode-template'));
    }
    await waitFor(() => expect(screen.getByTestId('mvs-create-name')).toBeInTheDocument());
    return result;
  }

  it('New vault… opens the form with the destination prefilled from defaultVaultsParentPath', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    // Mythos box embeds VaultLinkingColumns for the active vault (extra vaultGetPaths).
    expect(mockVaultGetPaths.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Name input is focused for immediate typing.
    expect(screen.getByTestId('mvs-create-name')).toHaveFocus();
  });

  // SKY-11815 repro 2: after a Vault & Files "Move…", `vaultsParentPath` is
  // the CURRENT parent while `defaultVaultsParentPath` stays pinned at the
  // static <userData>/vaults default forever — reading the wrong field here
  // silently re-created the just-deleted pre-move folder on "Create vault".
  it('SKY-11815: prefers the CURRENT vaultsParentPath over the static default when both are present', async () => {
    mockVaultGetPaths.mockResolvedValue({
      storyVaultPath: VAULT_A,
      notesVaultPath: '/vaults/Alpha/Notes Vault',
      defaultVaultsParentPath: '/vaults',
      vaultsParentPath: '/vaults_moved/vaults',
    });
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults_moved/vaults'));
  });

  // SKY-11815 repro 2 (the caching half): the prefill above is fetched once
  // and cached in `createDest` for the component's lifetime — without the
  // 'vaultsParent:moved' broadcast clearing it, a Move mid-session still
  // leaves a Settings panel that was already open pointing at the deleted
  // pre-move folder.
  it('SKY-11815: a vaultsParent:moved push clears a stale cached destination so it re-prefills', async () => {
    let movedHandler: ((data: { vaultRoot: string; notesVaultRoot?: string }) => void) | undefined;
    const onVaultsParentMoved = vi.fn((cb: typeof movedHandler) => {
      movedHandler = cb;
      return () => {};
    });
    Object.defineProperty(window, 'api', {
      value: { ...window.api, onVaultsParentMoved },
      writable: true,
      configurable: true,
    });

    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    expect(onVaultsParentMoved).toHaveBeenCalledTimes(1);

    mockVaultGetPaths.mockResolvedValue({
      storyVaultPath: VAULT_A,
      notesVaultPath: '/vaults/Alpha/Notes Vault',
      defaultVaultsParentPath: '/vaults',
      vaultsParentPath: '/vaults_moved/vaults',
    });
    await act(async () => { movedHandler?.({ vaultRoot: VAULT_A }); });
    // createDest was reset to '' by the push; "New vault…" re-runs
    // onOpenCreate's `if (!createDest)` prefill against the now-current path.
    fireEvent.click(screen.getByTestId('mvs-new-vault'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults_moved/vaults'));
  });

  it('Browse… replaces the destination with the picked folder', async () => {
    mockChooseVaultFolder.mockResolvedValue({ path: '/elsewhere/Vaults', cancelled: false });
    await openCreateForm();
    fireEvent.click(screen.getByTestId('mvs-create-dest-browse'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/elsewhere/Vaults'));
    expect(mockChooseVaultFolder).toHaveBeenCalledWith('Choose where to create the new vault', '/vaults');
  });

  it('PLAN-058 L1a: exposes template / blank / import (SKY-11151) on first open', async () => {
    await openCreateForm();
    expect(screen.getByTestId('mvs-vault-mode-template')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-vault-mode-blank')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-vault-mode-import')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-vault-mode-template')).toHaveAttribute('aria-checked', 'true');
  });

  it('PLAN-058 L1a (49:46): modal stays open while typing the vault name', async () => {
    await openCreateForm();
    const name = screen.getByTestId('mvs-create-name');
    fireEvent.change(name, { target: { value: 'My' } });
    fireEvent.change(name, { target: { value: 'My Vault' } });
    expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument();
    expect(name).toHaveValue('My Vault');
  });

  it('PLAN-058 L1a (57:21): vault card click does not open the create modal', async () => {
    await setup();
    fireEvent.click(screen.getByTestId(`mvs-card-${VAULT_B}`));
    expect(screen.queryByTestId('mvs-create-form')).not.toBeInTheDocument();
    await waitFor(() => expect(mockProjectSwitch).toHaveBeenCalled());
  });

  it('opens as a Create a Mythos vault popup; Default folder resets the destination', async () => {
    await openCreateForm('blank');
    expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument();
    expect(screen.getByText('Where to create')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-create-default-folder')).toBeInTheDocument();
    mockChooseVaultFolder.mockResolvedValueOnce({ path: '/elsewhere/Vaults', cancelled: false });
    fireEvent.click(screen.getByTestId('mvs-create-dest-browse'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/elsewhere/Vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-default-folder'));
    expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults');
  });

  it('a cancelled Browse leaves the destination untouched', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-dest-browse'));
    await waitFor(() => expect(mockChooseVaultFolder).toHaveBeenCalled());
    expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults');
  });

  it('§3a: template mode passes mode:"template" through createVaultFromOptions (separate vault)', async () => {
    await openCreateForm('template');
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.change(screen.getByTestId('mvs-create-name'), { target: { value: 'Templated' } });
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'template',
        activate: false,
        name: 'Templated',
      }),
    ));
  });

  it('Create vault calls the SKY-11151 primitive (blank, activate:false) and offers a switch', async () => {
    await openCreateForm('blank');
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.change(screen.getByTestId('mvs-create-name'), { target: { value: '  Second Vault  ' } });
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
    expect(mockCreateVaultFromOptions).toHaveBeenCalledWith({
      mode: 'blank',
      destinationParent: '/vaults',
      name: 'Second Vault',
      activate: false,
    });
    // SKY-11452: the demo-seeding legacy backend is never reached from here.
    expect(mockVaultCreateDefaultMythos).not.toHaveBeenCalled();
    // Form closed, offer visible, vault list refreshed to include the new card.
    expect(screen.queryByTestId('mvs-create-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('mvs-create-done').textContent).toContain('Second Vault');
    expect(screen.getByTestId('mvs-create-done').textContent).toContain(NEW_ROOT);
    expect(mockProjectList).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('ln-toast').textContent).toContain('Vault "Second Vault" created');
  });

  it('§3a: choosing Create blank passes mode:"blank" — no seedMode, no demo', async () => {
    await openCreateForm('blank');
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledTimes(1));
    const payload = mockCreateVaultFromOptions.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.mode).toBe('blank');
    expect(payload.activate).toBe(false);
    expect(payload).not.toHaveProperty('seedMode');
    expect(payload).not.toHaveProperty('importSources');
    expect(mockVaultCreateDefaultMythos).not.toHaveBeenCalled();
  });

  it('Import existing needs at least one source: Create is disabled until a folder is picked, then passes importSources', async () => {
    await openCreateForm('import');
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    expect(screen.getByTestId('mvs-create-import')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-create-confirm')).toBeDisabled();
    // Enter on the name field must not sneak past the disabled button.
    fireEvent.keyDown(screen.getByTestId('mvs-create-name'), { key: 'Enter' });
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
    expect(screen.getByTestId('mvs-create-error')).toHaveTextContent(/at least one folder/i);

    mockChooseVaultFolder.mockResolvedValue({ path: '/home/me/ObsidianVault', cancelled: false });
    fireEvent.click(screen.getByTestId('mvs-create-import-notes-browse'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-import-notes-path').textContent).toBe('/home/me/ObsidianVault'));
    expect(mockChooseVaultFolder).toHaveBeenLastCalledWith('Select an Obsidian or Markdown notes folder');
    expect(screen.getByTestId('mvs-create-confirm')).toBeEnabled();

    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledWith({
      mode: 'import',
      destinationParent: '/vaults',
      name: undefined,
      importSources: [{ kind: 'notes', srcPath: '/home/me/ObsidianVault' }],
      activate: false,
    }));
  });

  it('reopening the form resets to template default and clears import sources', async () => {
    await openCreateForm('import');
    mockChooseVaultFolder.mockResolvedValue({ path: '/home/me/Stories', cancelled: false });
    fireEvent.click(screen.getByTestId('mvs-create-import-story-browse'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-import-story-path').textContent).toBe('/home/me/Stories'));
    fireEvent.click(screen.getByTestId('mvs-create-cancel'));
    fireEvent.click(screen.getByTestId('mvs-new-vault'));
    await waitFor(() => expect(screen.getByTestId('mvs-create-form')).toBeInTheDocument());
    expect(screen.getByTestId('mvs-vault-mode-template')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('mvs-create-import-story-path')).not.toBeInTheDocument();
  });

  it('an empty name is allowed — main falls back to its default vault name', async () => {
    await openCreateForm('blank');
    await waitFor(() => expect(screen.getByTestId('mvs-create-dest-path').textContent).toBe('/vaults'));
    fireEvent.click(screen.getByTestId('mvs-create-confirm'));
    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledWith({
      mode: 'blank',
      destinationParent: '/vaults',
      name: undefined,
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

  it('Switch to it prefers __mythosRequestVaultSwitch (flush-first) over bare projectSwitch', async () => {
    const req = vi.fn().mockResolvedValue(true);
    (window as Window & { __mythosRequestVaultSwitch?: typeof req }).__mythosRequestVaultSwitch = req;
    try {
      await openCreateForm();
      fireEvent.click(screen.getByTestId('mvs-create-confirm'));
      await waitFor(() => expect(screen.getByTestId('mvs-create-done')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('mvs-create-switch'));
      await waitFor(() => expect(req).toHaveBeenCalledWith(`${NEW_ROOT}/Story Vault`));
      expect(mockProjectSwitch).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('mvs-create-done')).not.toBeInTheDocument());
    } finally {
      delete (window as Window & { __mythosRequestVaultSwitch?: typeof req }).__mythosRequestVaultSwitch;
    }
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
    mockCreateVaultFromOptions.mockResolvedValue({ ok: false, error: 'Mythos Vault folder is not empty' });
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
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
    expect(mockVaultCreateDefaultMythos).not.toHaveBeenCalled();
  });
});

describe('MythosVaultsSection — inner-vault counts (SKY-11154 §4)', () => {
  it('shows "N notes vaults · N story vaults" under each card, matching the QA regex', async () => {
    await setup();
    expect(screen.getByTestId(`mvs-card-${VAULT_A}`).textContent).toMatch(
      /\d+\s+notes vaults?\s*(&middot;|·)\s*\d+\s+story vaults?/i,
    );
    expect(screen.getByTestId(`mvs-card-${VAULT_A}`).textContent).toContain('2 notes vaults · 1 story vault');
    expect(screen.getByTestId(`mvs-card-${VAULT_B}`).textContent).toContain('1 notes vault · 1 story vault');
  });
});

describe('MythosVaultsSection — inline rename (SKY-11154 §4, AC-VS-02)', () => {
  it('double-clicking the name column opens an inline rename field with an aria-label containing "rename"', async () => {
    await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    expect(input).toHaveAttribute('aria-label', expect.stringMatching(/rename/i));
    expect((input as HTMLInputElement).value).toBe('Alpha');
  });

  it('Enter commits the new name via settings.vaultDisplayNames (mirrors the vaultThemes persistence pattern)', async () => {
    const { setSettings } = await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: 'Renamed Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setSettings).toHaveBeenCalled();
    const updater = setSettings.mock.calls[setSettings.mock.calls.length - 1][0] as (prev: AppSettings) => AppSettings;
    const next = typeof updater === 'function' ? updater(baseSettings) : updater;
    expect(next.vaultDisplayNames).toEqual({ [VAULT_A]: 'Renamed Alpha' });
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    expect(mockSettingsSet).toHaveBeenCalledWith({
      ...baseSettings,
      vaultDisplayNames: { [VAULT_A]: 'Renamed Alpha' },
    });
    expect(screen.queryByTestId(`mvs-rename-input-${VAULT_A}`)).not.toBeInTheDocument();
  });

  it('SKY-11453: Enter also writes the rename through to the vault-local mythos.json via projectNameSet, not just the settings cache', async () => {
    await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: 'Renamed Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockProjectNameSet).toHaveBeenCalledWith({ vaultRoot: VAULT_A, name: 'Renamed Alpha' });
  });

  it('Escape cancels without persisting', async () => {
    const { setSettings } = await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: 'Should not stick' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId(`mvs-rename-input-${VAULT_A}`)).not.toBeInTheDocument();
    expect(setSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('blur commits, matching Enter', async () => {
    const { setSettings } = await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: 'Via Blur' } });
    fireEvent.blur(input);
    expect(setSettings).toHaveBeenCalled();
    const updater = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
    const next = typeof updater === 'function' ? updater(baseSettings) : updater;
    expect(next.vaultDisplayNames).toEqual({ [VAULT_A]: 'Via Blur' });
  });

  it('an empty submission is ignored — reverts without persisting', async () => {
    const { setSettings } = await setup();
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = await screen.findByTestId(`mvs-rename-input-${VAULT_A}`);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('reads settings.vaultDisplayNames as an override, matching DesktopShell precedence', async () => {
    await setup({
      apiKey: '', agents: {}, theme: 'dark', vaultDisplayNames: { [VAULT_A]: 'Custom Name' },
    } as unknown as AppSettings);
    expect(screen.getByText('Custom Name')).toBeInTheDocument();
  });
});

describe('MythosVaultsSection — PLAN-058 L1b grouping + chrome', () => {
  it('groups two story-vault rows under one Mythos box', async () => {
    const SECOND_STORY = '/vaults/Alpha/Stories/Second World';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: VAULT_A, mythosVaultRoot: '/vaults/Alpha', notesVaultRoot: '/vaults/Alpha/Notes Vault', name: 'Alpha', openedAt: '' },
        { vaultRoot: SECOND_STORY, mythosVaultRoot: '/vaults/Alpha', notesVaultRoot: '/vaults/Alpha/Notes Vault', name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B, mythosVaultRoot: '/vaults/Beta', notesVaultRoot: '/vaults/Beta/Notes Vault', name: 'Beta', openedAt: '' },
      ],
    });
    await setup();
    expect(screen.getByTestId('mvs-box-/vaults/Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('mvs-box-/vaults/Beta')).toBeInTheDocument();
    expect(screen.queryByTestId(`mvs-card-${SECOND_STORY}`)).not.toBeInTheDocument();
  });

  it('Open on a Mythos box calls vaultSurfaceRevealMythos', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('mvs-mythos-open-/vaults/Alpha'));
    await waitFor(() => expect(mockVaultSurfaceRevealMythos).toHaveBeenCalledWith('/vaults/Alpha'));
  });

  it('⋯ menu Rename opens inline rename (FD-6)', async () => {
    await setup();
    fireEvent.click(screen.getByLabelText('More options for Alpha'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(await screen.findByTestId(`mvs-rename-input-${VAULT_A}`)).toBeInTheDocument();
  });
});

describe('MythosVaultsSection — the ⋯ overflow menu (SKY-11154 §4a, AC-VS-03/04)', () => {
  it('exposes a "More options" trigger with Hide/Delete/Remove menuitems, no bare Delete button', async () => {
    await setup();
    const card = screen.getByTestId(`mvs-card-${VAULT_A}`);
    const trigger = screen.getByLabelText('More options for Alpha');
    fireEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Hide' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove from Mythos…' })).toBeInTheDocument();
    expect(card.querySelectorAll('[aria-label="Delete" i]:not([role="menuitem"])').length).toBe(0);
  });

  it('Delete on a Mythos vault runs the 2-step confirm and the copy contains "moved to the Recycle Bin" (AC-VS-04)', async () => {
    await setup();
    fireEvent.click(screen.getByLabelText('More options for Alpha'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Recycle Bin' }));
    await waitFor(() => expect(mockVaultSurfaceBlastRadius).toHaveBeenCalled());
    // SKY-11322: the confirm dialog's inner-vault count must match the card's
    // own "2 notes vaults · 1 story vault" (= 3) stats for the same vault.
    expect(await screen.findByText(/contains 3 inner vaults/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Continue'));
    await waitFor(() => expect(screen.getByText(/moved to the recycle bin/i)).toBeInTheDocument());
    expect(screen.getByText(/and its 3 inner vaults will be moved/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Move to Recycle Bin'));
    await waitFor(() => expect(mockVaultSurfaceTrash).toHaveBeenCalledWith({ vaultPath: '/vaults/Alpha', level: 'mythos' }));
  });

  it('Hide calls vaultSurfaceHide with level="mythos" on confirm', async () => {
    await setup();
    fireEvent.click(screen.getByLabelText('More options for Alpha'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    fireEvent.click(await screen.findByText('Hide', { selector: 'button' }));
    await waitFor(() => expect(mockVaultSurfaceHide).toHaveBeenCalledWith({ vaultRoot: '/vaults/Alpha', level: 'mythos' }));
  });

  // SKY-11451: a vault created under the grouped Stories/Notes layout must
  // still resolve to the true Mythos root for whole-vault Hide/Delete — not
  // to `<mythosRoot>/Stories`, which would trash/hide only the Stories group
  // and strand Notes/, mythos.json and the registries on disk.
  it('Delete on a GROUPED-layout Mythos vault trashes the true mythos root, not <root>/Stories', async () => {
    const GROUPED_ROOT = '/vaults/Gamma/Stories/Story Vault';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: GROUPED_ROOT, mythosVaultRoot: '/vaults/Gamma', notesVaultRoot: '/vaults/Gamma/Notes/Notes Vault', name: 'Gamma', openedAt: '' },
      ],
    });
    mockProjectStats.mockResolvedValue({
      stats: [
        { vaultRoot: GROUPED_ROOT, storyFileCount: 0, noteCount: 0, notesVaultCount: 1, storyVaultCount: 1 },
      ],
    });
    mockVaultSurfaceBlastRadius.mockResolvedValue({ vaultName: 'Gamma', innerCount: 2 });
    const setSettings = vi.fn();
    const setSavedOk = vi.fn();
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={setSettings} setSavedOk={setSavedOk} />);
    });
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${GROUPED_ROOT}`)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('More options for Gamma'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Recycle Bin' }));
    await waitFor(() => expect(mockVaultSurfaceBlastRadius).toHaveBeenCalledWith('/vaults/Gamma'));
    fireEvent.click(await screen.findByText('Continue'));
    fireEvent.click(await screen.findByText('Move to Recycle Bin'));
    await waitFor(() => expect(mockVaultSurfaceTrash).toHaveBeenCalledWith({ vaultPath: '/vaults/Gamma', level: 'mythos' }));
  });

  // SKY-11882: a story vault created through the Story Vault Picker (SKY-11169)
  // gets a USER-CHOSEN dir name — `<mythos>/Stories/Second World`. The old
  // regex-based mythosPathFor() stripped only the two hardcoded `Story Vault`
  // suffixes, so it fell through and returned the story-vault subfolder: Delete
  // trashed just that folder and stranded Notes/, mythos.json, story-vaults.json
  // and notes-vaults.json on disk with no path back into the UI. The mythos root
  // is now resolved in main (PROJECT_LIST → `mythosVaultRoot`) against the
  // registry, and this section must use it verbatim.
  it('Delete on a CUSTOM-NAMED story vault trashes the mythos root, not the story-vault subfolder', async () => {
    const CUSTOM_ROOT = '/vaults/Delta/Stories/Second World';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: CUSTOM_ROOT, mythosVaultRoot: '/vaults/Delta', notesVaultRoot: '/vaults/Delta/Notes/Notes Vault', name: 'Delta', openedAt: '' },
      ],
    });
    mockProjectStats.mockResolvedValue({
      stats: [
        { vaultRoot: CUSTOM_ROOT, storyFileCount: 0, noteCount: 0, notesVaultCount: 1, storyVaultCount: 2 },
      ],
    });
    mockVaultSurfaceBlastRadius.mockResolvedValue({ vaultName: 'Delta', innerCount: 3 });
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${CUSTOM_ROOT}`)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('More options for Delta'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Recycle Bin' }));
    await waitFor(() => expect(mockVaultSurfaceBlastRadius).toHaveBeenCalledWith('/vaults/Delta'));
    fireEvent.click(await screen.findByText('Continue'));
    fireEvent.click(await screen.findByText('Move to Recycle Bin'));
    await waitFor(() => expect(mockVaultSurfaceTrash).toHaveBeenCalledWith({ vaultPath: '/vaults/Delta', level: 'mythos' }));
  });

  it('SKY-11882: Hide on a CUSTOM-NAMED story vault hides the mythos root', async () => {
    const CUSTOM_ROOT = '/vaults/Delta/Stories/Second World';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: CUSTOM_ROOT, mythosVaultRoot: '/vaults/Delta', notesVaultRoot: '/vaults/Delta/Notes/Notes Vault', name: 'Delta', openedAt: '' },
      ],
    });
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${CUSTOM_ROOT}`)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('More options for Delta'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    fireEvent.click(await screen.findByText('Hide', { selector: 'button' }));
    await waitFor(() => expect(mockVaultSurfaceHide).toHaveBeenCalledWith({ vaultRoot: '/vaults/Delta', level: 'mythos' }));
  });

  // SKY-11882: main returns mythosVaultRoot:null when it cannot read the vault
  // at all (today: a too-new mythos.json, which mythosJson.ts raises rather
  // than "never touches"). There is then no path that is safe to trash, and
  // falling back to vaultRoot would be the original orphaning bug — so the
  // whole destructive menu is withheld. The card still lists and still
  // switches; only Hide/Delete disappear.
  it('a vault with an UNRESOLVED mythos root offers no Hide/Delete menu at all', async () => {
    const UNREADABLE = '/vaults/Epsilon/Stories/Story Vault';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: UNREADABLE, mythosVaultRoot: null, notesVaultRoot: '/vaults/Epsilon/Notes/Notes Vault', name: 'Epsilon', openedAt: '' },
      ],
    });
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${UNREADABLE}`)).toBeInTheDocument());

    expect(screen.queryByLabelText('More options for Epsilon')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to Recycle Bin' })).not.toBeInTheDocument();
  });
});

describe('MythosVaultsSection — Show hidden (SKY-11154 §4a, AC-VS-05)', () => {
  it('a "Show hidden" button is always visible, even with zero hidden vaults', async () => {
    await setup();
    expect(screen.getByTestId('mvs-show-hidden-btn')).toBeInTheDocument();
  });

  it('hidden vaults are excluded from the main list and appear with Unhide once expanded', async () => {
    mockVaultSurfaceListHidden.mockResolvedValue({ hiddenVaultRoots: ['/vaults/Alpha'] });
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId(`mvs-card-${VAULT_B}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`mvs-card-${VAULT_A}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mvs-show-hidden-btn'));
    expect(await screen.findByTestId(`mvs-unhide-${VAULT_A}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`mvs-unhide-${VAULT_A}`));
    await waitFor(() => expect(mockVaultSurfaceUnhide).toHaveBeenCalledWith('/vaults/Alpha'));
  });

  // SKY-11882: the hidden list stores MYTHOS roots, so the cross-reference has
  // to use the same resolved root the Hide button sent. Under the old regex a
  // custom-named vault cross-referenced its own subfolder instead — hiding it
  // left the card in the visible list forever (the hide silently "did nothing").
  it('a hidden CUSTOM-NAMED vault is cross-referenced by its mythos root, not its subfolder', async () => {
    const CUSTOM_ROOT = '/vaults/Delta/Stories/Second World';
    mockProjectList.mockResolvedValue({
      projects: [
        { vaultRoot: CUSTOM_ROOT, mythosVaultRoot: '/vaults/Delta', notesVaultRoot: '/vaults/Delta/Notes/Notes Vault', name: 'Delta', openedAt: '' },
      ],
    });
    mockVaultSurfaceListHidden.mockResolvedValue({ hiddenVaultRoots: ['/vaults/Delta'] });
    await act(async () => {
      render(<MythosVaultsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    });
    await waitFor(() => expect(screen.getByTestId('mvs-show-hidden-btn')).toBeInTheDocument());
    expect(screen.queryByTestId(`mvs-card-${CUSTOM_ROOT}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mvs-show-hidden-btn'));
    fireEvent.click(await screen.findByTestId(`mvs-unhide-${CUSTOM_ROOT}`));
    await waitFor(() => expect(mockVaultSurfaceUnhide).toHaveBeenCalledWith('/vaults/Delta'));
  });
});
