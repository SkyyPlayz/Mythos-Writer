/**
 * Owner punch: Settings is a covering overlay. Clicking a left-rail module
 * must dismiss Settings so the destination is visible.
 *
 * Pattern: DesktopShell.storySelection.test.tsx — real <App /> + stubbed IPC.
 * Uses Vault Graph (not Notes) so the destination does not pull the Notes
 * tree's extra IPC; handleNavModuleChange is the same closer for every rail id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import App from './App';

const NOW = '2026-08-01T00:00:00.000Z';

function makeManifest() {
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: 'story-1',
        title: 'Rail Dismiss',
        path: 'stories/story-1',
        createdAt: NOW,
        updatedAt: NOW,
        chapters: [],
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeMockApi() {
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      rightSidebarVisible: true,
      theme: 'dark',
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
    settingsSet: vi.fn().mockResolvedValue({}),
    readManifest: () => Promise.resolve(makeManifest()),
    writeManifest: vi.fn().mockResolvedValue({}),
    writeVault: vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 }),
    onVaultFileChanged: () => () => {},
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    sessionSaveScene: vi.fn().mockResolvedValue({ saved: true }),
    archiveListContinuity: vi.fn().mockResolvedValue({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    getVaultIndex: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    vaultGraphGet: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

describe('DesktopShell Settings dismiss on rail nav (owner punch)', () => {
  function openSettings() {
    // App menu gear + AppNavRail both expose "Open settings" — prefer the menu gear.
    const gear = document.querySelector('.app-menu-gear-btn') as HTMLElement | null;
    if (gear) {
      fireEvent.click(gear);
      return;
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Open settings' })[0]);
  }

  function clickRail(name: string) {
    const btn = document.querySelector(
      `nav[aria-label="Main navigation"] button[aria-label="${name}"]`,
    ) as HTMLElement | null;
    if (!btn) throw new Error(`rail button not found: ${name}`);
    fireEvent.click(btn);
  }

  it('closes Settings when a left-rail module is clicked', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    await act(async () => {
      clickRail('Vault Graph');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
  });

  it('F2#15/H6: rail close flushes settings:set (same path as Escape/X)', async () => {
    const api = makeMockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    await act(async () => {
      clickRail('Vault Graph');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
    expect(api.settingsSet).toHaveBeenCalled();
  });

  it('closes Settings when the header X is pressed', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // F2#15: close flushes settings in the background (onSaved → shell state);
    // wrap so the post-dismiss persist resolves inside act.
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId('settings-close'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
  });
});
