// SKY-11379: regression guard for the vault-switch race that left the nav-rail
// bottom-left highlight stuck on the PREVIOUS vault.
//
// loadVault() runs several IPC round-trips before it commits
// setActiveVaultRoot() (the single source of truth the rail highlight binds
// to). Two overlapping switches each kick off their own loadVault with no
// request-sequencing, so a slower, EARLIER load could resolve LAST and
// overwrite activeVaultRoot back to the vault the user already left — the rail
// then highlighted the wrong tile persistently (only self-correcting on the
// next switch).
//
// This drives the real DesktopShell (rendered via <App />, not a mocked
// island) and forces the out-of-order resolution deterministically: getVaultRoot
// is the IPC that resolves to each switch's target, so we hold both switches'
// getVaultRoot open, then resolve the NEWER one first and the OLDER one last —
// exactly the coin-flip the ticket says a 3+-vault rapid A→B→C switch exposes.
// With the "latest switch wins" generation guard, the stale load no-ops its
// writes and the highlight stays on the vault actually open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';
const VAULT_C = '/vault-c';

// --- controllable getVaultRoot -------------------------------------------------
// deferMode off  → resolves immediately to `mainRoot` (used for the boot load).
// deferMode on   → each call parks a resolver in `rootResolvers` so the test
//                  decides the resolution ORDER, reproducing the race.
let mainRoot = VAULT_A;
let deferMode = false;
let rootResolvers: Array<(root: string) => void> = [];

// Captured push-listener the main process would call on project:switched.
let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;

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

function makeMockApi() {
  return {
    settingsGet: () => Promise.resolve({ onboardingComplete: true }),
    // App + DesktopShell binding read this; kept fixed & valid so we always
    // render the shell. It does NOT drive the highlight — getVaultRoot does.
    vaultGetPaths: () => Promise.resolve({ storyVaultPath: '/story', notesVaultPath: '/notes' }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => {
      if (!deferMode) return Promise.resolve({ vaultRoot: mainRoot });
      return new Promise<{ vaultRoot: string }>((resolve) => {
        rootResolvers.push((root) => resolve({ vaultRoot: root }));
      });
    },
    readManifest: () => Promise.resolve(makeManifest(mainRoot)),
    settingsSet: vi.fn().mockResolvedValue({}),
    projectList: () => Promise.resolve({
      projects: [
        { vaultRoot: VAULT_A, name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B, name: 'Bravo', openedAt: '' },
        { vaultRoot: VAULT_C, name: 'Charlie', openedAt: '' },
      ],
    }),
    onProjectSwitched: (cb: (data: { vaultRoot: string }) => void) => {
      onProjectSwitchedCb = cb;
      return () => { onProjectSwitchedCb = null; };
    },
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    listNotesVault: () => Promise.resolve({ items: [] }),
    onVaultFileChanged: () => () => {},
    // continuity panel subscriptions (GRS mounts by default)
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
  };
}

beforeEach(() => {
  mainRoot = VAULT_A;
  deferMode = false;
  rootResolvers = [];
  onProjectSwitchedCb = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tile(root: string): HTMLElement {
  return screen.getByTestId(`nav-rail-vault-tile-${root}`);
}
function isActive(root: string): boolean {
  return tile(root).getAttribute('aria-current') === 'page';
}

describe('DesktopShell vault-switch highlight race (SKY-11379)', () => {
  it('keeps the highlight on the vault actually open when an earlier switch resolves last', async () => {
    render(<App />);

    // Boot settles on vault A.
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    expect(isActive(VAULT_A)).toBe(true);

    // From here every getVaultRoot is held open so we control ordering. Each
    // switch flips the shell into its loading state until its load settles, so
    // the assertions below run once the rail is back in the DOM.
    deferMode = true;

    // Rapid A → B → C: two overlapping switches, each starting its own load
    // before the previous one has resolved.
    await act(async () => { onProjectSwitchedCb!({ vaultRoot: VAULT_B }); });
    await act(async () => { onProjectSwitchedCb!({ vaultRoot: VAULT_C }); });

    // Both loads are now in flight. rootResolvers[0] = B's load, [1] = C's load.
    expect(rootResolvers).toHaveLength(2);

    // Resolve the NEWER load (C) first — the shell settles and the rail renders
    // with C highlighted (no stale frame, AC-2).
    await act(async () => { rootResolvers[1](VAULT_C); });
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_C}`);
    expect(isActive(VAULT_C)).toBe(true);

    // ...then let the OLDER, stale load (B) resolve LAST — the exact ordering
    // that used to clobber activeVaultRoot back to B.
    await act(async () => { rootResolvers[0](VAULT_B); });

    // The rail must STILL highlight C (the open vault), not the stale B.
    expect(isActive(VAULT_C)).toBe(true);
    expect(isActive(VAULT_B)).toBe(false);
    expect(isActive(VAULT_A)).toBe(false);
  });

  it('applies a normal (non-overlapping) switch to the newly opened vault', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);
    expect(isActive(VAULT_A)).toBe(true);

    deferMode = true;
    await act(async () => { onProjectSwitchedCb!({ vaultRoot: VAULT_B }); });
    // Single switch, its own load resolves in order — highlight lands on B.
    await act(async () => { rootResolvers[0](VAULT_B); });
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_B}`);

    expect(isActive(VAULT_B)).toBe(true);
    expect(isActive(VAULT_A)).toBe(false);
  });
});
