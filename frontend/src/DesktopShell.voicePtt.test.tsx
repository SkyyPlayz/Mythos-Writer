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
    // SKY-10499: GlobalRightSidebar now mounts by default (rightSidebarVisible
    // defaults true), so ContinuityPanel inside the Assistant hub subscribes
    // unconditionally.
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

// SKY-11586: the shortcut listener in DesktopShell is attached by a
// `useEffect` keyed on `appSettings.voice`. `appSettings` is set by
// `loadVault()`, and the same load flips `loading` false, which is what lets
// the nav rail render. Those two state updates land in one commit — but the
// nav is observable (MutationObserver → `findByRole` resolves) as soon as the
// DOM commits, while the passive effect that calls `addEventListener` is
// flushed by React's scheduler on a later task. On a cold/loaded runner a
// single `fireEvent.keyDown` fired right after `findByRole` can therefore run
// before the listener exists; the keydown is dropped and no `waitFor` on
// `voiceStart` can ever recover it. Firing the keydown INSIDE `waitFor`
// retries until the listener is live. This is safe for the toggle shortcut
// because `startVoice` calls `window.api.voiceStart` synchronously (no await
// precedes it), so the first keydown that reaches the listener satisfies the
// assertion in the same iteration — no double-toggle across retries.
const SHORTCUT_TIMEOUT = { timeout: 15_000 };

describe('DesktopShell voice capture shortcuts (SKY-7771)', () => {
  it('does not start voice on Ctrl+Shift+M when voiceMode is toggle', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    // Fire the legacy chord and the canonical chord back-to-back and require
    // EXACTLY one voiceStart. Before the listener is attached both are dropped
    // (0 calls → retry). Once attached, Ctrl+Shift+M must be ignored and
    // Ctrl+Shift+V must start voice (1 call → pass). Were Ctrl+Shift+M still
    // wired, it would start voice first and Ctrl+Shift+V would start it again
    // (2 calls → fail). Firing M inside the retry loop is what makes the
    // negative assertion non-vacuous: it is only checked while the listener
    // is provably live.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
      fireEvent.keyUp(window, { key: 'M', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: 'v', ctrlKey: true, shiftKey: true });
      expect(window.api.voiceStart).toHaveBeenCalledTimes(1);
    }, SHORTCUT_TIMEOUT);
  });

  it('still starts voice on the canonical Ctrl+Shift+V toggle shortcut', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    // Keep the suite-wide 15s cap documented in vite.config.ts (SKY-9893);
    // the retry-inside-waitFor is what actually removes the flake (see the
    // SKY-11586 note above), the cap only bounds a genuine failure.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'v', ctrlKey: true, shiftKey: true });
      expect(window.api.voiceStart).toHaveBeenCalled();
    }, SHORTCUT_TIMEOUT);
  });
});
