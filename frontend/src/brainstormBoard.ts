// Beta 4 / M20 — Idea Collections category metadata + starter library.
//
// SKY-11192/SKY-11674: this file previously also held the free-form canvas
// board model (BoardCard/BoardLink/BrainstormBoardData, position math,
// migrateDraftFactsToBoard, parseBoardFile) that backed
// components/BrainstormBoard/BoardCanvas.tsx. That component and model are
// retired — Brainstorm's Board page now renders the same shared engine the
// Notes Board tab uses (see BrainstormBoardSurface.tsx), and a card is a
// real vault note, not an entry in this file's old JSON board. What
// survives here is category/collection metadata Idea Collections still
// needs: which category maps to which left-panel group label/color, and
// the preloaded starter library. The retired board's user data is migrated
// into real notes by electron-main's migrateBrainstormBoardCardsToNotes
// (ideaCollectionsFiling.ts owns the live category->folder mapping).

export type BoardCategoryKey = 'beats' | 'rel' | 'world' | 'theme' | 'loose' | 'trope';

export type LegacyFactType = 'character' | 'location' | 'item' | 'note';

export interface BoardCategoryDef {
  key: BoardCategoryKey;
  /** Left-panel collection row label (prototype bsCollDefs). */
  collectionLabel: string;
  /** Left-panel collection dot color (prototype bsCollDefs). */
  dot: string;
}

/** The six canonical categories. */
export const BOARD_CATEGORIES: readonly BoardCategoryDef[] = [
  { key: 'beats', collectionLabel: 'Story Beats', dot: 'var(--n1, #00f0ff)' },
  { key: 'rel', collectionLabel: 'Characters', dot: 'var(--n2, #9b5fff)' },
  { key: 'world', collectionLabel: 'World & Lore', dot: '#2fe6c8' },
  { key: 'theme', collectionLabel: 'Themes', dot: '#ffd319' },
  { key: 'loose', collectionLabel: 'Loose Ideas', dot: 'var(--n3, #ff4dff)' },
  { key: 'trope', collectionLabel: 'Tropes', dot: '#ff6b4d' },
] as const;

/** Left-panel collection order (prototype bsCollDefs): Tropes before Loose Ideas. */
export const COLLECTION_ORDER: readonly BoardCategoryKey[] = [
  'beats', 'rel', 'world', 'theme', 'trope', 'loose',
];

/** Old fact types → unified board categories (the legacy "collections"). */
export const FACT_CATEGORY: Record<LegacyFactType, BoardCategoryKey> = {
  character: 'rel',
  location: 'world',
  item: 'world',
  note: 'loose',
};

export function boardCategory(key: BoardCategoryKey): BoardCategoryDef {
  return BOARD_CATEGORIES.find((c) => c.key === key) ?? BOARD_CATEGORIES[4];
}

// ─── Legacy localStorage draft fact shape ────────────────────────────────────
// Still read by BrainstormPage's chat-message restore path (unrelated to the
// retired board) — kept here since IdeaCollectionsPanel/useIdeaCollectionsFiling
// don't need their own copy of this type.

export interface LegacyDraftFact {
  id: string;
  type: LegacyFactType;
  name: string;
  content: string;
  savedStatus?: string;
  createdAt?: number;
}

// ─── Starter library (prototype bsPool `Starter` entries, lines 4085–4160) ──

export interface StarterIdea {
  title: string;
  desc: string;
  chips: string[];
}

export const STARTER_LIBRARY: Record<BoardCategoryKey, readonly StarterIdea[]> = {
  beats: [
    { title: 'Midpoint Reversal', desc: 'The goal changes — what they were chasing was the wrong prize.', chips: ['Starter', 'Structure'] },
    { title: 'The Ticking Clock', desc: 'Introduce a deadline that makes every scene cost something.', chips: ['Starter', 'Structure'] },
    { title: 'The Point of No Return', desc: 'Burn the bridge home. Literally or otherwise.', chips: ['Starter', 'Structure'] },
  ],
  trope: [
    { title: 'The Chosen One', desc: 'Marked by fate — works best when being chosen is a burden.', chips: ['Starter', 'Trope'] },
    { title: 'Enemies to Allies', desc: 'Forced cooperation curdles into real trust.', chips: ['Starter', 'Trope'] },
    { title: 'The Reluctant Hero', desc: 'Wants no part of it. The story makes it personal.', chips: ['Starter', 'Trope'] },
    { title: 'The Betrayal', desc: 'A trusted ally turns — seeded in plain sight.', chips: ['Starter', 'Trope'] },
    { title: 'The False Victory', desc: 'They get exactly what they wanted — and it’s a trap.', chips: ['Starter', 'Trope'] },
    { title: 'The Mentor Falls', desc: 'The one person with answers is taken off the board.', chips: ['Starter', 'Trope'] },
    { title: 'Enemy at the Table', desc: 'The antagonist and hero must cooperate — briefly.', chips: ['Starter', 'Trope'] },
    { title: 'Hidden Parentage', desc: 'A bloodline secret that reframes everything before it.', chips: ['Starter', 'Trope'] },
    { title: 'The Prophecy Misread', desc: 'It came true — just not the way anyone assumed.', chips: ['Starter', 'Trope'] },
    { title: 'Redemption Arc', desc: 'The fall is easy. Earn the climb back.', chips: ['Starter', 'Trope'] },
    { title: 'Fish Out of Water', desc: 'Drop them where every instinct is wrong.', chips: ['Starter', 'Trope'] },
    { title: 'The Heist Gone Wrong', desc: 'The plan was perfect. The intel wasn’t.', chips: ['Starter', 'Trope'] },
  ],
  theme: [
    { title: 'Power Corrupts Quietly', desc: 'Not a fall — a slow lean. When did they cross the line?', chips: ['Starter', 'Theme'] },
    { title: 'Found Family', desc: 'The family you choose vs. the one that chose you.', chips: ['Starter', 'Theme'] },
    { title: 'The Cost of Truth', desc: 'Would they be happier not knowing? Would you?', chips: ['Starter', 'Theme'] },
    { title: 'Becoming the Monster', desc: 'Every step to defeat the enemy makes them more alike.', chips: ['Starter', 'Theme'] },
    { title: 'Home You Can’t Return To', desc: 'The place is the same — the person isn’t.', chips: ['Starter', 'Theme'] },
    { title: 'Legacy vs. Choice', desc: 'What you inherit against what you decide.', chips: ['Starter', 'Theme'] },
  ],
  loose: [
    { title: 'A letter delivered 20 years late', desc: 'Who sent it — and why now?', chips: ['Starter', 'Spark'] },
    { title: 'The town that votes on the weather', desc: 'And this year’s election is rigged.', chips: ['Starter', 'Spark'] },
    { title: 'Two characters swap secrets', desc: 'Each now carries the other’s worst truth.', chips: ['Starter', 'Spark'] },
    { title: 'The last speaker of a language', desc: 'And the one word they refuse to translate.', chips: ['Starter', 'Spark'] },
  ],
  rel: [],
  world: [],
};

// ─── QUESTIONS FOR YOU — open questions pulled from the agent's replies ─────

/**
 * Extract up to three real question sentences from an agent reply for the
 * right panel's QUESTIONS FOR YOU section (§7.2 — click sends it to the chat).
 */
export function extractOpenQuestions(text: string): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?\n]+[.!?]/g) ?? [];
  const questions: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.endsWith('?') && trimmed.length > 12) {
      questions.push(trimmed);
      if (questions.length === 3) break;
    }
  }
  return questions;
}
