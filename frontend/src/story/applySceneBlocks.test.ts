/**
 * Shield collision bar: same scene id in two stories must not cross-write.
 * Goes RED if mergeSceneBlocksIntoStories stops scoping by storyId
 * (e.g. `stories.find(s => hasScene(sceneId))` instead of `s.id === storyId`).
 */
import { describe, it, expect } from 'vitest';
import { mergeSceneBlocksIntoStories } from './applySceneBlocks';
import type { Block, Chapter, Scene, Story } from '../types';

const NOW = '2026-09-30T00:00:00.000Z';
const STORY_A = 'story-a';
const STORY_B = 'story-b';
const CH_A = 'ch-a';
const CH_B = 'ch-b';
const SHARED_SCENE = 'shared-scene-id';

function makeScene(storyId: string, chapterId: string, id: string, title: string, content: string): Scene {
  return {
    id,
    title,
    path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
    order: 0,
    chapterId,
    storyId,
    createdAt: NOW,
    updatedAt: NOW,
    blocks: [{ id: `${id}-b0`, type: 'prose', content, order: 0, updatedAt: NOW }],
  };
}

function makeChapter(storyId: string, id: string, title: string, scenes: Scene[]): Chapter {
  return {
    id,
    title,
    path: `stories/${storyId}/chapters/${id}`,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    scenes,
  };
}

function makeStory(id: string, title: string, chapter: Chapter): Story {
  return {
    id,
    title,
    path: `stories/${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    chapters: [chapter],
    parts: [{
      id: `part-${id}`,
      title: '',
      order: 0,
      note: [],
      chapters: [chapter],
      createdAt: NOW,
      updatedAt: NOW,
    }],
  };
}

function sceneContent(stories: Story[], storyId: string, sceneId: string): string {
  const story = stories.find((s) => s.id === storyId)!;
  const scene = story.chapters.flatMap((c) => c.scenes).find((sc) => sc.id === sceneId)!;
  return scene.blocks.map((b) => b.content).join('\n\n');
}

describe('mergeSceneBlocksIntoStories (Shield story-id scoping)', () => {
  it('writes only into the captured storyId when the same scene id exists in two stories', () => {
    // B listed FIRST so a global scene-id find() would pick B and go red.
    const chB = makeChapter(STORY_B, CH_B, 'Chapter B', [
      makeScene(STORY_B, CH_B, SHARED_SCENE, 'Scene B', 'Seed B.'),
    ]);
    const chA = makeChapter(STORY_A, CH_A, 'Chapter A', [
      makeScene(STORY_A, CH_A, SHARED_SCENE, 'Scene A', 'Seed A.'),
    ]);
    const stories = [
      makeStory(STORY_B, 'Story Beta', chB),
      makeStory(STORY_A, 'Story Alpha', chA),
    ];

    const blocks: Block[] = [
      { id: 'b-new', type: 'prose', content: 'Typed in A only.', order: 0, updatedAt: NOW },
    ];
    const result = mergeSceneBlocksIntoStories(
      stories,
      STORY_A,
      CH_A,
      SHARED_SCENE,
      blocks,
      { now: () => NOW },
    );

    expect(result).not.toBeNull();
    expect(sceneContent(result!.stories, STORY_A, SHARED_SCENE)).toContain('Typed in A only.');
    expect(sceneContent(result!.stories, STORY_B, SHARED_SCENE)).toBe('Seed B.');
    expect(result!.stories.find((s) => s.id === STORY_B)).toBe(stories[0]); // B untouched (same ref)
  });

  it('REGRESSION: global scene-id find (no storyId scope) writes the wrong story', () => {
    // Documents Shield's mutation: if lookup becomes
    //   stories.find(s => chaptersIn(s).some(c => c.scenes.some(sc => sc.id === sceneId)))
    // with B listed first, Story B receives the write. This sabotaged copy must
    // disagree with mergeSceneBlocksIntoStories on B's content.
    const chB = makeChapter(STORY_B, CH_B, 'Chapter B', [
      makeScene(STORY_B, CH_B, SHARED_SCENE, 'Scene B', 'Seed B.'),
    ]);
    const chA = makeChapter(STORY_A, CH_A, 'Chapter A', [
      makeScene(STORY_A, CH_A, SHARED_SCENE, 'Scene A', 'Seed A.'),
    ]);
    const stories = [
      makeStory(STORY_B, 'Story Beta', chB),
      makeStory(STORY_A, 'Story Alpha', chA),
    ];
    const blocks: Block[] = [
      { id: 'b-new', type: 'prose', content: 'Typed in A only.', order: 0, updatedAt: NOW },
    ];

    // Sabotaged global lookup (what Shield mutates toward):
    const globalStory = stories.find((s) =>
      s.chapters.some((c) => c.scenes.some((sc) => sc.id === SHARED_SCENE)),
    )!;
    expect(globalStory.id).toBe(STORY_B); // B first → wrong target

    const correct = mergeSceneBlocksIntoStories(
      stories, STORY_A, CH_A, SHARED_SCENE, blocks, { now: () => NOW },
    )!;
    expect(sceneContent(correct.stories, STORY_A, SHARED_SCENE)).toContain('Typed in A only.');
    expect(sceneContent(correct.stories, STORY_B, SHARED_SCENE)).toBe('Seed B.');
  });

  it('H3) stale chapterId hint still finds the scene after a move', () => {
    // After moveScene, a deferred save may still carry the OLD chapterId.
    // Lookup must find sceneId anywhere in the story — not only in chapterIdHint.
    const chA = makeChapter(STORY_A, CH_A, 'Chapter A', []);
    const chB = makeChapter(STORY_A, CH_B, 'Chapter B', [
      makeScene(STORY_A, CH_B, SHARED_SCENE, 'Moved', 'Seed.'),
    ]);
    const story = makeStory(STORY_A, 'Story', chA);
    // Place scene only under CH_B; keep CH_A empty (post-move shape).
    story.chapters = [chA, chB];
    story.parts = [{
      id: 'part-a', title: 'Part', order: 0, note: [], chapters: [chA, chB],
      createdAt: NOW, updatedAt: NOW,
    }];
    const blocks: Block[] = [
      { id: 'b', type: 'prose', content: 'After move text.', order: 0, updatedAt: NOW },
    ];
    // Stale hint = CH_A (where the scene used to live).
    const result = mergeSceneBlocksIntoStories(
      [story], STORY_A, CH_A, SHARED_SCENE, blocks, { now: () => NOW },
    );
    expect(result).not.toBeNull();
    expect(result!.targetChapterId).toBe(CH_B);
    expect(sceneContent(result!.stories, STORY_A, SHARED_SCENE)).toContain('After move text.');
  });
});
