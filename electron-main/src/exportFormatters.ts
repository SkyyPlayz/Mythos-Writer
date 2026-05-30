export interface ExportableScene { title: string; prose: string; }
export interface ExportableChapter { title: string; scenes: ExportableScene[]; }
export interface ExportableStory { title: string; chapters: ExportableChapter[]; }

export function sceneToMarkdown(s: ExportableScene): string {
  const l = [`# ${s.title}`, ''];
  if (s.prose.trim()) l.push(s.prose.trim(), '');
  return l.join('\n');
}
export function chapterToMarkdown(title: string, scenes: ExportableScene[]): string {
  const p = [`# ${title}`, ''];
  for (const s of scenes) { p.push(`## ${s.title}`, ''); if (s.prose.trim()) p.push(s.prose.trim(), ''); }
  return p.join('\n');
}
export function storyToMarkdown(story: ExportableStory): string {
  const p = [`# ${story.title}`, ''];
  for (const ch of story.chapters) {
    p.push(`## ${ch.title}`, '');
    for (const sc of ch.scenes) { p.push(`### ${sc.title}`, ''); if (sc.prose.trim()) p.push(sc.prose.trim(), ''); }
  }
  return p.join('\n');
}
export function vaultToMarkdown(stories: ExportableStory[]): string {
  return stories.length === 0 ? '' : stories.map(storyToMarkdown).join('\n\n---\n\n');
}
function strip(md: string): string { return md.replace(/^#+\s*/gm, '').trimEnd(); }
export function sceneToPlaintext(s: ExportableScene): string {
  const l = [s.title, '']; if (s.prose.trim()) l.push(s.prose.trim(), ''); return l.join('\n');
}
export function chapterToPlaintext(title: string, scenes: ExportableScene[]): string { return strip(chapterToMarkdown(title, scenes)); }
export function storyToPlaintext(story: ExportableStory): string { return strip(storyToMarkdown(story)); }
export function vaultToPlaintext(stories: ExportableStory[]): string {
  return stories.length === 0 ? '' : stories.map(storyToPlaintext).join('\n\n---\n\n');
}
