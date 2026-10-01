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

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';

type Persisted = {
  onboardingComplete: boolean;
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
let activeStoryId = STORY_VAULT_A;
/** When false, projectSwitch does not emit project:switched (M4 gap close). */
let announceOnSwitch = true;

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
    persisted = { ...persisted, ...next };
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
  return {
    settingsGet: () => Promise.resolve({ ...persisted }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/mythos/Story A',
      notesVaultPath: '/mythos/Notes A',
      pathSeparator: '/',
      mythosRoot: '/mythos',
    }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => {
      if (!holdLoad) return Promise.resolve({ vaultRoot: mainRoot });
      return new Promise<{ vaultRoot: string }>((resolve) => {
        loadHolds.push(() => resolve({ vaultRoot: mainRoot }));
      });
    },
    readManifest: () => Promise.resolve(makeManifest(mainRoot)),
    settingsSet: settingsSetMock,
    projectList: () => Promise.resolve({
      projects: [
        { vaultRoot: VAULT_A, name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B, name: 'Bravo', openedAt: '' },
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__mythosSettingsFlush;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__mythosSettingsRequestClose;
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
    expect(screen.getByTestId('ln-toast')).toHaveTextContent(
      /unsaved settings were discarded/i,
    );
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
});
