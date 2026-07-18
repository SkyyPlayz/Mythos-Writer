// Beta 3 M23 — timeline auto-build from vault Story Plans + written scenes.
//
// The M20 timeline renders real scene/chapter data. This module makes it
// populate "without manual entry" (M23 acceptance): vault Story Plan notes
// (same convention as Scene Crafter's planNotesFromVault — anything under
// `Plans/` or named `Plan…`) are parsed into planned chapter/scene units and
// merged into the M20 derive input:
//
//   - a plan unit matching a real chapter/scene title attaches to it;
//   - unmatched units become synthetic PLANNED scenes/chapters (wordCount 0
//     ⇒ deriveAeonTimeline classifies them unwritten ⇒ the Plan-vs-Progress
//     grey filter renders them "planned from your notes");
//   - skip-backward flags: planned scenes that sit BEFORE the last written
//     plan position but were never written — the author jumped ahead.
//
// SKY-7379 — this is also the Archive Agent's timeline auto-build pass per the
// Timeline Views design spec (§2): alongside `skipped` (legacy M22/23 shape,
// kept for the existing TimelineRoot badge) it now emits the same findings —
// plus structural gaps and projected manuscript contradictions — as
// `TimelineFlag`s (`archive/timelineFlags.ts`), the shape M25's Inspector
// Flags section and canvas outline will consume.
//
// Pure functions only — TimelineRoot does the IPC.

import type { InconsistencyItem } from './InconsistencyCard';
import { continuityItemsToTimelineFlags, type TimelineFlag } from './archive/timelineFlags';
import type { AeonChapterInput, AeonSceneInput } from './timelineAeon';

// ─── Plan note parsing ──────────────────────────────────────────────────────

export interface PlanUnit {
  kind: 'chapter' | 'scene';
  title: string;
  /** Source plan note id (vault path without `.md`). */
  planId: string;
}

/** Strip list decorations, checkboxes, wiki brackets, and emphasis marks. */
export function cleanPlanTitle(raw: string): string {
  return raw
    .replace(/^\[[xX ]\]\s*/, '') // task checkbox
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, '$2') // [[Target|Alias]] → Alias
    .replace(/\[\[([^[\]]+)\]\]/g, '$1') // [[Target]] → Target
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .trim();
}

/**
 * Parse a Story Plan note's markdown into ordered plan units:
 *   `## Heading`  → chapter unit (h1 is the note title — skipped)
 *   `### Heading` (and deeper) → scene unit
 *   list items (`-`, `*`, `+`, `1.`) → scene units (beats)
 * Frontmatter and fenced code blocks are ignored.
 */
export function parsePlanUnits(md: string, planId: string): PlanUnit[] {
  const units: PlanUnit[] = [];
  let body = md;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(body.indexOf('\n', end + 1) + 1);
  }

  let inFence = false;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      if (heading[1].length === 1) continue; // h1 = the note's own title
      const title = cleanPlanTitle(heading[2]);
      if (title) units.push({ kind: heading[1].length === 2 ? 'chapter' : 'scene', title, planId });
      continue;
    }

    const listItem = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (listItem) {
      const title = cleanPlanTitle(listItem[1]);
      if (title) units.push({ kind: 'scene', title, planId });
    }
  }
  return units;
}

// ─── Title matching ─────────────────────────────────────────────────────────

/** Normalize a title for plan↔manuscript matching: case-fold, drop
 *  "Chapter 3:" / "Scene 12 —" style prefixes and punctuation. */
export function normalizePlanTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(chapter|scene|part)\s+(\d+|[ivxlc]+)\b\s*[:.\-—–]?\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Merge ──────────────────────────────────────────────────────────────────

export interface SkippedPlanFlag {
  title: string;
  planId: string;
  /** The scene id (real or synthetic `plan:...`) this skip is anchored to —
   *  the Timeline lane item to select on Jump-to-scene. */
  itemId: string;
  /** The chapter this skipped scene belongs to, for the flag's anchor text. */
  chapterId: string;
}

export interface PlanMergeResult {
  scenes: AeonSceneInput[];
  chapters: AeonChapterInput[];
  /** Planned-but-unwritten scenes the author skipped past (plan order). */
  skipped: SkippedPlanFlag[];
  /** SKY-7379 — unified timeline-scoped flags: `skipped` reshaped as
   *  `ordering_skip`, plus structural `gap`s and projected `contradiction`s. */
  flags: TimelineFlag[];
}

const FALLBACK_CHAPTER_ID = 'plan:unsorted';

/**
 * Merge plan units into the real timeline input. Synthetic planned chapters
 * append after the real ones (plan order); planned scenes land in their plan
 * chapter's context (real chapter when the heading matches, synthetic
 * otherwise, a shared "Planned from notes" chapter when the plan has no
 * chapter headings). No plan units ⇒ the input passes through untouched.
 */
