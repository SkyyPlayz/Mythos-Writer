// Beta 4 M23 — Lane rows (§8.4): chapter date positioning.
//
// Port of the prototype's `chWhen` (6077): chapters distribute evenly across
// the story's BOOK spans — chapters 1–15 interpolate across Book One's
// [from, to], 16–30 across Book Two, 31–45 across Book Three. Generalized to
// any chapter count and any number of books (the books are the active
// timeline's main spans from timelines.json, so the CHAPTERS row genuinely
// plots from the store). With no books the chapters interpolate across the
// axis domain. Everything is NaN-guarded (§8.2).
import type { AxisDomain } from './domain';

export interface BookRange {
  startWhen: number;
  endWhen: number;
}

/** The Plottr grid's fixed chapter-column count (prototype `tlChN`, 6573).
 *  Plotline cards address chapters on this 12-column grid. */
export const PLOT_GRID_CHAPTERS = 12;

function finite(n: number | null | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Books sorted by start, dropping degenerate/NaN ranges. */
export function sortedBooks(books: readonly BookRange[]): BookRange[] {
  return books
    .filter(
      (b) =>
        Number.isFinite(b.startWhen) && Number.isFinite(b.endWhen) && b.endWhen > b.startWhen,
    )
    .sort((a, b) => a.startWhen - b.startWhen);
}

/**
 * `when` of chapter index `i` (0-based, may be fractional) out of
 * `chapterCount` chapters, distributed across `books` (already sorted).
 * Prototype `chWhen`: with 45 chapters and 3 books each book carries 15
 * chapters and interpolates linearly across its own date range.
 */
export function chapterWhen(
  i: number,
  chapterCount: number,
  books: readonly BookRange[],
  domain: AxisDomain,
): number {
  const [t0, t1] = domain;
  const safeT0 = finite(t0, 0);
  const safeT1 = finite(t1, safeT0 + 1);
  const n = Math.max(1, finite(chapterCount, 1));
  const idx = Math.max(0, Math.min(n, finite(i, 0)));

  if (books.length === 0) {
    return safeT0 + (idx / n) * (safeT1 - safeT0);
  }
  const perBook = n / books.length;
  const b = Math.min(books.length - 1, Math.floor(idx / perBook));
  const frac = Math.max(0, Math.min(1, (idx - b * perBook) / perBook));
  const book = books[b];
  return book.startWhen + frac * (book.endWhen - book.startWhen);
}

export interface ChapterMiniPosition {
  /** Chapter start `when`. */
  when: number;
  /** Left percent along the axis (caller clamps via axisPctL). */
  startWhen: number;
  /** Next chapter's start (the mini's width spans 80% of the gap). */
  nextWhen: number;
}

/** Positions for every chapter mini (prototype 6079: width = (r−l) × .8). */
export function chapterPositions(
  chapterCount: number,
  books: readonly BookRange[],
  domain: AxisDomain,
): ChapterMiniPosition[] {
  const sorted = sortedBooks(books);
  return Array.from({ length: Math.max(0, chapterCount) }, (_, i) => {
    const startWhen = chapterWhen(i, chapterCount, sorted, domain);
    const nextWhen = chapterWhen(i + 1, chapterCount, sorted, domain);
    return { when: startWhen, startWhen, nextWhen };
  });
}

/**
 * Chapter-mini fallback slot: the prototype splits its 45 cells at 12/23/34
 * into theme slots c2/c6/c5/c3 (6079) — the same fractions applied to any
 * count. Returns a LANE_PALETTE index (0-based: 1=c2, 5=c6, 4=c5, 2=c3).
 */
export function chapterSlotIndex(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 1;
  const f = index / total;
  if (f < 12 / 45) return 1; // c2 purple
  if (f < 23 / 45) return 5; // c6 blue
  if (f < 34 / 45) return 4; // c5 teal
  return 2; // c3 magenta
}

/**
 * `when` of a plotline card addressed at grid chapter `ch` (1-based on the
 * 12-column Plottr grid). Prototype 6682:
 * `tlPct(chWhen(Math.max(0, (c.ch - 1) * 3.75)))` — 3.75 = 45 chapters / 12
 * grid columns, generalized to the story's real chapter count. Falls back to
 * a linear spread across the domain when the story has no chapters yet.
 */
export function plotCardWhen(
  ch: number,
  chapterCount: number,
  books: readonly BookRange[],
  domain: AxisDomain,
): number {
  const col = Math.max(1, Math.min(PLOT_GRID_CHAPTERS, finite(ch, 1)));
  if (chapterCount > 0) {
    const scaled = (col - 1) * (chapterCount / PLOT_GRID_CHAPTERS);
    return chapterWhen(scaled, chapterCount, sortedBooks(books), domain);
  }
  const [t0, t1] = domain;
  const safeT0 = finite(t0, 0);
  const safeT1 = finite(t1, safeT0 + 1);
  return safeT0 + ((col - 1) / PLOT_GRID_CHAPTERS) * (safeT1 - safeT0);
}
