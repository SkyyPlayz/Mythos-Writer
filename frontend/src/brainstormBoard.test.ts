// Beta 4 / M20 — Idea Collections category metadata + starter library tests.
//
// SKY-11192/SKY-11674: the old free-form canvas board model (migration,
// position geometry, board-file parsing) that used to live here is retired
// along with components/BrainstormBoard/BoardCanvas.tsx — see
// brainstormBoard.ts's header comment. What remains here is category
// metadata + the starter library, unaffected by that retirement.

import { describe, expect, it } from 'vitest';
import {
  BOARD_CATEGORIES,
  COLLECTION_ORDER,
  FACT_CATEGORY,
  STARTER_LIBRARY,
  boardCategory,
  extractOpenQuestions,
} from './brainstormBoard';

describe('category metadata', () => {
  it('defines the six categories with collection labels and dot colors', () => {
    expect(BOARD_CATEGORIES.map((c) => c.key)).toEqual([
      'beats', 'rel', 'world', 'theme', 'loose', 'trope',
    ]);
    for (const cat of BOARD_CATEGORIES) {
      expect(cat.collectionLabel).toBeTruthy();
      expect(cat.dot).toBeTruthy();
    }
  });

  it('collection order puts Tropes before Loose Ideas', () => {
    expect(COLLECTION_ORDER).toEqual(['beats', 'rel', 'world', 'theme', 'trope', 'loose']);
  });

  it('boardCategory looks up by key, falling back to loose for an unknown key', () => {
    expect(boardCategory('rel').collectionLabel).toBe('Characters');
    expect(boardCategory('world').collectionLabel).toBe('World & Lore');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the fallback path
    expect(boardCategory('bogus' as any).key).toBe('loose');
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
