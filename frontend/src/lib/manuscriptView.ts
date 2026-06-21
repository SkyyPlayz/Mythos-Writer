// Pure selector: {manifest, selection, depth} → ordered render bands
// SKY-3210 — Part C · C1 — Heading-driven view model

import type { Manifest, Chapter, Scene, DraftState } from '../types';

// ─── Re-export so callers share one import ──────────────────────────────────
export type { ViewDepth } from '../DepthSlider';

// ─── Public types ────────────────────────────────────────────────────────────

export interface SelectionState {
  storyId: string | null;
  chapterId: string | null;
  sceneId: string | null;
}

/** Chapter heading render band — always H1 per spec (Chapter → H1) */
export interface ChapterHeadingBand {
  kind: 'chapter-heading';
  chapterId: string;
  title: string;
  headingLevel: 'h1';
  order: number;
}

/** Scene render band — always H2 per spec (Scene → H2) */
export interface SceneBand {
  kind: 'scene';
  sceneId: string;
  chapterId: string;
  storyId: string;
  title: string;
  headingLevel: 'h2';
  order: number;
  draftState: DraftState | undefined;
}

export type RenderBand = ChapterHeadingBand | SceneBand;

export interface ManuscriptViewInput {
  manifest: Manifest;
  selection: SelectionState;
  /** Depth level: 'book' = full story, 'chapter' = selected chapter, 'scene' = selected scene */
  depth: 'book' | 'chapter' | 'scene';
}

export interface ManuscriptViewResult {
  bands: RenderBand[];
  /** All scene IDs in chapter/scene order across the whole story (for step navigation) */
  orderedSceneIds: string[];
  /** Index of current scene in orderedSceneIds; -1 when depth !== 'scene' or scene not found */
  selectedSceneIndex: number;
  /**
   * canPrev / canNext implement the edge-arrow wrap rule:
   * true whenever orderedSceneIds.length > 1 (wraps at ends).
   * Only meaningful at depth='scene'.
   */
  canPrev: boolean;
  canNext: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortedScenes(chapter: Chapter): Scene[] {
  return [...chapter.scenes].sort((a, b) => a.order - b.order);
}

function sortedChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.order - b.order);
}

function toSceneBand(scene: Scene, chapter: Chapter, storyId: string): SceneBand {
  return {
    kind: 'scene',
    sceneId: scene.id,
    chapterId: chapter.id,
    storyId,
    title: scene.title,
    headingLevel: 'h2',
    order: scene.order,
    draftState: scene.draftState,
  };
}

function toChapterHeadingBand(chapter: Chapter): ChapterHeadingBand {
  return {
    kind: 'chapter-heading',
    chapterId: chapter.id,
    title: chapter.title,
    headingLevel: 'h1',
    order: chapter.order,
  };
}

// ─── Main selector ───────────────────────────────────────────────────────────

/**
 * Pure projection: manifest × selection × depth → render bands.
 *
 * Folder/file manifest is the structural source of truth. The selector reads
 * manifest.stories[].chapters[].scenes[] and emits bands in order.
 *
 * Depth levels:
 *   book    — H1 chapter heading + H2 scene for every chapter in the story
 *   chapter — H1 chapter heading + H2 scenes for the selected chapter only
 *   scene   — single H2 scene band for the selected scene
 *
 * Cross-chapter step rule: orderedSceneIds is a flat, story-wide scene list.
 * Stepping past the last scene in a chapter automatically enters the next
 * chapter. Edge-arrow wrap: canPrev/canNext are true whenever there are ≥2
 * scenes (navigation wraps from last → first and first → last).
 */
export function selectManuscriptView(input: ManuscriptViewInput): ManuscriptViewResult {
  const { manifest, selection, depth } = input;

  const EMPTY: ManuscriptViewResult = {
    bands: [],
    orderedSceneIds: [],
    selectedSceneIndex: -1,
    canPrev: false,
    canNext: false,
  };

  const story =
    (selection.storyId
      ? manifest.stories.find((s) => s.id === selection.storyId)
      : manifest.stories[0]) ?? null;

  if (!story) return EMPTY;

  const chapters = sortedChapters(story.chapters);

  // Flat ordered scene list for the whole story (used for step navigation)
  const orderedSceneIds: string[] = chapters.flatMap((ch) =>
    sortedScenes(ch).map((s) => s.id),
  );

  const bands: RenderBand[] = [];

  if (depth === 'book') {
    for (const ch of chapters) {
      bands.push(toChapterHeadingBand(ch));
      for (const scene of sortedScenes(ch)) {
        bands.push(toSceneBand(scene, ch, story.id));
      }
    }
  } else if (depth === 'chapter') {
    const ch =
      (selection.chapterId
        ? chapters.find((c) => c.id === selection.chapterId)
        : chapters[0]) ?? null;

    if (ch) {
      bands.push(toChapterHeadingBand(ch));
      for (const scene of sortedScenes(ch)) {
        bands.push(toSceneBand(scene, ch, story.id));
      }
    }
  } else {
    // depth === 'scene'
    let targetScene: Scene | null = null;
    let targetChapter: Chapter | null = null;

    if (selection.sceneId) {
      for (const ch of chapters) {
        const sc = ch.scenes.find((s) => s.id === selection.sceneId);
        if (sc) {
          targetScene = sc;
          targetChapter = ch;
          break;
        }
      }
    }

    if (targetScene && targetChapter) {
      bands.push(toSceneBand(targetScene, targetChapter, story.id));
    }
  }

  const selectedSceneIndex =
    depth === 'scene' && selection.sceneId
      ? orderedSceneIds.indexOf(selection.sceneId)
      : -1;

  const canStep = orderedSceneIds.length > 1;

  return {
    bands,
    orderedSceneIds,
    selectedSceneIndex,
    canPrev: canStep,
    canNext: canStep,
  };
}

// ─── Step navigation (cross-chapter, wrapping) ───────────────────────────────

/**
 * Advance the selection by one scene in the given direction.
 *
 * Implements the stepScene cross-chapter rule: orderedSceneIds is a flat
 * story-wide list so stepping naturally crosses chapter boundaries.
 * Edge-arrow wrap: stepping past the last scene returns the first, and vice versa.
 *
 * Returns null when there are no scenes to navigate.
 */
export function stepScene(
  orderedSceneIds: string[],
  currentSceneId: string | null,
  direction: 'prev' | 'next',
  manifest: Manifest,
): SelectionState | null {
  if (orderedSceneIds.length === 0) return null;

  const currentIndex = currentSceneId
    ? orderedSceneIds.indexOf(currentSceneId)
    : -1;

  let nextIndex: number;
  if (currentIndex === -1) {
    nextIndex = direction === 'next' ? 0 : orderedSceneIds.length - 1;
  } else if (direction === 'next') {
    nextIndex = (currentIndex + 1) % orderedSceneIds.length;
  } else {
    nextIndex = (currentIndex - 1 + orderedSceneIds.length) % orderedSceneIds.length;
  }

  const targetSceneId = orderedSceneIds[nextIndex];

  // Find the scene in the manifest to resolve chapter and story IDs
  for (const story of manifest.stories) {
    for (const chapter of story.chapters) {
      const scene = chapter.scenes.find((s) => s.id === targetSceneId);
      if (scene) {
        return {
          storyId: story.id,
          chapterId: chapter.id,
          sceneId: scene.id,
        };
      }
    }
  }

  return null;
}
