// SKY-10875 (M12.B4a) — Shared manuscript-pass primitive ("two buttons, one
// engine", owner ruling on SKY-10528). Reads the manuscript ONCE in reading
// order into a snapshot that both the continuity checks (Check 1 + Check 2,
// SKY-10736) and the "Rebuild my timeline" command (M12.B4b, sibling ticket)
// consume — the book is never read twice when both run.
//
// READ-ONLY by construction: this module imports nothing from timelines/*,
// performs no writes of any kind, and touches disk only through the injected
// scene reader (default: vault.ts readSceneFile, a pure read). Timeline
// mutation belongs exclusively to the M12.B4b command layer — a continuity
// check driven from here can never rewrite timeline data.

import type { Manifest } from './ipc.js';
import type { SceneFileData } from './vault.js';
import { readSceneFile } from './vault.js';
import type {
  ArchiveIgnoreKey,
  ArchiveIndex,
  ArchiveProposedQuestion,
  ManuscriptScene,
} from './archiveAgent.js';
import {
  detectInconsistencies,
  detectInternalContinuity,
  detectVaultGapQuestions,
} from './archiveAgent.js';
import type { DbSuggestion } from './db.js';

export interface ManuscriptPassScene {
  sceneId: string;
  scenePath: string;
  title: string;
  storyId: string;
  chapterId: string;
  chapterTitle: string;
  /** 1-based narrative chapter number within the story — the value a timeline
   *  event's `chapter` field expects (FLASHBACK badge math, plotline cards). */
  chapterNumber: number;
  prose: string;
  // Frontmatter passthrough for the timeline extractor (M12.B4b). These come
  // from the same single file read as the prose — adding a field here never
  // costs another disk read.
  chronologicalDate?: string;
  chronologicalIsEstimated?: boolean;
  chronologicalConfidence?: number;
  chronologicalSource?: string;
  pov?: string;
  metaPov?: string;
  metaMood?: string;
  entityCharacterIds?: string[];
  entityLocationId?: string;
}

export interface ManuscriptSnapshot {
  /** Every story's scenes in manuscript reading order (story order as listed,
   *  then chapter.order, then scene.order — same traversal as export). */
  scenes: ManuscriptPassScene[];
  /** Scenes whose .md could not be read. Surfaced, never silent — a missing
   *  file must not masquerade as an empty scene (gh-944). */
  missingSceneIds: string[];
  builtAt: string;
}

/** Injectable for tests (spy readers proving the single-read guarantee). */
export type SceneFileReader = (vaultRoot: string, relativePath: string) => SceneFileData;

export function buildManuscriptSnapshot(
  vaultRoot: string,
  manifest: Manifest,
  readScene: SceneFileReader = readSceneFile,
): ManuscriptSnapshot {
  const scenes: ManuscriptPassScene[] = [];
  const missingSceneIds: string[] = [];

  for (const story of manifest.stories) {
    const chapters = [...story.chapters].sort((a, b) => a.order - b.order);
    chapters.forEach((chapter, chapterIdx) => {
      const orderedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
      for (const scene of orderedScenes) {
        let data: SceneFileData;
        try {
          data = readScene(vaultRoot, scene.path);
        } catch {
          missingSceneIds.push(scene.id);
          continue;
        }
        scenes.push({
          sceneId: scene.id,
          scenePath: scene.path,
          title: scene.title,
          storyId: story.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterNumber: chapterIdx + 1,
          prose: data.prose,
          chronologicalDate: data.chronologicalDate,
          chronologicalIsEstimated: data.chronologicalIsEstimated,
          chronologicalConfidence: data.chronologicalConfidence,
          chronologicalSource: data.chronologicalSource,
          pov: data.pov,
          metaPov: data.metaPov,
          metaMood: data.metaMood,
          entityCharacterIds: data.entityCharacterIds,
          entityLocationId: data.entityLocationId,
        });
      }
    });
  }

  return { scenes, missingSceneIds, builtAt: new Date().toISOString() };
}

/** Adapter: snapshot scenes → Check 1's ordered `{path, text}` input. */
export function toManuscriptScenes(scenes: ManuscriptPassScene[]): ManuscriptScene[] {
  return scenes.map((s) => ({ path: s.scenePath, text: s.prose }));
}

export interface ContinuityCheckResult {
  /** Check 1 flags (`scope: 'story_internal'`), manuscript order per story. */
  internalSuggestions: DbSuggestion[];
  /** Check 2 flags (`scope: 'story_vault'`) across all scenes. */
  vaultSuggestions: DbSuggestion[];
  /** Check 2's proposed Brainstorm questions (M12.B2 artifact class — an
   *  invitation, not a defect; never lands in the flag store). */
  questions: ArchiveProposedQuestion[];
}

/**
 * Drives both continuity checks from an already-built snapshot — zero disk
 * reads happen here, so running this after a timeline rebuild (or vice versa)
 * costs one manuscript read total, not two.
 */
export function runContinuityChecksFromSnapshot(
  snapshot: ManuscriptSnapshot,
  index: ArchiveIndex,
  ignoreList?: ArchiveIgnoreKey[],
): ContinuityCheckResult {
  const internalSuggestions: DbSuggestion[] = [];
  const vaultSuggestions: DbSuggestion[] = [];
  const questions: ArchiveProposedQuestion[] = [];

  // Check 1 compares scenes against EARLIER scenes of the same book — run it
  // per story so two unrelated manuscripts in one vault never cross-flag.
  const byStory = new Map<string, ManuscriptPassScene[]>();
  for (const scene of snapshot.scenes) {
    const group = byStory.get(scene.storyId);
    if (group) group.push(scene);
    else byStory.set(scene.storyId, [scene]);
  }
  for (const group of byStory.values()) {
    internalSuggestions.push(...detectInternalContinuity(toManuscriptScenes(group), index));
  }

  for (const scene of snapshot.scenes) {
    vaultSuggestions.push(...detectInconsistencies(scene.prose, index, scene.scenePath, ignoreList));
    questions.push(...detectVaultGapQuestions(scene.prose, index, scene.scenePath));
  }

  return { internalSuggestions, vaultSuggestions, questions };
}
