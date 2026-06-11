// Plain-text and Markdown export formatters for scene/chapter/story/vault scopes.
// No Electron dependency; purely functional transforms over prose strings.

export interface ExportableScene {
  title: string;
  prose: string;
}

export interface ExportableChapter {
  title: string;
  scenes: ExportableScene[];
}

export interface ExportableStory {
  title: string;
  chapters: ExportableChapter[];
}

// ─── Markdown ────────────────────────────────────────────────────────────────────────────────

export function sceneToMarkdown(scene: ExportableScene): string {
  const lines = [`# ${scene.title}`, ''];
  if (scene.prose.trim()) lines.push(scene.prose.trim(), '');
  return lines.join('\n');
}

export function chapterToMarkdown(chapterTitle: string, scenes: ExportableScene[]): string {
  const lines = [`# ${chapterTitle}`, ''];
  for (const s of scenes) {
    lines.push(`## ${s.title}`, '');
    if (s.prose.trim()) lines.push(s.prose.trim(), '');
  }
  return lines.join('\n');
}

export function storyToMarkdown(story: ExportableStory): string {
  const lines = [`# ${story.title}`, ''];
  for (const ch of story.chapters) {
    lines.push(`## ${ch.title}`, '');
    for (const sc of ch.scenes) {
      lines.push(`### ${sc.title}`, '');
      if (sc.prose.trim()) lines.push(sc.prose.trim(), '');
    }
  }
  return lines.join('\n');
}

export function vaultToMarkdown(stories: ExportableStory[]): string {
  return stories.length === 0 ? '' : stories.map(storyToMarkdown).join('\n\n---\n\n');
}

// ─── Plaintext ────────────────────────────────────────────────────────────────────────────

export function sceneToPlaintext(scene: ExportableScene): string {
  const lines = [scene.title, ''];
  if (scene.prose.trim()) lines.push(scene.prose.trim(), '');
  return lines.join('\n');
}

export function chapterToPlaintext(chapterTitle: string, scenes: ExportableScene[]): string {
  const lines = [chapterTitle, ''];
  for (const s of scenes) {
    lines.push(s.title, '');
    if (s.prose.trim()) lines.push(s.prose.trim(), '');
  }
  return lines.join('\n');
}

export function storyToPlaintext(story: ExportableStory): string {
  const lines = [story.title, ''];
  for (const ch of story.chapters) {
    lines.push(ch.title, '');
    for (const sc of ch.scenes) {
      lines.push(sc.title, '');
      if (sc.prose.trim()) lines.push(sc.prose.trim(), '');
    }
  }
  return lines.join('\n');
}

export function vaultToPlaintext(stories: ExportableStory[]): string {
  return stories.length === 0 ? '' : stories.map(storyToPlaintext).join('\n\n---\n\n');
}
