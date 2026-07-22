// Beta 4 / M20 — unified Brainstorm board model tests.
//
// B4-4 (decisions log): deleting the old Map/Clusters views REQUIRES migrating
// their data into the unified board first. The migration tests below were
// written before the implementation and are the acceptance record for that
// ruling: every legacy draft fact survives as a placed board card.

import { describe, expect, it } from 'vitest';
import {
  BOARD_CATEGORIES,
  BOARD_WORLD,
  FACT_CATEGORY,
  STARTER_LIBRARY,
  boardCategory,
  boardClusterCount,
  cardCenter,
  createBoardCard,
  createEmptyBoard,
  defaultCardPosition,
  extractOpenQuestions,
  migrateDraftFactsToBoard,
  parseBoardFile,
  type BrainstormBoardData,
  type LegacyDraftFact,
} from './brainstormBoard';

const LEGACY_FACTS: LegacyDraftFact[] = [
  { id: 'fact-a', type: 'character', name: 'Aria Voss', content: 'A young sorceress', savedStatus: 'saved', createdAt: 1000 },
  { id: 'fact-b', type: 'character', name: 'Kael Thorne', content: 'A guarded smuggler', savedStatus: 'saved', createdAt: 1001 },
  { id: 'fact-c', type: 'location', name: 'Dark Cave', content: 'An underground cavern', savedStatus: 'saved', createdAt: 1002 },
  { id: 'fact-d', type: 'item', name: 'Brass Token', content: 'Buys one favor', savedStatus: 'unsaved', createdAt: 1003 },
  { id: 'fact-e', type: 'note', name: 'Memory as currency', content: 'Who owns your past?', savedStatus: 'saved', createdAt: 1004 },
];

// ─── B4-4 migration: legacy draft facts → unified board ─────────────────────

describe('migrateDraftFactsToBoard (B4-4)', () => {
  it('preserves EVERY legacy fact as a board card', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    expect(board.cards).toHaveLength(LEGACY_FACTS.length);
    for (const fact of LEGACY_FACTS) {
      const card = board.cards.find((c) => c.factId === fact.id);
      expect(card, `fact ${fact.id} must survive migration`).toBeDefined();
      expect(card!.title).toBe(fact.name);
      expect(card!.desc).toBe(fact.content);
    }
  });

  it('maps legacy collections (fact types) onto board categories', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    const catOf = (factId: string) => board.cards.find((c) => c.factId === factId)!.cat;
    expect(catOf('fact-a')).toBe('rel');
    expect(catOf('fact-b')).toBe('rel');
    expect(catOf('fact-c')).toBe('world');
    expect(catOf('fact-d')).toBe('world');
    expect(catOf('fact-e')).toBe('loose');
  });

  it('places migrated cards on the prototype home grid for their category', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    const relHome = boardCategory('rel').home;
    const cardA = board.cards.find((c) => c.factId === 'fact-a')!;
    const cardB = board.cards.find((c) => c.factId === 'fact-b')!;
    // slot 0 → home; slot 1 → home + (240, 158·0 + 28)
    expect({ x: cardA.x, y: cardA.y }).toEqual({ x: relHome[0], y: relHome[1] });
    expect({ x: cardB.x, y: cardB.y }).toEqual({ x: relHome[0] + 240, y: relHome[1] + 28 });
  });

  it('is idempotent — re-running the migration never duplicates cards', () => {
    const once = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    const twice = migrateDraftFactsToBoard(once, LEGACY_FACTS);
    expect(twice.cards).toHaveLength(LEGACY_FACTS.length);
  });

  it('marks the board as migrated (one-shot flag lives in the board file)', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), []);
    expect(board.draftMigrated).toBe(true);
  });

  it('respects the legacy custom order when placing cards', () => {
    const board = migrateDraftFactsToBoard(
      createEmptyBoard(),
      LEGACY_FACTS,
      ['fact-b', 'fact-a'],
    );
    const relHome = boardCategory('rel').home;
    const cardB = board.cards.find((c) => c.factId === 'fact-b')!;
    // fact-b is first in custom order → it takes slot 0 of its category.
    expect({ x: cardB.x, y: cardB.y }).toEqual({ x: relHome[0], y: relHome[1] });
  });

  it('keeps cards the user already placed and slots new ones after them', () => {
    let board = createEmptyBoard();
    board = {
      ...board,
      cards: [createBoardCard(board.cards, {
        cat: 'rel', title: 'Existing', desc: 'already here', chips: [],
      })],
    };
    const migrated = migrateDraftFactsToBoard(board, LEGACY_FACTS);
    expect(migrated.cards.find((c) => c.title === 'Existing')).toBeDefined();
    // The first migrated rel card lands in slot 1, not on top of the existing card.
    const cardA = migrated.cards.find((c) => c.factId === 'fact-a')!;
    const relHome = boardCategory('rel').home;
    expect({ x: cardA.x, y: cardA.y }).toEqual({ x: relHome[0] + 240, y: relHome[1] + 28 });
  });

  it('gives character cards avatar initials', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    expect(board.cards.find((c) => c.factId === 'fact-a')!.av).toBe('AV');
    expect(board.cards.find((c) => c.factId === 'fact-c')!.av).toBeUndefined();
  });

  it('migrated cards reuse the fact id as a stable card id (links survive)', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    expect(board.cards.map((c) => c.id)).toEqual(
      expect.arrayContaining(['fact-a', 'fact-b', 'fact-c', 'fact-d', 'fact-e']),
    );
    // A taken id falls back to a generated one instead of colliding.
    const clash = createBoardCard(board.cards, {
      id: 'fact-a', cat: 'rel', title: 'Other', desc: '', chips: [],
    });
    expect(clash.id).not.toBe('fact-a');
  });
});

