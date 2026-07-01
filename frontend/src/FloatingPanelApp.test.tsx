import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FloatingPanelApp from './FloatingPanelApp';

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
  (window as any).api = makeMockApi();
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
