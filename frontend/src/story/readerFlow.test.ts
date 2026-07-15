// Beta 3 M13 / Beta 4 M11 — reader flow model unit tests (prototype buildFlow,
// fromCursor + readerScene semantics; M11 sentence splitting + ±10s skips).

import { describe, it, expect } from 'vitest';
import type { Block, Chapter, Scene, Story } from '../types';
import type { ManuscriptCursor } from './manuscriptModel';
import {
  buildReaderFlow,
  flowScopeKey,
  flowStartIndex,
  sceneSkipIndex,
  splitSentences,
  timeSkipIndex,
  type ReaderFlowItem,
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

  it('M11: multi-sentence paragraphs emit one item per sentence with offsets', () => {
    const story = mkStory();
    const text = 'Mira counted the bells. The lantern trembled!';
    story.chapters[0].scenes[0].blocks[0] = mkBlock('s1-b0', text, 0);
    const flow = buildReaderFlow(story, at('scene', 0, 0));
    const items = flow.filter((f) => f.key === 's1-b0');
    expect(items.map((f) => f.text)).toEqual([
      'Mira counted the bells.',
      'The lantern trembled!',
    ]);
    // Offsets index the block's content exactly (the highlight contract).
    for (const item of items) {
      expect(text.slice(item.start, item.end)).toBe(item.text);
    }
    // Sentences of one paragraph share the block key + scene ordinal.
    expect(new Set(items.map((f) => f.sceneOrdinal)).size).toBe(1);
  });

  it('M11: headings carry an empty offset range', () => {
    const flow = buildReaderFlow(mkStory(), at('book'));
    expect(flow[0].key).toBeNull();
    expect(flow[0].start).toBe(0);
    expect(flow[0].end).toBe(0);
  });
});

describe('splitSentences (M11)', () => {
  it('splits on terminators and keeps exact source offsets', () => {
    const text = 'One here. Two there! Three?';
    const spans = splitSentences(text);
    expect(spans.map((s) => s.text)).toEqual(['One here.', 'Two there!', 'Three?']);
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it('treats terminator runs and attached closing quotes as one boundary', () => {
    const spans = splitSentences('“Run!” she said. Then silence…');
    expect(spans.map((s) => s.text)).toEqual(['“Run!”', 'she said.', 'Then silence…']);
  });

  it('does not split after initials or common abbreviations', () => {
    expect(splitSentences('Mr. Thorne waited. J. K. spoke.').map((s) => s.text)).toEqual([
      'Mr. Thorne waited.',
      'J. K. spoke.',
    ]);
  });

  it('returns the whole text as one span when there is no terminator', () => {
    const spans = splitSentences('  a fragment without an end  ');
    expect(spans).toEqual([
      { text: 'a fragment without an end', start: 2, end: 27 },
    ]);
  });

  it('returns no spans for empty/whitespace text', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('never splits mid-word on decimal points', () => {
    expect(splitSentences('It was 3.5 meters tall. Nobody moved.').map((s) => s.text)).toEqual([
      'It was 3.5 meters tall.',
      'Nobody moved.',
    ]);
  });
});

describe('timeSkipIndex (M11 ±10s)', () => {
  // 16 words ≈ 5s at the 3.2 words/s pacing estimate.
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const mkFlow = (texts: string[]): ReaderFlowItem[] =>
    texts.map((text, i) => ({
      text,
      key: `b${i}`,
      sceneId: 's',
      sceneOrdinal: 0,
      start: 0,
      end: text.length,
    }));

  it('walks forward until ~10s of estimated speech is covered', () => {
    const flow = mkFlow([words(16), words(16), words(16), words(16)]);
    // 16 + 16 words = 10s → lands two items ahead.
    expect(timeSkipIndex(flow, 0, 1, 10, 1)).toBe(2);
  });

  it('walks backward symmetrically', () => {
    const flow = mkFlow([words(16), words(16), words(16), words(16)]);
    expect(timeSkipIndex(flow, 3, -1, 10, 1)).toBe(1);
  });

  it('scales with the playback rate', () => {
    const flow = mkFlow([words(16), words(16), words(16), words(16)]);
    // At 2× speed each item is ~2.5s → four items ≈ 10s, clamped to the end.
    expect(timeSkipIndex(flow, 0, 1, 10, 2)).toBe(3);
  });

  it('always moves at least one item when not at an edge', () => {
    const flow = mkFlow([words(200), words(200)]);
    expect(timeSkipIndex(flow, 0, 1, 10, 1)).toBe(1);
    expect(timeSkipIndex(flow, 1, -1, 10, 1)).toBe(0);
  });

  it('clamps at the flow edges and handles empty flows', () => {
    const flow = mkFlow([words(4), words(4)]);
    expect(timeSkipIndex(flow, 0, -1, 10, 1)).toBe(0);
    expect(timeSkipIndex(flow, 1, 1, 10, 1)).toBe(1);
    expect(timeSkipIndex([], 0, 1, 10, 1)).toBe(-1);
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
