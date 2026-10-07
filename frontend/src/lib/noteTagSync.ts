/**
 * PLAN-058 L6 (33:03 / 33:21 / 34:15 / 34:20): keep frontmatter `tags:` and
 * inline body `#tag` lines in sync (Obsidian-style category hashtags).
 */
import { setFrontmatterTags } from '../noteFrontmatter';
import { stripHiddenBlocks } from './frontmatter';

const HASHTAG_ONLY_LINE = /^#[\p{L}\p{N}_/-]+$/iu;
/** Extract unique hashtag names from prose (no leading # in results). */
export function extractBodyHashtags(body: string): string[] {
  const tags = new Set<string>();
  const prose = stripHiddenBlocks(body);
  for (const rawLine of prose.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (HASHTAG_ONLY_LINE.test(line)) {
      tags.add(line.slice(1).toLowerCase());
    }
  }
  return [...tags];
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
 * Rewrite standalone `#tag` lines so they match the frontmatter tag list.
 * Other prose lines are preserved verbatim.
 */
export function syncBodyHashtagLines(body: string, tags: string[]): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (HASHTAG_ONLY_LINE.test(trimmed)) continue;
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
export function mergedNoteTags(frontmatterTags: string[], body: string): string[] {
  const bodyTags = extractBodyHashtags(body);
  const merged = [...frontmatterTags];
  for (const t of bodyTags) {
    if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
  }
  return normalizeTagList(merged);
}

/** Set frontmatter tags and mirror them as body `#tag` lines. */
export function setNoteTagsWithBodySync(content: string, tags: string[]): string {
  const clean = normalizeTagList(tags);
  const withFm = setFrontmatterTags(content, clean);
  const fmMatch = withFm.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  const body = fmMatch ? withFm.slice(fmMatch[0].length) : withFm;
  const syncedBody = syncBodyHashtagLines(body, clean);
  return fmMatch ? `${fmMatch[0]}${syncedBody}` : syncedBody;
}
