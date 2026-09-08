// SKY-9973: manifest debounced save has no flush-on-quit — edits within the
// 900ms scheduleManifestSave debounce window were silently lost if the app
// closed before the timer fired. Regression coverage: schedule a debounced
// save, invoke the flush-before-quit handshake (main's side of it is covered
// separately in the electron-main quit-lifecycle change), and assert the
// write happens immediately instead of waiting out the debounce.
//
// Pattern: DesktopShell.storySelection.test.tsx — renders the real <App />
// so this exercises the real scheduleManifestSave/persistManifest closures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { registerQuitFlusher, __resetQuitFlushers } from './lib/flushBeforeQuit';

const STORY_ID = 'story-1';
const STORY_TITLE = 'Flush Story';
const NOW = '2026-08-01T00:00:00.000Z';

function makeManifest() {
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
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

let flushCallback: (() => void) | null = null;

function makeMockApi() {
  return {
    settingsGet: () => Promise.resolve({ onboardingComplete: true, rightSidebarVisible: true }),
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
    onFlushBeforeQuit: vi.fn((cb: () => void) => {
      flushCallback = cb;
      return () => { flushCallback = null; };
    }),
    notifyFlushBeforeQuitDone: vi.fn(),
  };
}

beforeEach(() => {
  flushCallback = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => __resetQuitFlushers());

describe('DesktopShell flush-before-quit (SKY-9973)', () => {
  it('flushes a pending debounced manifest save immediately when asked, instead of waiting 900ms', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    // DesktopShell registers its flush listener on mount.
    await waitFor(() => expect(window.api.onFlushBeforeQuit).toHaveBeenCalled());
    expect(flushCallback).not.toBeNull();

    const divider = await screen.findByRole('separator', { name: 'Resize left panel' });
    fireEvent.keyDown(divider, { key: 'Home' });

    // The write is debounced — nothing hits disk synchronously.
    expect(window.api.writeManifest).not.toHaveBeenCalled();

    // Simulate the main process asking for a flush before the window closes.
    flushCallback!();

    await waitFor(() => expect(window.api.writeManifest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.api.notifyFlushBeforeQuitDone).toHaveBeenCalledTimes(1));
  });

  it('acks immediately with no pending save', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(window.api.onFlushBeforeQuit).toHaveBeenCalled());

    flushCallback!();

    await waitFor(() => expect(window.api.notifyFlushBeforeQuitDone).toHaveBeenCalledTimes(1));
    expect(window.api.writeManifest).not.toHaveBeenCalled();
  });

  // SKY-11363: the handshake must drain EVERY registered debounced writer (e.g.
  // the brainstorm board), not just the manifest, before acking — otherwise a
  // pending board write is silently lost on a full app-quit.
  it('awaits registered quit flushers before acking done', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(window.api.onFlushBeforeQuit).toHaveBeenCalled());

    const order: string[] = [];
    (window.api.notifyFlushBeforeQuitDone as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('done');
    });
    registerQuitFlusher(
      () =>
        new Promise<void>((resolve) => setTimeout(() => { order.push('flusher'); resolve(); }, 10)),
    );

    flushCallback!();

    await waitFor(() => expect(window.api.notifyFlushBeforeQuitDone).toHaveBeenCalledTimes(1));
    // The flusher completed BEFORE the quit ack — the barrier holds.
    expect(order).toEqual(['flusher', 'done']);
  });
});
