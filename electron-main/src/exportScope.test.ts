// SKY-11130 — buildTextExport / resolveExportScope must order chapters via
// chaptersOf() (parts-first), not a flat `story.chapters` sort.
//
// Fixture mirrors manuscriptPass.test.ts's "follows parts order when parts
// exist" case: the delete-chapter -> add-part -> add-chapter history leaves
// per-part chapter orders non-monotonic across the whole story — Part 1
// holds ch-c (order 2), Part 2 holds ch-n (order 1). A global chapter.order
// sort would reverse them; chaptersOf() must not.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChapterEntry, Manifest, PartEntry, SceneEntry, StoryEntry } from './ipc.js';
import { defaultManifest, writeSceneFile } from './vault.js';
import { buildTextExport, resolveExportScope } from './exportScope.js';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function makeScene(id: string, order: number): SceneEntry {
  return {
    id,
    title: `Scene ${id}`,
    path: `scenes/${id}.md`,
    order,
    blocks: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeChapter(id: string, order: number, scenes: SceneEntry[]): ChapterEntry {
  return {
    id,
    title: `Chapter ${id}`,
    path: `chapters/${id}`,
    order,
    scenes,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeStory(id: string, chapters: ChapterEntry[], parts: PartEntry[]): StoryEntry {
  return {
    id,
    title: `Story ${id}`,
    path: `stories/${id}`,
    chapters,
    parts,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-scope-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Non-monotonic-across-parts fixture: Part 1 -> ch-c (order 2), Part 2 ->
 *  ch-n (order 1). Reading order is ch-c then ch-n; a flat chapter.order
 *  sort would produce ch-n then ch-c. */
function writePartedStory(): { manifest: Manifest; story: StoryEntry } {
  const sceneC = makeScene('sc-c', 1);
  const sceneN = makeScene('sc-n', 1);
  const chC = makeChapter('ch-c', 2, [sceneC]);
  const chN = makeChapter('ch-n', 1, [sceneN]);
  const parts: PartEntry[] = [
    { id: 'p-1', title: 'Part 1', order: 0, note: [], chapters: [chC], createdAt: CREATED_AT, updatedAt: CREATED_AT },
    { id: 'p-2', title: 'Part 2', order: 1, note: [], chapters: [chN], createdAt: CREATED_AT, updatedAt: CREATED_AT },
  ];
  const story = makeStory('st-1', [chC, chN], parts);
  const manifest: Manifest = { ...defaultManifest(tmpDir), stories: [story] };
  writeSceneFile(tmpDir, sceneC.path, { id: sceneC.id, title: sceneC.title, prose: 'Part one prose.' });
  writeSceneFile(tmpDir, sceneN.path, { id: sceneN.id, title: sceneN.title, prose: 'Part two prose.' });
  return { manifest, story };
}

describe('resolveExportScope — part-aware chapter order (SKY-11130)', () => {
  it("'story' scope follows parts order, not raw chapter.order", () => {
    const { manifest, story } = writePartedStory();
    const resolved = resolveExportScope(tmpDir, manifest, { kind: 'story', storyId: story.id });
    expect(resolved.chapters.map((c) => c.id)).toEqual(['ch-c', 'ch-n']);
  });

  it("'vault' scope follows parts order, not raw chapter.order", () => {
    const { manifest } = writePartedStory();
    const resolved = resolveExportScope(tmpDir, manifest, { kind: 'vault' });
    expect(resolved.chapters.map((c) => c.id)).toEqual(['ch-c', 'ch-n']);
  });
});

describe('buildTextExport — part-aware chapter order (SKY-11130)', () => {
  it("'story' scope orders chapter headings by part, not raw chapter.order", () => {
    const { manifest, story } = writePartedStory();
    const { content } = buildTextExport(tmpDir, manifest, { kind: 'story', storyId: story.id }, 'markdown');
    expect(content.indexOf('## Chapter ch-c')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('## Chapter ch-c')).toBeLessThan(content.indexOf('## Chapter ch-n'));
  });

  it("'vault' scope orders chapter headings by part, not raw chapter.order", () => {
    const { manifest } = writePartedStory();
    const { content } = buildTextExport(tmpDir, manifest, { kind: 'vault' }, 'markdown');
    expect(content.indexOf('## Chapter ch-c')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('## Chapter ch-c')).toBeLessThan(content.indexOf('## Chapter ch-n'));
  });
});
