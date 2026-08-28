// M12.3 (SKY-10770): scope → scene-set resolution. The resolver is the ONLY
// source of a manuscript-scan's unit list, so these tests are what pins
// "scan only processes text within the selected scope" at the set level;
// manuscriptScanJob.test.ts pins it at the file level.
import { describe, it, expect } from 'vitest';
import type { ChapterEntry, Manifest, PartEntry, SceneEntry, StoryEntry } from '../ipc.js';
import { resolveScanScopeUnits } from './scanScopeResolver.js';

const NOW = '2026-08-27T00:00:00.000Z';

function scene(id: string, order: number, p = `scenes/${id}.md`): SceneEntry {
  return { id, title: id, path: p, order, blocks: [], createdAt: NOW, updatedAt: NOW };
}

function chapter(id: string, order: number, scenes: SceneEntry[]): ChapterEntry {
  return { id, title: id, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function part(id: string, order: number, chapters: ChapterEntry[], title = id): PartEntry {
  return { id, title, order, note: [], chapters, createdAt: NOW, updatedAt: NOW };
}

function story(id: string, opts: { parts?: PartEntry[]; chapters?: ChapterEntry[] }): StoryEntry {
  return {
    id,
    title: id,
    path: `stories/${id}`,
    parts: opts.parts,
    chapters: opts.chapters ?? [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function manifest(stories: StoryEntry[]): Manifest {
  return {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: '/tmp/vault',
    stories,
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };
}

// Two-part story: part1 [c1: s1 s2 | c2: s3], part2 [c3: s4].
const s1 = scene('s1', 0);
const s2 = scene('s2', 1);
const s3 = scene('s3', 0);
const s4 = scene('s4', 0);
const PARTED = manifest([
  story('book-a', {
    parts: [
      part('p1', 0, [chapter('c1', 0, [s1, s2]), chapter('c2', 1, [s3])]),
      part('p2', 1, [chapter('c3', 0, [s4])]),
    ],
  }),
]);

// Part-less story: [c4: s5 s6].
const s5 = scene('s5', 0);
const s6 = scene('s6', 1);
const PARTLESS = manifest([story('book-b', { chapters: [chapter('c4', 0, [s5, s6])] })]);

const ids = (units: Array<{ sceneId: string }>) => units.map((u) => u.sceneId);

describe('resolveScanScopeUnits', () => {
  it('negative control: an unknown anchor scene resolves to no units', () => {
    expect(resolveScanScopeUnits(PARTED, { level: 'book', sceneId: 'nope' })).toEqual([]);
  });

  it('scene scope = exactly the anchor scene', () => {
    const units = resolveScanScopeUnits(PARTED, { level: 'scene', sceneId: 's1' });
    expect(units).toEqual([{ sceneId: 's1', path: 'scenes/s1.md' }]);
  });

  it('chapter scope = every scene in the containing chapter, nothing outside it', () => {
    const units = resolveScanScopeUnits(PARTED, { level: 'chapter', sceneId: 's2' });
    expect(ids(units)).toEqual(['s1', 's2']);
    expect(ids(units)).not.toContain('s3'); // sibling chapter stays out of scope
  });

  it('part scope = every chapter in the containing Part only', () => {
    const units = resolveScanScopeUnits(PARTED, { level: 'part', sceneId: 's1' });
    expect(ids(units)).toEqual(['s1', 's2', 's3']);
    expect(ids(units)).not.toContain('s4'); // other Part stays out of scope
  });

  it('book scope = the whole containing story in manuscript order', () => {
    const units = resolveScanScopeUnits(PARTED, { level: 'book', sceneId: 's3' });
    expect(ids(units)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('part scope on a story with no Part tier degrades to book', () => {
    const units = resolveScanScopeUnits(PARTLESS, { level: 'part', sceneId: 's5' });
    expect(ids(units)).toEqual(['s5', 's6']);
  });

  it('a single untitled Part (M2 migration wrapper) counts as no Part tier', () => {
    const wrapped = manifest([
      story('book-c', { parts: [part('p0', 0, [chapter('c9', 0, [s1, s2])], '')] }),
    ]);
    const units = resolveScanScopeUnits(wrapped, { level: 'part', sceneId: 's1' });
    expect(ids(units)).toEqual(['s1', 's2']);
  });

  it('single-implicit-part story: story.chapters is authoritative over a stale wrapper-part snapshot', () => {
    // storyParts.ts contract: the M2 migration's single untitled wrapper part
    // can hold a stale migration-time chapter snapshot; story.chapters is the
    // live list until a structural write heals the wrapper. s2 was added (and
    // sDead deleted) after migration — only story.chapters knows.
    const sDead = scene('s-dead', 5);
    const divergent = manifest([
      story('book-f', {
        parts: [part('p0', 0, [chapter('c-stale', 0, [s1, sDead])], '')],
        chapters: [chapter('c-live', 0, [s1, s2])],
      }),
    ]);
    // The post-migration scene is reachable as an anchor…
    expect(ids(resolveScanScopeUnits(divergent, { level: 'scene', sceneId: 's2' }))).toEqual(['s2']);
    // …and book scope reflects the live list, not the snapshot.
    const book = ids(resolveScanScopeUnits(divergent, { level: 'book', sceneId: 's1' }));
    expect(book).toEqual(['s1', 's2']);
    expect(book).not.toContain('s-dead');
  });

  it('orders units by scene order and de-duplicates repeated ids', () => {
    const dupA = scene('dup', 1);
    const dupB = scene('dup', 0, 'scenes/dup-elsewhere.md');
    const m = manifest([
      story('book-d', { chapters: [chapter('c10', 0, [dupA, scene('first', 0), dupB])] }),
    ]);
    const units = resolveScanScopeUnits(m, { level: 'chapter', sceneId: 'first' });
    expect(ids(units)).toEqual(['first', 'dup']);
  });

  it('SEC: absolute or traversal paths from a corrupted manifest never become units', () => {
    const evilAbs = scene('evil-abs', 2, '/etc/passwd');
    const evilTraversal = scene('evil-up', 3, '../outside-vault.md');
    const evilWin = scene('evil-win', 4, 'C:/other/vault.md');
    const m = manifest([
      story('book-e', { chapters: [chapter('c11', 0, [s1, evilAbs, evilTraversal, evilWin])] }),
    ]);
    const units = resolveScanScopeUnits(m, { level: 'chapter', sceneId: 's1' });
    expect(ids(units)).toEqual(['s1']);
  });
});
