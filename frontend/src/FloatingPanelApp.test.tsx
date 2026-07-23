/**
 * SKY-5154 / GH #731: scene creation in the floating panel must never leave
 * an orphaned manifest entry. The scene file must be written (and confirmed)
 * before the manifest is updated; if the file write fails the manifest must
 * not be touched.
 */
// SKY-5133 — verify FloatingPanelApp subscribes to pin-changed via the
// contextBridge-exposed helper (window.api.onPanelFloatPinChanged) rather than
// the raw, unexposed window.ipcRenderer channel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, waitFor } from '@testing-library/react';
import FloatingPanelApp from './FloatingPanelApp';

vi.mock('./WritingAssistantPanel', () => ({ default: () => <div data-testid="wa-panel" /> }));
vi.mock('./ContinuityPanel', () => ({ default: () => <div data-testid="cont-panel" /> }));
vi.mock('./ScenePreviewPanel', () => ({ default: () => <div data-testid="sp-panel" /> }));
// StoryNavigator intentionally not mocked — SKY-5154 tests need the real component
// to trigger handleNavCreateScene and verify write-order behaviour.
vi.mock('./EntityBrowser', () => ({ default: () => <div data-testid="eb-panel" /> }));
vi.mock('./components/VaultBrowser', () => ({ default: () => <div data-testid="vb-panel" /> }));
vi.mock('./SuggestionReview', () => ({ default: () => <div data-testid="sr-panel" /> }));
vi.mock('./ProgressDashboard', () => ({ default: () => <div data-testid="pd-panel" /> }));
// GH #650: capture the props FloatingPanelApp passes to the pop-out graph so
// tests can exercise the scene-open forwarding wired through it.
const vaultGraphMock = vi.hoisted(() => ({ lastProps: null as Record<string, unknown> | null }));
vi.mock('./VaultGraphView', () => ({
  default: (props: Record<string, unknown>) => {
    vaultGraphMock.lastProps = props;
    return <div data-testid="vg-panel" />;
  },
}));
vi.mock('./StoryTimeline', () => ({ default: () => <div data-testid="st-panel" /> }));

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
    onPanelFloatPinChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

function makeMockApi(overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: vi.fn().mockResolvedValue({ theme: 'dark' }),
    readManifest: vi.fn().mockResolvedValue({ stories: [], entities: [], suggestions: [], scenes: [], chapters: [] }),
    onNavigatorManifestChanged: undefined,
    onNavigatorSceneSynced: undefined,
    onPanelFloatPinChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeApi();
  vaultGraphMock.lastProps = null;
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

describe('FloatingPanelApp — writeManifest strips scene prose for IPC (SKY-6196 / SKY-8153)', () => {
  it('blanks an existing scene\'s block content in the writeManifest payload when creating a new story', async () => {
    const manifestWithProse = {
      ...structuredClone(baseManifest),
      stories: [
        {
          ...structuredClone(baseManifest.stories[0]),
          chapters: [
            {
              ...structuredClone(baseManifest.stories[0].chapters[0]),
              scenes: [
                {
                  id: 'scene-1',
                  title: 'Scene One',
                  path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/scene-1.md`,
                  order: 0,
                  chapterId: CHAPTER_ID,
                  storyId: STORY_ID,
                  blocks: [
                    { id: 'b1', type: 'prose', order: 0, content: 'Rain fell on the tin roof.', updatedAt: '2024-01-01T00:00:00.000Z' },
                  ],
                  draftState: 'in-progress',
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2024-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    const writeManifest = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({
      writeManifest,
      readManifest: () => Promise.resolve(structuredClone(manifestWithProse)),
    });
    vi.spyOn(window, 'prompt').mockReturnValue('New Story');

    render(<FloatingPanelApp panelId="stories" />);
    await waitFor(() => screen.getByLabelText('New story'));
    fireEvent.click(screen.getByLabelText('New story'));

    await waitFor(() => expect(writeManifest).toHaveBeenCalledTimes(1));
    const payload = writeManifest.mock.calls[0][0];
    const existingScene = payload.stories[0].chapters[0].scenes[0];
    expect(existingScene.blocks[0].content).toBe('');
  });
});

describe('FloatingPanelApp — vault-graph pop-out navigation (GH #650)', () => {
  it('forwards scene opens to the main window via the navigator bridge', async () => {
    const navigatorSelectScene = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({ navigatorSelectScene });

    render(<FloatingPanelApp panelId="vault-graph" />);
    await waitFor(() => expect(screen.getByTestId('vg-panel')).toBeInTheDocument());

    const onOpenScene = vaultGraphMock.lastProps?.onOpenScene as
      (storyId: string, chapterId: string, sceneId: string) => void;
    expect(typeof onOpenScene).toBe('function');

    onOpenScene('story-1', 'chapter-1', 'scene-1');

    expect(navigatorSelectScene).toHaveBeenCalledTimes(1);
    expect(navigatorSelectScene).toHaveBeenCalledWith('scene-1');
  });

  it('does not crash when navigatorSelectScene is unavailable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeApi({ navigatorSelectScene: undefined });

    render(<FloatingPanelApp panelId="vault-graph" />);
    await waitFor(() => expect(screen.getByTestId('vg-panel')).toBeInTheDocument());

    const onOpenScene = vaultGraphMock.lastProps?.onOpenScene as
      (storyId: string, chapterId: string, sceneId: string) => void;
    expect(() => onOpenScene('story-1', 'chapter-1', 'scene-1')).not.toThrow();
  });

  it('leaves onOpenNote unwired — no notes bridge to the main window exists', async () => {
    render(<FloatingPanelApp panelId="vault-graph" />);
    await waitFor(() => expect(screen.getByTestId('vg-panel')).toBeInTheDocument());

    expect(vaultGraphMock.lastProps?.onOpenNote).toBeUndefined();
  });
});

describe('FloatingPanelApp — onPanelFloatPinChanged wiring (SKY-5133)', () => {
  it('subscribes via window.api.onPanelFloatPinChanged on mount', async () => {
    const unsub = vi.fn();
    const onPin = vi.fn().mockReturnValue(unsub);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = { ...(window as any).api, onPanelFloatPinChanged: onPin };

    const { unmount } = render(<FloatingPanelApp panelId="writing-assistant" />);
    await act(async () => {});

    expect(onPin).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('sets alwaysOnTop when callback fires with matching panelId', async () => {
    let cb: ((data: { panelId: string; alwaysOnTop: boolean }) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = {
      ...(window as any).api,
      onPanelFloatPinChanged: vi.fn().mockImplementation((fn) => { cb = fn; return () => {}; }),
    };

    render(<FloatingPanelApp panelId="writing-assistant" />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Pin on top' })).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { cb?.({ panelId: 'writing-assistant', alwaysOnTop: true }); });

    expect(screen.getByRole('button', { name: 'Unpin — disable always on top' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores payloads for a different panelId', async () => {
    let cb: ((data: { panelId: string; alwaysOnTop: boolean }) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = {
      ...(window as any).api,
      onPanelFloatPinChanged: vi.fn().mockImplementation((fn) => { cb = fn; return () => {}; }),
    };

    render(<FloatingPanelApp panelId="writing-assistant" />);
    await act(async () => {});

    await act(async () => { cb?.({ panelId: 'other-panel', alwaysOnTop: true }); });

    expect(screen.getByRole('button', { name: 'Pin on top' })).toHaveAttribute('aria-pressed', 'false');
  });
});
