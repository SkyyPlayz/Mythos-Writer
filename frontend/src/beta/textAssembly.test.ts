import { describe, it, expect } from 'vitest';
import { buildScopeOptions, buildBetaReadSourceText, findSceneAndChapter } from './textAssembly';
import type { Story, Chapter, Scene } from '../types';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1', title: 'Arrival', path: 'scenes/s1.md', order: 0,
    blocks: [
      { id: 'b1', type: 'prose', content: 'The lantern flickered.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b2', type: 'prose', content: 'Mara stepped inside.', order: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'c1', title: 'Chapter 1', path: 'chapters/c1', order: 0,
    scenes: [makeScene()],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1', title: 'My Story', path: 'stories/story-1',
    chapters: [makeChapter()],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildScopeOptions', () => {
  it('includes only the levels that are actually open, narrowest first', () => {
    const story = makeStory();
    const chapter = story.chapters[0];
    const scene = chapter.scenes[0];
    expect(buildScopeOptions(story, chapter, scene).map((o) => o.kind)).toEqual(['scene', 'chapter', 'story']);
    expect(buildScopeOptions(story, chapter, null).map((o) => o.kind)).toEqual(['chapter', 'story']);
    expect(buildScopeOptions(story, null, null).map((o) => o.kind)).toEqual(['story']);
    expect(buildScopeOptions(null, null, null)).toEqual([]);
  });
});

describe('findSceneAndChapter', () => {
  it('finds a scene nested anywhere in the story', () => {
    const story = makeStory();
    const found = findSceneAndChapter(story, 's1');
    expect(found?.scene.id).toBe('s1');
    expect(found?.chapter.id).toBe('c1');
  });

  it('returns null for an unknown scene id or a null story', () => {
    expect(findSceneAndChapter(makeStory(), 'missing')).toBeNull();
    expect(findSceneAndChapter(null, 's1')).toBeNull();
  });
});

describe('buildBetaReadSourceText', () => {
  it('wraps a single scene in a <<SCENE>> marker with its id and text', () => {
    const story = makeStory();
    const text = buildBetaReadSourceText({ kind: 'scene', id: 's1', label: 'Scene: Arrival' }, story);
    expect(text).toContain('<<SCENE id="s1"');
    expect(text).toContain('The lantern flickered.');
    expect(text).toContain('Mara stepped inside.');
    expect(text).toContain('<</SCENE>>');
  });

  it('concatenates every scene in a chapter, in order', () => {
    const scene1 = makeScene({ id: 's1', order: 1, title: 'Second' });
    const scene2 = makeScene({ id: 's2', order: 0, title: 'First', blocks: [{ id: 'b3', type: 'prose', content: 'Opening line.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }] });
    const chapter = makeChapter({ scenes: [scene1, scene2] });
    const story = makeStory({ chapters: [chapter] });

    const text = buildBetaReadSourceText({ kind: 'chapter', id: 'c1', label: 'Chapter: Chapter 1' }, story);
    // scene2 (order 0) should appear before scene1 (order 1).
    expect(text.indexOf('Opening line.')).toBeLessThan(text.indexOf('The lantern flickered.'));
    expect(text).toContain('id="s2"');
    expect(text).toContain('id="s1"');
  });

  it('concatenates every chapter/scene for a full-story scope', () => {
    const chapter2 = makeChapter({ id: 'c2', order: 1, title: 'Chapter 2', scenes: [makeScene({ id: 's3', title: 'Later', blocks: [{ id: 'b4', type: 'prose', content: 'Much later.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }] })] });
    const story = makeStory({ chapters: [makeChapter(), chapter2] });

    const text = buildBetaReadSourceText({ kind: 'story', id: 'story-1', label: 'Full story' }, story);
    expect(text).toContain('id="s1"');
    expect(text).toContain('id="s3"');
    expect(text).toContain('Much later.');
  });

  it('returns an empty string for a stale/unknown scope id', () => {
    const story = makeStory();
    expect(buildBetaReadSourceText({ kind: 'scene', id: 'gone', label: 'x' }, story)).toBe('');
    expect(buildBetaReadSourceText({ kind: 'chapter', id: 'gone', label: 'x' }, story)).toBe('');
  });

  it('returns an empty string when there is no story', () => {
    expect(buildBetaReadSourceText({ kind: 'story', id: 'x', label: 'x' }, null)).toBe('');
  });
});
