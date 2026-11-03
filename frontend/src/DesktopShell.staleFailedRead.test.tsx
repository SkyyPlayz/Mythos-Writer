// A failed readManifest inside loadVault used to call setError without the
// superseded() check its sibling apply points use. A stale failure from vault
// A, arriving after a switch to vault B had already loaded, painted the
// full-screen shell-error and unmounted the nav rail.
//
// This drives the real DesktopShell (via <App />). The first case holds A's
// readManifest, lets B's load finish, then fails A's read. The second case is
// a cold load whose read fails with no newer switch in flight.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import App from './App';

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';
const STORY_B = 'Bravo Tale';
const NOW = '2026-08-01T00:00:00.000Z';

type ReadMode = 'ok' | 'fail' | 'defer';

let mainRoot = VAULT_A;
let readMode: ReadMode = 'ok';
let parkedReads: Array<{ root: string; resolve: (value: unknown) => void }> = [];
let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;

function makeManifest(root: string) {
  const id = root === VAULT_B ? 'story-b' : 'story-a';
  const title = root === VAULT_B ? STORY_B : 'Alpha Tale';
  return {
    version: '1',
    vaultRoot: root,
    stories: [{
      id,
      title,
      path: `stories/${id}`,
      createdAt: NOW,
      updatedAt: NOW,
      chapters: [],
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeMockApi() {
  return {
    settingsGet: () => Promise.resolve({ onboardingComplete: true, rightSidebarVisible: true }),
    vaultGetPaths: () => Promise.resolve({ storyVaultPath: '/story', notesVaultPath: '/notes' }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => Promise.resolve({ vaultRoot: mainRoot }),
    readManifest: () => {
      const root = mainRoot;
      if (readMode === 'defer') {
        return new Promise((resolve) => {
          parkedReads.push({ root, resolve });
        });
      }
      if (readMode === 'fail') return Promise.resolve({ error: 'disk read error' });
      return Promise.resolve(makeManifest(root));
    },
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

beforeEach(() => {
  mainRoot = VAULT_A;
  readMode = 'ok';
  parkedReads = [];
  onProjectSwitchedCb = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function shellError(): Element | null {
  return document.querySelector('.shell-error');
}

describe('DesktopShell stale failed manifest read', () => {
  it('does not paint shell-error when vault A fails after vault B has loaded', async () => {
    readMode = 'defer';
    render(<App />);

    // A's read is in flight. The shell is still loading, so the rail is absent.
    await waitFor(() => {
      expect(parkedReads).toHaveLength(1);
    });
    expect(parkedReads[0]?.root).toBe(VAULT_A);
    const switched = onProjectSwitchedCb;
    if (!switched) throw new Error('project switch listener was not registered');

    // Switch to B and let B's read finish before A's read fails.
    mainRoot = VAULT_B;
    await act(async () => { switched({ vaultRoot: VAULT_B }); });
    await waitFor(() => {
      expect(parkedReads).toHaveLength(2);
    });
    expect(parkedReads[1]?.root).toBe(VAULT_B);

    await act(async () => { parkedReads[1]?.resolve(makeManifest(VAULT_B)); });

    await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText(STORY_B).length).toBeGreaterThan(0);

    await act(async () => { parkedReads[0]?.resolve({ error: 'stale vault read' }); });

    expect(shellError()).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-rail-vaults')).toBeInTheDocument();
    expect(screen.getByTestId(`nav-rail-vault-tile-${VAULT_B}`)).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText(STORY_B).length).toBeGreaterThan(0);
    expect(screen.queryByText('Alpha Tale')).not.toBeInTheDocument();
  });

  it('shows shell-error when a cold-load read fails and nothing superseded it', async () => {
    readMode = 'fail';
    render(<App />);

    const error = await screen.findByText('The story list could not be read.');
    expect(error.closest('.shell-error')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-rail-vaults')).not.toBeInTheDocument();
  });
});
