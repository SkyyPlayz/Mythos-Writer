// SKY-10607 / M11b surface contract: the Coach editor sub-tab is an AI
// surface. With the master AI toggle off it must be gone from the sub-view
// bar and the Coach page unreachable — sub-tabs reduce to Editor · Structure
// · Book (PLAN.md §4 M11, "Editor sub-tabs" row). If the Coach sub-view is
// active when the toggle turns off, the shell falls back to the editor (same
// fallback AgentHubPanel uses for its Assistant tab).
//
// Pattern: DesktopShell.storySelection.test.tsx — renders the real <App />
// with a mocked window.api.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { setAiEnabled, __resetAiEnabledForTests } from './hooks/useAiEnabled';

const STORY_ID = 'story-1';
const CHAPTER_1 = 'chapter-1';
const SCENE_1 = 'scene-1';
const NOW = '2026-08-01T00:00:00.000Z';

function makeManifest() {
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: STORY_ID,
        title: 'Gate Story',
        path: `stories/${STORY_ID}`,
        createdAt: NOW,
        updatedAt: NOW,
        chapters: [
          {
            id: CHAPTER_1,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_1}`,
            order: 0,
            createdAt: NOW,
            updatedAt: NOW,
            scenes: [
              {
                id: SCENE_1,
                title: 'The Gate',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_1}/scenes/${SCENE_1}.md`,
                order: 0,
                chapterId: CHAPTER_1,
                storyId: STORY_ID,
                draftState: 'in-progress',
                createdAt: NOW,
                updatedAt: NOW,
                blocks: [{ id: `${SCENE_1}-b0`, type: 'prose', content: 'She crossed the threshold at dusk.', order: 0, updatedAt: NOW }],
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

function makeMockApi(aiEnabledSetting: boolean) {
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      rightSidebarVisible: true,
      ai: { enabled: aiEnabledSetting },
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
  };
}

beforeEach(() => {
  __resetAiEnabledForTests();
});

describe('Coach sub-tab AI gating (SKY-10607 / M11b)', () => {
  it('drops the Coach tab from the sub-view bar when ai.enabled is false in settings', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi(false);
    render(<App />);

    const bar = await screen.findByTestId('story-subview-bar');
    // useAiEnabled hydrates async from settingsGet — wait for the gate to land.
    await waitFor(() => {
      expect(screen.queryByTestId('story-subview-coach')).not.toBeInTheDocument();
    });
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('story-subview-editor')).toBeInTheDocument();
    expect(screen.getByTestId('story-subview-structure')).toBeInTheDocument();
    expect(screen.getByTestId('story-subview-book')).toBeInTheDocument();
    expect(screen.queryByTestId('coach-page')).not.toBeInTheDocument();
  });

  it('falls back from the Coach page to the editor when the master toggle turns off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi(true);
    render(<App />);

    const coachTab = await screen.findByTestId('story-subview-coach');
    fireEvent.click(coachTab);
    expect(await screen.findByTestId('coach-page')).toBeInTheDocument();

    // Flip the master toggle off (what AiMasterSection does after persisting).
    act(() => { setAiEnabled(false); });

    await waitFor(() => {
      expect(screen.queryByTestId('coach-page')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-subview-coach')).not.toBeInTheDocument();
    expect(screen.getByTestId('story-subview-editor')).toHaveAttribute('aria-selected', 'true');
  });
});
