// Story/vault export-scope resolution (SKY-153, extended Beta 4 M14; part-aware
// fix SKY-11130). No Electron dependency — pure over a manifest + vault root,
// so it's directly unit-testable (main.ts itself isn't: it runs Electron
// app-lifecycle side effects at module load).
//
// Chapter ordering goes through chaptersOf() (jobs/scanScopeResolver.ts,
// SKY-10770), the one shared main-process reading-order traversal. A story
// with a real Part tier only guarantees chapter.order is monotonic WITHIN a
// part, not across the whole story (SKY-10875) — a flat `story.chapters`
// sort silently reorders and mis-numbers chapters for any vault that has
// gone through delete-chapter -> add-part -> add-chapter.
import { readSceneProseTracked } from './exportProse.js';
import {
  sceneToMarkdown, chapterToMarkdown, storyToMarkdown, vaultToMarkdown,
  sceneToPlaintext, chapterToPlaintext, storyToPlaintext, vaultToPlaintext,
  type ExportableScene, type ExportableChapter, type ExportableStory,
} from './exportFormatters.js';
import { chaptersOf } from './jobs/scanScopeResolver.js';
import type { ChapterEntry, ExportScope, Manifest, SceneEntry, StoryEntry } from './ipc.js';

export function safeExportFilename(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'export';
}

export function buildTextExport(
  vaultRoot: string,
  manifest: Manifest,
  scope: ExportScope,
  format: 'markdown' | 'plaintext',
): { content: string; defaultFilename: string; missingSceneIds: string[] } {
  const missing = new Set<string>();
  const readProse = (sc: SceneEntry): ExportableScene => ({
    title: sc.title,
    prose: readSceneProseTracked(vaultRoot, sc, missing),
  });
  const toChapter = (ch: ChapterEntry): ExportableChapter => ({
    title: ch.title,
    scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map(readProse),
  });
  const toStory = (st: StoryEntry): ExportableStory => ({
    title: st.title,
    chapters: chaptersOf(st).map(toChapter),
  });
  const md = format === 'markdown';

  switch (scope.kind) {
    case 'scene': {
      let found: SceneEntry | null = null;
      outer: for (const story of manifest.stories) {
        for (const ch of story.chapters) {
          const sc = ch.scenes.find((s) => s.id === scope.sceneId);
          if (sc) { found = sc; break outer; }
        }
      }
      if (!found) {
        found = (manifest.scenes ?? []).find((s: SceneEntry) => s.id === scope.sceneId) ?? null;
      }
      if (!found) throw new Error(`Scene not found: ${scope.sceneId}`);
      const exportScene = readProse(found);
      return {
        content: md ? sceneToMarkdown(exportScene) : sceneToPlaintext(exportScene),
        defaultFilename: safeExportFilename(found.title),
        missingSceneIds: [...missing],
      };
    }
    case 'chapter': {
      const story = manifest.stories.find((s) => s.id === scope.storyId);
      if (!story) throw new Error(`Story not found: ${scope.storyId}`);
      const ch = story.chapters.find((c) => c.id === scope.chapterId);
      if (!ch) throw new Error(`Chapter not found: ${scope.chapterId}`);
      const scenes = [...ch.scenes].sort((a, b) => a.order - b.order).map(readProse);
      return {
        content: md ? chapterToMarkdown(ch.title, scenes) : chapterToPlaintext(ch.title, scenes),
        defaultFilename: safeExportFilename(ch.title),
        missingSceneIds: [...missing],
      };
    }
    case 'story': {
      const story = manifest.stories.find((s) => s.id === scope.storyId);
      if (!story) throw new Error(`Story not found: ${scope.storyId}`);
      const exportStory = toStory(story);
      return {
        content: md ? storyToMarkdown(exportStory) : storyToPlaintext(exportStory),
        defaultFilename: safeExportFilename(story.title),
        missingSceneIds: [...missing],
      };
    }
    case 'vault': {
      const exportStories = manifest.stories.map(toStory);
      return {
        content: md ? vaultToMarkdown(exportStories) : vaultToPlaintext(exportStories),
        defaultFilename: 'vault-export',
        missingSceneIds: [...missing],
      };
    }
  }
}

export interface ResolvedExportScope {
  title: string;
  synopsis?: string;
  chapters: Array<{ id: string; title: string; scenes: Array<{ id: string; title: string; prose: string }> }>;
  missingSceneIds: string[];
}

export function resolveExportScope(
  vaultRoot: string,
  manifest: Manifest,
  scope: ExportScope,
): ResolvedExportScope {
  const missing = new Set<string>();
  const readProse = (sc: SceneEntry): { id: string; title: string; prose: string } => ({
    id: sc.id,
    title: sc.title,
    prose: readSceneProseTracked(vaultRoot, sc, missing),
  });

  if (scope.kind === 'scene') {
    let found: SceneEntry | null = null;
    outer: for (const st of manifest.stories) {
      for (const ch of st.chapters) {
        const sc = ch.scenes.find((s) => s.id === scope.sceneId);
        if (sc) { found = sc; break outer; }
      }
    }
    if (!found) throw new Error(`Scene not found: ${scope.sceneId}`);
    const scene = readProse(found);
    return { title: found.title, chapters: [{ id: found.id, title: found.title, scenes: [scene] }], missingSceneIds: [...missing] };
  }
  if (scope.kind === 'chapter') {
    const st = manifest.stories.find((s) => s.id === scope.storyId);
    if (!st) throw new Error(`Story not found: ${scope.storyId}`);
    const ch = st.chapters.find((c) => c.id === scope.chapterId);
    if (!ch) throw new Error(`Chapter not found: ${scope.chapterId}`);
    return {
      title: ch.title,
      synopsis: st.synopsis,
      chapters: [{
        id: ch.id,
        title: ch.title,
        scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map(readProse),
      }],
      missingSceneIds: [...missing],
    };
  }
  if (scope.kind === 'story') {
    const st = manifest.stories.find((s) => s.id === scope.storyId);
    if (!st) throw new Error(`Story not found: ${scope.storyId}`);
    return {
      title: st.title,
      synopsis: st.synopsis,
      chapters: chaptersOf(st).map((ch) => ({
        id: ch.id,
        title: ch.title,
        scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map(readProse),
      })),
      missingSceneIds: [...missing],
    };
  }
  // vault
  const chapters: ResolvedExportScope['chapters'] = [];
  for (const st of manifest.stories) {
    for (const ch of chaptersOf(st)) {
      chapters.push({
        id: ch.id,
        title: `${st.title} — ${ch.title}`,
        scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map(readProse),
      });
    }
  }
  return { title: 'Vault Export', chapters, missingSceneIds: [...missing] };
}