export function mergePlannedIntoTimeline(
  scenes: AeonSceneInput[],
  chapters: AeonChapterInput[],
  units: PlanUnit[],
  continuityFlags: readonly InconsistencyItem[] = [],
): PlanMergeResult {
  if (units.length === 0) {
    const sceneIds = new Set(scenes.map((s) => s.id));
    return { scenes, chapters, skipped: [], flags: continuityItemsToTimelineFlags(continuityFlags, sceneIds) };
  }

  const chapterByTitle = new Map<string, AeonChapterInput>();
  for (const ch of chapters) {
    const key = normalizePlanTitle(ch.title);
    if (key && !chapterByTitle.has(key)) chapterByTitle.set(key, ch);
  }
  const sceneByTitle = new Map<string, AeonSceneInput>();
  for (const sc of scenes) {
    const key = normalizePlanTitle(sc.title);
    if (key && !sceneByTitle.has(key)) sceneByTitle.set(key, sc);
  }

  const outScenes = [...scenes];
  const outChapters = [...chapters];
  const skipped: SkippedPlanFlag[] = [];
  const usedKeys = new Set<string>();

  // Written state per scene unit, in plan order — for skip-backward flags.
  const sceneUnitWritten: Array<
    { unit: PlanUnit; written: boolean; itemId: string; chapterId: string } | null
  > = [];

  let contextChapterId: string | null = null;
  let fallbackCreated = false;
  let syntheticCount = 0;

  for (const unit of units) {
    const key = normalizePlanTitle(unit.title);
    if (!key || usedKeys.has(key)) {
      sceneUnitWritten.push(null);
      continue;
    }
    usedKeys.add(key);

    if (unit.kind === 'chapter') {
      const real = chapterByTitle.get(key);
      if (real) {
        contextChapterId = real.id;
      } else {
        syntheticCount += 1;
        const id = `plan:${unit.planId}:ch:${syntheticCount}`;
        outChapters.push({ id, title: unit.title });
        contextChapterId = id;
      }
      sceneUnitWritten.push(null);
      continue;
    }

    // Scene unit.
    const real = sceneByTitle.get(key);
    if (real) {
      sceneUnitWritten.push({
        unit,
        written: (real.wordCount ?? 0) > 0,
        itemId: real.id,
        chapterId: real.chapterId,
      });
      continue;
    }

    let chapterId = contextChapterId;
    if (!chapterId) {
      if (!fallbackCreated) {
        outChapters.push({ id: FALLBACK_CHAPTER_ID, title: 'Planned from notes' });
        fallbackCreated = true;
      }
      chapterId = FALLBACK_CHAPTER_ID;
    }
    syntheticCount += 1;
    const itemId = `plan:${unit.planId}:sc:${syntheticCount}`;
    outScenes.push({
      id: itemId,
      title: unit.title,
      chapterId,
      date: '',
      wordCount: 0, // unwritten ⇒ "planned from your notes" (grey filter)
      pov: '',
      mood: '',
      arcIds: [],
      characterIds: [],
    });
    sceneUnitWritten.push({ unit, written: false, itemId, chapterId });
  }

  // Skip-backward: scene units before the LAST written plan position that
  // never got written — the author wrote ahead and skipped these.
  let lastWrittenIdx = -1;
  sceneUnitWritten.forEach((entry, i) => {
    if (entry?.written) lastWrittenIdx = i;
  });
  if (lastWrittenIdx > -1) {
    sceneUnitWritten.forEach((entry, i) => {
      if (entry && !entry.written && i < lastWrittenIdx) {
        skipped.push({
          title: entry.unit.title,
          planId: entry.unit.planId,
          itemId: entry.itemId,
          chapterId: entry.chapterId,
        });
      }
    });
  }

  // SKY-7379 — reshape into the unified TimelineFlag contract.
  const chapterTitleById = new Map(outChapters.map((c) => [c.id, c.title]));
  const orderingSkipFlags: TimelineFlag[] = skipped.map((f) => ({
    id: `flag:skip:${f.itemId}`,
    kind: 'ordering_skip',
    description: `Planned scene "${f.title}" was skipped — later scenes were written first.`,
    anchor: chapterTitleById.get(f.chapterId) ?? f.title,
    affectedItemId: f.itemId,
  }));

  // Gap: a chapter (real or plan-synthesized) with no scene coverage at all —
  // a structural hole in the timeline, distinct from an unwritten-but-planned scene.
  const sceneCountByChapter = new Map<string, number>();
  for (const s of outScenes) {
    sceneCountByChapter.set(s.chapterId, (sceneCountByChapter.get(s.chapterId) ?? 0) + 1);
  }
  const gapFlags: TimelineFlag[] = outChapters
    .filter((c) => !sceneCountByChapter.get(c.id))
    .map((c) => ({
      id: `flag:gap:${c.id}`,
      kind: 'gap' as const,
      description: `"${c.title}" has no scenes yet.`,
      anchor: c.title,
      affectedItemId: c.id,
    }));

  const timelineSceneIds = new Set(outScenes.map((s) => s.id));
  const contradictionFlags = continuityItemsToTimelineFlags(continuityFlags, timelineSceneIds);

  return {
    scenes: outScenes,
    chapters: outChapters,
    skipped,
    flags: [...orderingSkipFlags, ...gapFlags, ...contradictionFlags],
  };
}
