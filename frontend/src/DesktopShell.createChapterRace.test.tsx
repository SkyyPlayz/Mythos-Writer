// F1#9 root-fix break-tests (must RED on tip 999cfb79, GREEN after storiesRef
// + schedule-time ID capture). Covers: add-chapter race, Shield delete-drop,
// Probe switch-story retarget.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act, cleanup } from '@testing-library/react';
import type { BlockEditorApi } from './BlockEditor';

// Capture insertText from every BlockEditor mount so tests can type without
// depending on jsdom ProseMirror layout / elementFromPoint.
let lastEditorApi: BlockEditorApi | null = null;

vi.mock('./BlockEditor', async () => {
  const actual = await vi.importActual<typeof import('./BlockEditor')>('./BlockEditor');
  function Wrapped(props: React.ComponentProps<typeof actual.default>) {
    return (
      <actual.default
        {...props}
        onEditorReady={(api) => {
          lastEditorApi = api;
          props.onEditorReady?.(api);
        }}
      />
    );
  }
  return { ...actual, default: Wrapped };
});

import App from './App';

const NOW = '2026-09-29T00:00:00.000Z';

const STORY_A = 'story-a';
const STORY_B = 'story-b';
const CH_A = 'ch-a';
const CH_B = 'ch-b';
const SCENE_A = 'scene-a';
const SCENE_B = 'scene-b';

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
    parts: [{
      id: `part-${id}`,
      title: '',
      order: 0,
      note: [],
      chapters,
      createdAt: NOW,
      updatedAt: NOW,
    }],
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

function makeSingleStoryManifest() {
  const ch = makeChapter(STORY_A, CH_A, 'Chapter One', [
    makeScene(STORY_A, CH_A, SCENE_A, 'Scene One', 'Seed prose.', 0),
  ], 0);
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [makeStory(STORY_A, 'Race Story', [ch])],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

type Manifest = ReturnType<typeof makeSingleStoryManifest>;

function makeMockApi(manifest: Manifest, openSceneId = SCENE_A) {
  let liveManifest: Manifest = structuredClone(manifest);
  const scenePath = `stories/${STORY_A}/chapters/${CH_A}/scenes/${openSceneId}.md`;
  const writeManifest = vi.fn().mockImplementation(async (m: Manifest) => {
    liveManifest = structuredClone(m);
  });
  const writeVault = vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 });
  const deleteVault = vi.fn().mockResolvedValue({});
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      lastOpenedScene: { sceneId: openSceneId, scenePath, scrollTop: 0, cursorLine: 0 },
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
    settingsSet: vi.fn().mockResolvedValue({}),
    readManifest: () => Promise.resolve(structuredClone(liveManifest)),
    writeManifest,
    writeVault,
    deleteVault,
    onVaultFileChanged: () => () => {},
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    sessionSaveScene: vi.fn().mockResolvedValue({ saved: true }),
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    snapshotSave: vi.fn().mockResolvedValue({}),
    /** Test helper: last persisted manifest (debounced save lands in writeManifest). */
    _liveManifest: () => liveManifest,
  };
}

async function submitPrompt(text: string): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.prompt-modal-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

async function mountSceneEditor(): Promise<BlockEditorApi> {
  lastEditorApi = null;
  await screen.findByRole('navigation', { name: 'Main navigation' });
  await screen.findByTestId('msv-root');
  // Boot restore may already be at scene zoom; click to be sure.
  fireEvent.click(screen.getByTestId('msv-zoom-scene'));
  await waitFor(() => expect(lastEditorApi).toBeTruthy(), { timeout: 5000 });
  // TipTap marks initialized after a 0ms timer — flush it so typing arms debounce.
  await act(async () => { await Promise.resolve(); });
  return lastEditorApi!;
}

function chapterTitles(manifest: Manifest, storyId = STORY_A): string[] {
  const story = manifest.stories.find((s) => s.id === storyId);
  if (!story) return [];
  return (story.parts?.[0]?.chapters ?? story.chapters ?? []).map((c) => c.title);
}

