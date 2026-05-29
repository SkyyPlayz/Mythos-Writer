import { create } from 'zustand';
import type { Story, Scene, Chapter, EntityEntry } from '../types';

export interface VaultState {
  stories: Story[];
  activeStoryId: string | null;
  activeChapterId: string | null;
  activeSceneId: string | null;
  activeEntityId: string | null;
  /** Full entity object — kept in sync with activeEntityId. */
  activeEntity: EntityEntry | null;
  setStories: (stories: Story[]) => void;
  setActiveScene: (storyId: string | null, chapterId: string | null, sceneId: string | null) => void;
  setActiveEntity: (entity: EntityEntry | null) => void;
  clearSelection: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  stories: [],
  activeStoryId: null,
  activeChapterId: null,
  activeSceneId: null,
  activeEntityId: null,
  activeEntity: null,
  setStories: (stories) => set({ stories }),
  setActiveScene: (storyId, chapterId, sceneId) =>
    set({ activeStoryId: storyId, activeChapterId: chapterId, activeSceneId: sceneId, activeEntityId: null, activeEntity: null }),
  setActiveEntity: (entity) =>
    set({ activeEntity: entity, activeEntityId: entity?.id ?? null, activeStoryId: null, activeChapterId: null, activeSceneId: null }),
  clearSelection: () =>
    set({ activeStoryId: null, activeChapterId: null, activeSceneId: null, activeEntityId: null, activeEntity: null }),
}));

export function selectActiveStory(state: VaultState): Story | null {
  return state.stories.find((s) => s.id === state.activeStoryId) ?? null;
}

export function selectActiveChapter(state: VaultState): Chapter | null {
  const story = state.stories.find((s) => s.id === state.activeStoryId);
  if (!story) return null;
  return story.chapters.find((c) => c.id === state.activeChapterId) ?? null;
}

export function selectActiveScene(state: VaultState): Scene | null {
  const story = state.stories.find((s) => s.id === state.activeStoryId);
  if (!story) return null;
  const chapter = story.chapters.find((c) => c.id === state.activeChapterId);
  if (!chapter) return null;
  return chapter.scenes.find((s) => s.id === state.activeSceneId) ?? null;
}
