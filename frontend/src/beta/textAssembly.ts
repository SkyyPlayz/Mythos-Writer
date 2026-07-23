// Beta Reader agent view (SKY-6982, Beta 4 M27) — scope resolution + source
// text assembly.
//
// Each scene is wrapped in a `<<SCENE id="..." title="...">>` marker so the
// backend prompt (buildBetaReportUserContent, electron-main/src/betaReport.ts)
// can ask the model to cite an exact sceneId per reaction — far more reliable
// than trying to fuzzy-match a free-text "where" back to a scene afterward.

import type { Chapter, Scene, Story } from '../types';

export interface BetaScopeOption {
  kind: 'scene' | 'chapter' | 'story';
  id: string;
  label: string;
}

function sceneText(scene: Scene): string {
  return [...scene.blocks].sort((a, b) => a.order - b.order).map((b) => b.content).join('\n\n');
}

function sceneMarker(scene: Scene, chapterTitle: string): string {
  const title = `${chapterTitle} — ${scene.title}`.replace(/"/g, "'");
  return `<<SCENE id="${scene.id}" title="${title}">>\n${sceneText(scene)}\n<</SCENE>>`;
}

function sortedChapters(story: Story): Chapter[] {
  return [...story.chapters].sort((a, b) => a.order - b.order);
}

function sortedScenes(chapter: Chapter): Scene[] {
  return [...chapter.scenes].sort((a, b) => a.order - b.order);
}

/** The scope choices available given what's currently open — narrowest first. */
export function buildScopeOptions(story: Story | null, chapter: Chapter | null, scene: Scene | null): BetaScopeOption[] {
  const options: BetaScopeOption[] = [];
  if (scene) options.push({ kind: 'scene', id: scene.id, label: `Scene: ${scene.title}` });
  if (chapter) options.push({ kind: 'chapter', id: chapter.id, label: `Chapter: ${chapter.title}` });
  if (story) options.push({ kind: 'story', id: story.id, label: 'Full story' });
  return options;
}

/** Locate a scene (and its owning chapter) anywhere in the story by id. */
export function findSceneAndChapter(story: Story | null, sceneId: string): { scene: Scene; chapter: Chapter } | null {
  if (!story) return null;
  for (const chapter of story.chapters) {
    const scene = chapter.scenes.find((s) => s.id === sceneId);
    if (scene) return { scene, chapter };
  }
  return null;
}

/**
 * Assemble the marker-wrapped manuscript text for a scope. Returns '' if the
 * scope can't be resolved (e.g. a stale scene id after a delete) or has no
 * scenes — callers should treat that as "nothing to read".
 */
export function buildBetaReadSourceText(scope: BetaScopeOption, story: Story | null): string {
  if (!story) return '';

  if (scope.kind === 'scene') {
    const found = findSceneAndChapter(story, scope.id);
    return found ? sceneMarker(found.scene, found.chapter.title) : '';
  }

  if (scope.kind === 'chapter') {
    const chapter = story.chapters.find((c) => c.id === scope.id);
    if (!chapter) return '';
    return sortedScenes(chapter).map((s) => sceneMarker(s, chapter.title)).join('\n\n');
  }

  // Full story.
  return sortedChapters(story)
    .flatMap((c) => sortedScenes(c).map((s) => sceneMarker(s, c.title)))
    .join('\n\n');
}
