/**
 * Probe H1 (PR #1644) / Ivy tip-form / Shield batch 1–7 / Critic Hard 1:
 * Real App/DesktopShell + real SettingsPanel — NO mocked flush.
 * Asserts settingsSet writingPartner.telemetryLevel==='crash' (not a vacuous
 * shell-loading-only gate). Critic Hard 1 at freeze tip 2832ce28 is closed here.
 *
 * Must go RED under:
 *   R1 / M2 — flush → Promise.resolve(true) (no real save)
 *   M3 — flush failure → onSaved + true (refused path silent)
 *   M4 — flushOpenSettings no-op (tile path, no announce backup)
 *   M6 — bad-key hold dropped (flushed apiKey is the typed bad key)
 *   Switch-side — flushOpenSettings AND announce flush stubbed together
 *   R1 — DesktopShell + SettingsPanel reverted to 48e86de2
 *
 * Ivy amendment: refused/failed flush shows Retry / Switch anyway — never
 * switch silently and never trap the user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import App from './App';
import ProjectSwitcher from './ProjectSwitcher';
import {
  enqueueSettingsWrite,
  __resetSettingsWriteSerialForTests,
} from './settingsWriteSerial';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';

type Persisted = {
  onboardingComplete: boolean;
  onboardingStartMode?: 'blank' | 'template' | 'skip' | 'import' | null;
  rightSidebarVisible: boolean;
  theme: string;
  apiKey?: string;
  agents: {
    writingAssistant: { enabled: boolean };
    brainstorm: { enabled: boolean };
    archive: { enabled: boolean };
    lineEditor: { enabled: boolean };
  };
  writingPartner?: { telemetryLevel?: string };
  telemetry?: { enabled?: boolean; sessionId?: string };
};

const STORY_VAULT_A = 'story-a';
const STORY_VAULT_B = 'story-b';
const STORY_VAULT_ENTRIES = [
  { id: STORY_VAULT_A, displayName: 'Story A', dirName: 'Story A', createdAt: '', pairedNotesVaultId: null as string | null },
  { id: STORY_VAULT_B, displayName: 'Story B', dirName: 'Story B', createdAt: '', pairedNotesVaultId: null as string | null },
];
const NOTES_VAULT_ENTRIES = [
  { id: 'notes-a', displayName: 'Notes A', dirName: 'Notes A', createdAt: '', origin: 'created' as const },
  { id: 'notes-b', displayName: 'Notes B', dirName: 'Notes B', createdAt: '', origin: 'created' as const },
];

let mainRoot = VAULT_A;
let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;
let persisted: Persisted;
let holdLoad = false;
let loadHolds: Array<() => void> = [];
let settingsSetMock: ReturnType<typeof vi.fn>;
let projectSwitchMock: ReturnType<typeof vi.fn>;
let storyVaultSetActiveMock: ReturnType<typeof vi.fn>;
let createVaultFromOptionsMock: ReturnType<typeof vi.fn>;
let openVaultFolderMock: ReturnType<typeof vi.fn>;
let activeStoryId = STORY_VAULT_A;
/** When false, projectSwitch does not emit project:switched (M4 gap close). */
let announceOnSwitch = true;
/** Simulate SETTINGS_SET full-replace (real main) rather than shallow merge. */
let settingsSetFullReplace = true;
/** Hold the next settingsGet (C7 interleave pin). */
let holdSettingsGet = false;
let settingsGetHolds: Array<() => void> = [];

