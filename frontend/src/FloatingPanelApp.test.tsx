/**
 * SKY-5154 / GH #731: scene creation in the floating panel must never leave
 * an orphaned manifest entry. The scene file must be written (and confirmed)
 * before the manifest is updated; if the file write fails the manifest must
 * not be touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FloatingPanelApp from './FloatingPanelApp';

const STORY_ID = 'story-abc';
const CHAPTER_ID = 'chapter-xyz';

const baseManifest = {
  version: '1',
  vaultRoot: '/tmp',
  stories: [
    {
      id: STORY_ID,
      title: 'Test Story',
      path: `stories/${STORY_ID}`,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      chapters: [
        {
          id: CHAPTER_ID,
          title: 'Chapter One',
          path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
          order: 0,
          scenes: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
  ],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: () => Promise.resolve({ theme: 'dark', onboardingComplete: true }),
    readManifest: () => Promise.resolve(structuredClone(baseManifest)),
    writeManifest: vi.fn().mockResolvedValue({}),
    writeVault: vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 }),
    onNavigatorManifestChanged: vi.fn().mockReturnValue(() => {}),
    onNavigatorSceneSynced: vi.fn().mockReturnValue(() => {}),
    navigatorSelectScene: vi.fn().mockResolvedValue(undefined),
    navigatorReportManifest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockApi(overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: vi.fn().mockResolvedValue({ theme: 'dark' }),
    readManifest: vi.fn().mockResolvedValue({ stories: [], entities: [], suggestions: [], scenes: [], chapters: [] }),
    onNavigatorManifestChanged: undefined,
    onNavigatorSceneSynced: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeApi();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FloatingPanelApp — settings-load failure (GH #736 / SKY-5144)', () => {
  it('renders panel content with defaults when settingsGet rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi({
      settingsGet: vi.fn().mockRejectedValue(new Error('IPC channel closed')),
    });

    render(<FloatingPanelApp panelId="test-panel" />);

    // Panel content must render (not blank) even when settings load fails
    await waitFor(() => {
      expect(screen.getByText(/unknown panel: test-panel/i)).toBeInTheDocument();
    });

    // Error must be logged, not silently swallowed
    expect(consoleError).toHaveBeenCalledWith(
      '[FloatingPanelApp] settings load failed, using defaults:',
      expect.any(Error),
    );

    consoleError.mockRestore();
  });

  it('renders panel content normally when settingsGet resolves', async () => {
    render(<FloatingPanelApp panelId="test-panel" />);

    await waitFor(() => {
      expect(screen.getByText(/unknown panel: test-panel/i)).toBeInTheDocument();
    });
  });

  it('renders the title-bar label for the panel', async () => {
    render(<FloatingPanelApp panelId="scene-preview" />);

    await waitFor(() => {
      expect(screen.getByText('Scene Preview')).toBeInTheDocument();
    });
  });
});

describe('FloatingPanelApp — handleNavCreateScene write order (GH #731 / SKY-5154)', () => {
  it('writes the scene file before updating the manifest on success', async () => {
    const callOrder: string[] = [];
    const writeVault = vi.fn().mockImplementation(() => {
      callOrder.push('writeVault');
      return Promise.resolve({ path: 'x.md', bytes: 10 });
    });
    const writeManifest = vi.fn().mockImplementation(() => {
      callOrder.push('writeManifest');
      return Promise.resolve({});
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({ writeVault, writeManifest });
    vi.spyOn(window, 'prompt').mockReturnValue('New Scene');

    render(<FloatingPanelApp panelId="stories" />);
    await waitFor(() => screen.getByRole('button', { name: 'Add scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add scene' }));

    await waitFor(() => expect(writeManifest).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['writeVault', 'writeManifest']);
  });

  it('does not write the manifest when the scene file write rejects', async () => {
    const writeManifest = vi.fn();
    const writeVault = vi.fn().mockRejectedValue(new Error('disk full'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({ writeVault, writeManifest });
    vi.spyOn(window, 'prompt').mockReturnValue('New Scene');

    render(<FloatingPanelApp panelId="stories" />);
    await waitFor(() => screen.getByRole('button', { name: 'Add scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add scene' }));

    // Drain the async chain; writeManifest must not have been called.
    await new Promise((r) => setTimeout(r, 50));
    expect(writeManifest).not.toHaveBeenCalled();
  });

  it('does nothing when the user dismisses the scene title prompt', async () => {
    const writeVault = vi.fn();
    const writeManifest = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({ writeVault, writeManifest });
    vi.spyOn(window, 'prompt').mockReturnValue(null);

    render(<FloatingPanelApp panelId="stories" />);
    await waitFor(() => screen.getByRole('button', { name: 'Add scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add scene' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(writeVault).not.toHaveBeenCalled();
    expect(writeManifest).not.toHaveBeenCalled();
  });
});
