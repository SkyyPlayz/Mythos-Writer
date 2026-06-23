import { describe, it, expect } from 'vitest';
import { stepScene, computeStepState } from './stepScene';
import type { Story, Chapter, Scene } from './types';

function makeScene(id: string, order: number): Scene {
  return { id, title: `Scene ${id}`, path: `/scenes/${id}.md`, order, blocks: [], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
}
function makeChapter(id: string, order: number, scenes: Scene[]): Chapter {
  return { id, title: `Chapter ${id}`, path: `/chapters/${id}`, order, scenes, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
}
function makeStory(id: string, chapters: Chapter[]): Story {
  return { id, title: `Story ${id}`, path: `/stories/${id}`, chapters, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
}

const sc1 = makeScene('sc1', 1), sc2 = makeScene('sc2', 2), sc3 = makeScene('sc3', 1), sc4 = makeScene('sc4', 2);
const ch1 = makeChapter('ch1', 1, [sc1, sc2]), ch2 = makeChapter('ch2', 2, [sc3, sc4]);
const story1 = makeStory('s1', [ch1, ch2]);
const sc5 = makeScene('sc5', 1), ch3 = makeChapter('ch3', 1, [sc5]);
const story2 = makeStory('s2', [ch3]);
const stories = [story1, story2];

describe('stepScene — depth=scene', () => {
  it('steps to next scene within same chapter', () => {
    const r = stepScene({ direction: 'next', depth: 'scene', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories });
    expect(r?.scene?.id).toBe('sc2');
    expect(r?.chapter?.id).toBe('ch1');
  });
  it('steps to prev scene within same chapter', () => {
    const r = stepScene({ direction: 'prev', depth: 'scene', selectedScene: sc2, selectedChapter: ch1, selectedStory: story1, stories });
    expect(r?.scene?.id).toBe('sc1');
  });
  it('wraps forward across chapter boundary', () => {
    const r = stepScene({ direction: 'next', depth: 'scene', selectedScene: sc2, selectedChapter: ch1, selectedStory: story1, stories });
    expect(r?.scene?.id).toBe('sc3');
    expect(r?.chapter?.id).toBe('ch2');
  });
  it('wraps backward across chapter boundary', () => {
    const r = stepScene({ direction: 'prev', depth: 'scene', selectedScene: sc3, selectedChapter: ch2, selectedStory: story1, stories });
    expect(r?.scene?.id).toBe('sc2');
    expect(r?.chapter?.id).toBe('ch1');
  });
  it('returns null at start of first chapter going prev', () => {
    expect(stepScene({ direction: 'prev', depth: 'scene', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories })).toBeNull();
  });
  it('returns null at end of last chapter going next', () => {
    expect(stepScene({ direction: 'next', depth: 'scene', selectedScene: sc4, selectedChapter: ch2, selectedStory: story1, stories })).toBeNull();
  });
  it('returns null when no scene selected', () => {
    expect(stepScene({ direction: 'next', depth: 'scene', selectedScene: null, selectedChapter: ch1, selectedStory: story1, stories })).toBeNull();
  });
  it('respects order field not array position', () => {
    const scA = makeScene('a', 2), scB = makeScene('b', 1);
    const ch = makeChapter('cx', 1, [scA, scB]);
    const st = makeStory('sx', [ch]);
    const r = stepScene({ direction: 'next', depth: 'scene', selectedScene: scB, selectedChapter: ch, selectedStory: st, stories: [st] });
    expect(r?.scene?.id).toBe('a');
  });
});

describe('stepScene — depth=chapter', () => {
  it('steps to next chapter', () => {
    const r = stepScene({ direction: 'next', depth: 'chapter', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories });
    expect(r?.chapter?.id).toBe('ch2');
    expect(r?.scene?.id).toBe('sc3');
  });
  it('steps to prev chapter', () => {
    const r = stepScene({ direction: 'prev', depth: 'chapter', selectedScene: sc3, selectedChapter: ch2, selectedStory: story1, stories });
    expect(r?.chapter?.id).toBe('ch1');
    expect(r?.scene?.id).toBe('sc1');
  });
  it('returns null at last chapter going next', () => {
    expect(stepScene({ direction: 'next', depth: 'chapter', selectedScene: sc3, selectedChapter: ch2, selectedStory: story1, stories })).toBeNull();
  });
  it('returns null at first chapter going prev', () => {
    expect(stepScene({ direction: 'prev', depth: 'chapter', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories })).toBeNull();
  });
  it('returns scene=null when next chapter has no scenes', () => {
    const chEmpty = makeChapter('empty', 2, []);
    const stWithEmpty = makeStory('se', [ch1, chEmpty]);
    const r = stepScene({ direction: 'next', depth: 'chapter', selectedScene: sc1, selectedChapter: ch1, selectedStory: stWithEmpty, stories: [stWithEmpty] });
    expect(r?.chapter?.id).toBe('empty');
    expect(r?.scene).toBeNull();
  });
});

describe('stepScene — depth=book', () => {
  it('steps to next story', () => {
    const r = stepScene({ direction: 'next', depth: 'book', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories });
    expect(r?.story?.id).toBe('s2');
    expect(r?.scene?.id).toBe('sc5');
  });
  it('steps to prev story', () => {
    const r = stepScene({ direction: 'prev', depth: 'book', selectedScene: sc5, selectedChapter: ch3, selectedStory: story2, stories });
    expect(r?.story?.id).toBe('s1');
  });
  it('returns null at last story going next', () => {
    expect(stepScene({ direction: 'next', depth: 'book', selectedScene: sc5, selectedChapter: ch3, selectedStory: story2, stories })).toBeNull();
  });
  it('returns null at first story going prev', () => {
    expect(stepScene({ direction: 'prev', depth: 'book', selectedScene: sc1, selectedChapter: ch1, selectedStory: story1, stories })).toBeNull();
  });
  it('returns null when no story selected', () => {
    expect(stepScene({ direction: 'next', depth: 'book', selectedScene: null, selectedChapter: null, selectedStory: null, stories })).toBeNull();
  });
});

describe('computeStepState', () => {
  it('scene depth — middle scene (cross-chapter): canPrev=true canNext=true', () => {
    const s = computeStepState('scene', sc2, ch1, story1, stories);
    expect(s.canPrev).toBe(true);
    expect(s.canNext).toBe(true);
    expect(s.contextLabel).toContain('Scene sc2');
  });
  it('scene depth — first scene across book: canPrev=false', () => {
    const s = computeStepState('scene', sc1, ch1, story1, stories);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(true);
  });
  it('scene depth — last scene across book: canNext=false', () => {
    const s = computeStepState('scene', sc4, ch2, story1, stories);
    expect(s.canPrev).toBe(true);
    expect(s.canNext).toBe(false);
  });
  it('scene depth — cross-chapter middle: sc3 canPrev=true (sc2 in prev chapter)', () => {
    const s = computeStepState('scene', sc3, ch2, story1, stories);
    expect(s.canPrev).toBe(true);
  });
  it('chapter depth — first chapter: canPrev=false, contextLabel correct', () => {
    const s = computeStepState('chapter', sc1, ch1, story1, stories);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(true);
    expect(s.contextLabel).toBe('Story s1 › Chapter ch1');
  });
  it('chapter depth — last chapter: canNext=false', () => {
    const s = computeStepState('chapter', sc3, ch2, story1, stories);
    expect(s.canNext).toBe(false);
    expect(s.canPrev).toBe(true);
  });
  it('book depth — first story: canPrev=false', () => {
    const s = computeStepState('book', sc1, ch1, story1, stories);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(true);
    expect(s.contextLabel).toBe('Story s1');
  });
  it('book depth — last story: canNext=false', () => {
    const s = computeStepState('book', sc5, ch3, story2, stories);
    expect(s.canNext).toBe(false);
    expect(s.canPrev).toBe(true);
  });
  it('returns all-false when no story selected', () => {
    const s = computeStepState('scene', null, null, null, stories);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(false);
    expect(s.contextLabel).toBe('');
  });
});
