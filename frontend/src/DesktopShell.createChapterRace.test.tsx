// F1#9 root-fix + Critic r3 H1–H4 break-tests.
// Core race tests must RED on tip 999cfb79; H1–H4 RED on tip 80c88bfc.
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
import { mergeSceneBlocksIntoStories } from './story/applySceneBlocks';
import type { Block, Story } from './types';

const NOW = '2026-09-29T00:00:00.000Z';

const STORY_A = 'story-a';
const STORY_B = 'story-b';
const CH_A = 'ch-a';
const CH_B = 'ch-b';
const SCENE_A = 'scene-a';
const SCENE_B = 'scene-b';
const PART_A = 'part-a';
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

function makeStory(
  id: string,
  title: string,
  chapters: ReturnType<typeof makeChapter>[],
  partTitle = '',
  partId = `part-${id}`,
) {
  return {
    id,
    title,
    path: `stories/${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    chapters,
    parts: [{
      id: partId,
      title: partTitle,
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

/** Two chapters under one named part — Structure move + createChapterInPart. */
function makeTwoChapterNamedPartManifest() {
  const chA = makeChapter(STORY_A, CH_A, 'Chapter One', [
    makeScene(STORY_A, CH_A, SCENE_A, 'Scene One', 'Seed prose.', 0),
  ], 0);
  const chB = makeChapter(STORY_A, CH_B, 'Chapter Two', [
    makeScene(STORY_A, CH_B, SCENE_B, 'Scene Two', 'Other seed.', 0),
  ], 1);
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [makeStory(STORY_A, 'Race Story', [chA, chB], 'Part One', PART_A)],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

/** Two parts: Part One holds both chapters; Part Two is empty (drop target). */
function makeTwoPartManifest() {
  const chA = makeChapter(STORY_A, CH_A, 'Chapter One', [
    makeScene(STORY_A, CH_A, SCENE_A, 'Scene One', 'Seed prose.', 0),
  ], 0);
  const chB = makeChapter(STORY_A, CH_B, 'Chapter Two', [
    makeScene(STORY_A, CH_B, SCENE_B, 'Scene Two', 'Other seed.', 0),
  ], 1);
  const partA = {
    id: PART_A,
    title: 'Part One',
    order: 0,
    note: [],
    chapters: [chA, chB],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const partB = {
    id: 'part-b',
    title: '',
    order: 1,
    note: [],
    chapters: [] as ReturnType<typeof makeChapter>[],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [{
      id: STORY_A,
      title: 'Race Story',
      path: `stories/${STORY_A}`,
      createdAt: NOW,
      updatedAt: NOW,
      chapters: [chA, chB],
      parts: [partA, partB],
    }],
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
    onNavigatorManifestChanged: (_cb: () => void) => () => {},
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
    /** Test helper: last persisted manifest (debounced save lands in writeManifest). */
    _liveManifest: () => liveManifest,
  };
}

/**
 * Same-scene-id fixture for the Shield collision bar.
 * B is listed FIRST so `stories.find(hasScene(sharedId))` hits B and
 * corrupts it — that is the mutation that must turn this test red.
 * (Do not boot DesktopShell with this shape: duplicate scene ids hang the
 * renderer — pre-existing residual, out of scope.)
 */
function makeSameSceneIdStories(): Story[] {
  const sharedId = 'shared-scene-id';
  const chB = makeChapter(STORY_B, CH_B, 'Chapter B', [
    makeScene(STORY_B, CH_B, sharedId, 'Scene B', 'Seed B.', 0),
  ], 0);
  const chA = makeChapter(STORY_A, CH_A, 'Chapter A', [
    makeScene(STORY_A, CH_A, sharedId, 'Scene A', 'Seed A.', 0),
  ], 0);
  // Fixture helpers above use stringly block types for the race harness;
  // cast once at the boundary into the helper's Story[].
  return [
    makeStory(STORY_B, 'Story Beta', [chB]),
    makeStory(STORY_A, 'Story Alpha', [chA]),
  ] as Story[];
}

async function submitPrompt(text: string): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.prompt-modal-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

/** Open the title prompt but leave it open (H4: flush while modal is up). */
async function openPromptDialog(): Promise<HTMLInputElement> {
  const dialog = await screen.findByRole('dialog');
  return dialog.querySelector('.prompt-modal-input') as HTMLInputElement;
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
  const chapters = story.parts?.length
    ? story.parts.flatMap((p) => p.chapters ?? [])
    : (story.chapters ?? []);
  // Dedup by id — story.chapters mirrors parts[].chapters after sync.
  const byId = new Map<string, (typeof chapters)[number]>();
  for (const ch of chapters) byId.set(ch.id, ch);
  for (const ch of byId.values()) {
    const scene = (ch.scenes ?? []).find((sc) => sc.id === sceneId);
    if (scene) return scene;
  }
  return null;
}

function sceneContent(manifest: Manifest, storyId: string, sceneId: string): string | null {
  const scene = sceneFromManifest(manifest, storyId, sceneId);
  if (!scene) return null;
  return scene.blocks?.map((b) => b.content).join('\n\n') ?? '';
}

function sceneChapterId(manifest: Manifest, storyId: string, sceneId: string): string | null {
  const story = manifest.stories.find((s) => s.id === storyId);
  if (!story) return null;
  const chapters = story.parts?.length
    ? story.parts.flatMap((p) => p.chapters ?? [])
    : (story.chapters ?? []);
  const byId = new Map<string, (typeof chapters)[number]>();
  for (const ch of chapters) byId.set(ch.id, ch);
  for (const ch of byId.values()) {
    if ((ch.scenes ?? []).some((sc) => sc.id === sceneId)) return ch.id;
  }
  return null;
}

/** Advance past RichTextEditor's 800ms debounce (+ buffer). */
async function flushEditorDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

async function drainManifestSave(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
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
    await drainManifestSave();

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
    await drainManifestSave();

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
    await drainManifestSave();

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

  it('H1) Back and Forward after Continuity View full note restore the note (not empty Notes)', async () => {
    const api = makeMockApi(makeTwoStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    await mountSceneEditor();

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

    // Exit focus so the story navigator is available, then switch story
    // (handleSelectScene clears notePath).
    fireEvent.click(await screen.findByTestId('writing-mode-normal'));
    fireEvent.click(await screen.findByTestId('nav-rail-story'));
    fireEvent.click(await screen.findByText('Story Beta'));
    await waitFor(() => {
      expect(document.querySelector('.nav-scene-row.active')?.textContent).toMatch(/Scene B/);
    });

    // Back via Alt+← (ManuscriptView → onHistoryAltArrow → tryGoBack).
    // May need two steps if nav-rail-story pushed an intermediate entry.
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

    // Probe H1 Forward: leave the note (Back to scene), then Forward must
    // restore the note again — not an empty Notes placeholder.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('note-title')).toBeNull();
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId('note-title')).toBeInTheDocument();
      expect(screen.queryByTestId('notes-editor-placeholder')).toBeNull();
    });
  });

  it('H3) move open scene, then type — text lands under new chapter', async () => {
    const api = makeMockApi(makeTwoChapterNamedPartManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    const { unmount } = render(<App />);
    await mountSceneEditor();

    // Structure → List view: drag Scene One onto Chapter Two BEFORE typing
    // (Probe: typing before the move flushes on Structure unmount and stays
    // green with H3 hunks reverted — type AFTER like Critic's moveDrop).
    fireEvent.click(await screen.findByTestId('story-subview-structure'));
    fireEvent.click(await screen.findByTitle(/List view/i));
    const alpha = await screen.findByRole('treeitem', { name: /Scene: Scene One/i });
    const ch2Header = screen.getByText('CHAPTER 2').closest('.list-chapter__header');
    expect(ch2Header).toBeTruthy();
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => SCENE_A),
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(alpha, { dataTransfer });
    fireEvent.dragOver(ch2Header!, { dataTransfer });
    fireEvent.drop(ch2Header!, { dataTransfer });

    await waitFor(() => {
      expect(sceneChapterId(api._liveManifest(), STORY_A, SCENE_A)).toBe(CH_B);
    });

    // Relaunch against the post-move manifest so the editor mounts on the
    // scene under Chapter Two (jsdom TipTap does not reliably remount after
    // Structure↔Editor). Typing then saving must still find the scene by id
    // (H3) — a chapterId-only lookup against the old chapter goes red.
    unmount();
    cleanup();
    lastEditorApi = null;
    const api2 = makeMockApi(api._liveManifest(), SCENE_A);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api2;
    render(<App />);
    const editor = await mountSceneEditor();
    await act(async () => {
      editor.insertText('After move text.');
    });
    // Real timers: TipTap debounce is 800ms — avoid fake-timer quirks after relaunch.
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    await drainManifestSave();

    await waitFor(() => {
      const man = api2._liveManifest();
      expect(sceneChapterId(man, STORY_A, SCENE_A)).toBe(CH_B);
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('After move text.');
    });
    const movedWrites = (api2.writeVault as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).includes('After move text.'),
    );
    expect(movedWrites.length).toBeGreaterThan(0);
  });

  it('Shield collision) same scene id in A and B — late save from A does not touch B', async () => {
    // Pure helper bar (MUST go RED when applySceneBlocks / mergeSceneBlocks
    // stops scoping by storyId). Booting DesktopShell with duplicate scene
    // ids hangs the renderer — out of scope — so same-id lives here + in
    // applySceneBlocks.test.ts; shell A→B below uses unique ids + fake timers.
    const sharedId = 'shared-scene-id';
    const stories = makeSameSceneIdStories();
    expect(stories[0]!.id).toBe(STORY_B); // B-first: global find hits wrong story
    const blocks: Block[] = [
      { id: 'b-collide', type: 'prose', content: 'Typed in A only.', order: 0, updatedAt: NOW },
    ];
    const merged = mergeSceneBlocksIntoStories(
      stories, STORY_A, CH_A, sharedId, blocks, { now: () => NOW },
    );
    expect(merged).not.toBeNull();
    const contentOf = (list: Story[], storyId: string) => {
      const story = list.find((s) => s.id === storyId)!;
      const scene = story.chapters.flatMap((c) => c.scenes).find((sc) => sc.id === sharedId)!;
      return scene.blocks.map((b) => b.content).join('\n\n');
    };
    expect(contentOf(merged!.stories, STORY_A)).toContain('Typed in A only.');
    expect(contentOf(merged!.stories, STORY_B)).toBe('Seed B.');
    expect(merged!.stories.find((s) => s.id === STORY_B)).toBe(stories[0]);

    // Fake-timer A→B companion (unique ids — no renderer hang).
    const api = makeMockApi(makeTwoStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writesBefore = (api.writeVault as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      editor.insertText('Collision typed in A.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    fireEvent.click(await screen.findByText('Story Beta'));
    await waitFor(() => {
      expect(document.querySelector('.nav-scene-row.active')?.textContent).toMatch(/Scene B/);
    });

    await flushEditorDebounce();
    vi.useRealTimers();
    await drainManifestSave();

    await waitFor(() => {
      const man = api._liveManifest();
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('Collision typed in A.');
      expect(sceneContent(man, STORY_B, SCENE_B)).toBe('Seed B.');
    });
    const bWrites = (api.writeVault as ReturnType<typeof vi.fn>).mock.calls
      .slice(writesBefore)
      .filter((c) => typeof c[0] === 'string' && (c[0] as string).includes(`stories/${STORY_B}/`)
        && typeof c[1] === 'string' && (c[1] as string).includes('Collision typed in A.'));
    expect(bWrites.length).toBe(0);
  });

  it('H4a) type then + Part while debounce pending — part + typed text survive', async () => {
    const api = makeMockApi(makeSingleStoryManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Typed before part.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // + Part is on the scene-zoom toolbar — editor stays mounted with debounce armed.
    fireEvent.click(screen.getByTestId('msv-add-part'));
    await openPromptDialog();
    await flushEditorDebounce();
    vi.useRealTimers();
    await submitPrompt('Part Race');
    await drainManifestSave();

    await waitFor(() => {
      const man = api._liveManifest();
      const story = man.stories.find((s) => s.id === STORY_A)!;
      expect(story.parts?.[0]?.title).toBe('Part Race');
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('Typed before part.');
    });
  });

  it('H4b) type then add-chapter-in-part while debounce pending — chapter + text survive', async () => {
    const api = makeMockApi(makeTwoChapterNamedPartManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Typed before in-part chapter.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Part context menu → Add chapter (createChapterInPart); editor stays mounted.
    const partRow = await screen.findByTestId(`nav-part-${PART_A}`);
    fireEvent.contextMenu(partRow.querySelector('.nav-part-row') ?? partRow);
    const addChapter = await screen.findByRole('menuitem', { name: /Add chapter/i });
    fireEvent.click(addChapter);

    await openPromptDialog();
    await flushEditorDebounce();
    vi.useRealTimers();
    await submitPrompt('Chapter In Part');
    await drainManifestSave();

    await waitFor(() => {
      const man = api._liveManifest();
      expect(chapterTitles(man)).toEqual(
        expect.arrayContaining(['Chapter One', 'Chapter Two', 'Chapter In Part']),
      );
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('Typed before in-part chapter.');
    });
  });

  it('H4 rename) type then rename part while debounce pending — rename + text survive', async () => {
    const api = makeMockApi(makeTwoChapterNamedPartManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Typed before rename.');
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    const partRow = await screen.findByTestId(`nav-part-${PART_A}`);
    fireEvent.contextMenu(partRow.querySelector('.nav-part-row') ?? partRow);
    const rename = await screen.findByRole('menuitem', { name: /Rename/i });
    fireEvent.click(rename);

    await openPromptDialog();
    await flushEditorDebounce();
    vi.useRealTimers();
    await submitPrompt('Renamed Part');
    await drainManifestSave();

    await waitFor(() => {
      const man = api._liveManifest();
      const story = man.stories.find((s) => s.id === STORY_A)!;
      expect(story.parts?.[0]?.title).toBe('Renamed Part');
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('Typed before rename.');
    });
  });

  it('moveScene) flush then move while stories closure is stale — typed text survives', async () => {
    const api = makeMockApi(makeTwoChapterNamedPartManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Survives moveScene.');
    });
    // Let the deferred save publish into storiesRef before the drop maps stories.
    await flushEditorDebounce();
    vi.useRealTimers();

    fireEvent.click(await screen.findByTestId('story-subview-structure'));
    fireEvent.click(await screen.findByTitle(/List view/i));
    const alpha = await screen.findByRole('treeitem', { name: /Scene: Scene One/i });
    const ch2Header = screen.getByText('CHAPTER 2').closest('.list-chapter__header');
    expect(ch2Header).toBeTruthy();
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => SCENE_A),
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(alpha, { dataTransfer });
    fireEvent.dragOver(ch2Header!, { dataTransfer });
    fireEvent.drop(ch2Header!, { dataTransfer });
    await drainManifestSave();

    await waitFor(() => {
      const man = api._liveManifest();
      expect(sceneChapterId(man, STORY_A, SCENE_A)).toBe(CH_B);
      expect(sceneContent(man, STORY_A, SCENE_A)).toContain('Survives moveScene.');
    });
  });

  it('moveChapterToPart) flush then drop chapter on part — typed text survives', async () => {
    const api = makeMockApi(makeTwoPartManifest());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = api;
    render(<App />);
    const editor = await mountSceneEditor();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      editor.insertText('Survives chapter→part.');
    });
    await flushEditorDebounce();
    vi.useRealTimers();

    fireEvent.click(await screen.findByTestId('story-subview-structure'));
    // Prior tests may leave Structure on List view (persisted) — part drops
    // live on the SceneGrid, so force Grid.
    const gridBtn = screen.queryByTitle(/Grid view/i);
    if (gridBtn) fireEvent.click(gridBtn);
    await screen.findByTestId('msv-struct-part-header-part-b');
    const ch1Title = screen.getByRole('heading', { name: 'Chapter One' });
    const ch1Header = ch1Title.closest('.chapter-section__header');
    expect(ch1Header).toBeTruthy();
    const partHeader = screen.getByTestId('msv-struct-part-header-part-b');
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => CH_A),
      effectAllowed: 'move',
      dropEffect: '',
    };
    fireEvent.dragStart(ch1Header!, { dataTransfer });
    fireEvent.dragOver(partHeader, { dataTransfer });
    fireEvent.drop(partHeader, { dataTransfer });
    await drainManifestSave();

    await waitFor(() => {
      const content = sceneContent(api._liveManifest(), STORY_A, SCENE_A);
      expect(content).toBeTruthy();
      expect(content).toContain('Survives chapter→part.');
    });
  });
});
