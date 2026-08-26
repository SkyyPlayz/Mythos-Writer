// SKY-10923: end-to-end authoring regression guard for M2 (SKY-9017) Part /
// note UI. Renders the real <App/> (not an isolated ManuscriptView) so it
// exercises the actual DesktopShell closures wired to onAddPart/
// onEditPartNote/onEditChapterNote and the storyParts.ts sync helpers.
//
// The first fixture deliberately reproduces the pre-existing data-drift bug
// this issue's investigation found: story.parts[0].chapters is a stale
// migration-time snapshot (empty) while story.chapters (rendering's source
// of truth today) already holds a chapter. "+ Part" must self-heal that
// drift, not lose the chapter — and "+ Chapter"/"+ Scene" must keep working
// once a real Part exists (the case that was never reachable before this
// fix, per the issue's regression-guard requirement).
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const STORY_ID = 'story-1';
const PART_ID = 'part-x';
const CHAPTER_ID = 'ch1';
const SCENE_ID = 'scene1';
const BLOCK_ID = 'block1';
const NOW = '2026-08-19T00:00:00.000Z';

function makeChapter() {
  return {
    id: CHAPTER_ID,
    title: 'Chapter One',
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    scenes: [
      {
        id: SCENE_ID,
        title: 'Scene One',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
        order: 0,
        createdAt: NOW,
        updatedAt: NOW,
        blocks: [{ id: BLOCK_ID, type: 'prose', content: 'Once upon a time.', order: 0, updatedAt: NOW }],
      },
    ],
  };
}

/** Drifted shape: parts[0].chapters is a stale (empty) migration snapshot —
 *  exactly the bug Finding 1 describes for every pre-existing vault. */
function makeDriftedManifest() {
  const chapter = makeChapter();
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: STORY_ID,
        title: 'Drift Story',
        path: `stories/${STORY_ID}`,
        createdAt: NOW,
        updatedAt: NOW,
        chapters: [chapter],
        parts: [{ id: PART_ID, title: '', order: 0, note: [], chapters: [], createdAt: NOW, updatedAt: NOW }],
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

/** Consistent shape (no drift) — used for the note-authoring round trip. */
function makeConsistentManifest() {
  const chapter = makeChapter();
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: STORY_ID,
        title: 'Note Story',
        path: `stories/${STORY_ID}`,
        createdAt: NOW,
        updatedAt: NOW,
        chapters: [chapter],
        parts: [{ id: PART_ID, title: '', order: 0, note: [], chapters: [chapter], createdAt: NOW, updatedAt: NOW }],
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeMockApi(manifest: unknown, overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      lastOpenedScene: { sceneId: SCENE_ID, scenePath: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`, scrollTop: 0, cursorLine: 0 },
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
    settingsSet: vi.fn().mockResolvedValue({}),
    readManifest: () => Promise.resolve(manifest),
    writeManifest: vi.fn().mockResolvedValue({}),
    writeVault: vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 }),
    onVaultFileChanged: () => () => {},
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    sessionSaveScene: vi.fn().mockResolvedValue({ saved: true }),
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    ...overrides,
  };
}

/** SKY-130 boot restore lands at scene-zoom, where ManuscriptView renders
 *  the sceneEditorSlot (BlockEditor) instead of its own block list — step
 *  out to book zoom to reach the h2/h3/note-slot rendering path. */
async function openBookZoom(): Promise<void> {
  await screen.findByRole('navigation', { name: 'Main navigation' });
  const bookZoomBtn = await screen.findByTestId('msv-zoom-book', {}, { timeout: 5000 });
  fireEvent.click(bookZoomBtn);
}

async function submitPrompt(text: string): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.prompt-modal-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('DesktopShell Part/note authoring (SKY-10923)', () => {
  it('"+ Part" self-heals a drifted parts mirror without losing the existing chapter, and + Chapter still works after', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi(makeDriftedManifest());
    render(<App />);
    await openBookZoom();
    await screen.findByTestId(`msv-h2-${CHAPTER_ID}`, {}, { timeout: 5000 });

    fireEvent.click(await screen.findByTestId('msv-add-part'));
    await submitPrompt('Part One');

    // The part now has real chrome (H1) — proof the story is no longer
    // "simple single part" — and the pre-existing chapter/scene are still
    // there, i.e. reconcileParts recovered them instead of losing them to
    // the stale (empty) parts[0].chapters snapshot.
    expect(await screen.findByTestId(`msv-h1-${PART_ID}`)).toHaveTextContent('Part One');
    expect(screen.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`msv-h3-${SCENE_ID}`)).toBeInTheDocument();

    // Regression guard (Finding 1): + Chapter must still work now that a
    // real Part exists — this was the path silently broken before the fix.
    fireEvent.click(screen.getByTestId('msv-add-chapter'));
    await submitPrompt('Chapter Two');
    expect(await screen.findByText('Chapter Two')).toBeInTheDocument();
    // The original chapter is still visible — the new chapter didn't
    // replace/orphan it.
    expect(screen.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeInTheDocument();
  });

  it('chapter note: affordance click -> type -> commit renders the epigraph', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi(makeConsistentManifest());
    render(<App />);
    await openBookZoom();
    const affordance = await screen.findByTestId(`msv-note-affordance-chapter-${CHAPTER_ID}`, {}, { timeout: 5000 });
    fireEvent.click(affordance);

    const field = await screen.findByTestId(`msv-note-edit-note-chapter-${CHAPTER_ID}`);
    field.textContent = 'A storm was coming.';
    fireEvent.blur(field);

    const epigraph = await screen.findByTestId(`msv-note-chapter-${CHAPTER_ID}`);
    expect(epigraph).toHaveTextContent('A storm was coming.');
    // The affordance is gone now that the note has content.
    expect(screen.queryByTestId(`msv-note-affordance-chapter-${CHAPTER_ID}`)).not.toBeInTheDocument();

    // Reopening and clearing the text removes the note again (revert to affordance).
    fireEvent.click(epigraph);
    const reopened = await screen.findByTestId(`msv-note-edit-note-chapter-${CHAPTER_ID}`);
    reopened.textContent = '';
    fireEvent.blur(reopened);
    expect(await screen.findByTestId(`msv-note-affordance-chapter-${CHAPTER_ID}`)).toBeInTheDocument();
  });
});
