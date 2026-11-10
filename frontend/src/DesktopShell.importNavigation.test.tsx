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
        title: 'Import Navigation',
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

describe('DesktopShell File import navigation', () => {
  it('opens Vault & Files for import after each close and preserves ordinary Settings', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    for (let visit = 0; visit < 2; visit += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'File' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Import vault / story…' }));

      expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Vault & Files' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('import-section')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose a file…' })).toBeInTheDocument();

      await act(async () => {
        fireEvent.pointerDown(screen.getByTestId('settings-close'));
      });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      });
    }

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
  });
});
