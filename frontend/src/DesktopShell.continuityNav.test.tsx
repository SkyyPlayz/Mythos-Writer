// Critic soft (CHANGES 5372647419) + r3 TC-CP-06: Continuity nav history —
// Back after "View full note" restores the note (not empty Notes); Forward
// returns to the scene you left. F2 keep-scene in handleOpenContinuityEntityNote
// (do NOT clear selectedScene — Story NoteViewer stays mounted). Forward
// coverage is asserted below (Alt+→ after Back).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act, cleanup } from '@testing-library/react';
import App from './App';

const NOW = '2026-09-29T00:00:00.000Z';
const STORY_A = 'story-a';
const STORY_B = 'story-b';
const CH_A = 'ch-a';
const CH_B = 'ch-b';
const SCENE_A = 'scene-a';
const SCENE_B = 'scene-b';
const NOTE_PATH = 'Characters/Mira.md';

function makeScene(storyId: string, chapterId: string, id: string, title: string, content: string, order: number) {
  return {
    id,
    title,
    path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
    order,
    chapterId,
    storyId,
    createdAt: NOW,
    updatedAt: NOW,
    blocks: [{ id: `${id}-b0`, type: 'prose', content, order: 0, updatedAt: NOW }],
  };
}

function makeChapter(storyId: string, id: string, title: string, scenes: ReturnType<typeof makeScene>[], order: number) {
  return {
    id,
    title,
    path: `stories/${storyId}/chapters/${id}`,
    order,
    createdAt: NOW,
    updatedAt: NOW,
    scenes,
  };
}

function makeStory(id: string, title: string, chapters: ReturnType<typeof makeChapter>[]) {
  return {
    id,
    title,
    path: `stories/${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    chapters,
  };
}

function makeTwoStoryManifest() {
  const chA = makeChapter(STORY_A, CH_A, 'Chapter A', [
    makeScene(STORY_A, CH_A, SCENE_A, 'Scene A', 'Seed A.', 0),
  ], 0);
  const chB = makeChapter(STORY_B, CH_B, 'Chapter B', [
    makeScene(STORY_B, CH_B, SCENE_B, 'Scene B', 'Seed B.', 0),
  ], 0);
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      makeStory(STORY_A, 'Story Alpha', [chA]),
      makeStory(STORY_B, 'Story Beta', [chB]),
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeMockApi() {
  const manifest = makeTwoStoryManifest();
  const scenePath = `stories/${STORY_A}/chapters/${CH_A}/scenes/${SCENE_A}.md`;
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      lastOpenedScene: { sceneId: SCENE_A, scenePath, scrollTop: 0, cursorLine: 0 },
      rightSidebarVisible: true,
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
    settingsSet: vi.fn().mockResolvedValue({}),
    readManifest: () => Promise.resolve(structuredClone(manifest)),
    writeManifest: vi.fn().mockResolvedValue({}),
    writeVault: vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 }),
    onVaultFileChanged: () => () => {},
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    sessionSaveScene: vi.fn().mockResolvedValue({ saved: true }),
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    snapshotSave: vi.fn().mockResolvedValue({}),
    listNotesVault: vi.fn().mockResolvedValue({
      items: [{ path: NOTE_PATH, type: 'file', name: 'Mira.md' }],
    }),
    readNotesVault: vi.fn().mockResolvedValue({ path: NOTE_PATH, content: '# Mira\n\nA character.' }),
    writeNotesVault: vi.fn().mockResolvedValue({ path: NOTE_PATH, bytes: 10 }),
    notesVaultReadIcons: vi.fn().mockResolvedValue({}),
    noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
    projectList: vi.fn().mockResolvedValue({
      projects: [],
      activeNotesVaultRoot: '/tmp/mythos-notes-vault',
    }),
    continuitySearch: vi.fn().mockResolvedValue({
      results: [{
        name: 'Mira',
        aliases: [],
        type: 'character',
        path: NOTE_PATH,
        excerpt: 'A character.',
      }],
    }),
    continuityMatchSelection: vi.fn().mockResolvedValue({ match: null }),
    suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
  };
}

describe('DesktopShell Continuity nav (Critic r3 TC-CP-06)', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi();
  });
  afterEach(() => {
    cleanup();
  });

  it('TC-CP-06: Back after Continuity View full note restores the note; Forward returns to scene', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await screen.findByTestId('msv-root');

    // Focus mode → Continuity Peek (Ctrl/Cmd+Shift+K).
    fireEvent.click(await screen.findByTestId('writing-mode-focus'));
    await act(async () => {
      fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
    });
    const peek = await screen.findByRole('dialog', { name: 'Continuity Peek' });
    const search = peek.querySelector('.continuity-search-input') as HTMLInputElement;
    expect(search).toBeTruthy();
    fireEvent.change(search, { target: { value: 'Mira' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    const viewNote = await screen.findByRole('button', { name: /View full note: Mira/i });
    fireEvent.click(viewNote);

    await waitFor(() => {
      expect(screen.getByTestId('note-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notes-editor-placeholder')).toBeNull();

    // Exit focus, switch story (handleSelectScene clears notePath).
    fireEvent.click(await screen.findByTestId('writing-mode-normal'));
    fireEvent.click(await screen.findByTestId('nav-rail-story'));
    fireEvent.click(await screen.findByText('Story Beta'));
    await waitFor(() => {
      expect(document.querySelector('.nav-scene-row.active')?.textContent).toMatch(/Scene B/);
    });

    // Back via Alt+← — may need two steps if nav-rail-story pushed an entry.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    });
    if (!screen.queryByTestId('note-title')) {
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
      });
    }

    await waitFor(() => {
      expect(screen.getByTestId('note-title')).toBeInTheDocument();
      expect(screen.queryByTestId('notes-editor-placeholder')).toBeNull();
    });

    // Critic soft: Forward (Alt+→) must leave the restored note — not a no-op.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('note-title')).toBeNull();
    });
    // One more Forward if the first only undid a rail push.
    if (!document.querySelector('.nav-scene-row.active')) {
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
      });
    }
    await waitFor(() => {
      expect(
        document.querySelector('.nav-scene-row.active'),
        'Forward must land on a story scene after leaving the note',
      ).toBeTruthy();
    });
  });
});
