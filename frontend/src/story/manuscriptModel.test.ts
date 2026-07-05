// Beta 3 M9 — manuscriptModel unit tests: flatUnits ordering, zoomStep wrap
// semantics at both ends for every zoom, buildBlocks scoping + folding,
// cycleStatus, breadcrumbs.

import { describe, it, expect } from 'vitest';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import {
  breadcrumbs,
  buildBlocks,
  chapterStatus,
  cycleStatus,
  flatUnits,
  sceneStatus,
  zoomStep,
  type H3Block,
  type ManuscriptCursor,
  type SceneStatus,
} from './manuscriptModel';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(
  id: string,
  title: string,
  order: number,
  draftState: DraftState | undefined,
  paras: string[]
): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    draftState,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

/** Mirrors the prototype _book0 shape flattened to one implicit part:
 *  ch1 (2 scenes), ch2 (3 scenes), ch3 (2 scenes). */
function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [
      mkChapter('ch1', 'The Quiet Before', 0, [
        mkScene('s1', "The Watcher's Call", 0, 'final', ['Mira counted the bells.', 'The harbor lanterns guttered.']),
        mkScene('s2', 'A City in Shadows', 1, 'final', ['By morning the rumor had teeth.']),
      ]),
      mkChapter('ch2', 'Fractures', 1, [
        mkScene('s3', "The Smuggler's Bargain", 0, 'final', ['Kael dealt cards slowly.']),
        mkScene('s4', 'Into the Undercity', 1, 'in-progress', ['The stairwell yawned.', 'Kael tightened his hood.', 'Stay close.']),
        mkScene('s5', 'The Broken Gate', 2, undefined, ['The map ended at a door.']),
      ]),
      mkChapter('ch3', 'Whispers of Rebellion', 2, [
        mkScene('s6', 'Ward Violet', 0, 'review', ['Ward Violet did not exist.']),
        mkScene('s7', 'The Deep Awakens', 1, undefined, ['The first tremor came at low tide.']),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Same story but with chapters/scenes/blocks stored out of array order —
 *  the model must sort by `order`, never trust array position. */
function mkShuffledStory(): Story {
  const story = mkStory();
  story.chapters.reverse();
  story.chapters.forEach((c) => {
    c.scenes.reverse();
    c.scenes.forEach((s) => s.blocks.reverse());
  });
  return story;
}

function cur(zoom: ManuscriptCursor['zoom'], chapter = 0, scene = 0): ManuscriptCursor {
  return { zoom, part: 0, chapter, scene };
}

const NONE: ReadonlySet<string> = new Set();

// ─── flatUnits ───────────────────────────────────────────────────────────────

describe('flatUnits', () => {
  it('returns no units at book zoom (a book has no siblings)', () => {
    expect(flatUnits(mkStory(), 'book')).toEqual([]);
  });

  it('returns the single implicit part at part zoom', () => {
    expect(flatUnits(mkStory(), 'part')).toEqual([{ part: 0, chapter: 0, scene: 0 }]);
  });

  it('returns one unit per chapter, in order, at chapter zoom', () => {
    expect(flatUnits(mkStory(), 'chapter')).toEqual([
      { part: 0, chapter: 0, scene: 0 },
      { part: 0, chapter: 1, scene: 0 },
      { part: 0, chapter: 2, scene: 0 },
    ]);
  });

  it('returns every scene in chapter-major order at scene zoom', () => {
    expect(flatUnits(mkStory(), 'scene')).toEqual([
      { part: 0, chapter: 0, scene: 0 },
      { part: 0, chapter: 0, scene: 1 },
      { part: 0, chapter: 1, scene: 0 },
      { part: 0, chapter: 1, scene: 1 },
      { part: 0, chapter: 1, scene: 2 },
      { part: 0, chapter: 2, scene: 0 },
      { part: 0, chapter: 2, scene: 1 },
    ]);
  });

  it('sorts by `order`, not array position', () => {
    expect(flatUnits(mkShuffledStory(), 'scene')).toEqual(flatUnits(mkStory(), 'scene'));
  });
});

// ─── zoomStep ────────────────────────────────────────────────────────────────

describe('zoomStep', () => {
  const story = mkStory();

  it('is a no-op at book zoom', () => {
    const c = cur('book', 1, 1);
    expect(zoomStep(story, c, 1)).toBe(c);
    expect(zoomStep(story, c, -1)).toBe(c);
  });

  it('wraps the single implicit part onto itself at part zoom', () => {
    expect(zoomStep(story, cur('part'), 1)).toEqual(cur('part'));
    expect(zoomStep(story, cur('part'), -1)).toEqual(cur('part'));
  });

  it('steps to the next chapter at chapter zoom', () => {
    expect(zoomStep(story, cur('chapter', 0), 1)).toEqual(cur('chapter', 1));
    expect(zoomStep(story, cur('chapter', 1), 1)).toEqual(cur('chapter', 2));
  });

  it('wraps chapter zoom at both ends', () => {
    expect(zoomStep(story, cur('chapter', 2), 1)).toEqual(cur('chapter', 0));
    expect(zoomStep(story, cur('chapter', 0), -1)).toEqual(cur('chapter', 2));
  });

  it('steps scenes across chapter boundaries at scene zoom', () => {
    expect(zoomStep(story, cur('scene', 0, 1), 1)).toEqual(cur('scene', 1, 0));
    expect(zoomStep(story, cur('scene', 1, 0), -1)).toEqual(cur('scene', 0, 1));
  });

  it('wraps scene zoom at both ends', () => {
    expect(zoomStep(story, cur('scene', 2, 1), 1)).toEqual(cur('scene', 0, 0));
    expect(zoomStep(story, cur('scene', 0, 0), -1)).toEqual(cur('scene', 2, 1));
  });

  it('never mutates the input cursor', () => {
    const c = cur('scene', 1, 1);
    zoomStep(story, c, 1);
    expect(c).toEqual(cur('scene', 1, 1));
  });

  it('returns the cursor unchanged for a story with no chapters', () => {
    const empty: Story = { ...story, chapters: [] };
    const c = cur('chapter', 0);
    expect(zoomStep(empty, c, 1)).toBe(c);
  });
});

// ─── status helpers ──────────────────────────────────────────────────────────

describe('sceneStatus', () => {
  it('maps draftState onto todo/draft/done', () => {
    const story = mkStory();
    const scenes = story.chapters.flatMap((c) => c.scenes);
    const byId = new Map(scenes.map((s) => [s.id, s]));
    expect(sceneStatus(byId.get('s1') as Scene)).toBe('done'); // final
    expect(sceneStatus(byId.get('s4') as Scene)).toBe('draft'); // in-progress
    expect(sceneStatus(byId.get('s6') as Scene)).toBe('draft'); // review
    expect(sceneStatus(byId.get('s5') as Scene)).toBe('todo'); // undefined
  });
});

describe('chapterStatus', () => {
  const story = mkStory();

  it('is done when every scene is done', () => {
    expect(chapterStatus(story.chapters[0])).toBe('done');
  });

  it('is draft when any scene has progress but not all are done', () => {
    expect(chapterStatus(story.chapters[1])).toBe('draft');
    expect(chapterStatus(story.chapters[2])).toBe('draft');
  });

  it('is todo when no scene has progress (including empty chapters)', () => {
    expect(chapterStatus(mkChapter('chx', 'Empty', 0, []))).toBe('todo');
    expect(
      chapterStatus(mkChapter('chy', 'Planned', 0, [mkScene('sx', 'Later', 0, undefined, [])]))
    ).toBe('todo');
  });
});

describe('cycleStatus', () => {
  it('cycles todo → draft → done → todo (prototype 3497–3503)', () => {
    expect(cycleStatus('todo')).toBe('draft');
    expect(cycleStatus('draft')).toBe('done');
    expect(cycleStatus('done')).toBe('todo');
  });
});

// ─── buildBlocks ─────────────────────────────────────────────────────────────

describe('buildBlocks', () => {
  const story = mkStory();

  it('emits every chapter/scene/paragraph in order at book zoom', () => {
    const blocks = buildBlocks(story, cur('book'), NONE);
    expect(blocks.map((b) => `${b.kind}:${b.id}`)).toEqual([
      'h2:h2-ch1',
      'h3:h3-s1', 'para:p-s1-b0', 'para:p-s1-b1',
      'h3:h3-s2', 'para:p-s2-b0',
      'h2:h2-ch2',
      'h3:h3-s3', 'para:p-s3-b0',
      'h3:h3-s4', 'para:p-s4-b0', 'para:p-s4-b1', 'para:p-s4-b2',
      'h3:h3-s5', 'para:p-s5-b0',
      'h2:h2-ch3',
      'h3:h3-s6', 'para:p-s6-b0',
      'h3:h3-s7', 'para:p-s7-b0',
    ]);
  });

  it('treats part zoom as the whole (single implicit) part', () => {
    expect(buildBlocks(story, cur('part'), NONE)).toEqual(buildBlocks(story, cur('book'), NONE));
  });

  it('scopes chapter zoom to the cursor chapter, including its H2', () => {
    const blocks = buildBlocks(story, cur('chapter', 1), NONE);
    expect(blocks[0]).toMatchObject({
      kind: 'h2',
      chapterId: 'ch2',
      label: 'CHAPTER 2',
      title: 'Fractures',
      status: 'draft',
      folded: false,
      childCount: 3,
    });
    expect(blocks.filter((b) => b.kind === 'h2')).toHaveLength(1);
    expect(blocks.filter((b) => b.kind === 'h3').map((b) => b.id)).toEqual([
      'h3-s3', 'h3-s4', 'h3-s5',
    ]);
    expect(blocks.every((b) => b.kind === 'h2' || b.chapterId === 'ch2')).toBe(true);
  });

  it('scopes scene zoom to one scene with no H2 (prototype: H2 only when zoom !== scene)', () => {
    const blocks = buildBlocks(story, cur('scene', 1, 1), NONE);
    expect(blocks.map((b) => `${b.kind}:${b.id}`)).toEqual([
      'h3:h3-s4', 'para:p-s4-b0', 'para:p-s4-b1', 'para:p-s4-b2',
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'h3', sceneId: 's4', title: 'Into the Undercity', status: 'draft' });
  });

  it('carries paragraph identity + content on para blocks', () => {
    const blocks = buildBlocks(story, cur('scene', 0, 0), NONE);
    expect(blocks[1]).toEqual({
      kind: 'para',
      id: 'p-s1-b0',
      sceneId: 's1',
      chapterId: 'ch1',
      blockId: 's1-b0',
      content: 'Mira counted the bells.',
    });
  });

  it('skips the children of a folded chapter but keeps its siblings', () => {
    const blocks = buildBlocks(story, cur('book'), new Set(['ch2']));
    const h2 = blocks.find((b) => b.kind === 'h2' && b.chapterId === 'ch2');
    expect(h2).toMatchObject({ folded: true, childCount: 3 });
    expect(blocks.some((b) => b.kind !== 'h2' && b.chapterId === 'ch2')).toBe(false);
    // Sibling chapters are untouched.
    expect(blocks.filter((b) => b.kind === 'h3' && b.chapterId === 'ch1')).toHaveLength(2);
    expect(blocks.filter((b) => b.kind === 'h3' && b.chapterId === 'ch3')).toHaveLength(2);
  });

  it('skips the paragraphs of a folded scene but keeps its heading', () => {
    const blocks = buildBlocks(story, cur('book'), new Set(['s4']));
    const h3 = blocks.find((b) => b.kind === 'h3' && b.sceneId === 's4');
    expect(h3).toMatchObject({ folded: true, childCount: 3 });
    expect(blocks.some((b) => b.kind === 'para' && b.sceneId === 's4')).toBe(false);
    expect(blocks.some((b) => b.kind === 'para' && b.sceneId === 's3')).toBe(true);
  });

  it('respects scene folds even at scene zoom (prototype parity)', () => {
    const blocks = buildBlocks(story, cur('scene', 1, 1), new Set(['s4']));
    expect(blocks.map((b) => b.kind)).toEqual(['h3']);
  });

  it('orders paragraphs by block `order`, not array position', () => {
    const blocks = buildBlocks(mkShuffledStory(), cur('book'), NONE);
    expect(blocks.map((b) => b.id)).toEqual(buildBlocks(story, cur('book'), NONE).map((b) => b.id));
  });

  it('maps scene statuses onto the H3 dots', () => {
    const dots = buildBlocks(story, cur('book'), NONE)
      .filter((b): b is H3Block => b.kind === 'h3')
      .map((b) => [b.sceneId, b.status] as [string, SceneStatus]);
    expect(dots).toEqual([
      ['s1', 'done'], ['s2', 'done'],
      ['s3', 'done'], ['s4', 'draft'], ['s5', 'todo'],
      ['s6', 'draft'], ['s7', 'todo'],
    ]);
  });
});

// ─── breadcrumbs ─────────────────────────────────────────────────────────────

describe('breadcrumbs', () => {
  const story = mkStory();

  it('shows only the book title at book zoom', () => {
    const trail = breadcrumbs(story, cur('book'));
    expect(trail.map((c) => c.label)).toEqual(['The Last City of Veynn']);
    expect(trail[0].cursor.zoom).toBe('book');
  });

  it('shows only the book title at part zoom (single implicit part)', () => {
    expect(breadcrumbs(story, cur('part')).map((c) => c.label)).toEqual([
      'The Last City of Veynn',
    ]);
  });

  it('adds "Ch. N: title" at chapter zoom', () => {
    const trail = breadcrumbs(story, cur('chapter', 1));
    expect(trail.map((c) => c.label)).toEqual(['The Last City of Veynn', 'Ch. 2: Fractures']);
    expect(trail[1].cursor).toEqual(cur('chapter', 1));
  });

  it('adds the scene title at scene zoom, and crumbs keep the indices', () => {
    const trail = breadcrumbs(story, cur('scene', 1, 2));
    expect(trail.map((c) => c.label)).toEqual([
      'The Last City of Veynn',
      'Ch. 2: Fractures',
      'The Broken Gate',
    ]);
    expect(trail[0].cursor).toEqual(cur('book', 1, 2));
    expect(trail[1].cursor).toEqual(cur('chapter', 1, 2));
    expect(trail[2].cursor).toEqual(cur('scene', 1, 2));
  });

  it('truncates gracefully when the cursor points past the story', () => {
    expect(breadcrumbs(story, cur('scene', 9, 9)).map((c) => c.label)).toEqual([
      'The Last City of Veynn',
    ]);
  });
});
