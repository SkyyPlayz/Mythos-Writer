// SKY-10923 (M2 follow-up): chapters/parts sync helpers.
//
// story.chapters (flat, legacy) and story.parts[].chapters (M2/SKY-9017) must
// never drift. `+Part` was disabled until this change, so every pre-existing
// story is still the single-implicit-part shape (isSimpleSinglePart) and has
// only ever had story.chapters written — its parts[0].chapters is a stale
// migration-time snapshot. These helpers make story.parts the mutation
// target going forward: reconcileParts self-heals that staleness (treating
// story.chapters as authoritative until a real part exists), every write
// goes through the owning Part, and story.chapters is recomputed as a
// flattened derived mirror before the result is returned — so the ~25
// read-only call sites across the app that only ever look at story.chapters
// keep working unchanged.
import type { Chapter, Part, Story } from '../types';
import { isSimpleSinglePart } from './manuscriptModel';

/** Recompute story.chapters as the order-sorted flattened mirror of story.parts. */
export function syncChaptersFromParts(story: Story): Story {
  const parts = story.parts ?? [];
  if (parts.length === 0) return story;
  const chapters = [...parts].sort((a, b) => a.order - b.order).flatMap((p) => p.chapters);
  return { ...story, chapters };
}

/**
 * Self-heal the Part tier before every write. For the single-implicit-part
 * shape, story.chapters is authoritative (parts[0] mirrors it); once a real
 * part exists (titled, or more than one), parts become authoritative and
 * this is a no-op. Also backfills parts on the pre-M2 shape defensively —
 * schema v3 should always have parts, but never trust that blindly.
 */
export function reconcileParts(story: Story): Story {
  const parts = story.parts ?? [];
  if (parts.length === 0) {
    const part: Part = {
      id: `part-${story.id}`,
      title: '',
      order: 0,
      note: [],
      chapters: story.chapters,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    };
    return { ...story, parts: [part] };
  }
  if (isSimpleSinglePart(story)) {
    return { ...story, parts: [{ ...parts[0], chapters: story.chapters }] };
  }
  return story;
}

/** Immutably replace one part's chapters on an already-reconciled story, then re-sync the mirror. */
function withPartChapters(reconciledStory: Story, partId: string, chapters: Chapter[]): Story {
  const parts = (reconciledStory.parts ?? []).map((p) => (p.id === partId ? { ...p, chapters } : p));
  return syncChaptersFromParts({ ...reconciledStory, parts });
}

/** The Part that owns `chapterId`, after self-healing. Undefined if no part contains it. */
export function findOwningPart(story: Story, chapterId: string): Part | undefined {
  const reconciled = reconcileParts(story);
  return (reconciled.parts ?? []).find((p) => p.chapters.some((c) => c.id === chapterId));
}

/**
 * Locate the Part owning `chapterId` and replace its chapters via `updater`
 * (receives that part's current chapters, returns the new list — same shape
 * as the old `story.chapters.map(...)` call sites this replaces). No-op
 * (returns `story` unchanged) if no part owns the chapter.
 */
export function updateChapterOwner(
  story: Story,
  chapterId: string,
  updater: (chapters: Chapter[]) => Chapter[]
): Story {
  const reconciled = reconcileParts(story);
  const part = (reconciled.parts ?? []).find((p) => p.chapters.some((c) => c.id === chapterId));
  if (!part) return story;
  return withPartChapters(reconciled, part.id, updater(part.chapters));
}

/** Append a new chapter to the end of the story — targets the last (order-sorted) part. */
export function appendChapterToStory(story: Story, chapter: Chapter): Story {
  const reconciled = reconcileParts(story);
  const parts = [...(reconciled.parts ?? [])].sort((a, b) => a.order - b.order);
  const target = parts[parts.length - 1];
  if (!target) return reconciled;
  return withPartChapters(reconciled, target.id, [...target.chapters, chapter]);
}

/** Apply `patch` to every chapter across every part (e.g. a state-only convergence rewrite). */
export function mapAllChapters(story: Story, patch: (chapter: Chapter) => Chapter): Story {
  const reconciled = reconcileParts(story);
  const parts = (reconciled.parts ?? []).map((p) => ({ ...p, chapters: p.chapters.map(patch) }));
  return syncChaptersFromParts({ ...reconciled, parts });
}