// ─── Board model geometry (prototype-exact) ──────────────────────────────────

describe('board model', () => {
  it('defines the six prototype categories with exact titles and homes', () => {
    expect(BOARD_CATEGORIES.map((c) => [c.key, c.title, ...c.home])).toEqual([
      ['beats', 'STORY BEATS', 240, 190],
      ['rel', 'CHARACTER RELATIONSHIPS', 880, 150],
      ['world', 'WORLDBUILDING CLUSTERS', 1480, 200],
      ['theme', 'THEMATIC IDEAS', 420, 660],
      ['loose', 'LOOSE IDEAS', 1160, 700],
      ['trope', 'TROPES', 1730, 640],
    ]);
  });

  it('default positions follow the prototype slot math (x+240 alternating, rows of 158)', () => {
    // bsPosOf: x = h[0] + (i%2)*240; y = h[1] + floor(i/2)*158 + (i%2)*28
    const home = boardCategory('beats').home;
    expect(defaultCardPosition('beats', 0)).toEqual({ x: home[0], y: home[1] });
    expect(defaultCardPosition('beats', 1)).toEqual({ x: home[0] + 240, y: home[1] + 28 });
    expect(defaultCardPosition('beats', 2)).toEqual({ x: home[0], y: home[1] + 158 });
    expect(defaultCardPosition('beats', 5)).toEqual({ x: home[0] + 240, y: home[1] + 2 * 158 + 28 });
  });

  it('card centers use the prototype link anchor (+108, +46)', () => {
    const card = createBoardCard([], { cat: 'loose', title: 'T', desc: '', chips: [] });
    expect(cardCenter(card)).toEqual({ x: card.x + 108, y: card.y + 46 });
  });

  it('the canvas world is 2200×1400', () => {
    expect(BOARD_WORLD).toEqual({ width: 2200, height: 1400 });
  });

  it('cluster count is the number of non-empty categories', () => {
    const cards = [
      createBoardCard([], { cat: 'rel', title: 'A', desc: '', chips: [] }),
      createBoardCard([], { cat: 'rel', title: 'B', desc: '', chips: [] }),
      createBoardCard([], { cat: 'loose', title: 'C', desc: '', chips: [] }),
    ];
    expect(boardClusterCount(cards)).toBe(2);
    expect(boardClusterCount([])).toBe(0);
  });

  it('legacy fact types all map onto a board category', () => {
    expect(FACT_CATEGORY).toEqual({
      character: 'rel',
      location: 'world',
      item: 'world',
      note: 'loose',
    });
  });
});

// ─── Board file parsing (NaN-guarded per §8.2 "never again") ────────────────

