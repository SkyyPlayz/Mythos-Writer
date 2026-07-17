// Beta 4 M12 — Coach page right-rail suggestion grouping (§5.2).
//
// Prototype `coachSugGroups` (Liquid Neon HTML 7268): collapsible General +
// per-chapter groups, the CURRENT chapter marked `· current`. The prototype
// ships mock content; the app binds the groups to the real unified suggestion
// feed — Writing Coach suggestions land in the chapter whose scene they
// target (via `targetPath`), everything else in General.

import type { Story } from '../types';
import type { UnifiedSuggestion } from '../SuggestionDetailPane';

export interface CoachSuggestionItem {
  id: string;
  /** Short row title (prototype `t`). */
  title: string;
  /** Longer description line (prototype `d`). */
  detail: string;
}

export interface CoachSuggestionGroup {
  key: string;
  /** e.g. `General`, `Chapter 2 · current` */
  label: string;
  current: boolean;
  items: CoachSuggestionItem[];
}

export const GENERAL_GROUP_KEY = 'general';

/** Humanized short titles for the coach's suggestion categories. */
const CATEGORY_TITLES: Record<string, string> = {
  punctuation: 'Punctuation',
  spelling: 'Spelling',
  grammar: 'Grammar',
  'sentence-structure': 'Sentence structure',
  'style-tone': 'Style & tone',
  other: 'Writing suggestion',
};

function categoryLabel(s: UnifiedSuggestion): string {
  if (s.category && CATEGORY_TITLES[s.category]) return CATEGORY_TITLES[s.category];
  if (s.category) return s.category;
  return 'Writing suggestion';
}

// Prototype rows: `t` is the suggestion headline, `d` a secondary line.
// The unified feed's `rationale` is the headline sentence; the secondary line
// carries the category + confidence.
function toItem(s: UnifiedSuggestion): CoachSuggestionItem {
  return {
    id: s.id,
    title: s.rationale || categoryLabel(s),
    detail: `${categoryLabel(s)} · ${Math.round(s.confidence * 100)}% confidence`,
  };
}

/**
 * Group proposed Writing Coach suggestions into General + per-chapter groups.
 * Chapter membership: the suggestion's `targetPath` matches one of the
 * chapter's scene paths (or lives under the chapter's folder).
 */
export function buildCoachSuggestionGroups(
  story: Story | null,
  currentChapterId: string | null,
  suggestions: readonly UnifiedSuggestion[],
): CoachSuggestionGroup[] {
  const coachSuggestions = suggestions.filter(
    (s) => s.sourceAgent === 'writing-assistant' && s.status === 'proposed',
  );

  const chapters = story ? [...story.chapters].sort((a, b) => a.order - b.order) : [];
  const byChapter = new Map<string, CoachSuggestionItem[]>();
  for (const ch of chapters) byChapter.set(ch.id, []);
  const general: CoachSuggestionItem[] = [];

  for (const s of coachSuggestions) {
    const target = s.targetPath;
    let placed = false;
    if (target) {
      for (const ch of chapters) {
        const inChapter =
          ch.scenes.some((sc) => sc.path === target) ||
          (ch.path !== '' && target.startsWith(`${ch.path}/`));
        if (inChapter) {
          byChapter.get(ch.id)?.push(toItem(s));
          placed = true;
          break;
        }
      }
    }
    if (!placed) general.push(toItem(s));
  }

  return [
    { key: GENERAL_GROUP_KEY, label: 'General', current: false, items: general },
    ...chapters.map((ch) => {
      const current = ch.id === currentChapterId;
      return {
        key: ch.id,
        label: current ? `${ch.title} · current` : ch.title,
        current,
        items: byChapter.get(ch.id) ?? [],
      };
    }),
  ];
}

/** Prototype default open state: General + the current chapter start open. */
export function defaultOpenGroups(groups: readonly CoachSuggestionGroup[]): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const g of groups) open[g.key] = g.key === GENERAL_GROUP_KEY || g.current;
  return open;
}

/** Clicking a suggestion prefills the chat input with a teaching request. */
export function teachMePrompt(item: Pick<CoachSuggestionItem, 'title'>): string {
  return `Teach me: ${item.title}`;
}
