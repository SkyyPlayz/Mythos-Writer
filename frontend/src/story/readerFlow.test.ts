// Beta 3 M13 — reader flow model unit tests (prototype buildFlow 3633–3656,
// fromCursor 3681–3684, readerScene 3697–3702 semantics).

import { describe, it, expect } from 'vitest';
import type { Block, Chapter, Scene, Story } from '../types';
import type { ManuscriptCursor } from './manuscriptModel';
import {
  buildReaderFlow,
  flowScopeKey,
  flowStartIndex,
  sceneSkipIndex,
} from './readerFlow';

const NOW = '2026-07-07T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, title: string, order: number, paras: string[]): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [
      mkChapter('ch1', 'The Quiet Before', 0, [
        mkScene('s1', "The Watcher's Call", 0, ['First para.', 'Second para.']),
        mkScene('s2', 'A City in Shadows', 1, ['Third para.']),
      ]),
      mkChapter('ch2', 'Embers', 1, [mkScene('s3', 'Ash Falls', 0, ['Fourth para.'])]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const at = (zoom: ManuscriptCursor['zoom'], chapter = 0, scene = 0): ManuscriptCursor => ({
  zoom,
  part: 0,
  chapter,
  scene,
});

describe('buildReaderFlow', () => {
  it('book zoom linearizes every chapter with prototype heading rules', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(flow.map((f) => f.text)).toEqual([
      "Chapter 1. The Quiet Before. The Watcher's Call.",
      'First para.',
      'Second para.',
      'A City in Shadows.', // later sibling — scene title only
      'Third para.',
      'Chapter 2. Embers. Ash Falls.',
      'Fourth para.',
    ]);
  });

  it('paragraph items carry the Block id as the highlight key; headings carry null', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(flow[0].key).toBeNull();
    expect(flow[1].key).toBe('s1-b0');
    expect(flow[2].key).toBe('s1-b1');
    expect(flow[3].key).toBeNull();
    expect(flow[4].key).toBe('s2-b0');
  });

  it('assigns global scene ordinals across chapters', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(flow.map((f) => f.sceneOrdinal)).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });

  it('chapter zoom scopes to the cursor chapter', () => {
    const flow = buildReaderFlow(mkStory(), at('chapter', 1));
    expect(flow.map((f) => f.text)).toEqual(['Chapter 2. Embers. Ash Falls.', 'Fourth para.']);
    // Ordinals stay global so ±scene skips line up with the full manuscript.
    expect(flow[0].sceneOrdinal).toBe(2);
  });

  it('scene zoom scopes to the single cursor scene with a full heading', () => {
    const flow = buildReaderFlow(mkStory(), at('scene', 0, 1));
    expect(flow.map((f) => f.text)).toEqual([
      'Chapter 1. The Quiet Before. A City in Shadows.',
      'Third para.',
    ]);
  });

  it('skips empty/whitespace paragraphs', () => {
    const story = mkStory();
    story.chapters[0].scenes[0].blocks.push(mkBlock('s1-b2', '   ', 2));
    const flow = buildReaderFlow(story, at('book'));
    expect(flow.some((f) => f.key === 's1-b2')).toBe(false);
  });
});

describe('flowStartIndex (from cursor)', () => {
  it('targets the first paragraph of the cursor scene', () => {
    const story = mkStory();
    const flow = buildReaderFlow(story, at('book'));
    expect(flowStartIndex(flow, story, at('book', 0, 1))).toBe(4); // 'Third para.'
    expect(flowStartIndex(flow, story, at('book', 1, 0))).toBe(6); // 'Fourth para.'
  });

  it('falls back to the scene heading when the scene has no paragraphs', () => {
    const story = mkStory();
    story.chapters[1].scenes[0].blocks = [];
    const flow = buildReaderFlow(story, at('book'));
    expect(flowStartIndex(flow, story, at('book', 1, 0))).toBe(
      flow.findIndex((f) => f.sceneId === 's3')
    );
  });

  it('falls back to 0 for an out-of-range cursor', () => {
    const story = mkStory();
    const flow = buildReaderFlow(story, at('book'));
    expect(flowStartIndex(flow, story, at('book', 9, 9))).toBe(0);
  });
});

describe('sceneSkipIndex', () => {
  it('jumps to the first item of the adjacent scene ordinal', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(sceneSkipIndex(flow, 1, 1)).toBe(3); // ord 0 → ord 1 heading
    expect(sceneSkipIndex(flow, 4, -1)).toBe(0); // ord 1 → ord 0 heading
    expect(sceneSkipIndex(flow, 4, 1)).toBe(5); // ord 1 → ord 2 heading
  });

  it('falls back to a one-utterance skip at the edges', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(sceneSkipIndex(flow, 0, -1)).toBe(0); // clamped
    expect(sceneSkipIndex(flow, flow.length - 1, 1)).toBe(flow.length - 1);
  });

  it('returns -1 for an empty flow', () => {
    expect(sceneSkipIndex([], 0, 1)).toBe(-1);
  });
});

describe('flowScopeKey', () => {
  it('book/part flows ignore chapter/scene cursor moves', () => {
    const story = mkStory();
    expect(flowScopeKey(story, at('book', 0, 0))).toBe(flowScopeKey(story, at('book', 1, 0)));
    expect(flowScopeKey(story, at('part', 0, 0))).toBe(flowScopeKey(story, at('part', 0, 1)));
  });

  it('chapter/scene flows invalidate on their own axis', () => {
    const story = mkStory();
    expect(flowScopeKey(story, at('chapter', 0))).not.toBe(flowScopeKey(story, at('chapter', 1)));
    expect(flowScopeKey(story, at('scene', 0, 0))).not.toBe(flowScopeKey(story, at('scene', 0, 1)));
    expect(flowScopeKey(story, at('book'))).not.toBe(flowScopeKey(story, at('chapter', 0)));
  });
});
