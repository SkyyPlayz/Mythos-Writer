// M6 (SKY-9022, GAP-2): one source of truth for "the open scene".
//
// Clicking a story title in the navigator used to run a bare
// setSelectedStory — the editor's manuscriptCursor memo clamps the null
// selection to chapter 0 / scene 0, so scene 1 was demonstrably open in the
// editor while `selectedScene` stayed null and the right sidebar's Scene
// Analysis card sat on "Open a scene to see analysis."
//
// Pattern: DesktopShell.manuscriptRefresh.test.tsx — renders the real <App />
// (real DesktopShell closures, real AgentHubPanel card), seeds a story with
// no restored session, clicks the story title, and asserts the Scene
// Analysis card populates from the resolved cursor-default scene.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';

const STORY_ID = 'story-1';
const STORY_TITLE = 'Selection Story';
const CHAPTER_1 = 'chapter-1';
const CHAPTER_2 = 'chapter-2';
const SCENE_1 = 'scene-1';
const SCENE_2 = 'scene-2';
const NOW = '2026-08-01T00:00:00.000Z';

function makeScene(id: string, chapterId: string, title: string, order: number, content: string) {
  return {
    id,
    title,
    path: `stories/${STORY_ID}/chapters/${chapterId}/scenes/${id}.md`,
    order,
    chapterId,
    storyId: STORY_ID,
    draftState: 'in-progress',
    createdAt: NOW,
    updatedAt: NOW,
    blocks: [{ id: `${id}-b0`, type: 'prose', content, order: 0, updatedAt: NOW }],
  };
}

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
            id: CHAPTER_1,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_1}`,
            order: 0,
            createdAt: NOW,
            updatedAt: NOW,
            scenes: [makeScene(SCENE_1, CHAPTER_1, 'The Gate', 0, 'She crossed the threshold at dusk.')],
          },
          {
            id: CHAPTER_2,
            title: 'Chapter Two',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_2}`,
            order: 1,
            createdAt: NOW,
            updatedAt: NOW,
            scenes: [makeScene(SCENE_2, CHAPTER_2, 'The Descent', 0, 'The stairwell yawned below.')],
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

function makeMockApi() {
  return {
    // No lastOpenedScene: boot restores nothing, so no scene is selected —
    // the exact precondition for the GAP-2 repro. rightSidebarVisible must
    // be an explicit boolean or the right sidebar never renders.
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
    // ContinuityPanel (inside the Assistant hub) subscribes unconditionally.
    archiveListContinuity: vi.fn().mockResolvedValue({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

describe('DesktopShell story selection opens the cursor-default scene (SKY-9022 GAP-2)', () => {
  it('clicking a story title populates Scene Analysis with the first scene', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });

    // Precondition: nothing selected — the Scene Analysis card shows its
    // empty state while the navigator lists the story.
    expect(await screen.findByText('Open a scene to see analysis.')).toBeInTheDocument();
    const storyTitles = await screen.findAllByText(STORY_TITLE);
    const navTitle = storyTitles.find((el) => el.classList.contains('nav-story-title'));
    expect(navTitle).toBeTruthy();

    fireEvent.click(navTitle!);

    // The story click resolved and opened the order-sorted first chapter's
    // first scene: the card now renders real rows instead of the empty state.
    const rows = await screen.findByTestId('scene-analysis-rows');
    expect(within(rows).getByText('Word Count')).toBeInTheDocument();
    expect(screen.queryByText('Open a scene to see analysis.')).not.toBeInTheDocument();

    // And the selection went through handleSelectScene (one source of
    // truth): the session-restore save recorded the resolved scene.
    expect(window.api.sessionSaveScene).toHaveBeenCalledWith(
      expect.objectContaining({ sceneId: SCENE_1 }),
    );
  });
});
