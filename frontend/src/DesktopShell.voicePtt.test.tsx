// SKY-7771: regression guard for the deleted Ctrl+Shift+M push-to-talk
// handler keyed on the legacy voice.pushToTalkMode boolean. voice.voiceMode
// is the sole capture-mode source of truth now; Ctrl+Shift+M must no longer
// start voice capture, and the remaining voiceMode-driven shortcut still must.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const mockManifest = {
  version: '1',
  vaultRoot: '/tmp',
  stories: [],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
};

function makeMockApi(overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      voice: { enabled: true, cloudFallback: false, voiceMode: 'toggle' },
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
    settingsSet: () => Promise.resolve({}),
    readManifest: () => Promise.resolve(mockManifest),
    writeManifest: () => Promise.resolve({}),
    onVaultFileChanged: () => () => {},
    voiceStart: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    voiceStop: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

describe('DesktopShell voice capture shortcuts (SKY-7771)', () => {
  it('does not start voice on Ctrl+Shift+M when voiceMode is toggle', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: 'M', ctrlKey: true, shiftKey: true });

    expect(window.api.voiceStart).not.toHaveBeenCalled();
  });

  it('still starts voice on the canonical Ctrl+Shift+V toggle shortcut', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(window.api.voiceStart).toHaveBeenCalled());
  });
});
