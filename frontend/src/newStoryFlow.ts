// Beta 4 M3 — New Story wizard flow (BETA-REFINE M3; FULL-SPEC §4; prototype
// "New Story" modal 3639–3688 and nsCreate 7146–7152).
//
// Pure helpers so DesktopShell's handler stays thin and the wizard's contract
// — "creates the story AND a Story Plan note" — is unit-testable without the
// shell. The Story Plan note follows the story-import convention
// (electron-main/src/storyImport.ts): it lives in the Notes Vault's `Plans/`
// folder as `Plan — <name>.md` with `type: story-plan` frontmatter, which is
// exactly where Scene Crafter (crafterState.ts) and the timeline auto-build
// (timelinePlanBuild.ts) already look for plans.

import type { Story } from './types';

/** Prototype 3656: genre select options. */
export const NEW_STORY_GENRES = [
  'Epic Fantasy',
  'Dark Fantasy',
  'Sci-Fi',
  'Thriller',
  'Romance',
  'Literary',
] as const;

/** Prototype 3657: voice select options. */
export const NEW_STORY_VOICES = ['Dark & Gritty', 'Hopeful', 'Wry', 'Lyrical'] as const;

/** Prototype 3658: POV select options. */
export const NEW_STORY_POVS = ['Third Limited', 'First Person', 'Omniscient'] as const;

/** Everything the wizard collects (prototype stName/nsGenre/nsVoice/nsPov/nsLinks). */
export interface NewStoryDraft {
  name: string;
  genre: string;
  voice: string;
  pov: string;
  /** Notes-Vault folder paths (vault-relative) linked as existing plans. */
  linkedFolders: string[];
}

/** One "LINK YOUR PLANS" checklist row (prototype nsLinkRows). */
export interface NoteFolderOption {
  /** Vault-relative folder path, normalized to `/` separators. */
  path: string;
  /** Display label — nested folders join with ` / ` like the prototype. */
  label: string;
  noteCount: number;
}

interface VaultListingItem {
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Normalize a listing path to `/` separators (main joins with the OS sep). */
function normalizeSep(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Turn a recursive Notes-Vault listing into the wizard's folder checklist:
 * every directory, with a count of the `.md` notes anywhere beneath it.
 */
export function buildFolderOptions(items: VaultListingItem[]): NoteFolderOption[] {
  const dirs = items.filter((i) => i.isDirectory).map((i) => normalizeSep(i.path));
  const notes = items
    .filter((i) => !i.isDirectory && i.path.toLowerCase().endsWith('.md'))
    .map((i) => normalizeSep(i.path));
  return dirs
    .sort((a, b) => a.localeCompare(b))
    .map((dir) => ({
      path: dir,
      label: dir.split('/').join(' / '),
      noteCount: notes.filter((n) => n.startsWith(`${dir}/`)).length,
    }));
}

/** Prototype nsCreate: empty names fall back to "Untitled Story". */
export function makeStoryFromDraft(
  draft: NewStoryDraft,
  ids: { id: string; createdAt: string },
): Story {
  const title = draft.name.trim() || 'Untitled Story';
  return {
    id: ids.id,
    title,
    path: `stories/${ids.id}`,
    chapters: [],
    createdAt: ids.createdAt,
    updatedAt: ids.createdAt,
    genre: draft.genre,
    voice: draft.voice,
    pov: draft.pov,
    linkedPlanFolders: [...draft.linkedFolders],
  };
}

/**
 * Sanitize a story title into a safe plan-note filename fragment.
 * Mirrors electron-main/src/storyImport.ts `planNoteFileName` so wizard-made
 * and import-made plan notes share one naming scheme.
 */
export function storyPlanFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled Story';
  return `Plan — ${safe}.md`;
}

/**
 * Vault-relative path for the new Story Plan note, deduped against an
 * existing listing (`Plan — X.md`, then `Plan — X 2.md`, …) exactly like the
 * story-import flow.
 */
export function dedupePlanRelPath(title: string, existingRelPaths: Iterable<string>): string {
  const taken = new Set<string>();
  for (const p of existingRelPaths) taken.add(normalizeSep(p).toLowerCase());
  let rel = `Plans/${storyPlanFileName(title)}`;
  let n = 2;
  while (taken.has(rel.toLowerCase())) {
    rel = `Plans/${storyPlanFileName(`${title} ${n}`)}`;
    n += 1;
  }
  return rel;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Build the Story Plan note the wizard writes beside the new story.
 *
 * Body caution: timelinePlanBuild's `parsePlanUnits` treats `##` headings as
 * planned chapters and list items as planned scenes. The wizard note starts
 * with prose paragraphs only (no `##`/list markers) so a fresh story plots
 * ZERO phantom planned units until Brainstorm or the writer fills the plan
 * in. All structured metadata lives in the frontmatter, which the parser
 * strips (and which the Notes rich view never renders — shipped-bug rule).
 */
export function buildNewStoryPlanNote(story: Story, draft: NewStoryDraft): string {
  const linked = draft.linkedFolders;
  const lines: string[] = [
    '---',
    `id: ${story.id}`,
    `title: ${yamlQuote(`Plan — ${story.title}`)}`,
    'type: story-plan',
    `created: ${story.createdAt}`,
    `story: ${yamlQuote(story.title)}`,
    `genre: ${yamlQuote(draft.genre)}`,
    `voice: ${yamlQuote(draft.voice)}`,
    `pov: ${yamlQuote(draft.pov)}`,
  ];
  if (linked.length > 0) {
    lines.push('linkedPlans:');
    for (const folder of linked) lines.push(`  - ${yamlQuote(folder)}`);
  }
  lines.push(
    'tags:',
    '  - story-plan',
    '  - new-story',
    '---',
    '',
    `# Plan — ${story.title}`,
    '',
    `Created with the New Story wizard. Voice preset: ${draft.genre} · ${draft.voice} · ${draft.pov} — this tunes the Writing Coach for the story.`,
    '',
    linked.length > 0
      ? `Linked plan folders: ${linked.join(', ')}. The Archive Agent reads the linked plans to fill the planned lane of this story's timeline.`
      : 'Nothing linked yet — the timeline starts empty until this plan grows.',
    '',
    'Brainstorm fills the outline — sketch chapters here as `##` headings and scenes as list items, and the timeline picks them up as planned units.',
    '',
  );
  return lines.join('\n');
}
