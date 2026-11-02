// A vault:manifest:read failure resolves `{ error }` instead of rejecting.
// The navigator refresh must leave the stories already on screen in place.
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import App from './App';

const STORY_ID = 'story-1';
const STORY_TITLE = 'Kept Story';
const CHAPTER_ID = 'chapter-1';
const SCENE_ID = 'scene-1';
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
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            createdAt: NOW,
            updatedAt: NOW,
            scenes: [
              {
                id: SCENE_ID,
                title: 'The Gate',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                draftState: 'in-progress',
                createdAt: NOW,
                updatedAt: NOW,
                blocks: [{ id: `${SCENE_ID}-b0`, type: 'prose', content: 'She crossed the threshold.', order: 0, updatedAt: NOW }],
              },
            ],
          },
        ],
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

describe('DesktopShell manifest refresh error', () => {
  it('keeps the existing stories when readManifest resolves an { error } envelope', async () => {
    let onChanged: (() => void) | undefined;
    let failRead = false;
    const readManifest = vi.fn(() => Promise.resolve(
      failRead ? { error: 'Manifest is in use.' } : makeManifest(),
    ));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = {
      settingsGet: () => Promise.resolve({ onboardingComplete: true, rightSidebarVisible: true }),
      vaultGetPaths: () => Promise.resolve({
        storyVaultPath: '/tmp/mythos-story-vault',
        notesVaultPath: '/tmp/mythos-notes-vault',
      }),
      validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
      settingsSet: vi.fn().mockResolvedValue({}),
      readManifest,
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
      onNavigatorManifestChanged: (cb: () => void) => {
        onChanged = cb;
        return () => {};
      },
    };

    render(<App />);
    await screen.findByText(STORY_TITLE);
    expect(document.querySelector('.nav-story-title')).toHaveTextContent(STORY_TITLE);
    expect(screen.queryByText('No stories yet.')).not.toBeInTheDocument();

    const readsBefore = readManifest.mock.calls.length;
    failRead = true;
    await act(async () => {
      onChanged?.();
      await Promise.resolve();
    });

    expect(readManifest.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(document.querySelector('.nav-story-title')).toHaveTextContent(STORY_TITLE);
    expect(screen.queryByText('No stories yet.')).not.toBeInTheDocument();
  });
});
