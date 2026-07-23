import { describe, it, expect } from 'vitest';
import { stripManifestContentForIpc } from './manifestIpc';
import type { Manifest, Scene, Story } from './types';

const NOW = '2026-07-22T00:00:00.000Z';

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    title: 'Scene One',
    path: 'stories/s/chapters/c/scenes/s1.md',
    order: 0,
    blocks: [
      { id: 'b-h', type: 'heading', order: 0, content: '## The Old Mill', updatedAt: NOW },
      { id: 'b-p', type: 'prose', order: 1, content: 'Rain fell on the tin roof.', updatedAt: NOW },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function story(scenes: Scene[]): Story {
  return {
    id: 'story-1',
    title: 'Story',
    path: 'stories/story-1',
    chapters: [
      {
        id: 'c1',
        title: 'Chapter 1',
        path: 'stories/story-1/chapters/c1',
        order: 0,
        scenes,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function manifest(scenes: Scene[]): Manifest {
  return {
    version: '2',
    vaultRoot: '/tmp/vault',
    stories: [story(scenes)],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

describe('stripManifestContentForIpc', () => {
  it('blanks every block content and records bodySegLen matching electron-main\'s stripSceneProse', () => {
    const m = manifest([scene()]);
    const stripped = stripManifestContentForIpc(m);
    const blocks = stripped.stories[0].chapters[0].scenes[0].blocks;
    expect(blocks.map((b) => b.content)).toEqual(['', '']);
    // '## The Old Mill' = 15 chars, 'Rain fell on the tin roof.' = 26 chars —
    // same values electron-main/src/manifestBlockRoundtrip.test.ts asserts.
    expect(blocks.map((b) => b.bodySegLen)).toEqual([15, 26]);
    // '## The Old Mill' (4 whitespace-delimited runs, '##' included) +
    // 'Rain fell on the tin roof.' (6) = 10, matching electron-main's countWords.
    expect(stripped.stories[0].chapters[0].scenes[0].wordCount).toBe(10);
  });

  it('never mutates the input manifest or its React-state scene objects', () => {
    const m = manifest([scene()]);
    const originalBlocks = m.stories[0].chapters[0].scenes[0].blocks;
    stripManifestContentForIpc(m);
    expect(originalBlocks.map((b) => b.content)).toEqual([
      '## The Old Mill',
      'Rain fell on the tin roof.',
    ]);
    expect(originalBlocks.every((b) => b.bodySegLen === undefined)).toBe(true);
  });

  it('handles scenes with no blocks', () => {
    const m = manifest([scene({ blocks: [] })]);
    const stripped = stripManifestContentForIpc(m);
    expect(stripped.stories[0].chapters[0].scenes[0].blocks).toEqual([]);
  });
});
