// #1774 Accent breathe: Accent breathe is a personal setting, and per-vault
// (SKY-11237) liquidNeonV2 snapshots saved before #1774 have no accentBreathe
// key. The theme DesktopShell actually applies (html[data-ln-breathe], written
// by the driver in theme/accentBreathe.ts) must inherit the global value for
// such a snapshot, on the initial load and on a vault switch. It must not
// normalize the missing key to on. A legacy snapshot is a precondition here,
// not the feature under test, so seeding it through settingsGet is fine.
//
// Drives the real DesktopShell through <App /> with the same IPC mock as
// DesktopShell.vaultSwitchRace.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import App from './App';
import { LIQUID_NEON_V2_DEFAULTS, type LiquidNeonV2Settings } from './theme/liquidNeonEngine';
import { stopAccentBreathe } from './theme/accentBreathe';

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';

let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;
let currentRoot = VAULT_A;

function pre1774(): LiquidNeonV2Settings {
  const ln = { ...LIQUID_NEON_V2_DEFAULTS } as Partial<LiquidNeonV2Settings>;
  delete ln.accentBreathe;
  return ln as LiquidNeonV2Settings;
}

function makeMockApi(settings: Partial<AppSettings>) {
  return {
    settingsGet: () => Promise.resolve({ onboardingComplete: true, ...settings }),
    vaultGetPaths: () => Promise.resolve({ storyVaultPath: currentRoot, notesVaultPath: '/notes' }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => Promise.resolve({ vaultRoot: currentRoot }),
    readManifest: () => Promise.resolve({
      version: '1', vaultRoot: currentRoot, stories: [], entities: [], suggestions: [], scenes: [], chapters: [],
    }),
    settingsSet: vi.fn().mockResolvedValue({}),
    projectList: () => Promise.resolve({
      projects: [
        { vaultRoot: VAULT_A, name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B, name: 'Bravo', openedAt: '' },
      ],
    }),
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

const breatheState = () => document.documentElement.getAttribute('data-ln-breathe');

beforeEach(() => {
  onProjectSwitchedCb = null;
  currentRoot = VAULT_A;
  // Nothing blocks breathe at the OS level, so the driver can actually run
  // (jsdom has no matchMedia, which would force it off whatever the setting).
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })));
});

afterEach(() => {
  stopAccentBreathe();
  document.documentElement.removeAttribute('data-ln-breathe');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('#1774 DesktopShell applies the inherited Accent breathe value', () => {
  it('initial load: global off + a pre-#1774 snapshot for the open vault stays off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi({
      liquidNeonV2: { ...LIQUID_NEON_V2_DEFAULTS, accentBreathe: false },
      vaultAppearance: { [VAULT_A]: { theme: 'dark', liquidNeonV2: pre1774() } },
    });
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await waitFor(() => expect(breatheState()).not.toBeNull());
    expect(breatheState()).toBe('off');
  });

  it('initial load: an explicit per-vault value still wins over the global one', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi({
      liquidNeonV2: { ...LIQUID_NEON_V2_DEFAULTS, accentBreathe: false },
      vaultAppearance: { [VAULT_A]: { theme: 'dark', liquidNeonV2: { ...LIQUID_NEON_V2_DEFAULTS, accentBreathe: true } } },
    });
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    await waitFor(() => expect(breatheState()).toBe('running'));
  });

  it('vault switch: global off + a pre-#1774 snapshot for the target vault stays off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi({
      liquidNeonV2: { ...LIQUID_NEON_V2_DEFAULTS, accentBreathe: false },
      // B has a per-vault default theme, so the switch takes the vaultPatch path.
      vaultThemes: { [VAULT_B]: 'aurora' },
      vaultAppearance: {
        [VAULT_A]: { theme: 'dark', liquidNeonV2: { ...LIQUID_NEON_V2_DEFAULTS, accentBreathe: true } },
        [VAULT_B]: { theme: 'dark', liquidNeonV2: pre1774() },
      },
    });
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    // Positive control: A's explicit true runs, so 'off' below is B's doing.
    await waitFor(() => expect(breatheState()).toBe('running'));

    currentRoot = VAULT_B;
    await act(async () => { onProjectSwitchedCb!({ vaultRoot: VAULT_B }); });
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_B}`);
    await waitFor(() => expect(breatheState()).toBe('off'));
  });
});
