import { describe, it, expect } from 'vitest';
import {
  PLOT_GRID_CHAPTERS,
  chapterPositions,
  chapterSlotIndex,
  chapterWhen,
  plotCardWhen,
  sortedBooks,
} from './chapters';
import type { AxisDomain } from './domain';

const DOMAIN: AxisDomain = [0, 900];

describe('sortedBooks', () => {
  it('sorts by start and drops degenerate/NaN ranges', () => {
    const books = sortedBooks([
      { startWhen: 400, endWhen: 800 },
      { startWhen: 0, endWhen: 400 },
      { startWhen: NaN, endWhen: 100 },
      { startWhen: 100, endWhen: 100 },
    ]);
    expect(books).toEqual([
      { startWhen: 0, endWhen: 400 },
      { startWhen: 400, endWhen: 800 },
    ]);
  });
});

describe('chapterWhen — prototype chWhen generalization', () => {
  const BOOKS = [
    { startWhen: 0, endWhen: 300 },
    { startWhen: 300, endWhen: 600 },
    { startWhen: 600, endWhen: 900 },
  ];

  it('distributes chapters evenly across the book spans', () => {
    // 45 chapters over 3 books = 15 per book, like the prototype.
    expect(chapterWhen(0, 45, BOOKS, DOMAIN)).toBe(0);
    expect(chapterWhen(15, 45, BOOKS, DOMAIN)).toBe(300); // first chapter of book two
    expect(chapterWhen(30, 45, BOOKS, DOMAIN)).toBe(600);
    expect(chapterWhen(45, 45, BOOKS, DOMAIN)).toBe(900);
  });

  it('interpolates linearly inside a book', () => {
    // Chapter 7.5 of 45 = halfway through book one.
    expect(chapterWhen(7.5, 45, BOOKS, DOMAIN)).toBe(150);
  });

  it('falls back to the axis domain when there are no books', () => {
    expect(chapterWhen(0, 10, [], [100, 200])).toBe(100);
    expect(chapterWhen(5, 10, [], [100, 200])).toBe(150);
  });

  it('is NaN-guarded (§8.2)', () => {
    expect(Number.isFinite(chapterWhen(NaN, 10, BOOKS, DOMAIN))).toBe(true);
    expect(Number.isFinite(chapterWhen(3, NaN, BOOKS, DOMAIN))).toBe(true);
    expect(Number.isFinite(chapterWhen(3, 10, [], [NaN, NaN]))).toBe(true);
  });
});

describe('chapterPositions', () => {
  it('yields one mini per chapter with the next start for width math', () => {
    const minis = chapterPositions(3, [], [0, 300]);
    expect(minis).toHaveLength(3);
    expect(minis[0]).toMatchObject({ startWhen: 0, nextWhen: 100 });
    expect(minis[2]).toMatchObject({ startWhen: 200, nextWhen: 300 });
  });

  it('returns [] for zero chapters', () => {
    expect(chapterPositions(0, [], DOMAIN)).toEqual([]);
  });
});

describe('chapterSlotIndex — prototype 12/23/34-of-45 color split', () => {
  it('splits any chapter count at the prototype fractions', () => {
    expect(chapterSlotIndex(0, 45)).toBe(1); // c2
    expect(chapterSlotIndex(11, 45)).toBe(1);
    expect(chapterSlotIndex(12, 45)).toBe(5); // c6
    expect(chapterSlotIndex(22, 45)).toBe(5);
    expect(chapterSlotIndex(23, 45)).toBe(4); // c5
    expect(chapterSlotIndex(34, 45)).toBe(2); // c3
    expect(chapterSlotIndex(44, 45)).toBe(2);
  });

  it('defaults safely on bad input', () => {
    expect(chapterSlotIndex(0, 0)).toBe(1);
    expect(chapterSlotIndex(NaN, 45)).toBe(1);
  });
});

describe('plotCardWhen — grid chapter → date (prototype 6682)', () => {
  it('maps the 12-column grid across the story chapters', () => {
    // 45 chapters, no books: grid ch 1 = chapter 0 → t0; grid ch 13 clamps to 12.
    expect(plotCardWhen(1, 45, [], DOMAIN)).toBe(0);
    // grid ch 5 → chapter index (5−1)×45/12 = 15 → 15/45 of the domain.
    expect(plotCardWhen(5, 45, [], DOMAIN)).toBeCloseTo(300, 6);
  });

  it('spreads linearly across the domain when the story has no chapters', () => {
    expect(plotCardWhen(1, 0, [], [0, 120])).toBe(0);
    expect(plotCardWhen(7, 0, [], [0, 120])).toBeCloseTo((6 / PLOT_GRID_CHAPTERS) * 120, 6);
  });

  it('clamps the grid chapter into 1..12 and guards NaN', () => {
    expect(plotCardWhen(99, 0, [], [0, 120])).toBeCloseTo((11 / 12) * 120, 6);
    expect(Number.isFinite(plotCardWhen(NaN, 0, [], [0, 120]))).toBe(true);
  });
});
