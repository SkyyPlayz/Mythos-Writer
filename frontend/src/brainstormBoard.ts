// Beta 4 / M20 — unified Brainstorm board model (§7.2; B4-4).
//
// ONE free-form canvas replaces the old Board/Map/Clusters modes. Every
// constant here is ported 1:1 from the Liquid Neon prototype:
//   category defs + home regions (bsData / bsHomes2)  . . lines 4097–4120, 6023
//   default slot positions (bsPosOf) . . . . . . . . . . lines 5298–5306
//   card link anchor (+108, +46 — bsPosCenter) . . . . . line 6021
//   starter library (bsPool `Starter` entries) . . . . . lines 4085–4160
//
// The board persists as a Notes-Vault JSON file (M5 files-first storage, same
// convention as the Scene Crafter `Boards/*.canvas.json` store). Positions are
// NaN-guarded on parse — a NaN once blanked the app; never again (§8.2).
//
// B4-4: the old views' data (facts + their type-based collections + the custom
// order) migrates into this model via migrateDraftFactsToBoard before the old
// views were deleted. See brainstormBoard.test.ts for the acceptance record.

export type BoardCategoryKey = 'beats' | 'rel' | 'world' | 'theme' | 'loose' | 'trope';

export type LegacyFactType = 'character' | 'location' | 'item' | 'note';

export interface BoardCategoryDef {
  key: BoardCategoryKey;
  /** Floating region label text (uppercase, prototype bsData titles). */
  title: string;
  /** Liquid Neon color slot index 0–3 (colHex = [c1, c2, c3, c4]). */
  color: number;
  /** Home region top-left on the 2200×1400 world (prototype bsHomes2). */
  home: readonly [number, number];
  /** Left-panel collection row label (prototype bsCollDefs). */
  collectionLabel: string;
  /** Left-panel collection dot color (prototype bsCollDefs). */
  dot: string;
}

/** The six canonical categories, in prototype bsData order. */
export const BOARD_CATEGORIES: readonly BoardCategoryDef[] = [
  { key: 'beats', title: 'STORY BEATS', color: 0, home: [240, 190], collectionLabel: 'Story Beats', dot: 'var(--n1, #00f0ff)' },
  { key: 'rel', title: 'CHARACTER RELATIONSHIPS', color: 1, home: [880, 150], collectionLabel: 'Characters', dot: 'var(--n2, #9b5fff)' },
  { key: 'world', title: 'WORLDBUILDING CLUSTERS', color: 1, home: [1480, 200], collectionLabel: 'World & Lore', dot: '#2fe6c8' },
  { key: 'theme', title: 'THEMATIC IDEAS', color: 3, home: [420, 660], collectionLabel: 'Themes', dot: '#ffd319' },
  { key: 'loose', title: 'LOOSE IDEAS', color: 2, home: [1160, 700], collectionLabel: 'Loose Ideas', dot: 'var(--n3, #ff4dff)' },
  { key: 'trope', title: 'TROPES', color: 3, home: [1730, 640], collectionLabel: 'Tropes', dot: '#ff6b4d' },
] as const;

/** Left-panel collection order (prototype bsCollDefs): Tropes before Loose Ideas. */
export const COLLECTION_ORDER: readonly BoardCategoryKey[] = [
  'beats', 'rel', 'world', 'theme', 'trope', 'loose',
];

/** Canvas world size (prototype bsXformSt, line 6026). */
export const BOARD_WORLD = { width: 2200, height: 1400 } as const;

/** Old fact types → unified board categories (the legacy "collections"). */
export const FACT_CATEGORY: Record<LegacyFactType, BoardCategoryKey> = {
  character: 'rel',
  location: 'world',
  item: 'world',
  note: 'loose',
};

export interface BoardCard {
  id: string;
  cat: BoardCategoryKey;
  title: string;
  desc: string;
  chips: string[];
  /** Avatar initials for character cards (prototype `av: 'MV'`). */
  av?: string;
  x: number;
  y: number;
  /** Id of the legacy DetectedFact this card was created from, when any. */
  factId?: string;
}

export interface BoardLink {
  from: string;
  to: string;
}

export interface BrainstormBoardData {
  version: 1;
  /** B4-4 one-shot marker: legacy draft facts were migrated into this board. */
  draftMigrated: boolean;
  cards: BoardCard[];
  links: BoardLink[];
}

export function boardCategory(key: BoardCategoryKey): BoardCategoryDef {
  return BOARD_CATEGORIES.find((c) => c.key === key) ?? BOARD_CATEGORIES[4];
}

export function createEmptyBoard(): BrainstormBoardData {
  return { version: 1, draftMigrated: false, cards: [], links: [] };
}

/**
 * Prototype bsPosOf slot math: cards fan out from their category's home region
 * two to a row — `x = h[0] + (i%2)·240`, `y = h[1] + ⌊i/2⌋·158 + (i%2)·28`.
 */
export function defaultCardPosition(cat: BoardCategoryKey, slot: number): { x: number; y: number } {
  const home = boardCategory(cat).home;
  return {
    x: home[0] + (slot % 2) * 240,
    y: home[1] + Math.floor(slot / 2) * 158 + (slot % 2) * 28,
  };
}

/** Link anchor: card center per prototype bsPosCenter (+108, +46). */
export function cardCenter(card: Pick<BoardCard, 'x' | 'y'>): { x: number; y: number } {
  return { x: card.x + 108, y: card.y + 46 };
}

