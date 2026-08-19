// Beta 3 M11 — pure anchoring model: segmentation (prototype segsFor
// 3601–3615), owning-scene lookup (addCommentFromSel 3621–3629), document
// ordering, and anchor clipping.

import { describe, it, expect } from 'vitest';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import { clipAnchor, findAnchorSceneId, orderCommentsByDocument, segmentsFor } from './model';
import type { StoryComment } from './types';

const NOW = '2026-07-07T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, order: number, paras: string[], draftState?: DraftState): Scene {
  return {
    id,
    title: id,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    draftState,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, order: number, scenes: Scene[]): Chapter {
  return { id, title: id, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'Test',
    path: 'stories/story-1',
    chapters: [
      // Deliberately out-of-order arrays — the model must sort by `order`.
      mkChapter('ch2', 1, [mkScene('s3', 0, ['Kael dealt cards slowly, watching the door.'])]),
      mkChapter('ch1', 0, [
        mkScene('s2', 1, ['By morning the rumor had teeth.']),
        mkScene('s1', 0, [
          'Mira counted the bells. The lantern cast a trembling circle of light.',
          'Getting out would be another story.',
        ]),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkComment(id: string, sceneId: string, anchor: string, over: Partial<StoryComment> = {}): StoryComment {
  return {
    id,
    storyId: 'story-1',
    sceneId,
    anchor,
    author: 'You',
    kind: 'user',
    text: `text-${id}`,
    createdAt: NOW,
    ...over,
  };
}

describe('segmentsFor', () => {
  const text = 'Mira counted the bells. The lantern cast a trembling circle of light.';

  it('returns null when no anchor matches', () => {
    expect(segmentsFor(text, [mkComment('c1', 's1', 'not present')])).toBeNull();
    expect(segmentsFor(text, [])).toBeNull();
  });

  it('splits around a single anchor', () => {
    const segs = segmentsFor(text, [mkComment('c1', 's1', 'lantern cast')]);
    expect(segs).toEqual([
      { text: 'Mira counted the bells. The ' },
      { text: 'lantern cast', comment: { id: 'c1', kind: 'user' } },
      { text: ' a trembling circle of light.' },
    ]);
  });

  it('handles anchors at the very start and end', () => {
    const segs = segmentsFor(text, [
      mkComment('c1', 's1', 'Mira'),
      mkComment('c2', 's1', 'circle of light.', { kind: 'archive' }),
    ]);
    expect(segs?.[0]).toEqual({ text: 'Mira', comment: { id: 'c1', kind: 'user' } });
    expect(segs?.at(-1)).toEqual({
      text: 'circle of light.',
      comment: { id: 'c2', kind: 'archive' },
    });
  });

  it('orders multiple anchors by offset and keeps the earliest on overlap', () => {
    const segs = segmentsFor(text, [
      mkComment('late', 's1', 'trembling circle'),
      mkComment('early', 's1', 'The lantern cast a trembling'),
    ]);
    const marked = segs?.filter((s) => s.comment).map((s) => s.comment?.id);
    expect(marked).toEqual(['early']); // 'late' overlaps the first anchor — skipped
  });

  it('rejoins to the original text (contentEditable textContent stays intact)', () => {
    const segs = segmentsFor(text, [
      mkComment('c1', 's1', 'bells'),
      mkComment('c2', 's1', 'light.'),
    ]);
    expect(segs?.map((s) => s.text).join('')).toBe(text);
  });
});

describe('findAnchorSceneId', () => {
  const story = mkStory();

  it('finds the owning scene in document order', () => {
    expect(findAnchorSceneId(story, 'trembling circle of light')).toBe('s1');
    expect(findAnchorSceneId(story, 'rumor had teeth')).toBe('s2');
    expect(findAnchorSceneId(story, 'watching the door')).toBe('s3');
  });

  it('returns null for unknown or empty anchors', () => {
    expect(findAnchorSceneId(story, 'never written')).toBeNull();
    expect(findAnchorSceneId(story, '')).toBeNull();
  });

  it('returns the FIRST scene when the anchor appears in several', () => {
    expect(findAnchorSceneId(story, 'the')).toBe('s1');
  });
});

describe('orderCommentsByDocument', () => {
  const story = mkStory();

  it('sorts by scene document order, then anchor offset within the scene', () => {
    const ordered = orderCommentsByDocument(story, [
      mkComment('kael', 's3', 'Kael dealt'),
      mkComment('story-end', 's1', 'Getting out would be another story.'),
      mkComment('bells', 's1', 'counted the bells'),
      mkComment('rumor', 's2', 'rumor'),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['bells', 'story-end', 'rumor', 'kael']);
  });

  it('keeps comments with unknown scenes or lost anchors, sorted last in creation order', () => {
    const ordered = orderCommentsByDocument(story, [
      mkComment('ghost-scene', 'deleted-scene', 'anything'),
      mkComment('bells', 's1', 'counted the bells'),
      mkComment('lost-anchor', 's1', 'text edited away'),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['bells', 'lost-anchor', 'ghost-scene']);
    expect(ordered).toHaveLength(3);
  });

  it('does not mutate the input', () => {
    const input = [mkComment('b', 's2', 'rumor'), mkComment('a', 's1', 'Mira')];
    const copy = [...input];
    orderCommentsByDocument(story, input);
    expect(input).toEqual(copy);
  });
});

describe('clipAnchor', () => {
  it('clips long anchors with an ellipsis (prototype 34/60-char clips)', () => {
    const long = 'a'.repeat(40);
    expect(clipAnchor(long, 34)).toBe(`${'a'.repeat(34)}…`);
    expect(clipAnchor('short', 34)).toBe('short');
  });
});
