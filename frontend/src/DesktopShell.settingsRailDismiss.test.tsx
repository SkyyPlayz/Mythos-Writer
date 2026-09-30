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

  it('F2#15/H6: rail close flushes changed payload (goes red if flush skipped)', async () => {
    const api = makeMockApi();
    api.settingsGet = () => Promise.resolve({
      onboardingComplete: true,
      rightSidebarVisible: true,
      theme: 'dark',
      agents: {
        writingAssistant: { enabled: false },
        brainstorm: { enabled: false },
        archive: { enabled: false },
        lineEditor: { enabled: false },
      },
    });
    api.settingsSet = vi.fn().mockResolvedValue({ saved: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // Mutate a non-Appearance field so the flush payload differs from load.
    await act(async () => {
      const agentsTab = await screen.findByTestId('settings-cat-agents');
      fireEvent.click(agentsTab);
      await Promise.resolve();
    });
    const card = await screen.findByTestId('line-editor-agent-card');
    await act(async () => {
      fireEvent.click(card.querySelector('.settings-toggle-track') as Element);
      await Promise.resolve();
    });

    // N3 / Critic H6: count before/after — bare close (B10) must go red.
    const callsBefore = api.settingsSet.mock.calls.length;
    api.settingsSet.mockClear();

    await act(async () => {
      clickRail('Vault Graph');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
    // Must carry the toggled field — not just any settingsSet from boot writes.
    expect(api.settingsSet.mock.calls.length).toBeGreaterThan(0);
    const payloads = api.settingsSet.mock.calls.map(
      (c) => c[0] as { agents?: { lineEditor?: { enabled?: boolean } } },
    );
    expect(
      payloads.some((p) => p?.agents?.lineEditor?.enabled === true),
      `expected settingsSet with lineEditor.enabled after rail close (callsBefore=${callsBefore})`,
    ).toBe(true);
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