/** Number of categories with at least one card ("K clusters" in the status line). */
export function boardClusterCount(cards: readonly BoardCard[]): number {
  return new Set(cards.map((c) => c.cat)).size;
}

let cardSeq = 0;

export interface NewCardInput {
  cat: BoardCategoryKey;
  title: string;
  desc: string;
  chips: string[];
  av?: string;
  factId?: string;
  /** Preferred stable id (e.g. the source fact id); ignored when taken. */
  id?: string;
}

/** Create a card at the next free default slot of its category. */
export function createBoardCard(existing: readonly BoardCard[], input: NewCardInput): BoardCard {
  const slot = existing.filter((c) => c.cat === input.cat).length;
  const pos = defaultCardPosition(input.cat, slot);
  cardSeq += 1;
  const preferred = input.id && !existing.some((c) => c.id === input.id) ? input.id : null;
  return {
    id: preferred ?? `bsc-${Date.now().toString(36)}-${cardSeq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    cat: input.cat,
    title: input.title,
    desc: input.desc,
    chips: [...input.chips],
    ...(input.av ? { av: input.av } : {}),
    ...(input.factId ? { factId: input.factId } : {}),
    x: pos.x,
    y: pos.y,
  };
}

/** Avatar initials (prototype `av: 'MV'`): first letters of the first two words. */
export function avatarInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ─── B4-4 migration: legacy localStorage draft → board file ─────────────────

/** The slice of the legacy `brainstorm:draft` fact shape the migration reads. */
export interface LegacyDraftFact {
  id: string;
  type: LegacyFactType;
  name: string;
  content: string;
  savedStatus?: string;
  createdAt?: number;
}

/**
 * Migrate every legacy draft fact onto the unified board. Idempotent: facts
 * already represented (matched by factId) are skipped, and user-placed cards
 * are never moved. The legacy custom order, when present, decides placement
 * order so a hand-sorted session keeps its arrangement.
 */
export function migrateDraftFactsToBoard(
  board: BrainstormBoardData,
  facts: readonly LegacyDraftFact[],
  customOrder?: readonly string[],
): BrainstormBoardData {
  const placed = new Set(board.cards.map((c) => c.factId).filter(Boolean));
  const orderIndex = new Map((customOrder ?? []).map((id, i) => [id, i]));
  const ordered = [...facts].sort((a, b) => {
    const ai = orderIndex.has(a.id) ? (orderIndex.get(a.id) as number) : Infinity;
    const bi = orderIndex.has(b.id) ? (orderIndex.get(b.id) as number) : Infinity;
    if (ai !== bi) return ai - bi;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

  const cards = [...board.cards];
  for (const fact of ordered) {
    if (!fact || typeof fact.id !== 'string' || placed.has(fact.id)) continue;
    const cat = FACT_CATEGORY[fact.type] ?? 'loose';
    cards.push(createBoardCard(cards, {
      // Stable, deterministic card id: reuse the fact id so links written
      // against migrated cards survive later migrations of the same draft.
      id: fact.id,
      cat,
      title: fact.name ?? '',
      desc: fact.content ?? '',
      chips: [LEGACY_TYPE_CHIP[fact.type] ?? 'Note'],
      ...(fact.type === 'character' ? { av: avatarInitials(fact.name ?? '') } : {}),
      factId: fact.id,
    }));
    placed.add(fact.id);
  }
  return { ...board, draftMigrated: true, cards };
}

const LEGACY_TYPE_CHIP: Record<LegacyFactType, string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  note: 'Note',
};

// ─── Board file parsing (NaN-guarded) ────────────────────────────────────────

export function parseBoardFile(raw: string): BrainstormBoardData | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.cards) || !Array.isArray(obj.links)) return null;

  const catKeys = new Set<string>(BOARD_CATEGORIES.map((c) => c.key));
  const cards: BoardCard[] = [];
  for (const entry of obj.cards) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== 'string' || !c.id) continue;
    const cat: BoardCategoryKey = typeof c.cat === 'string' && catKeys.has(c.cat)
      ? (c.cat as BoardCategoryKey)
      : 'loose';
    const home = boardCategory(cat).home;
    const x = typeof c.x === 'number' && Number.isFinite(c.x) ? c.x : home[0];
    const y = typeof c.y === 'number' && Number.isFinite(c.y) ? c.y : home[1];
    cards.push({
      id: c.id,
      cat,
      title: typeof c.title === 'string' ? c.title : '',
      desc: typeof c.desc === 'string' ? c.desc : '',
      chips: Array.isArray(c.chips) ? c.chips.filter((ch): ch is string => typeof ch === 'string') : [],
      ...(typeof c.av === 'string' && c.av ? { av: c.av } : {}),
      ...(typeof c.factId === 'string' && c.factId ? { factId: c.factId } : {}),
      x,
      y,
    });
  }

  const ids = new Set(cards.map((c) => c.id));
  const links: BoardLink[] = [];
  for (const entry of obj.links) {
    if (!entry || typeof entry !== 'object') continue;
    const l = entry as Record<string, unknown>;
    if (typeof l.from !== 'string' || typeof l.to !== 'string') continue;
    if (l.from === l.to || !ids.has(l.from) || !ids.has(l.to)) continue;
    links.push({ from: l.from, to: l.to });
  }

  return {
    version: 1,
    draftMigrated: obj.draftMigrated === true,
    cards,
    links,
  };
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