describe('parseBoardFile', () => {
  it('round-trips a serialized board', () => {
    const board = migrateDraftFactsToBoard(createEmptyBoard(), LEGACY_FACTS);
    const withLink: BrainstormBoardData = {
      ...board,
      links: [{ from: board.cards[0].id, to: board.cards[1].id }],
    };
    const parsed = parseBoardFile(JSON.stringify(withLink));
    expect(parsed).toEqual(withLink);
  });

  it('rejects malformed JSON and wrong shapes', () => {
    expect(parseBoardFile('not json')).toBeNull();
    expect(parseBoardFile('{}')).toBeNull();
    expect(parseBoardFile(JSON.stringify({ version: 99, cards: [], links: [] }))).toBeNull();
  });

  it('guards NaN / missing positions back onto the category home', () => {
    const raw = JSON.stringify({
      version: 1,
      draftMigrated: true,
      cards: [
        { id: 'c1', cat: 'rel', title: 'A', desc: '', chips: [], x: 'oops', y: null },
      ],
      links: [],
    });
    const parsed = parseBoardFile(raw);
    const home = boardCategory('rel').home;
    expect(parsed!.cards[0].x).toBe(home[0]);
    expect(parsed!.cards[0].y).toBe(home[1]);
  });

  it('drops links whose endpoints are missing', () => {
    const raw = JSON.stringify({
      version: 1,
      draftMigrated: true,
      cards: [{ id: 'c1', cat: 'rel', title: 'A', desc: '', chips: [], x: 0, y: 0 }],
      links: [{ from: 'c1', to: 'ghost' }, { from: 'c1', to: 'c1' }],
    });
    expect(parseBoardFile(raw)!.links).toEqual([]);
  });
});

// ─── Starter library (prototype bsPool, lines 4085–4160) ────────────────────

describe('starter library', () => {
  it('ships exactly 3 structure beats, 12 tropes, 6 themes, 4 sparks', () => {
    expect(STARTER_LIBRARY.beats).toHaveLength(3);
    expect(STARTER_LIBRARY.trope).toHaveLength(12);
    expect(STARTER_LIBRARY.theme).toHaveLength(6);
    expect(STARTER_LIBRARY.loose).toHaveLength(4);
    expect(STARTER_LIBRARY.rel).toHaveLength(0);
    expect(STARTER_LIBRARY.world).toHaveLength(0);
  });

  it('every starter idea carries the Starter chip', () => {
    for (const ideas of Object.values(STARTER_LIBRARY)) {
      for (const idea of ideas) {
        expect(idea.chips[0]).toBe('Starter');
      }
    }
  });

  it('ports the prototype titles exactly', () => {
    expect(STARTER_LIBRARY.beats.map((i) => i.title)).toEqual([
      'Midpoint Reversal',
      'The Ticking Clock',
      'The Point of No Return',
    ]);
    expect(STARTER_LIBRARY.trope.map((i) => i.title)).toEqual([
      'The Chosen One',
      'Enemies to Allies',
      'The Reluctant Hero',
      'The Betrayal',
      'The False Victory',
      'The Mentor Falls',
      'Enemy at the Table',
      'Hidden Parentage',
      'The Prophecy Misread',
      'Redemption Arc',
      'Fish Out of Water',
      'The Heist Gone Wrong',
    ]);
    expect(STARTER_LIBRARY.theme.map((i) => i.title)).toEqual([
      'Power Corrupts Quietly',
      'Found Family',
      'The Cost of Truth',
      'Becoming the Monster',
      'Home You Can’t Return To',
      'Legacy vs. Choice',
    ]);
    expect(STARTER_LIBRARY.loose.map((i) => i.title)).toEqual([
      'A letter delivered 20 years late',
      'The town that votes on the weather',
      'Two characters swap secrets',
      'The last speaker of a language',
    ]);
  });
});

// ─── QUESTIONS FOR YOU extraction ────────────────────────────────────────────

describe('extractOpenQuestions', () => {
  it('pulls question sentences out of an agent reply', () => {
    const text = 'The gate is old. Does Kael know Mira took the map? '
      + 'It matters for chapter two. What does the brass token actually buy?';
    expect(extractOpenQuestions(text)).toEqual([
      'Does Kael know Mira took the map?',
      'What does the brass token actually buy?',
    ]);
  });

  it('caps at three questions and ignores tiny fragments', () => {
    const text = 'Why? A? One real question stands here first, right? '
      + 'And a second real question follows it, yes? A third question also appears, no? '
      + 'Then would a fourth question ever show up in the panel?';
    const questions = extractOpenQuestions(text);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toBe('One real question stands here first, right?');
  });

  it('returns an empty list when there are no questions', () => {
    expect(extractOpenQuestions('All statements. Nothing open.')).toEqual([]);
    expect(extractOpenQuestions('')).toEqual([]);
  });
});
