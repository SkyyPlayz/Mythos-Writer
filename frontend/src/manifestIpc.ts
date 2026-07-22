// SKY-6196: strip scene prose from the manifest payload before it crosses
// the `vault:manifest:write` IPC boundary. electron-main already strips
// `blocks[].content` before touching disk (SKY-6596 / stripEmbeddedProseForPersist
// in electron-main/src/manifest.ts) — this does the same trim one hop earlier,
// on the renderer side, so the (potentially large) prose never gets
// structured-clone-serialized across the IPC boundary in the first place.
// React state (`stories`/`scenes`/`manifest` in DesktopShell/WritingApp) is
// never touched — only the object handed to `window.api.writeManifest`.
import type { Block, Chapter, Manifest, Scene, Story } from './types';
import { computeSceneBodyLayout } from './sceneBodyLayout';

// Mirrors electron-main/src/manifest.ts's `countWords`: a single-pass,
// allocation-free scan (no `split`/`match` array) — this runs across every
// scene's content on every manifest write.
function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isSpace = c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

function stripSceneBlocksForIpc(blocks: Block[]): Block[] {
  if (blocks.length === 0) return blocks;
  const { segments } = computeSceneBodyLayout(blocks);
  const lengthByIndex = new Map<number, number>();
  for (const seg of segments) lengthByIndex.set(seg.index, seg.length);
  return blocks.map((b, i) => {
    const bodySegLen = lengthByIndex.get(i);
    return { ...b, content: '', bodySegLen } as Block & { bodySegLen?: number };
  });
}

function stripScene(scene: Scene): Scene {
  const wordCount = scene.blocks.reduce((total, b) => total + countWords(b.content), 0);
  return { ...scene, blocks: stripSceneBlocksForIpc(scene.blocks), wordCount };
}

function stripChapter(chapter: Chapter): Chapter {
  return { ...chapter, scenes: (chapter.scenes ?? []).map(stripScene) };
}

function stripStory(story: Story): Story {
  return { ...story, chapters: (story.chapters ?? []).map(stripChapter) };
}

/**
 * Returns a shallow-cloned manifest with every scene's `blocks[].content`
 * blanked (each block instead carries a `bodySegLen`, mirroring
 * electron-main's `stripEmbeddedProseForPersist`, so `readManifest` can still
 * reconstruct multi-block scenes on the next vault-open). Only the object
 * passed to `writeManifest` should ever see this — never assign the result
 * back into React state.
 */
export function stripManifestContentForIpc(manifest: Manifest): Manifest {
  return {
    ...manifest,
    stories: (manifest.stories ?? []).map(stripStory),
    chapters: (manifest.chapters ?? []).map(stripChapter),
    scenes: (manifest.scenes ?? []).map(stripScene),
  };
}