function sceneFromManifest(manifest: Manifest, storyId: string, sceneId: string) {
  const story = manifest.stories.find((s) => s.id === storyId);
  if (!story) return null;
  const scenes = (story.parts?.[0]?.chapters ?? story.chapters ?? []).flatMap((c) => c.scenes ?? []);
  return scenes.find((sc) => sc.id === sceneId) ?? null;
}

function sceneContent(manifest: Manifest, storyId: string, sceneId: string): string | null {
  const scene = sceneFromManifest(manifest, storyId, sceneId);
  if (!scene) return null;
  return scene.blocks?.map((b) => b.content).join('\n\n') ?? '';
}

/** Advance past RichTextEditor's 800ms debounce (+ buffer). */
async function flushEditorDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

describe('DesktopShell deferred editor save (F1#9 root fix)', () => {
  beforeEach(() => {
    document.elementFromPoint = () => document.body;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    lastEditorApi = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1) type then add chapter within 800ms — chapter + typed text survive', async () => {
    const api = makeMockApi(makeSingleStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Typed before chapter.');
    });
    // Still inside the 800ms window — do NOT let the debounce fire yet.
    await act(async () => { vi.advanceTimersByTime(200); });

    fireEvent.click(screen.getByTestId('msv-add-chapter'));
    await submitPrompt('Chapter Race');

    await flushEditorDebounce();
    vi.useRealTimers();

    // Drain debounced manifest save (900ms scheduleManifestSave).
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });

    await waitFor(() => {
      const man = api._liveManifest();
      expect(chapterTitles(man)).toEqual(expect.arrayContaining(['Chapter One', 'Chapter Race']));
      const content = sceneContent(man, STORY_A, SCENE_A);
      expect(content).toContain('Typed before chapter.');
    });
  });

  it('2) Shield delete: type, delete target, save fires — item stays gone in memory and on disk after relaunch', async () => {
    const api = makeMockApi(makeSingleStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    const { unmount } = render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Doomed text.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Delete the open scene via navigator context menu (confirm mocked true).
    const sceneRow = await waitFor(() => {
      const row = document.querySelector('.nav-scene-row') as HTMLElement | null;
      expect(row).toBeTruthy();
      return row!;
    });
    fireEvent.contextMenu(sceneRow);
    const del = await screen.findByRole('menuitem', { name: /Delete scene/i });
    fireEvent.click(del);

    await flushEditorDebounce();
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });

    await waitFor(() => {
      const man = api._liveManifest();
      expect(sceneFromManifest(man, STORY_A, SCENE_A)).toBeNull();
      expect(api.deleteVault).toHaveBeenCalled();
    });
    // Typed text must not have been rewritten to disk for the deleted scene.
    const doomedWrites = (api.writeVault as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).includes('Doomed text.'),
    );
    expect(doomedWrites.length).toBe(0);

    // Same-userData relaunch: remount with liveManifest as disk.
    unmount();
    lastEditorApi = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => {
      const man = api._liveManifest();
      expect(sceneFromManifest(man, STORY_A, SCENE_A)).toBeNull();
    });
    // Navigator must not list the deleted scene (toast text may still say its title).
    expect(document.querySelector('.nav-scene-row')).toBeNull();
  });

  it('3) Probe switch-story: type in A, switch to B, save fires — A keeps text, B unchanged', async () => {
    const api = makeMockApi(makeTwoStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Alpha typed text.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Switch to Story Beta via navigator — must not retarget the pending save
    // and must not snap selection back to A when the deferred flush lands.
    fireEvent.click(await screen.findByText('Story Beta'));
    await waitFor(() => {
      expect(document.querySelector('.nav-scene-row.active')?.textContent).toMatch(/Scene B/);
    });

    await flushEditorDebounce();
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });

    await waitFor(() => {
      const man = api._liveManifest();
      const aContent = sceneContent(man, STORY_A, SCENE_A);
      const bContent = sceneContent(man, STORY_B, SCENE_B);
      expect(aContent).toContain('Alpha typed text.');
      expect(bContent).toContain('Seed B.');
      expect(bContent).not.toContain('Alpha typed');
    });
    // Probe: late save must not reset the live selection back to Story A.
    expect(document.querySelector('.nav-scene-row.active')?.textContent).toMatch(/Scene B/);
  });
});


