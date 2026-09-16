/**
 * Owner punch: Settings is a covering overlay. Clicking a left-rail module
 * must dismiss Settings so the destination is visible.
 *
 * Pattern: DesktopShell.storySelection.test.tsx — real <App /> + stubbed IPC.
 * Uses Vault Graph (not Notes) so the destination does not pull the Notes
 * tree's extra IPC; handleNavModuleChange is the same closer for every rail id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('closes Settings when a left-rail module is clicked', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Vault Graph' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