function makeManifest(root: string) {
  return {
    version: '1',
    vaultRoot: root,
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function basePersisted(): Persisted {
  return {
    onboardingComplete: true,
    rightSidebarVisible: true,
    theme: 'dark',
    apiKey: '',
    agents: {
      writingAssistant: { enabled: true },
      brainstorm: { enabled: true },
      archive: { enabled: true },
      lineEditor: { enabled: false },
    },
    writingPartner: { telemetryLevel: 'off' },
    telemetry: { enabled: false, sessionId: '' },
  };
}

function makeMockApi() {
  settingsSetMock = vi.fn().mockImplementation(async (next: Persisted) => {
    // Real main SETTINGS_SET is full-replace (no omit-preserve). C7(b) is
    // renderer-only: panel get→set copies current onboarding* into the payload.
    if (settingsSetFullReplace) {
      persisted = { ...next };
    } else {
      persisted = { ...persisted, ...next };
    }
    return { saved: true };
  });
  projectSwitchMock = vi.fn().mockImplementation(async (vaultRoot: string) => {
    mainRoot = vaultRoot;
    if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
    return { switched: true };
  });
  storyVaultSetActiveMock = vi.fn().mockImplementation(async (id: string) => {
    activeStoryId = id;
    return { entry: STORY_VAULT_ENTRIES.find((v) => v.id === id) ?? null };
  });
  createVaultFromOptionsMock = vi.fn().mockResolvedValue({
    ok: true,
    mode: 'blank',
    mythosRoot: '/mythos/New',
    storyVaultPath: '/vault-new',
    notesVaultPath: '/notes-new',
    vaultName: 'New',
  });
  openVaultFolderMock = vi.fn().mockResolvedValue({
    cancelled: false,
    vaultRoot: '/vault-picked',
  });
  return {
    settingsGet: () => {
      if (!holdSettingsGet) return Promise.resolve({ ...persisted });
      // Snapshot at call time — models an in-flight get that must not see
      // a later C7 write (serialization keeps C7 after this flush op).
      const snapshot = { ...persisted };
      return new Promise<Persisted>((resolveGet) => {
        settingsGetHolds.push(() => resolveGet(snapshot));
      });
    },
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/mythos/Story A',
      notesVaultPath: '/mythos/Notes A',
      pathSeparator: '/',
      mythosRoot: '/mythos',
      vaultsParentPath: '/mythos',
      defaultVaultsParentPath: '/mythos',
    }),
    chooseVaultFolder: () => Promise.resolve({ path: '/mythos', cancelled: false }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => {
      if (!holdLoad) return Promise.resolve({ vaultRoot: mainRoot });
      return new Promise<{ vaultRoot: string }>((resolve) => {
        loadHolds.push(() => resolve({ vaultRoot: mainRoot }));
      });
    },
    readManifest: () => Promise.resolve(makeManifest(mainRoot)),
    settingsSet: settingsSetMock,
    createVaultFromOptions: createVaultFromOptionsMock,
    openVaultFolder: openVaultFolderMock,
    projectList: () => Promise.resolve({
      projects: [
        { vaultRoot: VAULT_A, name: 'Alpha', openedAt: '', notesVaultRoot: '/notes-a' },
        { vaultRoot: VAULT_B, name: 'Bravo', openedAt: '', notesVaultRoot: '/notes-b' },
        { vaultRoot: '/vault-new', name: 'New', openedAt: '', notesVaultRoot: '/notes-new' },
        { vaultRoot: '/vault-picked', name: 'Picked', openedAt: '', notesVaultRoot: '/notes-picked' },
      ],
    }),
    projectSwitch: projectSwitchMock,
    onProjectSwitched: (cb: (data: { vaultRoot: string }) => void) => {
      onProjectSwitchedCb = cb;
      return () => { onProjectSwitchedCb = null; };
    },
    // Ivy R6 real-control surfaces — StoryVaultPicker + VaultLinkingColumns.
    storyVaultRegistryList: () => Promise.resolve({
      vaults: STORY_VAULT_ENTRIES,
      activeId: activeStoryId,
    }),
    storyVaultRegistrySetActive: storyVaultSetActiveMock,
    onStoryVaultRegistryChanged: () => () => {},
    notesVaultRegistryList: () => Promise.resolve({
      vaults: NOTES_VAULT_ENTRIES,
      activeId: 'notes-a',
    }),
    notesVaultRegistrySetActive: vi.fn().mockResolvedValue({ entry: NOTES_VAULT_ENTRIES[0] }),
    notesVaultRegistrySetActivePreview: vi.fn().mockResolvedValue({
      resolvedCount: 0, unresolvedStems: [], totalStems: 0,
    }),
    onNotesVaultRegistryChanged: () => () => {},
    storyVaultRegistryPair: vi.fn().mockResolvedValue({ entry: STORY_VAULT_ENTRIES[0] }),
    vaultSurfaceListHidden: () => Promise.resolve({ hiddenVaultRoots: [] }),
    vaultSurfaceUnhide: vi.fn().mockResolvedValue({ ok: true }),
    vaultAccessGetState: vi.fn().mockResolvedValue({
      ok: true, mythosId: 'mid', vaultAccess: {}, crossLinks: [],
    }),
    vaultAccessSet: vi.fn().mockResolvedValue({ ok: true, vaultAccess: {}, crossLinks: [] }),
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    listNotesVault: () => Promise.resolve({ items: [] }),
    onVaultFileChanged: () => () => {},
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
  };
}

beforeEach(() => {
  mainRoot = VAULT_A;
  activeStoryId = STORY_VAULT_A;
  onProjectSwitchedCb = null;
  persisted = basePersisted();
  holdLoad = false;
  loadHolds = [];
  announceOnSwitch = true;
  settingsSetFullReplace = true;
  holdSettingsGet = false;
  settingsGetHolds = [];
  __resetSettingsWriteSerialForTests();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
  holdSettingsGet = false;
  settingsGetHolds = [];
  __resetSettingsWriteSerialForTests();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__mythosSettingsFlush;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__mythosSettingsRequestClose;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__mythosOpenVaultViaPicker;
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
});

function openSettings() {
  const gear = document.querySelector('.app-menu-gear-btn') as HTMLElement | null;
  if (gear) {
    fireEvent.click(gear);
    return;
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Open settings' })[0]);
}

async function openModelKeys() {
  openSettings();
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  const agentsTab = await screen.findByTestId('settings-cat-agents');
  fireEvent.click(agentsTab);
  await waitFor(() => expect(screen.getByTestId('model-keys-page')).toBeInTheDocument());
}

async function openModelKeysAndClickCrash() {
  await openModelKeys();
  const crash = await screen.findByTestId('mk-telemetry-crash');
  fireEvent.click(crash);
  expect(crash).toHaveAttribute('aria-checked', 'true');
}

function crashPayloadSeen(): boolean {
  return settingsSetMock.mock.calls.some((c) => {
    const p = c[0] as { writingPartner?: { telemetryLevel?: string } };
    return p?.writingPartner?.telemetryLevel === 'crash';
  });
}

async function releaseLoadHolds() {
  await act(async () => {
    const holds = loadHolds.splice(0, loadHolds.length);
    for (const release of holds) release();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickVaultTile(root: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`nav-rail-vault-tile-${root}`));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickVaultsCard(root: string) {
  fireEvent.click(await screen.findByTestId('settings-cat-vaults'));
  const card = await screen.findByTestId(`mvs-card-${root}`);
  await act(async () => {
    fireEvent.click(card);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function goModelKeysTab() {
  fireEvent.click(await screen.findByTestId('settings-cat-agents'));
  await waitFor(() => expect(screen.getByTestId('model-keys-page')).toBeInTheDocument());
}

async function triggerSettingsClose(via: 'close' | 'escape') {
  await act(async () => {
    if (via === 'close') {
      fireEvent.click(screen.getByRole('button', { name: /close settings/i }));
    } else {
      fireEvent.keyDown(document, { key: 'Escape' });
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Probe NH1 close-fail: edit must survive failed Close/Escape, then a later
 * successful Close or Retry must write telemetryLevel=crash. RED under mutant
 * that re-hydrates via settingsGet after onCloseBlocked in handleClose.catch.
 */
async function expectCloseFailKeepsEditThenWrites(resume: 'close' | 'retry') {
  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
  expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
  expect(mainRoot).toBe(VAULT_A);

  await goModelKeysTab();
  // Settle any async settingsGet the close-fail mutant may have kicked off.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(
    await screen.findByTestId('mk-telemetry-crash'),
    'close-fail must keep crash edit checked (RED if settingsGet re-hydrates)',
  ).toHaveAttribute('aria-checked', 'true');

  // Restore save success; Resume via Close or Retry.
  settingsSetMock.mockImplementation(async (next: Persisted) => {
    persisted = { ...persisted, ...next };
    return { saved: true };
  });
  settingsSetMock.mockClear();

  if (resume === 'retry') {
    // Re-park so Retry chrome is available, then Retry.
    settingsSetMock.mockResolvedValueOnce({ saved: false, error: 'disk full' });
    await clickVaultTile(VAULT_B);
    await expectParkChrome();
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      persisted = { ...persisted, ...next };
      return { saved: true };
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B)).toBe(true));
  } else {
    await triggerSettingsClose('close');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
  }
  expect(
    crashPayloadSeen(),
    `later ${resume} must write writingPartner.telemetryLevel=crash`,
  ).toBe(true);
}

/** ProjectSwitcher.tsx is not mounted in the live shell today (WindowChrome's
 * project menu owns that chrome). Mount ProjectSwitcher beside App in this
 * harness so unit tests can still exercise its flush-then-park contract via
 * DesktopShell's `__mythosRequestVaultSwitch` bridge.
 */
function renderAppWithProjectSwitcher() {
  render(
    <>
      <App />
      <div data-testid="harness-project-switcher">
        <ProjectSwitcher
          activeVaultRoot={VAULT_A}
          onSwitched={(root) => {
            const req = (window as Window & {
              __mythosRequestVaultSwitch?: (r: string) => Promise<boolean>;
            }).__mythosRequestVaultSwitch;
            if (req) return req(root);
            return Promise.resolve(false);
          }}
        />
      </div>
    </>,
  );
}

/** ProjectSwitcher.tsx list option (harness beside App — not live WindowChrome). */
async function clickProjectSwitcherEntry(vaultRoot: string) {
  const host = await screen.findByTestId('harness-project-switcher');
  const btn = host.querySelector('.project-switcher-btn') as HTMLElement;
  expect(btn, 'harness ProjectSwitcher trigger').toBeTruthy();
  // Wait for mount-time projectList so the dropdown has rows.
  await waitFor(() => {
    expect(host.querySelector('.project-switcher-btn')).toBeTruthy();
  });
  await act(async () => {
    fireEvent.click(btn);
    await Promise.resolve();
    await Promise.resolve();
  });
  const listbox = await screen.findByRole('listbox', { name: /Mythos Vaults/i });
  const option = await within(listbox).findByRole('option', {
    name: (_, el) => (el.textContent ?? '').includes(vaultRoot) || (el.textContent ?? '').includes('Bravo') || (el.textContent ?? '').includes('Alpha'),
  });
  // Prefer the target vaultRoot path match when both Alpha/Bravo exist.
  const options = within(listbox).getAllByRole('option');
  const target = options.find((el) => (el.textContent ?? '').includes(vaultRoot)) ?? option;
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** LeftRail StoryVaultPicker — real menu item (fireEvent works under Settings overlay). */
async function clickStoryVaultPickerSwitch(targetId: string) {
  const picker = await screen.findByTestId('story-vault-picker-btn');
  await act(async () => {
    fireEvent.click(picker);
    await Promise.resolve();
  });
  const item = await screen.findByTestId(`menu-item-switch:${targetId}`);
  await act(async () => {
    fireEvent.click(item);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openVaultsCategory() {
  fireEvent.click(await screen.findByTestId('settings-cat-vaults'));
  await waitFor(() => expect(screen.getByTestId('settings-cat-vaults')).toHaveAttribute('aria-selected', 'true'));
}

async function expectParkChrome() {
  await waitFor(() => {
    expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
  });
  expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument();
}

describe('DesktopShell Settings flush on real vault-switch (Probe H1 / Shield)', () => {
  // Critic Hard 1 / Probe bar / M2: real SettingsPanel, no mocked save.
  // Deferred flush proves the gate: .shell-loading must stay null until flush
  // resolves (vacuous on freeze tip — stayed green with gate removed). Then
  // assert settingsSet writingPartner.telemetryLevel==='crash'.
  it('real SettingsPanel flush persists telemetry crash across vault-tile switch + unmount', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();

    // Wrap the real flush in a deferred promise so the gate is observable.
    const w = window as Window & { __mythosSettingsFlush?: () => Promise<boolean> };
    const realFlush = w.__mythosSettingsFlush;
    expect(typeof realFlush, 'SettingsPanel must install __mythosSettingsFlush').toBe('function');
    let resolveFlush: ((ok: boolean) => void) | null = null;
    let flushInvoked = false;
    w.__mythosSettingsFlush = () => {
      flushInvoked = true;
      return new Promise<boolean>((resolve) => { resolveFlush = resolve; });
    };

    holdLoad = true;
    await clickVaultTile(VAULT_B);

    expect(flushInvoked, 'tile switch must await __mythosSettingsFlush').toBe(true);
    expect(
      document.querySelector('.shell-loading'),
      'loadVault must wait for flush — shell-loading must not appear yet (RED if gate removed)',
    ).toBeNull();
    expect(crashPayloadSeen(), 'settingsSet must not land before flush resolves').toBe(false);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // Release: run the real save, then resolve the gate.
    await act(async () => {
      const ok = realFlush ? await realFlush() : true;
      resolveFlush?.(ok);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(crashPayloadSeen(), 'settingsSet must receive writingPartner.telemetryLevel=crash').toBe(true);
    });
    await waitFor(() => {
      expect(
        document.querySelector('.shell-loading'),
        'loadVault must run and show .shell-loading after flush (panel unmounts)',
      ).not.toBeNull();
    });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

    holdLoad = false;
    await releaseLoadHolds();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(document.querySelector('.shell-loading')).toBeNull();
    });
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('settings-cat-agents'));
    await waitFor(() => expect(screen.getByTestId('model-keys-page')).toBeInTheDocument());
    expect(await screen.findByTestId('mk-telemetry-crash')).toHaveAttribute('aria-checked', 'true');
  });

  // M4: tile path without announce backup — flushOpenSettings no-op must go RED
  it('tile switch without main announce still flushes before projectSwitch (M4)', async () => {
    announceOnSwitch = false;
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    await clickVaultTile(VAULT_B);

    await waitFor(() => {
      expect(crashPayloadSeen(), 'pre-switch flush must write crash without announce backup').toBe(true);
    });
    expect(projectSwitchMock).toHaveBeenCalled();
    expect(projectSwitchMock.mock.calls[0][0]).toBe(VAULT_B);
  });

  // (b) / M3: refused save — no switch, dialog open, alert + choices
  it('refused flush blocks switch and shows Retry / Switch anyway (M3)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickVaultTile(VAULT_B);

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-switch-error')).toHaveTextContent(
        /couldn't save settings/i,
      );
    });
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
    expect(screen.getByTestId('settings-flush-switch-anyway')).toHaveTextContent(
      /discard unsaved settings/i,
    );
    expect(document.querySelector('.shell-loading')).toBeNull();
  });

  // (c) Switch anyway → switches + discard notice
  it('Switch anyway discards unsaved settings and completes the vault switch', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(projectSwitchMock).toHaveBeenCalled();
    });
    expect(projectSwitchMock.mock.calls[0][0]).toBe(VAULT_B);
    // Toast waits until switch settles (Shield batch).
    await waitFor(() => {
      expect(screen.getByTestId('ln-toast')).toHaveTextContent(
        /unsaved settings were discarded/i,
      );
    });
  });

  // (d) Retry → re-runs save and switches on success
  it('Retry re-runs flush and switches when save succeeds', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    let n = 0;
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      n += 1;
      if (n === 1) return { saved: false, error: 'transient' };
      persisted = { ...persisted, ...next };
      return { saved: true };
    });

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(projectSwitchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(projectSwitchMock).toHaveBeenCalled();
    });
    expect(projectSwitchMock.mock.calls[0][0]).toBe(VAULT_B);
    expect(crashPayloadSeen()).toBe(true);
  });

  // M6: bad API key — hold last good key; block switch with choice until user acts
  it('bad API key on switch holds last-good key and parks switch with choice (M6)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    await clickVaultTile(VAULT_B);

    await waitFor(() => {
      expect(settingsSetMock).toHaveBeenCalled();
    });
    // Last good key held (empty default) — M6 drops this hold → RED.
    expect(settingsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: '' }),
    );
    const badWritten = settingsSetMock.mock.calls.some(
      (c) => (c[0] as { apiKey?: string })?.apiKey === 'bad-key',
    );
    expect(badWritten, 'typed bad key must not be flushed').toBe(false);

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-switch-error')).toHaveTextContent(
        /api key not saved/i,
      );
    });
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
    expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument();
  });

  it('DesktopShell source gates switch on flush boolean (no silent finally-apply)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(/__mythosSettingsFlush/);
    expect(src).toMatch(/flushOpenSettings/);
    expect(src).toMatch(/setPendingVaultSwitch/);
    expect(src).toMatch(/handleFlushSwitchChoice/);
    // Must NOT apply on flush failure via finally.
    expect(src).not.toMatch(/void flush\(\)\.finally\(\(\) => \{ applyProjectSwitched/);
    expect(src).toMatch(/flush\(\)\.then\(async \(ok\) =>/);
    expect(src).toMatch(/const ok = await flushOpenSettings/);
    // Ivy R6: announce park must roll main back; Close completes or cancels.
    expect(src).toMatch(/suppressProjectAnnounceRef/);
    expect(src).toMatch(/vaultPending/);
    // Shield: serialize switches; check rollback results; pass original notes.
    expect(src).toMatch(/enqueueVaultSwitchOp/);
    expect(src).toMatch(/originalNotes/);
    // Guard (b): both same-vault lines pinned (N6/N7 each alone left 0 red).
    expect(src).toMatch(
      /if \(vaultRoot === activeVaultRootRef\.current\) return;[\s\S]*if \(vaultRoot === activeVaultRootRef\.current \|\| vaultRoot === originalRoot\) return;/,
    );
  });

  // HARD — announce path (no tile): onProjectSwitched with Settings open + edit.
  // settingsSet must land BEFORE .shell-loading. RED if handleProjectSwitched
  // skips flush / applies immediately.
  it('HARD: onProjectSwitched flush persists edit before shell-loading (no tile)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    const w = window as Window & { __mythosSettingsFlush?: () => Promise<boolean> };
    const realFlush = w.__mythosSettingsFlush;
    expect(typeof realFlush).toBe('function');
    let resolveFlush: ((ok: boolean) => void) | null = null;
    let flushInvoked = false;
    w.__mythosSettingsFlush = () => {
      flushInvoked = true;
      return new Promise<boolean>((resolve) => { resolveFlush = resolve; });
    };

    holdLoad = true;
    // Simulate main already committed + broadcast (no tile click).
    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushInvoked, 'announce must await __mythosSettingsFlush').toBe(true);
    expect(
      document.querySelector('.shell-loading'),
      'shell-loading must wait for announce flush (RED if broadcast flush off)',
    ).toBeNull();
    expect(crashPayloadSeen(), 'settingsSet must not land before announce flush resolves').toBe(false);

    await act(async () => {
      const ok = realFlush ? await realFlush() : true;
      resolveFlush?.(ok);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(crashPayloadSeen(), 'announce flush must write telemetry=crash before loadVault').toBe(true);
    });
    await waitFor(() => {
      expect(document.querySelector('.shell-loading')).not.toBeNull();
    });

    holdLoad = false;
    await releaseLoadHolds();
    await waitFor(() => expect(document.querySelector('.shell-loading')).toBeNull());
    expect(mainRoot).toBe(VAULT_B);
  });

  // HARD — refused announce save: alert + no renderer switch; main rolled back.
  // RED if broadcast applies even when save refused.
  it('HARD: refused announce flush parks, alerts, and keeps main on original', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    // Main prematurely on B (the bug Ivy named) — announce arrives.
    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-switch-error')).toHaveTextContent(
        /couldn't save settings/i,
      );
    });
    expect(document.querySelector('.shell-loading')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    // Roll back main to original — RED if announce applies despite refused save.
    await waitFor(() => {
      expect(mainRoot, 'main must roll back to original when announce flush refused').toBe(VAULT_A);
    });
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_A}`)).toHaveAttribute('aria-current', 'page');
  });

  // Critic soft: drive a parked main-pushed (announce) switch through to
  // completion via Retry. RED if completeVaultSwitch only updates UI (no
  // projectSwitch re-commit). The park-only test above stops at the park.
  it('HARD: parked announce switch completes via Retry (re-commits main)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mainRoot).toBe(VAULT_A);
    });
    // Shield batch: rollback must pass the original notes pairing.
    expect(
      projectSwitchMock.mock.calls.some(
        (c) => c[0] === VAULT_A && c[1] === '/notes-a',
      ),
      'rollback must projectSwitch(original, originalNotes)',
    ).toBe(true);
    projectSwitchMock.mockClear();

    // Retry flush now succeeds → completeVaultSwitch must re-commit target on main.
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      persisted = { ...persisted, ...next };
      return { saved: true };
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B),
        'Retry after announce-park must projectSwitch to the parked target',
      ).toBe(true);
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
  });

  // Shield N2: Switch anyway on announce park must re-commit main (not UI-only).
  it('HARD: parked announce Switch anyway re-commits main to B (N2)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument());
    await waitFor(() => expect(mainRoot).toBe(VAULT_A));
    projectSwitchMock.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B),
        'Switch anyway after announce-park must projectSwitch to B (N2 RED if UI-only)',
      ).toBe(true);
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
    await waitFor(() => {
      expect(screen.getByTestId('ln-toast')).toHaveTextContent(/unsaved settings were discarded/i);
    });
  });

  // Shield N3: fix key + Escape/Close on announce park must complete to B.
  it('HARD: parked announce Escape completes to B when key fixed (N3)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    await waitFor(() => expect(mainRoot).toBe(VAULT_A));
    projectSwitchMock.mockClear();

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B),
        'Escape after announce-park must projectSwitch to B (N3 RED if Close skips complete)',
      ).toBe(true);
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
  });

  // Shield finding 1 / V6c: refused rollback must not leave UI on A while main on B.
  it('HARD: refused announce rollback follows main — UI matches getVaultRoot (V6c)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === VAULT_A) {
        return { switched: false, error: 'not in recent-projects allowlist' };
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`),
        'UI must follow main when rollback is refused — New Story writes here',
      ).toHaveAttribute('aria-current', 'page');
    });
    expect(mainRoot).toBe(VAULT_B);
    const root = await window.api.getVaultRoot();
    expect(root?.vaultRoot).toBe(VAULT_B);
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
  });

  // Shield finding 2 / V7: park chrome only after rollback; Switch anyway agrees.
  it('HARD: delayed rollback then Switch anyway — main and UI agree (V7)', async () => {
    let releaseRollback!: () => void;
    const rollbackHeld = new Promise<void>((resolve) => {
      releaseRollback = resolve;
    });

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === VAULT_A) {
        await rollbackHeld;
        mainRoot = VAULT_A;
        return { switched: true };
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Park chrome must wait for rollback — overlapping Switch anyway is blocked.
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-flush-switch-anyway')).not.toBeInTheDocument();

    await act(async () => {
      releaseRollback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument());
    expect(mainRoot).toBe(VAULT_A);

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
  });

  it('__mythosRequestVaultSwitch returns false when projectSwitch refuses', async () => {
    announceOnSwitch = false;
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    projectSwitchMock.mockResolvedValue({ switched: false, error: 'refused' });

    const req = (window as Window & {
      __mythosRequestVaultSwitch?: (r: string) => Promise<boolean>;
    }).__mythosRequestVaultSwitch;
    expect(req).toBeTruthy();
    let result = true;
    await act(async () => {
      result = await req!(VAULT_B);
    });
    expect(result, 'must return false when projectSwitch refuses (not true)').toBe(false);
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_A}`)).toHaveAttribute('aria-current', 'page');
    expect(mainRoot).toBe(VAULT_A);
  });

  // Ivy R6 — Close with parked switch: save now succeeds → complete switch.
  it('Close with parked switch completes when save now succeeds (fix key)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    // Second active = A; park switch to First = B.
    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);

    // Fix key, then Close — save succeeds → complete switch to B.
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    // Clear apiKeyError by matching empty last-good (empty default).
    const closeBtn = screen.getByRole('button', { name: /close settings/i });
    await act(async () => {
      fireEvent.click(closeBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(projectSwitchMock).toHaveBeenCalled();
    });
    expect(projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B)).toBe(true);
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
  });

  // Ivy R6 — Close with parked switch: save still fails → cancel; stay original.
  // Probe NH1: edit must survive (crash stays checked) and later write must keep it.
  it('Close with parked switch cancels when save still fails (main stays original)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(mainRoot).toBe(VAULT_A);

    await triggerSettingsClose('close');

    // Still failing — Settings stays open; switch cancelled; main original.
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(mainRoot).toBe(VAULT_A);
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
    // No successful switch to B.
    const switchedToB = projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B);
    expect(switchedToB, 'must not commit target when Close save still fails').toBe(false);
    await expectCloseFailKeepsEditThenWrites('close');
  });

  // Probe NH1 close-fail matrix: Close|Escape × tile|Vault&Files card.
  // Each RED under settingsGet re-hydrate mutant after onCloseBlocked.
  it('NH1 close-fail: tile + Close keeps edit; later Retry writes crash', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    await clickVaultTile(VAULT_B);
    await expectParkChrome();
    await triggerSettingsClose('close');
    await expectCloseFailKeepsEditThenWrites('retry');
  });

  it('NH1 close-fail: tile + Escape keeps edit; later Close writes crash', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    await clickVaultTile(VAULT_B);
    await expectParkChrome();
    await triggerSettingsClose('escape');
    await expectCloseFailKeepsEditThenWrites('close');
  });

  it('NH1 close-fail: Vault & Files card + Close keeps edit; later Retry writes crash', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    await clickVaultsCard(VAULT_B);
    await expectParkChrome();
    await triggerSettingsClose('close');
    await expectCloseFailKeepsEditThenWrites('retry');
  });

  it('NH1 close-fail: Vault & Files card + Escape keeps edit; later Close writes crash', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    await clickVaultsCard(VAULT_B);
    await expectParkChrome();
    await triggerSettingsClose('escape');
    await expectCloseFailKeepsEditThenWrites('close');
  });

  // Probe NH1 HARD2: failed Close must not fake-re-park via same-vault broadcast.
  // RED when guard (a) alone reverted (re-switch on tile park) OR guard (b) alone
  // reverted (park on vaultRoot === active). Mock broadcasts like main.
  it('NH1: failed Close with projectSwitch broadcast leaves no Retry; edit intact', async () => {
    announceOnSwitch = true;
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickVaultTile(VAULT_B);
    await expectParkChrome();
    expect(projectSwitchMock).not.toHaveBeenCalled();
    const switchesBeforeClose = projectSwitchMock.mock.calls.length;

    await triggerSettingsClose('close');

    await waitFor(() => {
      expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('settings-flush-switch-anyway')).not.toBeInTheDocument();
    expect(mainRoot).toBe(VAULT_A);
    // Guard (a): tile park never moved main — must not re-assert projectSwitch.
    expect(
      projectSwitchMock.mock.calls.length,
      'RED if handleSettingsCloseBlocked re-switches when main never moved',
    ).toBe(switchesBeforeClose);

    await goModelKeysTab();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByTestId('mk-telemetry-crash')).toHaveAttribute('aria-checked', 'true');

    // Guard (b): a same-vault broadcast must not park Retry / Switch anyway.
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_A });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      screen.queryByTestId('settings-flush-retry'),
      'RED if handleProjectSwitched parks a switch to the current vault',
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-flush-switch-anyway')).not.toBeInTheDocument();
    expect(await screen.findByTestId('mk-telemetry-crash')).toHaveAttribute('aria-checked', 'true');
  });

  // no-announce Retry — must re-save (settingsSet) before projectSwitch.
  // RED if Retry only switches without re-saving.
  it('no-announce Retry re-saves before switching (RED if Retry skips flush)', async () => {
    announceOnSwitch = false;
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    let n = 0;
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      n += 1;
      if (n === 1) return { saved: false, error: 'transient' };
      persisted = { ...persisted, ...next };
      return { saved: true };
    });

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(projectSwitchMock).not.toHaveBeenCalled();
    const setsBeforeRetry = settingsSetMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(projectSwitchMock).toHaveBeenCalled();
    });
    expect(
      settingsSetMock.mock.calls.length,
      'Retry must call settingsSet again (RED if Retry switches without re-saving)',
    ).toBeGreaterThan(setsBeforeRetry);
    expect(crashPayloadSeen()).toBe(true);
    expect(projectSwitchMock.mock.calls[0][0]).toBe(VAULT_B);
    expect(mainRoot).toBe(VAULT_B);
  });

  // Behaviour (not source-regex): gates loadVault on __mythosSettingsFlush
  // while Settings is open — shell-loading stays null until flush resolves.
  it('behaviour: loadVault waits on __mythosSettingsFlush while Settings open', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();

    const w = window as Window & { __mythosSettingsFlush?: () => Promise<boolean> };
    let resolveFlush: ((ok: boolean) => void) | null = null;
    w.__mythosSettingsFlush = () => new Promise<boolean>((resolve) => { resolveFlush = resolve; });

    holdLoad = true;
    await clickVaultTile(VAULT_B);
    expect(document.querySelector('.shell-loading'), 'must not loadVault before flush').toBeNull();
    expect(resolveFlush, 'flush must be pending').not.toBeNull();

    await act(async () => {
      resolveFlush?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector('.shell-loading')).not.toBeNull();
    });
    holdLoad = false;
    await releaseLoadHolds();
  });

  // RT1: Retry after second failure stays parked; later successful Retry switches.
  it('RT1: Retry after second failure stays parked; later Retry switches', async () => {
    announceOnSwitch = false;
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    let n = 0;
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      n += 1;
      if (n <= 2) return { saved: false, error: 'transient' };
      persisted = { ...persisted, ...next };
      return { saved: true };
    });

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(projectSwitchMock).toHaveBeenCalled());
    expect(mainRoot).toBe(VAULT_B);
  });

  // Vault & Files card — same Retry / Switch anyway as tile (flush-first).
  it('Vault & Files card switch parks with Retry/Switch anyway on refused flush', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    fireEvent.click(await screen.findByTestId('settings-cat-vaults'));
    const card = await screen.findByTestId(`mvs-card-${VAULT_B}`);
    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-switch-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
    expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument();
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);
  });

  // REAL StoryVaultPicker (not globals-only) — refuse parks; Escape cancels.
  // RED if StoryVaultPicker.tsx reverted to 8ccbfa42 (setActive before flush).
  it('story-vault picker refuse parks; Escape cancel keeps original vault', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await screen.findByTestId('story-vault-picker-btn');

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    storyVaultSetActiveMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickStoryVaultPickerSwitch(STORY_VAULT_B);
    await expectParkChrome();
    expect(storyVaultSetActiveMock, 'picker must not setActive on refuse').not.toHaveBeenCalled();
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);
    expect(activeStoryId).toBe(STORY_VAULT_A);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mainRoot).toBe(VAULT_A);
    expect(activeStoryId).toBe(STORY_VAULT_A);
    expect(storyVaultSetActiveMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  // Probe-style: bad key → park → fix → Escape completes switch (save succeeds).
  it('Escape with parked switch completes when key fixed (Probe close branch)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(mainRoot).toBe(VAULT_A);

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B)).toBe(true);
  });

  // ─── Ivy GO: control surfaces (harness ProjectSwitcher; live StoryVaultPicker /
  // VaultLinkingColumns). Each RED when that file → 8ccbfa42. ───

  it('ProjectSwitcher harness: refuse parks; Retry after key fixed switches', async () => {
    announceOnSwitch = false;
    renderAppWithProjectSwitcher();
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await screen.findByTestId('harness-project-switcher');

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    await clickProjectSwitcherEntry(VAULT_B);
    await expectParkChrome();
    expect(projectSwitchMock, 'harness ProjectSwitcher must not projectSwitch on refuse').not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(projectSwitchMock).toHaveBeenCalled());
    expect(projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B)).toBe(true);
    expect(mainRoot).toBe(VAULT_B);
  });

  it('ProjectSwitcher harness: Switch anyway completes switch', async () => {
    announceOnSwitch = false;
    renderAppWithProjectSwitcher();
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await screen.findByTestId('harness-project-switcher');

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickProjectSwitcherEntry(VAULT_B);
    await expectParkChrome();
    expect(projectSwitchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B)).toBe(true));
    expect(mainRoot).toBe(VAULT_B);
  });

  it('REAL StoryVaultPicker: refuse parks; Retry after key fixed setActive', async () => {
    render(<App />);
    await screen.findByTestId('story-vault-picker-btn');

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    storyVaultSetActiveMock.mockClear();
    projectSwitchMock.mockClear();

    await clickStoryVaultPickerSwitch(STORY_VAULT_B);
    await expectParkChrome();
    expect(storyVaultSetActiveMock).not.toHaveBeenCalled();
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(activeStoryId).toBe(STORY_VAULT_A);

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(storyVaultSetActiveMock).toHaveBeenCalledWith(STORY_VAULT_B));
    expect(activeStoryId).toBe(STORY_VAULT_B);
  });

  it('REAL StoryVaultPicker: Switch anyway setActive target', async () => {
    render(<App />);
    await screen.findByTestId('story-vault-picker-btn');

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    storyVaultSetActiveMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await clickStoryVaultPickerSwitch(STORY_VAULT_B);
    await expectParkChrome();
    expect(storyVaultSetActiveMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(storyVaultSetActiveMock).toHaveBeenCalledWith(STORY_VAULT_B));
    expect(activeStoryId).toBe(STORY_VAULT_B);
  });

  it('REAL VaultLinkingColumns story card: refuse parks; Retry after key fixed setActive', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeys();
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'bad-key' },
    });
    settingsSetMock.mockClear();
    storyVaultSetActiveMock.mockClear();
    projectSwitchMock.mockClear();

    await openVaultsCategory();
    const card = await screen.findByTestId(`story-vault-card-${STORY_VAULT_B}`);
    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await expectParkChrome();
    expect(
      storyVaultSetActiveMock,
      'VaultLinkingColumns must not setActive on refuse',
    ).not.toHaveBeenCalled();
    expect(projectSwitchMock).not.toHaveBeenCalled();
    expect(activeStoryId).toBe(STORY_VAULT_A);

    // Key fixed — agents tab still holds the input (or re-open Model & keys).
    fireEvent.click(await screen.findByTestId('settings-cat-agents'));
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(storyVaultSetActiveMock).toHaveBeenCalledWith(STORY_VAULT_B));
    expect(activeStoryId).toBe(STORY_VAULT_B);
  });

  it('REAL VaultLinkingColumns story card: Switch anyway setActive target', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    storyVaultSetActiveMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await openVaultsCategory();
    const card = await screen.findByTestId(`story-vault-card-${STORY_VAULT_B}`);
    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await expectParkChrome();
    expect(storyVaultSetActiveMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(storyVaultSetActiveMock).toHaveBeenCalledWith(STORY_VAULT_B));
    expect(activeStoryId).toBe(STORY_VAULT_B);
  });

  // ─── Ivy GO HARD batch pins (Critic H8-1 / Probe C7 / Shield G8·G8f·G8d·G2·G1d·V7) ───

  it('HARD source: DesktopShell onCreated awaits switchToVault (C7a)', () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    // RED if `void switchToVault(vaultRoot)` returns before the flush settles.
    expect(src).toMatch(
      /useCreateMythosVaultFlow\(\s*useCallback\(async \(\{ vaultRoot \}\) => \{[\s\S]*?await switchToVault\(vaultRoot\);/,
    );
    expect(src).not.toMatch(
      /useCreateMythosVaultFlow\(\s*useCallback\(\(\{ vaultRoot \}\) => \{[\s\S]*?void switchToVault\(vaultRoot\);/,
    );
  });

  it('HARD source: C7b panel flush get→set on settingsWriteSerial chain', () => {
    const panel = readFileSync(resolve(__dirname, 'SettingsPanel.tsx'), 'utf8');
    const serial = readFileSync(resolve(__dirname, 'settingsWriteSerial.ts'), 'utf8');
    expect(serial).toMatch(/settingsWriteChain\.then\(op,\s*op\)/);
    // writeSettingsPayload: get→set must stay on enqueueSettingsWrite (not a loose flow match).
    expect(panel).toMatch(
      /const writeSettingsPayload = useCallback\(async \(payload: AppSettings\): Promise<AppSettings> => \{[\s\S]*?return enqueueSettingsWrite\(async \(\) => \{\s*const disk = await window\.api\.settingsGet\(\);[\s\S]*?withOnboarding\.onboardingStartMode = disk\.onboardingStartMode/,
    );
  });

  it('HARD source: vaultSwitchSerialRef.then(op, op) serialization (V7)', () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    // RED if enqueue degenerates to bare `op()` (Probe gap).
    expect(src).toMatch(/vaultSwitchSerialRef\.current\.then\(op,\s*op\)/);
    expect(src).not.toMatch(
      /const enqueueVaultSwitchOp = useCallback\(\(op: \(\) => Promise<void>\): Promise<void> => \{\s*const next = op\(\);/,
    );
  });

  // C7a behavioral: real shell onCreated + Settings open — hook's startMode
  // settingsSet must wait until switchToVault (flush + project:switched) settles.
  // RED if `await switchToVault` → `void switchToVault` (C7 write races ahead).
  it('C7a behavioral: onboardingStartMode settingsSet waits for switchToVault settle', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    let releaseSwitch!: () => void;
    const switchHeld = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    let switchStarted = false;
    const c7SetOrder: string[] = [];

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === '/vault-new') {
        switchStarted = true;
        await switchHeld;
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    const origSet = settingsSetMock.getMockImplementation() as
      ((next: Persisted) => Promise<{ saved: boolean }>) | undefined;
    expect(origSet).toBeTypeOf('function');
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      if (next.onboardingStartMode === 'blank' && next.onboardingComplete === true) {
        c7SetOrder.push('c7-set');
      } else {
        c7SetOrder.push('flush-set');
      }
      return origSet!(next);
    });

    createVaultFromOptionsMock.mockClear();
    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(createVaultFromOptionsMock).toHaveBeenCalled());
    await waitFor(() => expect(switchStarted).toBe(true));
    // While switchToVault is held, C7 must not have written yet.
    expect(
      c7SetOrder.includes('c7-set'),
      'C7a RED if void switchToVault — hook settingsSet runs before switch settles',
    ).toBe(false);

    await act(async () => {
      releaseSwitch();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(c7SetOrder).toContain('c7-set'));
    expect(c7SetOrder.indexOf('flush-set')).toBeGreaterThanOrEqual(0);
    expect(c7SetOrder.indexOf('c7-set')).toBeGreaterThan(c7SetOrder.indexOf('flush-set'));
    expect(persisted.onboardingStartMode).toBe('blank');
    expect(mainRoot).toBe('/vault-new');
  });

  // C7b hook-side: hold the hook's onboardingStartMode settingsSet on the
  // serial chain (post-get; holding settingsGet stalls Settings remount hydrate),
  // let a panel flush land after release. Disk must keep chosen startMode AND
  // the panel's other edits. RED if hook write leaves enqueueSettingsWrite.
  it('C7b behavioral: held hook settingsSet on chain + panel flush — startMode + edits survive', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    announceOnSwitch = false;
    let releaseC7Set!: () => void;
    let c7SetHeld = false;
    let armC7Hold = true;

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    expect(await screen.findByTestId('mk-telemetry-crash')).toHaveAttribute('aria-checked', 'true');

    // Hold the hook's settingsSet (blank + onboardingComplete) so a concurrent
    // panel flush must wait on settingsWriteSerial — not on a bare settingsGet
    // which would stall Settings remount hydrate.
    const prevSet = settingsSetMock.getMockImplementation() as
      ((next: Persisted) => Promise<{ saved: boolean }>) | undefined;
    expect(prevSet).toBeTypeOf('function');
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      if (
        armC7Hold
        && next.onboardingStartMode === 'blank'
        && next.onboardingComplete === true
        && !c7SetHeld
      ) {
        c7SetHeld = true;
        await new Promise<void>((resolve) => {
          releaseC7Set = resolve;
        });
      }
      return prevSet!(next);
    });

    createVaultFromOptionsMock.mockClear();
    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(c7SetHeld).toBe(true));

    // Remount after switch may have cleared the crash toggle — restore before flush.
    if (!screen.queryByTestId('settings-cat-agents')) {
      openSettings();
      await waitFor(() => expect(screen.getByTestId('settings-cat-agents')).toBeInTheDocument());
    }
    fireEvent.click(screen.getByTestId('settings-cat-agents'));
    await waitFor(() => expect(screen.getByTestId('model-keys-page')).toBeInTheDocument());
    const crashBtn = await screen.findByTestId('mk-telemetry-crash');
    if (crashBtn.getAttribute('aria-checked') !== 'true') {
      fireEvent.click(crashBtn);
    }
    expect(crashBtn).toHaveAttribute('aria-checked', 'true');

    const flush = (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
      .__mythosSettingsFlush;
    expect(flush, 'Settings flush hook must be installed').toBeTruthy();
    const setsBeforeFlush = settingsSetMock.mock.calls.length;
    let flushDone: Promise<boolean> | undefined;
    await act(async () => {
      flushDone = flush!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Hook still held on the chain → flush must not have written yet.
    expect(
      settingsSetMock.mock.calls.length,
      'flush must wait on hook write still held on the chain',
    ).toBe(setsBeforeFlush);

    await act(async () => {
      armC7Hold = false;
      releaseC7Set();
      await flushDone;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));
    expect(
      persisted.onboardingStartMode,
      'C7b RED if hook write left enqueueSettingsWrite — flush clobbers startMode',
    ).toBe('blank');
    expect(
      persisted.writingPartner?.telemetryLevel,
      'C7b RED if hook write left the chain — panel crash edit lost on full-replace',
    ).toBe('crash');
  });

  // V7 behavioral: two overlapping enqueueVaultSwitchOp completions (the chain
  // `.then(op, op)` guards). First held → second must not start; final active =
  // second target. RED if enqueue degenerates to bare `op()`.
  // Switch-anyway (no suppress) held + announce-rollback enqueue overlaps the chain.
  it('V7 behavioral: held first enqueued switch — second waits; final active is second', async () => {
    const VAULT_C = '/vault-c';
    announceOnSwitch = false;
    const api = window.api as { projectList: () => Promise<{ projects: unknown[] }> };
    const prevList = await api.projectList();
    (window.api as { projectList: typeof api.projectList }).projectList = () => Promise.resolve({
      projects: [
        ...prevList.projects as Array<{ vaultRoot: string; name: string; openedAt: string; notesVaultRoot: string }>,
        { vaultRoot: VAULT_C, name: 'Charlie', openedAt: '', notesVaultRoot: '/notes-c' },
      ],
    });

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const switchStarts: string[] = [];

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    // Tile park B, then Switch anyway → enqueue completeVaultSwitch(B); hold it.
    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument());

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      switchStarts.push(vaultRoot);
      if (vaultRoot === VAULT_B && switchStarts.filter((v) => v === VAULT_B).length === 1) {
        await firstHeld;
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(switchStarts).toContain(VAULT_B));

    // Re-open Settings + announce C while Switch-anyway(B) held — second
    // enqueueVaultSwitchOp (announce rollback). suppress is NOT set on the
    // Switch-anyway path, so the announce is not dropped.
    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> }).__mythosSettingsFlush,
      ).toBeTypeOf('function');
    });
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_C });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(
      switchStarts.length,
      'V7 RED if then(op,op)→op() — second enqueued op starts while first held',
    ).toBe(1);
    expect(switchStarts).toEqual([VAULT_B]);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Second op (announce rollback toward parking C) must run after first settles.
    await waitFor(() => expect(switchStarts.length).toBeGreaterThan(1));

    // applyProjectSwitched(B) may remount Settings and clear saveError — re-refuse
    // so Retry / Switch anyway chrome returns while pending targets C.
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });
    const flushAfter = (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
      .__mythosSettingsFlush;
    if (flushAfter && !screen.queryByTestId('settings-flush-switch-anyway')) {
      await act(async () => {
        await flushAfter();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_C));
    const root = await window.api.getVaultRoot();
    expect(root?.vaultRoot).toBe(VAULT_C);
  });

  it('HARD: shell create activate:false + flush-first (G8 / G8f)', async () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    // G8: options object must carry activate:false (not a comment).
    expect(src).toMatch(
      /useCreateMythosVaultFlow\([\s\S]*?\{\s*activate:\s*false,\s*onOnboardingSynced:\s*syncOnboardingIntoAppSettings\s*\}/,
    );
    expect(src).toMatch(/await switchToVault\(vaultRoot\)/);
    expect(src).not.toMatch(
      /useCreateMythosVaultFlow\(\s*useCallback\([\s\S]*?handleProjectSwitched\(vaultRoot\)/,
    );

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    createVaultFromOptionsMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(createVaultFromOptionsMock).toHaveBeenCalled());
    expect(createVaultFromOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false, mode: 'blank' }),
    );
    // Refused flush parks — no projectSwitch to the new vault before save.
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(
      projectSwitchMock.mock.calls.some((c) => c[0] === '/vault-new'),
      'must not projectSwitch new vault before refused save settles (G8)',
    ).toBe(false);
    expect(mainRoot).toBe(VAULT_A);
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_A}`)).toHaveAttribute('aria-current', 'page');

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-switch-anyway'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mainRoot).toBe('/vault-new'));
    const root = await window.api.getVaultRoot();
    expect(root?.vaultRoot).toBe('/vault-new');
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_A}`).getAttribute('aria-current')).not.toBe('page');
  });

  it('HARD: Welcome onPickPath create uses same activate:false shell path (G8)', async () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(/onPickPath=\{\(id: WelcomePathId\) => \{/);
    expect(src).toMatch(/void createMythosVault\(id\)/);
    // Single shell hook — Welcome and rail+ share activate:false options object.
    expect(src).toMatch(
      /useCreateMythosVaultFlow\([\s\S]*?\{\s*activate:\s*false,\s*onOnboardingSynced:\s*syncOnboardingIntoAppSettings\s*\}/,
    );
    expect(src).toMatch(/onOnboardingSynced:\s*syncOnboardingIntoAppSettings/);
  });

  it('HARD: openVaultViaPicker flush-first — refused save skips openVaultFolder (G8d)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    openVaultFolderMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    const openPicker = (window as Window & {
      __mythosOpenVaultViaPicker?: () => Promise<void>;
    }).__mythosOpenVaultViaPicker;
    expect(openPicker, 'Open vault… hook must be installed').toBeTruthy();

    await act(async () => {
      await openPicker!();
    });
    expect(
      openVaultFolderMock,
      'G8d RED if openVaultFolder runs before/without flush success',
    ).not.toHaveBeenCalled();
    expect(mainRoot).toBe(VAULT_A);
  });

  it('HARD: Close-blocked re-assert refused while main elsewhere follows getVaultRoot (G2)', async () => {
    const VAULT_C = '/vault-c';
    // Extend project list so getVaultRoot C is displayable if needed.
    const api = window.api as { projectList: () => Promise<{ projects: unknown[] }> };
    const prevList = await api.projectList();
    (window.api as { projectList: typeof api.projectList }).projectList = () => Promise.resolve({
      projects: [
        ...prevList.projects as Array<{ vaultRoot: string; name: string; openedAt: string; notesVaultRoot: string }>,
        { vaultRoot: VAULT_C, name: 'Charlie', openedAt: '', notesVaultRoot: '/notes-c' },
      ],
    });

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    // Announce park: rollback to A succeeds → park chrome.
    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === VAULT_A) {
        mainRoot = VAULT_A;
        return { switched: true };
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());
    expect(mainRoot).toBe(VAULT_A);

    // While parked: main silently moves to C (F5-style); Close-blocked re-assert
    // of A is refused → must follow main (G2).
    let reassertSeen = false;
    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === VAULT_A) {
        reassertSeen = true;
        mainRoot = VAULT_C;
        return { switched: false, error: 'not in recent-projects allowlist' };
      }
      mainRoot = vaultRoot;
      return { switched: true };
    });
    mainRoot = VAULT_C;

    await triggerSettingsClose('close');
    await waitFor(() => expect(reassertSeen).toBe(true));
    await waitFor(() => {
      expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_A}`).getAttribute('aria-current')).not.toBe('page');
    });
    const root = await window.api.getVaultRoot();
    expect(root?.vaultRoot).toBe(VAULT_C);
    expect(mainRoot).toBe(VAULT_C);
  });

  it('HARD: refused announce rollback throw follows getVaultRoot (G1d)', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === VAULT_A) {
        throw new Error('EACCES rollback');
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    mainRoot = VAULT_B;
    await act(async () => {
      onProjectSwitchedCb?.({ vaultRoot: VAULT_B });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`),
        'G1d RED if throw path does not follow main',
      ).toHaveAttribute('aria-current', 'page');
    });
    expect(mainRoot).toBe(VAULT_B);
    const root = await window.api.getVaultRoot();
    expect(root?.vaultRoot).toBe(VAULT_B);
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
  });

  it('C7b: Settings Close preserves main-stored onboardingStartMode', async () => {
    // Hydrate panel on template, then land a C7 write on disk while Settings
    // stays open — Close must send disk blank, not the mount snapshot.
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument());
    // Simulate C7 write after hydrate (panel local state still template).
    persisted = { ...persisted, onboardingStartMode: 'blank', onboardingComplete: true };
    settingsSetMock.mockClear();

    await triggerSettingsClose('close');
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'C7-5 RED if Close flush overwrites disk blank with mount snapshot',
    ).toBe('blank');
  });

  it('C7b: Settings Retry preserves main-stored onboardingStartMode', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    // Refuse first flush → park. Panel still holds template from hydrate.
    settingsSetMock.mockImplementation(async () => ({ saved: false, error: 'disk full' }));
    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());

    // C7 write lands on disk while parked; panel mount snapshot remains template.
    persisted = { ...persisted, onboardingStartMode: 'blank', onboardingComplete: true };

    settingsSetMock.mockImplementation(async (next: Persisted) => {
      persisted = { ...next };
      return { saved: true };
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(
      persisted.onboardingStartMode,
      'C7-2 RED if Retry flush drops disk onboardingStartMode',
    ).toBe('blank');
  });

  it('C7b interleave: held panel settingsGet + C7 write — disk startMode survives', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    holdSettingsGet = true;
    settingsSetMock.mockClear();

    const flush = (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
      .__mythosSettingsFlush;
    expect(flush).toBeTruthy();

    let flushDone: Promise<boolean> | undefined;
    await act(async () => {
      flushDone = flush!();
      await Promise.resolve();
    });
    await waitFor(() => expect(settingsGetHolds.length).toBeGreaterThan(0));

    // C7 write enqueued while flush get is held — must wait on the serial chain.
    const c7Write = enqueueSettingsWrite(async () => {
      const cur = { ...persisted };
      await window.api.settingsSet({
        ...cur,
        apiKey: cur.apiKey ?? '',
        onboardingComplete: true,
        onboardingStartMode: 'blank',
      } as Parameters<typeof window.api.settingsSet>[0]);
    });

    await act(async () => {
      const holds = settingsGetHolds.splice(0, settingsGetHolds.length);
      holdSettingsGet = false;
      for (const release of holds) release();
      await flushDone;
      await c7Write;
    });

    expect(
      persisted.onboardingStartMode,
      'RED if get/set leave the chain or flush uses mount snapshot over disk',
    ).toBe('blank');
  });

  it('C7 create (c): rail+ Blank with Settings open — startMode blank after flush (C7a+C7b)', async () => {
    // independent guards: per-guard pins 1/2 + Close/Retry/interleave; (c) red on joint revert.
    // (a) and (b) each fully cover C7 alone via the behavioral pins above — a single
    // revert of only (a) or only (b) can leave (c) green. Do not treat (c) as
    // per-guard proof; Critic/Shield run their own reverts.
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    const order: string[] = [];
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    const origSet = settingsSetMock.getMockImplementation() as
      ((next: Persisted) => Promise<{ saved: boolean }>) | undefined;
    expect(origSet).toBeTypeOf('function');
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      if (next.onboardingStartMode === 'blank' && next.onboardingComplete === true) {
        order.push('c7-set');
      } else {
        order.push('flush-set');
      }
      return origSet!(next);
    });

    createVaultFromOptionsMock.mockClear();
    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(createVaultFromOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false, mode: 'blank' }),
    ));
    await waitFor(() => expect(order).toContain('c7-set'));
    // Joint integration only — not a per-guard pin (see C7a/C7b behavioral above).
    expect(order.indexOf('flush-set')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('c7-set')).toBeGreaterThan(order.indexOf('flush-set'));
    expect(persisted.onboardingStartMode).toBe('blank');

    // After create, panel may still be hydrated on template; Close must keep blank
    // when both C7a ordering and C7b disk-preserve are intact (joint).
    settingsSetMock.mockClear();
    await triggerSettingsClose('close');
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'joint (c): blank must survive Close after create when both C7a+C7b hold',
    ).toBe('blank');
  });

  // ─── H10-1 / Probe HARD 2d / Shield onSaved / Critic guardrails A+B ───

  it('HARD source: H10-1 enqueue-next onboarding sync (no nested await enqueue)', () => {
    const flow = readFileSync(resolve(__dirname, 'useCreateMythosVaultFlow.tsx'), 'utf8');
    const shell = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    // Write op closes, THEN a second enqueue for sync (Critic A — not nested).
    expect(flow).toMatch(
      /onboardingStartMode: startMode,[\s\S]*?\}\);[\s\S]*?\/\/ H10-1[\s\S]*?await enqueueSettingsWrite\(async \(\) => \{[\s\S]*?onOnboardingSyncedRef/,
    );
    expect(shell).toMatch(/onOnboardingSynced:\s*syncOnboardingIntoAppSettings/);
    // Secure: sync merges only onboarding* keys.
    expect(shell).toMatch(/onboardingComplete:\s*patch\.onboardingComplete/);
    expect(shell).toMatch(/onboardingStartMode:\s*patch\.onboardingStartMode/);
  });

  it('HARD source: SettingsPanel onSaved receives post-overlay written object', () => {
    const panel = readFileSync(resolve(__dirname, 'SettingsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/return withOnboarding;/);
    expect(panel).toMatch(/\.then\(\(written\) => \{[\s\S]*?onSaved\?\.\(written\)/);
    // Must not call onSaved with the pre-overlay payload variable at Close/flush.
    expect(panel).not.toMatch(/\.then\(\(\) => \{[\s\S]*?onSaved\?\.\(payload\)/);
  });

  it('HARD source soft: onCreated settingsGet after await switchToVault order', () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(
      /await switchToVault\(vaultRoot\);[\s\S]*?const fresh = await window\.api\?\.settingsGet/,
    );
  });

  it('HARD source soft: flush-choice awaits vaultSwitchSerialRef', () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(
      /handleFlushSwitchChoice = useCallback\(async \(choice[\s\S]*?await vaultSwitchSerialRef\.current;/,
    );
  });

  it('HARD source soft: __mythosOpenVaultViaPicker gated to test MODE', () => {
    const src = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(/import\.meta\.env\.MODE !== 'test'/);
    expect(src).toMatch(/__mythosOpenVaultViaPicker/);
  });

  it('H10-1: create Blank then shell full-object write keeps onboardingStartMode blank', async () => {
    // Probe HARD 2d / Critic H10-1 — RED at 48f05422 without post-C7 shell sync.
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    createVaultFromOptionsMock.mockClear();
    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(createVaultFromOptionsMock).toHaveBeenCalled());
    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));

    // Shell full-object write (vault rename) must carry blank, not template.
    settingsSetMock.mockClear();
    const tile = screen.getByTestId('nav-rail-vault-tile-/vault-new');
    fireEvent.contextMenu(tile);
    const rename = await screen.findByRole('menuitem', { name: /^Rename$/i });
    fireEvent.click(rename);
    const prompt = await screen.findByRole('dialog', { name: /Rename vault/i });
    const input = within(prompt).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed New' } });
    fireEvent.click(within(prompt).getByRole('button', { name: /^OK$/i }));

    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'H10-1 RED at 48f05422 — shell rename wrote stale template over blank',
    ).toBe('blank');
    await waitFor(() => expect(screen.getByTestId('vs-template-cta')).toBeInTheDocument());
  });

  it('H10-1: Welcome Blank — in-session template CTA after create+sync', async () => {
    // Probe HARD 2d — CTA count 0 at 48f05422; 1 when shell holds blank.
    // Must not wait on the navHistory 500ms settingsGet debounce (that can
    // falsely hydrate blank from disk after C7). Force an immediate shell
    // full-object write; without H10-1 sync it erases blank and CTA stays gone.
    persisted = {
      ...basePersisted(),
      onboardingComplete: false,
      onboardingStartMode: null,
    };
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('welcome-overlay')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('welcome-path-blank'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));

    settingsSetMock.mockClear();
    const hide = screen.queryByRole('button', { name: /Hide right sidebar/i });
    if (hide) {
      fireEvent.click(hide);
      await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    } else {
      // GRS not yet visible — tip of nav rail / tab shell write instead.
      const notes = screen.queryByRole('button', { name: /^Notes$/i });
      if (notes) fireEvent.click(notes);
      await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    }
    expect(
      persisted.onboardingStartMode,
      'Welcome Blank RED at 48f05422 — shell write erased blank before CTA sync',
    ).toBe('blank');
    await waitFor(() => expect(screen.getByTestId('vs-template-cta')).toBeInTheDocument());
  });

  it('H10-1 Secure: resync merges only onboarding* — masked secret survives shell write', async () => {
    const REAL_KEY = 'sk-real-secret-value';
    const MASK = '••••••••';
    persisted = {
      ...basePersisted(),
      apiKey: REAL_KEY,
      onboardingStartMode: 'template',
      theme: 'dark',
    };
    // settingsGet always returns a masked view (main's secret placeholder).
    const api = window.api as {
      settingsGet: () => Promise<Persisted>;
    };
    api.settingsGet = () => Promise.resolve({
      ...persisted,
      apiKey: persisted.apiKey ? MASK : '',
    });
    // Main keeps the real key when the renderer echoes the mask.
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      const apiKey = next.apiKey === MASK ? persisted.apiKey : next.apiKey;
      if (settingsSetFullReplace) {
        persisted = { ...next, apiKey };
      } else {
        persisted = { ...persisted, ...next, apiKey };
      }
      return { saved: true };
    });

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    const beforeKeys = { ...persisted };

    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));

    settingsSetMock.mockClear();
    // Shell full-object write via GRS hide — must not persist the mask.
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    fireEvent.click(hide);
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));

    expect(persisted.apiKey, 'Secure RED if shell stored masked placeholder').toBe(REAL_KEY);
    expect(persisted.onboardingStartMode).toBe('blank');
    // Aside from onboarding*, theme and other non-GRS keys stay put.
    expect(persisted.theme).toBe(beforeKeys.theme);
  });

  it('H10-1 Critic A: create+sync completes with Settings open (no hang)', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    createVaultFromOptionsMock.mockClear();
    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    // Bounded — RED if sync nested-awaits the chain (deadlock).
    await waitFor(
      () => expect(persisted.onboardingStartMode).toBe('blank'),
      { timeout: 5_000 },
    );
    await waitFor(() => expect(screen.getByTestId('vs-template-cta')).toBeInTheDocument(), {
      timeout: 5_000,
    });
  });

  it('H10-1 Critic A: create+sync completes with vault switch in flight (no hang)', async () => {
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    let releaseSwitch!: () => void;
    const switchHeld = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    projectSwitchMock.mockImplementation(async (vaultRoot: string) => {
      if (vaultRoot === '/vault-new') {
        await switchHeld;
      }
      mainRoot = vaultRoot;
      if (announceOnSwitch) onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    });

    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(projectSwitchMock).toHaveBeenCalled());
    await act(async () => {
      releaseSwitch();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(
      () => expect(persisted.onboardingStartMode).toBe('blank'),
      { timeout: 5_000 },
    );
  });

  it('Shield: park→Retry→Close→hide GRS — onSaved post-overlay keeps blank', async () => {
    // Shield stale onSaved — RED at 48f05422 when onSaved gets pre-overlay payload.
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    settingsSetMock.mockImplementation(async () => ({ saved: false, error: 'disk full' }));
    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());

    // C7 blank on disk while parked; panel mount snapshot remains template.
    persisted = { ...persisted, onboardingStartMode: 'blank', onboardingComplete: true };

    settingsSetMock.mockImplementation(async (next: Persisted) => {
      persisted = { ...next };
      return { saved: true };
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mainRoot).toBe(VAULT_B));
    expect(persisted.onboardingStartMode).toBe('blank');

    // Close Settings — onSaved must receive post-overlay blank, not template.
    settingsSetMock.mockClear();
    await triggerSettingsClose('close');
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(persisted.onboardingStartMode).toBe('blank');

    // Shell full-object write (hide right sidebar) must not restore template.
    settingsSetMock.mockClear();
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    fireEvent.click(hide);
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'Shield RED at 48f05422 — onSaved(payload) left shell on template; GRS hide wrote it back',
    ).toBe('blank');
  });

  // ─── r11 uncaught mutants M3 / M4 / M5 / M5b / M8 ───

  it('M3: Retry flush onSaved(written) — shell write keeps blank without Close', async () => {
    // M3: flushSave `.then` uses onSaved(payload) (mount snapshot) instead of written.
    // Must drive Retry itself — Close's onSaved(written) must not mask the mutant.
    // Hold projectSwitch after Retry so loadVault cannot rehydrate disk and mask
    // onSaved; then shell-write (GRS hide) while the shell still holds that value.
    persisted = { ...basePersisted(), onboardingStartMode: 'template' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();

    settingsSetMock.mockImplementation(async () => ({ saved: false, error: 'disk full' }));
    await clickVaultTile(VAULT_B);
    await waitFor(() => expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument());

    persisted = { ...persisted, onboardingStartMode: 'blank', onboardingComplete: true };

    settingsSetMock.mockImplementation(async (next: Persisted) => {
      persisted = { ...next };
      return { saved: true };
    });

    let releaseSwitch: (() => void) | null = null;
    projectSwitchMock.mockImplementation(
      () => new Promise<{ switched: boolean }>((resolve) => {
        releaseSwitch = () => {
          mainRoot = VAULT_B;
          resolve({ switched: true });
        };
      }),
    );

    settingsSetMock.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-flush-retry'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      (settingsSetMock.mock.calls[0][0] as Persisted).onboardingStartMode,
      'Retry flush must write disk-overlaid blank',
    ).toBe('blank');
    await waitFor(() => expect(projectSwitchMock).toHaveBeenCalled());

    // No Close — shell must hold post-overlay blank from Retry onSaved(written).
    settingsSetMock.mockClear();
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    await act(async () => {
      fireEvent.click(hide);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'M3 RED — Retry onSaved(payload) left shell on template; GRS hide wrote it back',
    ).toBe('blank');

    await act(async () => {
      releaseSwitch?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('M4: Appearance onSaved(written) after Blank — shell write keeps blank', async () => {
    // M4: Appearance live persist calls onSaved(payload) instead of written.
    // Disk stays blank after Blank create. The Appearance base settingsGet is
    // forced stale (template) while writeSettingsPayload's disk get stays blank
    // — tip onSaved(written) keeps the shell on blank; mutant onSaved(payload)
    // stashes template and a later shell full-object write erases blank.
    persisted = { ...basePersisted(), onboardingStartMode: 'template', theme: 'dark' };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: /^appearance$/i })).toBeInTheDocument());
    // Let the post-hydrate appearanceLiveReady seed settle — no live write yet.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });

    const api = window.api as { settingsGet: () => Promise<Persisted> };
    const origGet = api.settingsGet.bind(api);
    let staleBaseOnce = true;
    api.settingsGet = async () => {
      if (staleBaseOnce) {
        staleBaseOnce = false;
        // Appearance persistAppearanceLive base snapshot — stale vs disk.
        return { ...persisted, onboardingStartMode: 'template' as const };
      }
      return { ...persisted };
    };

    settingsSetMock.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: /High contrast/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    // Disk overlay must have kept the Appearance settingsSet on blank.
    expect(
      (settingsSetMock.mock.calls[0][0] as Persisted).onboardingStartMode,
      'Appearance writeSettingsPayload must overlay disk blank',
    ).toBe('blank');
    api.settingsGet = origGet;

    settingsSetMock.mockClear();
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    fireEvent.click(hide);
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      persisted.onboardingStartMode,
      'M4 RED — Appearance onSaved(payload) stashed template; shell write erased blank',
    ).toBe('blank');
  });

  it('M5/M5b: resync patch is onboarding*-only — shell write keeps pre-sync apiKey+theme', async () => {
    // M5: hook forwards whole disk via onOnboardingSynced({ ...disk, ...patch }).
    // M5b: shell syncOnboardingIntoAppSettings spreads ...(patch as any) into prev.
    // Existing Secure pin stays green under both (settingsSet mask→real). This pin
    // asserts the shell-written payload itself.
    const REAL_KEY = 'sk-real-secret-value';
    const MASK = '••••';
    persisted = {
      ...basePersisted(),
      apiKey: REAL_KEY,
      theme: 'dark',
      onboardingStartMode: 'template',
    };

    let c7Written = false;
    settingsSetMock.mockImplementation(async (next: Persisted) => {
      if (next.onboardingStartMode === 'blank' && next.onboardingComplete === true) {
        c7Written = true;
      }
      if (settingsSetFullReplace) {
        persisted = { ...next };
      } else {
        persisted = { ...persisted, ...next };
      }
      return { saved: true };
    });

    const api = window.api as { settingsGet: () => Promise<Persisted> };
    api.settingsGet = () => {
      if (c7Written) {
        // H10-1 sync read: masked secret + a key that differs from the shell copy.
        return Promise.resolve({
          ...persisted,
          apiKey: MASK,
          theme: 'high-contrast',
        });
      }
      // Pre-C7 (incl. onCreated): real values so shell holds REAL+dark beforehand.
      return Promise.resolve({ ...persisted });
    };

    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    fireEvent.click(screen.getByTestId('nav-rail-vault-add'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(persisted.onboardingStartMode).toBe('blank'));

    settingsSetMock.mockClear();
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    fireEvent.click(hide);
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));

    const written = settingsSetMock.mock.calls[settingsSetMock.mock.calls.length - 1][0] as Persisted;
    expect(
      written.apiKey,
      'M5/M5b RED — shell wrote disk masked apiKey after whole-disk sync',
    ).toBe(REAL_KEY);
    expect(
      written.theme,
      'M5/M5b RED — shell wrote disk theme after ...(patch) spread',
    ).toBe('dark');
    expect(written.onboardingStartMode).toBe('blank');
  });

  it('HARD source: M5 sync patch keys are only onboardingComplete + onboardingStartMode', () => {
    const flow = readFileSync(resolve(__dirname, 'useCreateMythosVaultFlow.tsx'), 'utf8');
    const shell = readFileSync(resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(flow).toMatch(
      /const patch: OnboardingSyncPatch = \{\s*onboardingComplete:[\s\S]*?onboardingStartMode:[\s\S]*?\};/,
    );
    expect(flow).toMatch(/onOnboardingSyncedRef\.current\?\.\(patch\)/);
    expect(flow).not.toMatch(/onOnboardingSyncedRef\.current\?\.\(\{[\s\S]*?\.\.\.\s*\(?\s*disk/);
    // M5b: within syncOnboardingIntoAppSettings only — reject whole-patch spreads
    // (...patch / ...(patch) / ...(patch as any)), not property-keyed ...(patch.x).
    const syncSlice = shell.match(
      /const syncOnboardingIntoAppSettings = useCallback\(\(patch:[\s\S]*?\}, \[\]\);/,
    );
    expect(syncSlice?.[0], 'syncOnboardingIntoAppSettings must exist').toBeTruthy();
    expect(syncSlice![0]).not.toMatch(
      /\.\.\.\s*(?:patch\b(?!\.)|\(\s*patch(?:\s+as\s+any)?\s*\))/,
    );
    expect(syncSlice![0]).toMatch(/onboardingComplete:\s*patch\.onboardingComplete/);
  });

  it('M8: null settingsGet during panel write fails closed — no settingsSet, error shown', async () => {
    // Mount snapshot blank (+ crash edit); disk then becomes template so a
    // fail-open write would clobber template with blank. Null get must refuse
    // the write, keep the panel open with edits, skip onSaved, and show copy.
    persisted = { ...basePersisted(), onboardingStartMode: 'blank', onboardingComplete: true };
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    expect(screen.getByTestId('mk-telemetry-crash')).toHaveAttribute('aria-checked', 'true');

    persisted = { ...persisted, onboardingStartMode: 'template' };

    let nullOnce = true;
    const api = window.api as { settingsGet: () => Promise<Persisted | null> };
    api.settingsGet = () => {
      if (nullOnce) {
        nullOnce = false;
        return Promise.resolve(null);
      }
      return Promise.resolve({ ...persisted });
    };

    settingsSetMock.mockClear();
    await triggerSettingsClose('close');
    await waitFor(() =>
      expect(screen.getByText("Couldn't save settings. Try again.")).toBeInTheDocument(),
    );
    expect(
      settingsSetMock.mock.calls.length,
      'M8 RED — null disk must not call settingsSet (fail-open)',
    ).toBe(0);
    expect(
      persisted.onboardingStartMode,
      'M8 RED — null disk wrote mount snapshot over disk onboarding*',
    ).toBe('template');
    // Panel stays open; unsaved crash edit intact; onSaved did not land in shell.
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(
      screen.getByTestId('mk-telemetry-crash'),
      'M8 RED — null-path Close must keep unsaved edits in the form',
    ).toHaveAttribute('aria-checked', 'true');
    settingsSetMock.mockClear();
    const hide = await screen.findByRole('button', { name: /Hide right sidebar/i });
    fireEvent.click(hide);
    await waitFor(() => expect(settingsSetMock.mock.calls.length).toBeGreaterThan(0));
    expect(
      crashPayloadSeen(),
      'M8 RED — onSaved must not fire on null-path Close (shell must not hold crash)',
    ).toBe(false);
  });
});
