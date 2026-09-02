// SKY-10923: storyParts unit tests — reconciliation of the legacy
// single-implicit-part shape, owning-part lookup/update, chapter append,
// and the story.chapters derived-mirror invariant.

import { describe, it, expect } from 'vitest';
import type { Chapter, Part, Story } from '../types';
import {
  appendChapterToStory,
  findOwningPart,
  mapAllChapters,
  syncChaptersFromParts,
  updateChapterOwner,
} from './storyParts';

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
