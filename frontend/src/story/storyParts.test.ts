// SKY-10923: storyParts unit tests — reconciliation of the legacy
// single-implicit-part shape, owning-part lookup/update, chapter append,
// and the story.chapters derived-mirror invariant.

import { describe, it, expect } from 'vitest';
import type { Chapter, Part, Story } from '../types';
import {
  appendChapterToStory,
  findOwningPart,
  insertChapterIntoPart,
  mapAllChapters,
  moveChapterToPart,
  syncChaptersFromParts,
  updateChapterOwner,
} from './storyParts';
import { orderedChapters } from './manuscriptModel';

const NOW = '2026-08-19T00:00:00.000Z';

function mkChapter(id: string, title: string, order: number): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes: [], createdAt: NOW, updatedAt: NOW };
}

function mkPart(id: string, title: string, order: number, chapters: Chapter[]): Part {
  return { id, title, order, note: [], chapters, createdAt: NOW, updatedAt: NOW };
}

function mkStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('storyParts', () => {
  describe('pre-M2 shape (no parts field)', () => {
    it('updateChapterOwner backfills a part and updates the chapter, syncing the mirror', () => {
      const ch1 = mkChapter('ch1', 'Old Title', 0);
      const story = mkStory({ chapters: [ch1] });
      const updated = updateChapterOwner(story, 'ch1', (chapters) =>
        chapters.map((ch) => (ch.id !== 'ch1' ? ch : { ...ch, title: 'New Title' }))
      );
      expect(updated.chapters).toEqual([{ ...ch1, title: 'New Title' }]);
      expect(updated.parts).toHaveLength(1);
      expect(updated.parts![0].chapters).toEqual(updated.chapters);
    });
  });

  describe('single-implicit-part shape (the pre-existing-data drift case)', () => {
    it('treats story.chapters as authoritative when parts[0].chapters is a stale migration snapshot', () => {
      const liveChapter = mkChapter('ch2', 'Added After Migration', 1);
      const story = mkStory({
        // story.chapters has a chapter that was added after migration and
        // never made it into parts[0].chapters — the exact bug this fixes.
        chapters: [mkChapter('ch1', 'Chapter One', 0), liveChapter],
        parts: [mkPart('part-migrated-story-1', '', 0, [mkChapter('ch1', 'Chapter One', 0)])],
      });
      const updated = updateChapterOwner(story, 'ch2', (chapters) =>
        chapters.map((ch) => (ch.id !== 'ch2' ? ch : { ...ch, title: 'Renamed' }))
      );
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
      expect(updated.chapters.find((c) => c.id === 'ch2')?.title).toBe('Renamed');
      expect(updated.parts![0].chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
    });

    it('is a no-op when the chapter does not exist anywhere', () => {
      const story = mkStory({
        chapters: [mkChapter('ch1', 'Chapter One', 0)],
        parts: [mkPart('p1', '', 0, [mkChapter('ch1', 'Chapter One', 0)])],
      });
      const updated = updateChapterOwner(story, 'missing', (chapters) => chapters);
      expect(updated).toBe(story);
    });
  });

  describe('real parts (multi-part or titled first part)', () => {
    it('parts stay authoritative and sibling parts are untouched', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch2', 'Ch2', 0)]);
      const story = mkStory({
        chapters: [...partA.chapters, ...partB.chapters],
        parts: [partA, partB],
      });
      const updated = updateChapterOwner(story, 'ch2', (chapters) =>
        chapters.map((ch) => (ch.id !== 'ch2' ? ch : { ...ch, title: 'Renamed Ch2' }))
      );
      expect(updated.parts![0]).toEqual(partA);
      expect(updated.parts![1].chapters[0].title).toBe('Renamed Ch2');
      expect(updated.chapters.map((c) => c.title)).toEqual(['Ch1', 'Renamed Ch2']);
    });

    it('findOwningPart resolves the correct part and undefined for unknown chapters', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch2', 'Ch2', 0)]);
      const story = mkStory({ chapters: [...partA.chapters, ...partB.chapters], parts: [partA, partB] });
      expect(findOwningPart(story, 'ch2')?.id).toBe('pB');
      expect(findOwningPart(story, 'nope')).toBeUndefined();
    });
  });

  describe('appendChapterToStory', () => {
    it('appends to the single implicit part for a simple story', () => {
      const story = mkStory({
        chapters: [mkChapter('ch1', 'Ch1', 0)],
        parts: [mkPart('p1', '', 0, [mkChapter('ch1', 'Ch1', 0)])],
      });
      const newChapter = mkChapter('ch2', 'Ch2', 1);
      const updated = appendChapterToStory(story, newChapter);
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
      expect(updated.parts![0].chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
    });

    it('appends to the last order-sorted part for a multi-part story', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch2', 'Ch2', 0)]);
      const story = mkStory({ chapters: [...partA.chapters, ...partB.chapters], parts: [partA, partB] });
      const newChapter = mkChapter('ch3', 'Ch3', 1);
      const updated = appendChapterToStory(story, newChapter);
      expect(updated.parts![0].chapters.map((c) => c.id)).toEqual(['ch1']);
      expect(updated.parts![1].chapters.map((c) => c.id)).toEqual(['ch2', 'ch3']);
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch3']);
    });
  });

  describe('moveChapterToPart / insertChapterIntoPart (F1#3)', () => {
    it('moves a chapter into an empty part', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0), mkChapter('ch2', 'Ch2', 1)]);
      const partB = mkPart('pB', 'Part Two', 1, []);
      const story = mkStory({ chapters: [...partA.chapters], parts: [partA, partB] });
      const updated = moveChapterToPart(story, 'ch2', 'pB');
      expect(updated.parts![0].chapters.map((c) => c.id)).toEqual(['ch1']);
      expect(updated.parts![1].chapters.map((c) => c.id)).toEqual(['ch2']);
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
    });

    it('inserts a new chapter into a specific empty part', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const partB = mkPart('pB', 'Part Two', 1, []);
      const story = mkStory({ chapters: [...partA.chapters], parts: [partA, partB] });
      const updated = insertChapterIntoPart(story, 'pB', mkChapter('ch2', 'Ch2', 0));
      expect(updated.parts![1].chapters.map((c) => c.id)).toEqual(['ch2']);
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
    });

    it('F1#9: insert-after renumbers order so new chapter is not last by sort', () => {
      const ch1 = mkChapter('ch1', 'Ch1', 0);
      const ch2 = mkChapter('ch2', 'Ch2', 1);
      const ch3 = mkChapter('ch3', 'Ch3', 2);
      const part = mkPart('pA', 'Part One', 0, [ch1, ch2, ch3]);
      const story = mkStory({ chapters: [ch1, ch2, ch3], parts: [part] });
      // Simulate createChapter's stale max-order assignment (length === 3).
      const newbie = mkChapter('chNew', 'Inserted', 3);
      const updated = insertChapterIntoPart(story, 'pA', newbie, 'ch1');
      expect(updated.parts![0].chapters.map((c) => c.id)).toEqual(['ch1', 'chNew', 'ch2', 'ch3']);
      expect(updated.parts![0].chapters.map((c) => c.order)).toEqual([0, 1, 2, 3]);
      expect(updated.chapters.map((c) => c.id)).toEqual(['ch1', 'chNew', 'ch2', 'ch3']);
    });

    it('Critic N1: move across parts renumbers story-wide (not per-part 0..n)', () => {
      const partA = mkPart('pA', 'Part One', 0, [
        mkChapter('ch1', 'Ch1', 0),
        mkChapter('ch2', 'Ch2', 5), // stale order
      ]);
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch3', 'Ch3', 0)]);
      const story = mkStory({
        chapters: [...partA.chapters, ...partB.chapters],
        parts: [partA, partB],
      });
      const updated = moveChapterToPart(story, 'ch2', 'pB');
      // Story-wide: A[ch1] then B[ch3, ch2] → orders 0,1,2
      expect(updated.parts![0].chapters.map((c) => ({ id: c.id, order: c.order }))).toEqual([
        { id: 'ch1', order: 0 },
      ]);
      expect(updated.parts![1].chapters.map((c) => ({ id: c.id, order: c.order }))).toEqual([
        { id: 'ch3', order: 1 },
        { id: 'ch2', order: 2 },
      ]);
      expect([...updated.chapters].sort((a, b) => a.order - b.order).map((c) => c.id)).toEqual([
        'ch1', 'ch3', 'ch2',
      ]);
    });

    it('Critic N1: insert into Part 2 keeps flat orderedChapters = parts-flattened', () => {
      const a1 = mkChapter('a1', 'A1', 0);
      const a2 = mkChapter('a2', 'A2', 1);
      const b1 = mkChapter('b1', 'B1', 2);
      const b2 = mkChapter('b2', 'B2', 3);
      const partA = mkPart('pA', 'Act One', 0, [a1, a2]);
      const partB = mkPart('pB', 'Act Two', 1, [b1, b2]);
      const story = mkStory({
        chapters: [a1, a2, b1, b2],
        parts: [partA, partB],
      });
      const newbie = mkChapter('bNew', 'Bnew', 99);
      const updated = insertChapterIntoPart(story, 'pB', newbie, 'b1');
      const flatIds = updated.parts!
        .slice()
        .sort((a, b) => a.order - b.order)
        .flatMap((p) => p.chapters)
        .map((c) => c.id);
      expect(flatIds).toEqual(['a1', 'a2', 'b1', 'bNew', 'b2']);
      expect(orderedChapters(updated).map((c) => c.id)).toEqual(flatIds);
      const orders = updated.chapters.map((c) => c.order);
      expect(new Set(orders).size).toBe(orders.length);
      expect([...orders].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    it('Critic N1 / Probe: append + insert-after + cross-part move keep unique story-wide order', () => {
      const a1 = mkChapter('a1', 'A1', 0);
      const a2 = mkChapter('a2', 'A2', 1);
      const b1 = mkChapter('b1', 'B1', 2);
      const partA = mkPart('pA', 'Act One', 0, [a1, a2]);
      const partB = mkPart('pB', 'Act Two', 1, [b1]);
      let story = mkStory({ chapters: [a1, a2, b1], parts: [partA, partB] });

      // Append into last part
      story = appendChapterToStory(story, mkChapter('b2', 'B2', 99));
      expect(orderedChapters(story).map((c) => c.id)).toEqual(['a1', 'a2', 'b1', 'b2']);

      // Insert-after in Part 2
      story = insertChapterIntoPart(story, 'pB', mkChapter('bNew', 'Bnew', 99), 'b1');
      expect(orderedChapters(story).map((c) => c.id)).toEqual(['a1', 'a2', 'b1', 'bNew', 'b2']);

      // Cross-part drag a2 → Part 2
      story = moveChapterToPart(story, 'a2', 'pB');
      expect(orderedChapters(story).map((c) => c.id)).toEqual(['a1', 'b1', 'bNew', 'b2', 'a2']);
      const orders = story.chapters.map((c) => c.order);
      expect(new Set(orders).size).toBe(orders.length);
      expect(orders).toEqual(orderedChapters(story).map((c) => c.order));
    });
  });

  describe('mapAllChapters', () => {
    it('patches every chapter across every part and re-syncs the mirror', () => {
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch2', 'Ch2', 0)]);
      const story = mkStory({ chapters: [...partA.chapters, ...partB.chapters], parts: [partA, partB] });
      const updated = mapAllChapters(story, (ch) => ({ ...ch, title: `${ch.title}!` }));
      expect(updated.chapters.map((c) => c.title)).toEqual(['Ch1!', 'Ch2!']);
      expect(updated.parts!.flatMap((p) => p.chapters).map((c) => c.title)).toEqual(['Ch1!', 'Ch2!']);
    });
  });

  describe('syncChaptersFromParts', () => {
    it('flattens parts in order and is a no-op without parts', () => {
      const partB = mkPart('pB', 'Part Two', 1, [mkChapter('ch2', 'Ch2', 0)]);
      const partA = mkPart('pA', 'Part One', 0, [mkChapter('ch1', 'Ch1', 0)]);
      const story = mkStory({ chapters: [], parts: [partB, partA] });
      expect(syncChaptersFromParts(story).chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);

      const noParts = mkStory({ chapters: [mkChapter('ch1', 'Ch1', 0)] });
      expect(syncChaptersFromParts(noParts)).toBe(noParts);
    });
  });
});
