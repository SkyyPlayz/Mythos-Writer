// SKY-8587: regression guard for handleManuscriptEditParagraph /
// handleManuscriptMoveParagraph never refreshing `selectedStory` after
// updateManifest — the manuscript renders selectedStory, not `stories`, so a
// stale selectedStory meant a later paragraph edit (or drag) on the SAME
// scene read its sibling paragraphs from the pre-edit snapshot and silently
// reverted them when it wrote the scene back out.
//
// This renders <App /> far enough (via the "restore last-opened scene on
// boot" path, SKY-130) to reach the real ManuscriptView at chapter zoom —
// the same handlers wired up in DesktopShell, not a mocked/isolated
// ManuscriptView render — so it exercises the actual DesktopShell closures
// that SKY-8587 found broken.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';
const SCENE_ID = 'scene-1';
const BLOCK_A = 'block-a';
const BLOCK_B = 'block-b';
const NOW = '2026-07-01T00:00:00.000Z';

const ORIGINAL_A = 'Paragraph A original text.';
const ORIGINAL_B = 'Paragraph B original text.';
const EDITED_A = 'Paragraph A edited text.';
const EDITED_B = 'Paragraph B edited text.';

function makeManifest() {
  return {
    version: '1',
    vaultRoot: '/tmp',
    stories: [
      {
        id: STORY_ID,
        title: 'Regression Story',
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
                title: 'Scene One',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                createdAt: NOW,
                updatedAt: NOW,
                blocks: [
                  { id: BLOCK_A, type: 'prose', content: ORIGINAL_A, order: 0, updatedAt: NOW },
                  { id: BLOCK_B, type: 'prose', content: ORIGINAL_B, order: 1, updatedAt: NOW },
                ],
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

function makeMockApi(overrides: Record<string, unknown> = {}) {
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
    readManifest: () => Promise.resolve(makeManifest()),
    writeManifest: vi.fn().mockResolvedValue({}),
    writeVault: vi.fn().mockResolvedValue({ path: 'x.md', bytes: 10 }),
    onVaultFileChanged: () => () => {},
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

/** Navigate from the restored scene (viewDepth 'scene') to chapter zoom, the
 * ManuscriptView render path with grips + contentEditable paragraph rows. */
async function openChapterZoom(): Promise<void> {
  await screen.findByRole('navigation', { name: 'Main navigation' });
  const depthSlider = await screen.findByTestId('depth-slider');
  fireEvent.click(within(depthSlider).getByRole('button', { name: /^chapter$/i }));
  await screen.findByTestId(`msv-para-${BLOCK_A}`);
}

describe('DesktopShell manuscript paragraph refresh (SKY-8587)', () => {
  it('a second paragraph edit does not revert the first (handleManuscriptEditParagraph refresh)', async () => {
    render(<App />);
    await openChapterZoom();

    const paraA = screen.getByTestId(`msv-para-${BLOCK_A}`);
    paraA.textContent = EDITED_A;
    fireEvent.blur(paraA);

    // Edit #1 committed and is reflected in the re-rendered row.
    expect(await screen.findByText(EDITED_A)).toBeInTheDocument();

    const paraB = screen.getByTestId(`msv-para-${BLOCK_B}`);
    paraB.textContent = EDITED_B;
    fireEvent.blur(paraB);

    // Edit #2 committed...
    expect(await screen.findByText(EDITED_B)).toBeInTheDocument();
    // ...and paragraph A's row STILL shows edit #1's text — proving the
    // second edit read a refreshed selectedStory, not the pre-edit-1 one.
    expect(screen.getByTestId(`msv-para-${BLOCK_A}`)).toHaveTextContent(EDITED_A);
    expect(screen.queryByText(ORIGINAL_A)).not.toBeInTheDocument();

    // The decisive assertion: the SECOND scene-markdown write (persisted to
    // disk right after edit #2 commits) is handleManuscriptEditParagraph's
    // own "next handler's input" — built from whatever `selectedStory` it
    // read paragraph A's content from. A stale (unrefreshed) selectedStory
    // would silently write paragraph A back out as its pre-edit-1 original.
    const writeVault = window.api.writeVault as unknown as ReturnType<typeof vi.fn>;
    expect(writeVault).toHaveBeenCalledTimes(2);
    const secondWriteContent = writeVault.mock.calls[1][1] as string;
    expect(secondWriteContent).toContain(EDITED_A);
    expect(secondWriteContent).not.toContain(ORIGINAL_A);
    expect(secondWriteContent).toContain(EDITED_B);
  });

  it('grip-dragging a paragraph reorders it immediately (handleManuscriptMoveParagraph refresh)', async () => {
    render(<App />);
    await openChapterZoom();

    // Drag block B's grip onto block A's row to swap their order.
    fireEvent.mouseDown(screen.getByTestId(`msv-grip-${BLOCK_B}`));
    const targetRow = screen.getByTestId(`msv-para-${BLOCK_A}`).parentElement as HTMLElement;
    fireEvent.mouseEnter(targetRow);
    fireEvent.mouseUp(targetRow);

    // The reorder must show up in the DOM right away — before the fix,
    // selectedStory (what ManuscriptView renders) never refreshed and the
    // view kept showing the pre-drag order.
    await screen.findByTestId(`msv-para-${BLOCK_A}`);
    const paraTexts = screen.getAllByTestId(/^msv-para-/).map((el) => el.textContent);
    expect(paraTexts.indexOf(ORIGINAL_B)).toBeLessThan(paraTexts.indexOf(ORIGINAL_A));
  });
});
