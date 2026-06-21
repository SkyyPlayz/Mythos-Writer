import type { Scene, Chapter, Story } from './types';
import type { ViewDepth } from './DepthSlider';

export interface StepSceneContext {
  direction: 'prev' | 'next';
  depth: ViewDepth;
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
  stories: Story[];
}

export interface StepSceneTarget {
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story;
}

export interface StepSceneState {
  canPrev: boolean;
  canNext: boolean;
  contextLabel: string;
}

function sortedBy<T extends { order: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.order - b.order);
}

function flatScenes(story: Story): Array<{ scene: Scene; chapter: Chapter }> {
  const result: Array<{ scene: Scene; chapter: Chapter }> = [];
  for (const ch of sortedBy(story.chapters)) {
    for (const sc of sortedBy(ch.scenes)) {
      result.push({ scene: sc, chapter: ch });
    }
  }
  return result;
}

/**
 * Pure step function — given current selection and direction, returns the next
 * selection target, or null when already at a boundary.
 *
 * At depth='scene', steps across chapter boundaries (cross-chapter wrap).
 * At depth='chapter', steps across chapters within the story.
 * At depth='book', steps across stories.
 */
export function stepScene(ctx: StepSceneContext): StepSceneTarget | null {
  const { direction, depth, selectedScene, selectedChapter, selectedStory, stories } = ctx;
  if (!selectedStory) return null;
  const delta = direction === 'prev' ? -1 : 1;

  if (depth === 'scene') {
    if (!selectedScene) return null;
    const flat = flatScenes(selectedStory);
    const idx = flat.findIndex((e) => e.scene.id === selectedScene.id);
    if (idx < 0) return null;
    const entry = flat[idx + delta];
    if (!entry) return null;
    return { scene: entry.scene, chapter: entry.chapter, story: selectedStory };
  }

  if (depth === 'chapter') {
    if (!selectedChapter) return null;
    const sorted = sortedBy(selectedStory.chapters);
    const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
    if (idx < 0) return null;
    const chapter = sorted[idx + delta];
    if (!chapter) return null;
    const scene = sortedBy(chapter.scenes)[0] ?? null;
    return { scene, chapter, story: selectedStory };
  }

  // depth === 'book'
  const sorted = sortedBy(stories);
  const idx = sorted.findIndex((s) => s.id === selectedStory.id);
  if (idx < 0) return null;
  const story = sorted[idx + delta];
  if (!story) return null;
  const firstCh = sortedBy(story.chapters)[0] ?? null;
  const scene = firstCh ? sortedBy(firstCh.scenes)[0] ?? null : null;
  return { scene, chapter: firstCh, story };
}

/**
 * Derive canPrev / canNext / contextLabel from the current selection state.
 * Pure — no side effects.
 */
export function computeStepState(
  depth: ViewDepth,
  selectedScene: Scene | null,
  selectedChapter: Chapter | null,
  selectedStory: Story | null,
  stories: Story[],
): StepSceneState {
  if (!selectedStory) return { canPrev: false, canNext: false, contextLabel: '' };

  if (depth === 'scene') {
    if (!selectedScene) {
      return { canPrev: false, canNext: false, contextLabel: selectedChapter?.title ?? '' };
    }
    const flat = flatScenes(selectedStory);
    const idx = flat.findIndex((e) => e.scene.id === selectedScene.id);
    const ch = idx >= 0 ? flat[idx].chapter : selectedChapter;
    return {
      canPrev: idx > 0,
      canNext: idx >= 0 && idx < flat.length - 1,
      contextLabel: ch ? `${ch.title} › ${selectedScene.title}` : selectedScene.title,
    };
  }

  if (depth === 'chapter') {
    if (!selectedChapter) {
      return { canPrev: false, canNext: false, contextLabel: selectedStory.title };
    }
    const sorted = sortedBy(selectedStory.chapters);
    const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
    return {
      canPrev: idx > 0,
      canNext: idx >= 0 && idx < sorted.length - 1,
      contextLabel: `${selectedStory.title} › ${selectedChapter.title}`,
    };
  }

  // depth === 'book'
  const sorted = sortedBy(stories);
  const idx = sorted.findIndex((s) => s.id === selectedStory.id);
  return {
    canPrev: idx > 0,
    canNext: idx >= 0 && idx < sorted.length - 1,
    contextLabel: selectedStory.title,
  };
}
