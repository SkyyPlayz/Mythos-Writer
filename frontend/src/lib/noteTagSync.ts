/**
 * PLAN-058 L6 (33:03 / 33:21 / 34:15 / 34:20): keep frontmatter `tags:` and
 * inline body `#tag` lines in sync (Obsidian-style category hashtags).
 */
import { replaceDisplayBody, stripHiddenBlocks } from './frontmatter';
import { setFrontmatterTags } from '../noteFrontmatter';

const HASHTAG_ONLY_LINE = /^#[\p{L}\p{N}_/-]+$/iu;
const FENCE_OPENER = /^(`{3,}|~{3,})/;

function scanHashtagOnlyLines(displayBody: string): string[] {
  const tags = new Set<string>();
  let inFence = false;
  for (const rawLine of displayBody.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (FENCE_OPENER.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && HASHTAG_ONLY_LINE.test(trimmed)) {
      tags.add(trimmed.slice(1).toLowerCase());
    }
  }
  return [...tags];
}

/** Extract unique hashtag names from prose (no leading # in results). */
export function extractBodyHashtags(body: string): string[] {
  return scanHashtagOnlyLines(stripHiddenBlocks(body));
}

function normalizeTagList(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const clean = t.trim().replace(/^#/, '');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!out.some((x) => x.toLowerCase() === key)) out.push(clean);
  }
  return out;
}

/**
 * Rewrite standalone `#tag` lines in the **display** body so they match the
 * frontmatter tag list. Fenced code blocks are left untouched (H1).
 */
export function syncBodyHashtagLines(displayBody: string, tags: string[]): string {
  const lines = displayBody.split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (FENCE_OPENER.test(trimmed)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (!inFence && HASHTAG_ONLY_LINE.test(trimmed)) continue;
    kept.push(line);
  }

  const missing = tags;
  if (missing.length > 0) {
    if (kept.length > 0 && kept[kept.length - 1].trim() !== '') kept.push('');
    for (const tag of missing) kept.push(`#${tag}`);
  }

  while (kept.length > 0 && kept[kept.length - 1] === '' && kept[kept.length - 2] === '') {
    kept.pop();
  }
  return kept.join('\n');
}

/** Union of frontmatter tags and body hashtag lines (deduped, stable order). */
export function mergedNoteTags(frontmatterTags: string[], displayBody: string): string[] {
  const bodyTags = scanHashtagOnlyLines(displayBody);
  const merged = [...frontmatterTags];
  for (const t of bodyTags) {
    if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
  }
  return normalizeTagList(merged);
}

/** Set frontmatter tags and mirror them as body `#tag` lines (Kanban trailer last). */
export function setNoteTagsWithBodySync(content: string, tags: string[]): string {
  const clean = normalizeTagList(tags);
  const withFm = setFrontmatterTags(content, clean);
  const syncedDisplay = syncBodyHashtagLines(stripHiddenBlocks(withFm), clean);
  return replaceDisplayBody(withFm, syncedDisplay);
}
