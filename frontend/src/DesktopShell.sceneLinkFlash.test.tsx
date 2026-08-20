// SKY-9729: regression guard for the scene-link flash highlight.
//
// PR #1181 (SKY-9404/M1-S4, ManuscriptView unification) deleted the legacy
// scene-branch JSX that read `sceneFlashId` to apply the
// `shell-editor-scene-wrap--flash` class, but left the write side
// (applyCrossTabLinkMatch's setSceneFlashId + the CSS keyframes) in place —
// the click affordance still fired but nothing visually flashed the scene
// you jumped to. This renders <App /> and drives a real [[wiki link]] click
// through the actual DesktopShell/BlockEditor wiring (not a mocked/isolated
// render) so it exercises the same closures PR #1181 touched.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';
const CHAPTER_2_ID = 'chapter-2';
const SCENE_ID = 'scene-1';
const SCENE_2_ID = 'scene-2';
const NOW = '2026-07-01T00:00:00.000Z';

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
                  { id: 'block-a', type: 'prose', content: 'Body text with a [[Scene Two]] link.', order: 0, updatedAt: NOW },
                ],
              },
            ],
          },
          {
            id: CHAPTER_2_ID,
            title: 'Chapter Two',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_2_ID}`,
            order: 1,
            createdAt: NOW,
            updatedAt: NOW,
            scenes: [
              {
                id: SCENE_2_ID,
                title: 'Scene Two',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_2_ID}/scenes/${SCENE_2_ID}.md`,
                order: 0,
                createdAt: NOW,
                updatedAt: NOW,
                blocks: [
                  { id: 'block-b', type: 'prose', content: 'Scene Two body text.', order: 0, updatedAt: NOW },
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
    sessionSaveScene: vi.fn().mockResolvedValue({}),
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

describe('DesktopShell scene-link flash highlight (SKY-9729)', () => {
  it('flashes the target scene wrap on a [[wiki link]] jump, then clears it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = makeMockApi();
    render(<App />);

    await screen.findByRole('navigation', { name: 'Main navigation' });
    // SKY-10929: rich mode renders styled link text only — no [[ ]] brackets
    // — so the wiki-link node is found by its data attribute, not its text.
    const wikiLink = await waitFor(() => {
      const el = document.querySelector('[data-wiki-link="Scene Two"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(document.querySelector('.shell-editor-scene-wrap--flash')).not.toBeInTheDocument();

    fireEvent.click(wikiLink);

    // Navigated to the linked scene...
    await screen.findByText('Scene Two body text.');
    // ...and its wrap is flash-highlighted (the part PR #1181 silently dropped).
    expect(document.querySelector('.shell-editor-scene-wrap--flash')).toBeInTheDocument();

    // The flash is transient (1200ms, cleared in applyCrossTabLinkMatch).
    await waitFor(() => {
      expect(document.querySelector('.shell-editor-scene-wrap--flash')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
