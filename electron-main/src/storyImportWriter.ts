// Beta 3 "Liquid Neon" M24 — writes a parsed story (chapters → scenes) into
// the Story Vault + manifest. Mirrors the SKY-2971 onboarding .docx import
// write loop (main.ts ONBOARDING_IMPORT_DOCX) so the Settings "Import story"
// flow produces byte-identical vault structures; kept in its own module so
// the split → write pipeline is unit-testable without Electron.

import crypto from 'crypto';
import {
  chapterVaultPath,
  sceneVaultPath,
  writeSceneFile,
  readManifest,
  writeManifest,
  toSlug,
} from './vault.js';
import type { Manifest } from './ipc.js';
import type { DocxChapter } from './docxImporter.js';

export interface WrittenStory {
  storyId: string;
  storyTitle: string;
  chapterCount: number;
  sceneCount: number;
  firstScenePath?: string;
  firstSceneId?: string;
}

/**
 * Write every chapter/scene of `parsed` into the vault and append the story
 * to the manifest. Returns ids + counts for the caller's summary.
 */
export function writeImportedStoryToVault(
  vaultRoot: string,
  manifestPath: string,
  parsed: { title: string; chapters: DocxChapter[] },
): WrittenStory {
  const nowStr = new Date().toISOString();
  const storyId = crypto.randomUUID();
  let sceneCount = 0;
  let firstScenePath: string | undefined;
  let firstSceneId: string | undefined;

  const storyChapters: Manifest['stories'][number]['chapters'] = [];
  for (const ch of parsed.chapters) {
    const chapterId = crypto.randomUUID();
    const chapterDir = chapterVaultPath(vaultRoot, parsed.title, ch.title);
    const chapterScenes: Manifest['stories'][number]['chapters'][number]['scenes'] = [];
    for (const sc of ch.scenes) {
      const sceneId = crypto.randomUUID();
      const scenePath = sceneVaultPath(vaultRoot, chapterDir, sc.title);
      writeSceneFile(vaultRoot, scenePath, {
        id: sceneId,
        title: sc.title,
        chapterId,
        storyId,
        order: sc.order,
        prose: sc.prose,
      });
      sceneCount++;
      if (!firstScenePath) {
        firstScenePath = scenePath;
        firstSceneId = sceneId;
      }
      chapterScenes.push({
        id: sceneId, title: sc.title, path: scenePath,
        order: sc.order, chapterId, storyId, blocks: [],
        draftState: 'in-progress' as const, createdAt: nowStr, updatedAt: nowStr,
      });
    }
    storyChapters.push({
      id: chapterId, title: ch.title, path: chapterDir,
      order: ch.order, scenes: chapterScenes, createdAt: nowStr, updatedAt: nowStr,
    });
  }

  const manifest = readManifest(manifestPath);
  manifest.stories.push({
    id: storyId, title: parsed.title, path: `Manuscript/${toSlug(parsed.title)}`,
    chapters: storyChapters, createdAt: nowStr, updatedAt: nowStr,
  });
  writeManifest(manifestPath, manifest);

  return {
    storyId,
    storyTitle: parsed.title,
    chapterCount: parsed.chapters.length,
    sceneCount,
    firstScenePath,
    firstSceneId,
  };
}
