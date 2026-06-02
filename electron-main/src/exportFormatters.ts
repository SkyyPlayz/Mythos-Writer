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

// ─── Markdown ────────────────────────────────────────────────────────────────

export function sceneToMarkdown(scene: ExportableScene): string {
  return `## ${scene.title}\n\n${scene.prose}`;
}

export function chapterToMarkdown(chapterTitle: string, scenes: ExportableScene[]): string {
  const body = scenes.map(sceneToMarkdown).join('\n\n---\n\n');
  return `# ${chapterTitle}\n\n${body}`;
}

export function storyToMarkdown(story: ExportableStory): string {
  const parts = story.chapters.map((ch) => chapterToMarkdown(ch.title, ch.scenes));
  return `# ${story.title}\n\n${parts.join('\n\n---\n\n')}`;
}

export function vaultToMarkdown(stories: ExportableStory[]): string {
  return stories.map(storyToMarkdown).join('\n\n---\n\n');
}

// ─── Plaintext ────────────────────────────────────────────────────────────────

export function sceneToPlaintext(scene: ExportableScene): string {
  return `${scene.title}\n\n${scene.prose}`;
}

export function chapterToPlaintext(chapterTitle: string, scenes: ExportableScene[]): string {
  const body = scenes.map(sceneToPlaintext).join('\n\n---\n\n');
  return `${chapterTitle}\n\n${body}`;
}

export function storyToPlaintext(story: ExportableStory): string {
  const parts = story.chapters.map((ch) => chapterToPlaintext(ch.title, ch.scenes));
  return `${story.title}\n\n${parts.join('\n\n---\n\n')}`;
}

export function vaultToPlaintext(stories: ExportableStory[]): string {
  return stories.map(storyToPlaintext).join('\n\n---\n\n');
}
