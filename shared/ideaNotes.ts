/**
 * SKY-11192 — how an idea becomes a note. Shared by BOTH processes on purpose.
 *
 * The renderer files ideas one at a time from Idea Collections (§3); the main
 * process migrates the retired brainstorm board's cards into the same folders
 * in one pass. If those two disagreed about what a card is called, migration
 * would stop being idempotent against filing — a user could migrate, then file
 * the same idea again and get a near-duplicate note. So the naming and folder
 * rules live here, imported by both, rather than being written twice.
 *
 * Pure: no fs, no DOM, no Electron.
 */

/**
 * The Idea Collections categories, carried over from the legacy board model.
 * These name the SOURCE of an idea; they are not board categories any more —
 * the retired six-category/world model is what SKY-11192 replaces.
 */
export type IdeaCategory = 'beats' | 'rel' | 'world' | 'theme' | 'loose' | 'trope';

/**
 * §3 — the fixed mapping, not user-editable. Four of the six plot-shaped
 * categories share one folder on purpose: `Plot & Story` is where a writer
 * looks for all of them, and six top-level folders for six agent-side buckets
 * would be the agent's filing system leaking into the user's vault.
 */
export const IDEA_TARGET_FOLDER: Record<IdeaCategory, string> = {
  beats: 'Plot & Story',
  theme: 'Plot & Story',
  trope: 'Plot & Story',
  loose: 'Plot & Story',
  rel: 'Characters',
  world: 'Worldbuilding',
};

/** The three folders this feature can ever write to (§1 pill row order). */
export const IDEA_FOLDERS: readonly string[] = ['Plot & Story', 'Characters', 'Worldbuilding'];

/** Resolve any category-ish string to a target folder; unknown falls to Loose. */
export function ideaTargetFolder(cat: string | undefined): string {
  return IDEA_TARGET_FOLDER[cat as IdeaCategory] ?? IDEA_TARGET_FOLDER.loose;
}

/**
 * Characters no filesystem we target accepts in a name: the Windows reserved
 * set, both path separators, and C0 control characters. Hyphens, ampersands
 * and apostrophes are deliberately NOT here — "Enemies to Allies" and
 * "Home You Can't Return To" have to survive filing with their titles intact.
 */
// eslint-disable-next-line no-control-regex -- stripping control chars is the point
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * The note name an idea files as, WITHOUT the `.md` extension.
 *
 * Windows also rejects a trailing dot or space, and a name that is empty after
 * stripping would produce a bare `.md`, so both are resolved here rather than
 * at the filesystem call on whichever platform happens to notice first.
 */
export function ideaNoteName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'Untitled idea';
}

/**
 * §3 "already-filed detection": matched against the target folder's existing
 * note NAMES, never a separate `filed` flag.
 *
 * That is the whole reason the check survives a restart, and it means a note
 * the user typed by hand with the same name also blocks the duplicate — which
 * is correct, because the question is "is this idea already in my vault", not
 * "did this button get pressed". It also means renaming the note away
 * un-blocks the idea; per spec that is intended, not a bug to guard against.
 */
export function isIdeaFiled(existingNoteNames: Iterable<string>, title: string): boolean {
  const target = ideaNoteName(title).toLowerCase();
  for (const name of existingNoteNames) {
    // Trim BEFORE stripping the extension: on a name with trailing whitespace
    // the `\.md$` anchor does not match, and stripping second would leave the
    // extension in the comparison and miss a real duplicate.
    if (name.trim().replace(/\.md$/i, '').trim().toLowerCase() === target) return true;
  }
  return false;
}

export interface IdeaNoteSource {
  title: string;
  desc?: string;
  chips?: readonly string[];
}

/** Body of a filed note: the idea's own text, plus its chips as tags. */
export function ideaNoteBody(idea: IdeaNoteSource): string {
  const lines = [`# ${idea.title.trim()}`, ''];
  const desc = (idea.desc ?? '').trim();
  if (desc) lines.push(desc, '');
  const chips = (idea.chips ?? []).map((c) => c.trim()).filter(Boolean);
  if (chips.length > 0) lines.push(chips.map((c) => `#${c.replace(/\s+/g, '-')}`).join(' '), '');
  return lines.join('\n');
}
