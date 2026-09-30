/**
 * Pure late-save merge for editor block flushes (F1#9 / Shield / Critic H3).
 *
 * ALWAYS resolves the target story by `storyId` first, then looks up `sceneId`
 * only inside that story. A global scene-id search would let a deferred save
 * from Story A corrupt Story B when both happen to share a scene id.
 */
import type { Block, Chapter, Scene, Story } from '../types';
import { updateChapterOwner } from './storyParts';

export interface MergeSceneBlocksResult {
  stories: Story[];
  updatedScene: Scene;
  targetChapterId: string;
}

export interface MergeSceneBlocksOptions {
  /** Provisional empty-title scene being created by the flush. */
  isProvisional?: boolean;
  now?: () => string;
}

function chaptersInStory(story: Story): Chapter[] {
  const all = [
    ...story.chapters,
    ...(story.parts ?? []).flatMap((p) => p.chapters),
  ];
  const byId = new Map<string, Chapter>();
  for (const ch of all) byId.set(ch.id, ch);
  return [...byId.values()];
}

/**
 * Apply `blocks` onto `sceneId` inside the story identified by `storyId`.
 * Returns null when the target story/scene is gone (Shield: drop the save).
 */
export function mergeSceneBlocksIntoStories(
  stories: Story[],
  storyId: string,
  chapterIdHint: string,
  sceneId: string,
  blocks: Block[],
  options: MergeSceneBlocksOptions = {},
): MergeSceneBlocksResult | null {
  const stamp = options.now ?? (() => new Date().toISOString());
  const isProvisional = options.isProvisional === true;

  // Shield: story scoping — never search other stories for sceneId.
  const story = stories.find((s) => s.id === storyId);
  if (!story) return null;

  const chapterList = chaptersInStory(story);
  let chapter = chapterList.find((c) => c.scenes.some((sc) => sc.id === sceneId));
  if (!chapter && isProvisional) {
    chapter = chapterList.find((c) => c.id === chapterIdHint);
  }
  if (!chapter) return null;

  const targetChapterId = chapter.id;
  const existing = chapter.scenes.find((sc) => sc.id === sceneId);
  if (!existing && !isProvisional) return null;

  const base = existing ?? {
    id: sceneId,
    title: '',
    path: `stories/${storyId}/chapters/${targetChapterId}/scenes/${sceneId}.md`,
    order: chapter.scenes.length,
    chapterId: targetChapterId,
    storyId,
    blocks: [],
    createdAt: stamp(),
    updatedAt: stamp(),
  };
  const updatedScene: Scene = { ...base, blocks, updatedAt: stamp() };
  const content = blocks.map((b) => b.content).join('\n\n');
  if (isProvisional && !content.trim()) return null;

  const nextStories = stories.map((s) =>
    s.id !== storyId
      ? s
      : updateChapterOwner(s, targetChapterId, (chapters) =>
          chapters.map((ch) =>
            ch.id !== targetChapterId
              ? ch
              : {
                  ...ch,
                  scenes: isProvisional
                    ? [...ch.scenes, updatedScene]
                    : ch.scenes.map((sc) => (sc.id !== sceneId ? sc : updatedScene)),
                },
          ),
        ),
  );

  return { stories: nextStories, updatedScene, targetChapterId };
}
