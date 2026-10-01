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
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import App from './App';

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

let mainRoot = VAULT_A;
let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;
let persisted: Persisted;
let holdLoad = false;
let loadHolds: Array<() => void> = [];
let settingsSetMock: ReturnType<typeof vi.fn>;
let projectSwitchMock: ReturnType<typeof vi.fn>;
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
  return {
    settingsGet: () => Promise.resolve({ ...persisted }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/story',
      notesVaultPath: '/notes',
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

    const closeBtn = screen.getByRole('button', { name: /close settings/i });
    await act(async () => {
      fireEvent.click(closeBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still failing — Settings stays open; switch cancelled; main original.
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(mainRoot).toBe(VAULT_A);
    expect(screen.queryByTestId('settings-flush-retry')).not.toBeInTheDocument();
    // No successful switch to B.
    const switchedToB = projectSwitchMock.mock.calls.some((c) => c[0] === VAULT_B);
    expect(switchedToB, 'must not commit target when Close save still fails').toBe(false);
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

  // Story-vault picker park → Escape with still-failing save cancels; stay original.
  it('story-vault picker refuse parks; Escape cancel keeps original vault', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await openModelKeysAndClickCrash();
    settingsSetMock.mockClear();
    projectSwitchMock.mockClear();
    settingsSetMock.mockResolvedValue({ saved: false, error: 'disk full' });

    await act(async () => {
      const flush = (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
        .__mythosSettingsFlush;
      if (flush) await flush();
      (window as Window & { __mythosParkVaultSwitch?: (id: string) => void })
        .__mythosParkVaultSwitch?.('story-b');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('settings-flush-retry')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-flush-switch-anyway')).toBeInTheDocument();
    expect(mainRoot).toBe(VAULT_A);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mainRoot).toBe(VAULT_A);
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
});
