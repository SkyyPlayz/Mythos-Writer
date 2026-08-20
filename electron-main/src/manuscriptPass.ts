// Manuscript pass — shared read primitive (M12.B1 / SKY-10736).
//
// Ivy's ruling on SKY-10528 ("two buttons, one engine"): Timeline rebuild
// (M12.B4) and the continuity Check 1 (story-internal) engine are separate
// user-facing commands but must not each read the manuscript from disk on
// their own. Both drive this single primitive instead.
//
// Pure orchestration over vault.ts — no LLM, no detection logic here.

import type { Manifest } from './ipc.js';
import { readSceneFile } from './vault.js';

export interface ManuscriptPassScene {
  sceneId: string;
  sceneTitle: string;
  scenePath: string;
  chapterId: string;
  chapterTitle: string;
  /** 0-based position across the whole story: chapter order, then scene order. */
  order: number;
  prose: string;
}

export interface ManuscriptPass {
  storySlug: string;
  scenes: ManuscriptPassScene[];
  builtAt: string;
}

/**
 * Read every scene of one story, in chapter-then-scene manuscript order.
 * Scenes whose file is missing/unreadable are skipped (not thrown) so one
 * bad file doesn't blank the whole pass — mirrors buildArchiveIndex's
 * per-entity try/catch in archiveAgent.ts.
 */
export function buildManuscriptPass(
  vaultRoot: string,
  manifest: Manifest,
  storySlug: string,
): ManuscriptPass {
  const story = manifest.stories.find(
    (s) => (s.path.split('/').filter(Boolean).pop() ?? '') === storySlug,
  );

  const scenes: ManuscriptPassScene[] = [];
  if (story) {
    const chapters = [...story.chapters].sort((a, b) => a.order - b.order);
    let order = 0;
    for (const chapter of chapters) {
      const chapterScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
      for (const scene of chapterScenes) {
        let prose: string;
        try {
          prose = readSceneFile(vaultRoot, scene.path).prose;
        } catch {
          continue;
        }
        scenes.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          scenePath: scene.path,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          order: order++,
          prose,
        });
      }
    }
  }

  return { storySlug, scenes, builtAt: new Date().toISOString() };
}

/**
 * Scenes strictly before the given scene id, in manuscript order — the
 * "already established" window Check 1 (story-internal continuity) compares
 * a scene against. Falls back to the full pass when the scene id isn't found
 * (e.g. a brand-new scene not yet reflected in the manifest snapshot the
 * pass was built from).
 */
export function scenesBefore(pass: ManuscriptPass, sceneId: string): ManuscriptPassScene[] {
  const idx = pass.scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx === -1) return pass.scenes;
  return pass.scenes.slice(0, idx);
}
