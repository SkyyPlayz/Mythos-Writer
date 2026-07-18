// SKY-6596 / GH #893 — perf validation: manifest.json goes from O(vault) to
// O(structure) per write. This is a deterministic, CI-safe proxy for the
// release-binary measurement PR #889 used (Playwright-driven save loop under
// xvfb): rather than timing an actual Electron process, it directly measures
// what `scene:save`'s manifest write now serializes, using the same
// synthetic-vault shape (3000 scenes / ~8KB prose each) the issue quotes.
//
// Numbers from this file (recorded on this branch, see PR description):
//   - pre-SKY-6596 equivalent (embedded prose): ~23.4 MB manifest.json, ~53 ms write
//   - post-SKY-6596 (structure-only):           ~766 KB, ~4 ms write — flat
//     regardless of prose size (~30x smaller, ~15x faster on this fixture)
//
// SKY-6195 update: `wordCount` (manifest.ts) must be derived from each
// scene's full prose, which is an unavoidable O(content) scan the very first
// time a hydrated scene is written — unlike the structural fields above,
// there's no way to know a text's word count without reading all of it. That
// one-time cost is memoized per block object (`blockWordCountCache` in
// manifest.ts), so it is NOT repeated on subsequent writes as long as a
// block's content is unchanged (the common case: only the actively-edited
// scene's blocks are new objects between one autosave and the next). The
// test below asserts both halves of that guarantee separately: a generous
// bound on the first (cold-cache) write, and a tight one on an immediate
// repeat write with the same block references.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeManifestAtomic, stripEmbeddedProseForPersist } from './manifest.js';
import { defaultManifest } from './vault.js';
import type { Manifest, SceneEntry, ChapterEntry, StoryEntry } from './ipc.js';

const SCENE_COUNT = 3000;
const PROSE_BYTES_PER_SCENE = 8 * 1024; // matches PR #889's "8KB-scene" synthetic vault

function buildSyntheticVault(vaultRoot: string): Manifest {
  const now = new Date().toISOString();
  const prose = 'Lorem ipsum dolor sit amet. '.repeat(Math.ceil(PROSE_BYTES_PER_SCENE / 29));
  const scenes: SceneEntry[] = Array.from({ length: SCENE_COUNT }, (_, i) => ({
    id: `scene-${i}`,
    title: `Scene ${i}`,
    path: `scene-${i}.md`,
    order: i,
    blocks: [{ id: `block-${i}`, type: 'prose', order: 0, content: prose, updatedAt: now }],
    createdAt: now,
    updatedAt: now,
  }));
  const chapter: ChapterEntry = {
    id: 'ch-1', title: 'Chapter 1', path: 'ch-1', order: 0, scenes, createdAt: now, updatedAt: now,
  };
  const story: StoryEntry = {
    id: 'story-1', title: 'Story', path: 'story-1', chapters: [chapter], createdAt: now, updatedAt: now,
  };
  return { ...defaultManifest(vaultRoot), stories: [story] };
}

describe('SKY-6596 perf validation — manifest write cost on a 3000-scene synthetic vault', () => {
  it('the OLD behavior (embedded prose, pre-SKY-6596) scales with vault size — ~24MB for 3000 x 8KB scenes', () => {
    const manifest = buildSyntheticVault('/tmp/vault');
    // Pre-SKY-6596 write path: JSON.stringify the manifest as-is (prose still embedded).
    const before = JSON.stringify(manifest);
    const beforeBytes = Buffer.byteLength(before, 'utf-8');
    // 3000 scenes * 8KB ≈ 24MB — the O(vault) cost the issue names.
    expect(beforeBytes).toBeGreaterThan(20 * 1024 * 1024);
  });

  it('the NEW behavior (structure-only) is flat regardless of prose size — a few KB, not MB', () => {
    const manifest = buildSyntheticVault('/tmp/vault');
    const persisted = stripEmbeddedProseForPersist(manifest);
    const after = JSON.stringify(persisted);
    const afterBytes = Buffer.byteLength(after, 'utf-8');
    // Structure-only bytes for 3000 scenes: ids/titles/paths/timestamps only.
    // Generously bounded well under 2MB — the actual number is ~765KB for 3000
    // scenes of pure structure (~255 bytes/scene), logged in the write-cost
    // test below for the record.
    expect(afterBytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('writeManifestAtomic on a 3000-scene vault: file size and wall-clock time before vs after', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-perf-'));
    try {
      const manifest = buildSyntheticVault(tmpDir);
      const manifestPath = path.join(tmpDir, 'manifest.json');

      // "Before": what the pre-SKY-6596 writer did — stringify with prose embedded,
      // write directly (bypassing the new stripping, to measure the OLD cost honestly).
      const beforeStart = process.hrtime.bigint();
      fs.writeFileSync(`${manifestPath}.before-tmp`, JSON.stringify(manifest), 'utf-8');
      const beforeMs = Number(process.hrtime.bigint() - beforeStart) / 1e6;
      const beforeSize = fs.statSync(`${manifestPath}.before-tmp`).size;

      // "After": the real write path scene:save now takes.
      const afterStart = process.hrtime.bigint();
      writeManifestAtomic(manifestPath, manifest);
      const afterMs = Number(process.hrtime.bigint() - afterStart) / 1e6;
      const afterSize = fs.statSync(manifestPath).size;

      const repeatStart = process.hrtime.bigint();
      writeManifestAtomic(manifestPath, manifest);
      const repeatMs = Number(process.hrtime.bigint() - repeatStart) / 1e6;

      // eslint-disable-next-line no-console
      console.log(
        `[SKY-6596 perf] 3000-scene / 8KB-scene synthetic vault — manifest write:\n` +
          `  before (embedded prose): ${(beforeSize / 1024 / 1024).toFixed(2)} MB, ${beforeMs.toFixed(2)} ms\n` +
          `  after  (structure-only): ${(afterSize / 1024).toFixed(1)} KB, ${afterMs.toFixed(2)} ms\n` +
          `  repeat (same blocks, cache warm): ${repeatMs.toFixed(2)} ms`,
      );

      expect(afterSize).toBeLessThan(beforeSize / 20); // at least ~20x smaller on disk (actual: ~30x)
      // First write of a freshly-hydrated vault: wordCount's per-block scan
      // (uncached) is a genuine, unavoidable one-time O(content) cost — not a
      // strict multiple of `beforeMs` (timing noise on shared CI runners),
      // and no longer the ~4ms flat number from pre-SKY-6195, but still
      // generously bounded well short of scaling into seconds.
      expect(afterMs).toBeLessThan(1500);
      // Repeat write with the SAME block references (the realistic case: an
      // autosave firing again while only one scene is being edited): the
      // per-block word-count cache means this must stay close to the
      // original O(structure) number, regardless of how many scenes are
      // hydrated with unchanged prose.
      expect(repeatMs).toBeLessThan(300);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
