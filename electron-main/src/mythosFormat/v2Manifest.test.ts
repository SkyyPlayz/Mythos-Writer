// F6 — vault-wide story/chapter/scene ID dedupe (scan + boot check).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMythosVault } from './createVault.js';
import { VEYNN_STORY_FOLDER, writeVeynnSeed } from './veynnSeed.js';
import {
  _clearDetectionCache,
  resolveManifestPath,
  readMythosFile,
  writeMythosFile,
} from './mythosJson.js';
import {
  scanMythosStoryVault,
  manifestHasDuplicateIds,
  rebuildCacheIfDuplicated,
  _clearDupBootMemoForTests,
} from './v2Manifest.js';
import {
  surgicalReplaceSceneFrontmatterId,
  surgicalReplaceBookIds,
  rebuildCacheIfDuplicated as rebuildCacheIfDuplicatedCore,
} from './v2IdDedupe.js';
import { writeManifest } from '../vault.js';
import { parseBookFile } from './bookFile.js';
import { parseV2SceneFile, isSceneFileName } from './sceneFiles.js';
import { syncCanonicalFromManifest } from './v2Manifest.js';
import { resolveNotesTierFromManifest } from '../notesTierContext.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f6-'));
  _clearDetectionCache();
  _clearDupBootMemoForTests();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function dups(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) out.add(id);
    else seen.add(id);
  }
  return [...out];
}

function allSceneIds(m: ReturnType<typeof scanMythosStoryVault>): string[] {
  return m.stories.flatMap((s) => s.chapters.flatMap((c) => c.scenes.map((sc) => sc.id)));
}

function allChapterIds(m: ReturnType<typeof scanMythosStoryVault>): string[] {
  return m.stories.flatMap((s) => s.chapters.map((c) => c.id));
}

describe('F6 ID dedupe — story folder copy', () => {
  it('tracked + fs.cpSync copy → ids unique vault-wide; original unchanged; copy re-IDed; Veynn keeps original', () => {
    const result = createMythosVault(tmp, { name: 'CopyDedupe' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const original = scanMythosStoryVault(result.mythosRoot);
    const origStory = original.stories[0];
    const origStoryId = origStory.id;
    const origSceneIds = allSceneIds(original);
    const origChapterIds = allChapterIds(original);

    const copyFolder = `${VEYNN_STORY_FOLDER} copy`;
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );

    const after = scanMythosStoryVault(result.mythosRoot);
    expect(after.stories).toHaveLength(2);
    expect(dups(after.stories.map((s) => s.id))).toEqual([]);
    expect(dups(allChapterIds(after))).toEqual([]);
    expect(dups(allSceneIds(after))).toEqual([]);

    const kept = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
    const copy = after.stories.find((s) => s.path === copyFolder)!;
    expect(kept.id).toBe(origStoryId);
    expect(copy.id).not.toBe(origStoryId);
    expect(kept.chapters.map((c) => c.id)).toEqual(origChapterIds);
    expect(allSceneIds({ ...after, stories: [kept] } as typeof after)).toEqual(
      // scenes under original only
      kept.chapters.flatMap((c) => c.scenes.map((s) => s.id)),
    );
    for (const id of origSceneIds) {
      expect(kept.chapters.some((c) => c.scenes.some((s) => s.id === id))).toBe(true);
    }
    // Original book.md id unchanged on disk.
    const book = parseBookFile(
      fs.readFileSync(path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md'), 'utf-8'),
    );
    expect(book.id).toBe(origStoryId);
    const copyBook = parseBookFile(
      fs.readFileSync(path.join(result.storyVaultPath, copyFolder, 'book.md'), 'utf-8'),
    );
    expect(copyBook.id).toBe(copy.id);
  });

  it('out-of-spine chapter folder: copy rebuilt twice keeps story+chapter ids; F5 note resolves', () => {
    // Critic follow-up: an out-of-spine chapter folder must not refuse the whole
    // book.md write. Without the fromSpine filter, ids churn across rebuilds and
    // F5 notes attached to the copy's first minted ids are orphaned.
    const result = createMythosVault(tmp, { name: 'OutOfSpineCopy', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const story = 'Spine Plus Extra';
    const abs = path.join(result.storyVaultPath, story);
    fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 01'), { recursive: true });
    // Chapter 02 exists on disk but is intentionally absent from the spine.
    fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 02'), { recursive: true });
    fs.writeFileSync(
      path.join(abs, 'book.md'),
      [
        '---',
        'id: oos-story',
        'title: Spine Plus Extra',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# Spine Plus Extra',
        '',
        '<!-- mythos:spine',
        JSON.stringify([
          {
            dir: 'Part 1',
            chapters: [{ dir: 'Chapter 01', id: 'oos-ch-spine', title: 'In Spine' }],
          },
        ]),
        '-->',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(abs, 'Part 1', 'Chapter 01', 'Scene 01.md'),
      '---\nid: oos-sc-1\ntitle: S1\nstatus: draft\n---\nprose\n',
    );
    fs.writeFileSync(
      path.join(abs, 'Part 1', 'Chapter 02', 'Scene 01.md'),
      '---\nid: oos-sc-extra\ntitle: Extra\nstatus: draft\n---\nextra\n',
    );
    writeMythosFile(result.mythosRoot, {
      ...readMythosFile(result.mythosRoot),
      stories: [
        {
          id: 'oos-story',
          title: story,
          folder: story,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const copyFolder = `${story} copy`;
    fs.cpSync(abs, path.join(result.storyVaultPath, copyFolder), { recursive: true });

    // Two rebuilds BEFORE syncCanonicalFromManifest — ids must stabilize on disk.
    const first = scanMythosStoryVault(result.mythosRoot);
    const second = scanMythosStoryVault(result.mythosRoot);

    const copy1 = first.stories.find((s) => s.path === copyFolder)!;
    const copy2 = second.stories.find((s) => s.path === copyFolder)!;
    expect(copy1).toBeTruthy();
    expect(copy2).toBeTruthy();
    expect(copy1.id).not.toBe('oos-story');
    expect(copy2.id).toBe(copy1.id);
    expect(copy2.chapters.map((c) => c.id)).toEqual(copy1.chapters.map((c) => c.id));
    expect(copy2.chapters.flatMap((c) => c.scenes.map((sc) => sc.id))).toEqual(
      copy1.chapters.flatMap((c) => c.scenes.map((sc) => sc.id)),
    );

    // Disk book.md must have accepted the surgical write (not refused).
    const copyBook = parseBookFile(
      fs.readFileSync(path.join(result.storyVaultPath, copyFolder, 'book.md'), 'utf-8'),
    );
    expect(copyBook.id).toBe(copy1.id);
    expect(copyBook.spine[0].chapters[0].id).toBe(
      copy1.chapters.find((c) => c.path.endsWith('Chapter 01'))!.id,
    );

    // F5 note on the copy: resolve against first-rebuild scene id after second rebuild.
    const copySceneId = copy1.chapters
      .find((c) => c.path.endsWith('Chapter 01'))!
      .scenes[0].id;
    const tier1 = resolveNotesTierFromManifest(first, copySceneId);
    const tier2 = resolveNotesTierFromManifest(second, copySceneId);
    expect(tier1.ok).toBe(true);
    expect(tier2.ok).toBe(true);
    if (!tier1.ok || !tier2.ok) return;
    expect(tier2.bookId).toBe(tier1.bookId);
    expect(tier2.chapterId).toBe(tier1.chapterId);
    expect(tier2.bookId).toBe(copy1.id);
  });
});

describe('F6 ID dedupe — bad cache / winner rules', () => {
  it('2: two-tracked — original first in mythos.json keeps id (tracked order)', () => {
    const result = createMythosVault(tmp, { name: 'BadCache' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Copy sorts BEFORE original by code-point ("AAA…" < "The…") so without
    // tracked mythos.json order the wrong story would win.
    const copyFolder = 'AAA Tracked Copy';
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );
    const origBookPath = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md');
    const copyBookPath = path.join(result.storyVaultPath, copyFolder, 'book.md');
    // Keep shared story id on disk.
    fs.writeFileSync(copyBookPath, fs.readFileSync(origBookPath, 'utf-8'));

    const mythos = readMythosFile(result.mythosRoot);
    const shared = mythos.stories[0]?.id ?? parseBookFile(fs.readFileSync(origBookPath, 'utf-8')).id;
    // Track BOTH: original first, copy second — rule 2 picks first tracked.
    writeMythosFile(result.mythosRoot, {
      ...mythos,
      stories: [
        { ...mythos.stories[0], id: shared, folder: VEYNN_STORY_FOLDER },
        {
          id: shared,
          title: copyFolder,
          folder: copyFolder,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // Ambiguous prior cache (same id at two paths) → rule 1 skips → tracked order.
    const poisoned = scanMythosStoryVault(result.mythosRoot);
    for (const s of poisoned.stories) s.id = shared;
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    writeManifest(cachePath, poisoned);
    // Restore shared book ids (first scan may have write-back).
    fs.writeFileSync(copyBookPath, fs.readFileSync(origBookPath, 'utf-8'));

    const after = scanMythosStoryVault(result.mythosRoot);
    const kept = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
    const copy = after.stories.find((s) => s.path === copyFolder)!;
    expect(kept.id).toBe(shared);
    expect(copy.id).not.toBe(shared);
  });
});

describe('F6 ID dedupe — cross-story chapter copy', () => {
  it('3a with cache: prior-cache path keeps original (tracked earlier target would otherwise win)', () => {
    const result = createMythosVault(tmp, { name: 'CrossA' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    const origCh = first.stories[0].chapters[0];
    const origChId = origCh.id;
    const origSceneIds = origCh.scenes.map((s) => s.id);
    writeManifest(resolveManifestPath(result.storyVaultPath), first);

    // Earlier TRACKED story receives the chapter copy + spine entry with same id.
    // Without rule 1, both in-spine → story order would give the earlier target the id.
    const earlier = 'AAA Earlier';
    const earlierAbs = path.join(result.storyVaultPath, earlier);
    fs.mkdirSync(path.join(earlierAbs, 'Part 1'), { recursive: true });
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01'),
      path.join(earlierAbs, 'Part 1', 'Chapter 01'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(earlierAbs, 'book.md'),
      [
        '---',
        'id: earlier-story',
        'title: AAA Earlier',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# AAA Earlier',
        '',
        '<!-- mythos:spine',
        JSON.stringify([
          {
            dir: 'Part 1',
            chapters: [{ dir: 'Chapter 01', id: origChId, title: origCh.title }],
          },
        ]),
        '-->',
        '',
      ].join('\n'),
    );
    const mythos = readMythosFile(result.mythosRoot);
    writeMythosFile(result.mythosRoot, {
      ...mythos,
      stories: [
        {
          id: 'earlier-story',
          title: earlier,
          folder: earlier,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        ...mythos.stories,
      ],
    });

    const after = scanMythosStoryVault(result.mythosRoot);
    const veynn = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
    const aaa = after.stories.find((s) => s.path === earlier)!;
    expect(veynn.chapters.find((c) => c.path.endsWith('Chapter 01'))!.id).toBe(origChId);
    expect(aaa.chapters[0].id).not.toBe(origChId);
    expect(
      veynn.chapters.find((c) => c.path.endsWith('Chapter 01'))!.scenes.map((s) => s.id),
    ).toEqual(origSceneIds);
  });

  it('3b no cache: spine signal keeps original scenes across two rebuilds with sync', () => {
    const result = createMythosVault(tmp, { name: 'CrossB' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    const origCh = first.stories[0].chapters[0];
    const origChId = origCh.id;
    const origSceneIds = origCh.scenes.map((s) => s.id);
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    // Earlier TRACKED target gets the scene files but NOT a spine entry for that
    // chapter (inOwnSpine=false). Scene frontmatter still shares ids with Veynn.
    // Spine signal on the parent chapter → original keeps scene ids. Without it,
    // story order would give the earlier target the scene ids.
    const earlier = 'AAA Earlier';
    const earlierAbs = path.join(result.storyVaultPath, earlier);
    fs.mkdirSync(path.join(earlierAbs, 'Part 1'), { recursive: true });
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01'),
      path.join(earlierAbs, 'Part 1', 'Chapter 01'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(earlierAbs, 'book.md'),
      [
        '---',
        'id: earlier-story',
        'title: AAA Earlier',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# AAA Earlier',
        '',
        '<!-- mythos:spine',
        JSON.stringify([{ dir: 'Part 1', chapters: [] }]),
        '-->',
        '',
      ].join('\n'),
    );
    const mythos = readMythosFile(result.mythosRoot);
    writeMythosFile(result.mythosRoot, {
      ...mythos,
      stories: [
        {
          id: 'earlier-story',
          title: earlier,
          folder: earlier,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        ...mythos.stories,
      ],
    });

    const a = scanMythosStoryVault(result.mythosRoot);
    syncCanonicalFromManifest(result.mythosRoot, a);
    const b = scanMythosStoryVault(result.mythosRoot);
    for (const m of [a, b]) {
      const veynn = m.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
      const aaa = m.stories.find((s) => s.path === earlier)!;
      const vCh = veynn.chapters.find((c) => c.path.endsWith('Chapter 01'))!;
      expect(vCh.id).toBe(origChId);
      expect(vCh.scenes.map((s) => s.id)).toEqual(origSceneIds);
      expect(aaa.chapters[0].scenes.map((s) => s.id)).not.toEqual(origSceneIds);
    }
  });

  it('3c neither chapter in spine, no cache: story order pinned', () => {
    const result = createMythosVault(tmp, { name: 'CrossC', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeVeynnSeed(result.mythosRoot);
    const mk = (folder: string, storyId: string) => {
      const abs = path.join(result.storyVaultPath, folder);
      fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 01'), { recursive: true });
      fs.writeFileSync(
        path.join(abs, 'book.md'),
        `---\nid: ${storyId}\ntitle: ${folder}\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# ${folder}\n`,
      );
      fs.writeFileSync(
        path.join(abs, 'Part 1', 'Chapter 01', 'Scene 01.md'),
        '---\nid: shared-scene\ntitle: S\nstatus: draft\n---\ntext',
      );
    };
    mk('Story A', 'shared-story');
    mk('Story B', 'shared-story');
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const after = scanMythosStoryVault(result.mythosRoot);
    const a = after.stories.find((s) => s.path === 'Story A')!;
    const b = after.stories.find((s) => s.path === 'Story B')!;
    expect(a.id).toBe('shared-story');
    expect(b.id).not.toBe('shared-story');
    expect(a.chapters[0].id).not.toBe(b.chapters[0].id);
  });
});

describe('F6 ID dedupe — within-story conflict copy', () => {
  it('4 no-cache: canonical name beats non-canonical (not prior-cache)', () => {
    const result = createMythosVault(tmp, { name: 'WithinNoCache' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ensure no prior cache so rule 1 cannot decide.
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const chDir = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01');
    const canon = path.join(chDir, 'Scene 01.md');
    const conflict = path.join(chDir, 'Scene 01 copy.md');
    fs.copyFileSync(canon, conflict);
    expect(isSceneFileName('Scene 01.md')).toBe(true);
    expect(isSceneFileName('Scene 01 copy.md')).toBe(false);

    // Capture BEFORE scan — write-back on the loser would otherwise hide a
    // wrong winner (both sides would compare equal to the post-write id).
    const origId = parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).id;
    // Code-point alone would prefer "Scene 01 copy.md" (space < '.') — canonical must win.
    const after = scanMythosStoryVault(result.mythosRoot);
    const scenes = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!.chapters[0].scenes;
    const canonScene = scenes.find((s) => s.path.endsWith('Scene 01.md'))!;
    const copyScene = scenes.find((s) => s.path.endsWith('Scene 01 copy.md'))!;
    expect(canonScene.id).toBe(origId);
    expect(copyScene.id).not.toBe(origId);
    expect(parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).id).toBe(origId);
  });

  it('4 with cache: canonical still holds; two chapters each hold Scene 01.md', () => {
    const result = createMythosVault(tmp, { name: 'Within' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    writeManifest(resolveManifestPath(result.storyVaultPath), first);
    const chDir = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01');
    const canon = path.join(chDir, 'Scene 01.md');
    const conflict = path.join(chDir, 'Scene 01 copy.md');
    fs.copyFileSync(canon, conflict);
    // Capture BEFORE scan (Probe: post-scan read hid wrong winners).
    const origId = parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).id;

    const after = scanMythosStoryVault(result.mythosRoot);
    const scenes = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!.chapters[0].scenes;
    const canonScene = scenes.find((s) => s.path.endsWith('Scene 01.md'))!;
    const copyScene = scenes.find((s) => s.path.endsWith('Scene 01 copy.md'))!;
    expect(canonScene.id).toBe(origId);
    expect(copyScene.id).not.toBe(origId);
    const ch2 = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!.chapters[1];
    expect(ch2.scenes.some((s) => s.path.endsWith('Scene 01.md'))).toBe(true);
  });
});

describe('F6 display sort (Probe H2)', () => {
  it('unnumbered scene names keep localeCompare order (not code-point)', () => {
    const result = createMythosVault(tmp, { name: 'SortH2', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeVeynnSeed(result.mythosRoot);
    const story = 'Sort Story';
    const chDir = path.join(result.storyVaultPath, story, 'Part 1', 'Chapter 01');
    fs.mkdirSync(chDir, { recursive: true });
    fs.writeFileSync(
      path.join(result.storyVaultPath, story, 'book.md'),
      [
        '---',
        'id: sort-story',
        'title: Sort Story',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# Sort Story',
        '',
        '<!-- mythos:spine',
        JSON.stringify([{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-sort', title: 'C' }] }]),
        '-->',
        '',
      ].join('\n'),
    );
    // Probe repro names — localeCompare → apple, Banana, Épilogue, zebra
    // code-point would yield Banana, apple, zebra, Épilogue.
    const names = ['apple notes.md', 'Banana notes.md', 'Épilogue draft.md', 'zebra.md'];
    for (const name of names) {
      fs.writeFileSync(
        path.join(chDir, name),
        `---\nid: ${name}\ntitle: ${name}\nstatus: draft\n---\nbody\n`,
      );
    }
    writeMythosFile(result.mythosRoot, {
      ...readMythosFile(result.mythosRoot),
      stories: [
        {
          id: 'sort-story',
          title: story,
          folder: story,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const after = scanMythosStoryVault(result.mythosRoot);
    const titles = after.stories
      .find((s) => s.path === story)!
      .chapters[0].scenes.map((s) => path.basename(s.path));
    const expected = [...names].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(expected);
    // Explicit pin against code-point order Probe saw on the frozen tip.
    expect(titles).not.toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('F6 surgical write-back', () => {
  it('byte diff limited to id values; prose id untouched; CRLF preserved; count mismatch writes nothing', () => {
    const lf = [
      '---',
      'id: old-id',
      'title: Test',
      'status: draft',
      '---',
      'Prose mentions id: old-id in body.',
      '',
    ].join('\n');
    const next = surgicalReplaceSceneFrontmatterId(lf, 'old-id', 'new-id');
    expect(next).toContain('id: new-id');
    expect(next).toContain('Prose mentions id: old-id in body.');
    expect(next!.includes('\r\n')).toBe(false);

    const crlf = lf.replace(/\n/g, '\r\n');
    const nextCrlf = surgicalReplaceSceneFrontmatterId(crlf, 'old-id', 'new-id')!;
    expect(nextCrlf.includes('\r\n')).toBe(true);
    expect(nextCrlf).toContain('id: new-id');
    expect(nextCrlf).toContain('Prose mentions id: old-id in body.');

    // Count mismatch → null (two id lines in frontmatter).
    const double = [
      '---',
      'id: old-id',
      'id: old-id',
      'title: X',
      '---',
      'body',
    ].join('\n');
    expect(surgicalReplaceSceneFrontmatterId(double, 'old-id', 'new-id')).toBeNull();

    // book.md whole-value + JSON whitespace
    const book = [
      '---',
      'id: story-old',
      'title: S',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      '# S',
      '',
      '<!-- mythos:spine',
      '[{"dir":"Part 1","chapters":[{"dir":"Chapter 01","id" : "ch-old","title":"C"}]}]',
      '-->',
      '',
    ].join('\n');
    const map = new Map([
      ['story-old', 'story-new'],
      ['ch-old', 'ch-new'],
    ]);
    const bookNext = surgicalReplaceBookIds(book, map, { expectFrontmatterStoryId: 'story-old' })!;
    expect(bookNext).toContain('id: story-new');
    expect(bookNext).toMatch(/"id"\s*:\s*"ch-new"/);
    expect(bookNext).not.toContain('ch-old');

    // Fallbacks shaped like storyId-Part-1-Chapter-01 must match as WHOLE values only.
    const fallbackBook = book.replace('ch-old', 'story-old-Part-1-Chapter-01');
    const fbMap = new Map([
      ['story-old', 'story-new'],
      ['story-old-Part-1-Chapter-01', 'story-new-Part-1-Chapter-01'],
    ]);
    const fbNext = surgicalReplaceBookIds(fallbackBook, fbMap, {
      expectFrontmatterStoryId: 'story-old',
    })!;
    expect(fbNext).toContain('story-new-Part-1-Chapter-01');
    // Must not have mangled a longer substring incorrectly.
    expect(fbNext.match(/story-old/g)).toBeNull();

    // Critic Hard 1: JSON-escaped spine id → refuse entire write (no partial story-id write).
    const escapedBook = [
      '---',
      'id: story-old',
      'title: S',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      '# S',
      '',
      '<!-- mythos:spine',
      // Parsed id is ch"old; raw form is JSON-escaped so a naive regex misses it.
      '[{"dir":"Part 1","chapters":[{"dir":"Chapter 01","id":"ch\\"old","title":"C"}]}]',
      '-->',
      '',
    ].join('\n');
    const escMap = new Map([
      ['story-old', 'story-new'],
      ['ch"old', 'ch-new'],
    ]);
    expect(surgicalReplaceBookIds(escapedBook, escMap, { expectFrontmatterStoryId: 'story-old' })).toBeNull();

    // Map path with duplicate spine ids → refuse (ambiguous without folder scope).
    const dupSpineBook = [
      '---',
      'id: story-old',
      'title: S',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      '# S',
      '',
      '<!-- mythos:spine',
      JSON.stringify([
        {
          dir: 'Part 1',
          chapters: [
            { dir: 'Chapter 01', id: 'ch-old', title: 'C1' },
            { dir: 'Chapter 02', id: 'ch-old', title: 'C2' },
          ],
        },
      ]),
      '-->',
      '',
    ].join('\n');
    const dupMap = new Map([
      ['story-old', 'story-new'],
      ['ch-old', 'ch-new'],
    ]);
    expect(surgicalReplaceBookIds(dupSpineBook, dupMap, { expectFrontmatterStoryId: 'story-old' })).toBeNull();

    // Folder-scoped: only the loser chapter slot is rewritten; winner keeps id.
    const loserOnly = surgicalReplaceBookIds(dupSpineBook, new Map(), {
      chapterFolders: [
        { partDir: 'Part 1', chapterDir: 'Chapter 02', oldId: 'ch-old', newId: 'ch-loser' },
      ],
    })!;
    expect(loserOnly).toContain('"id":"ch-loser"');
    expect(loserOnly).toContain('"id":"ch-old"'); // winner Chapter 01 untouched
    const spineJson = loserOnly.slice(
      loserOnly.indexOf('<!-- mythos:spine') + '<!-- mythos:spine'.length,
      loserOnly.indexOf('-->'),
    );
    const parsedSpine = JSON.parse(spineJson.trim());
    expect(parsedSpine[0].chapters[0].id).toBe('ch-old');
    expect(parsedSpine[0].chapters[1].id).toBe('ch-loser');
  });

  it('loser rewrite preserves fence when chapter title contains -->', () => {
    // bookFile writes titles with `-->` escaped as `--\u003e`; JSON.parse decodes
    // that back to raw `-->`. Re-serializing without the same escape truncates
    // the spine fence (extra fence-close inside the title JSON string).
    const arrowTitle = 'A --> B';
    const spinePayload = [
      {
        dir: 'Part 1',
        chapters: [
          { dir: 'Chapter 01', id: 'ch-old', title: arrowTitle },
          { dir: 'Chapter 02', id: 'ch-keep', title: 'Safe' },
        ],
      },
    ];
    const escapedSpine = JSON.stringify(spinePayload).replace(/-->/g, '--\\u003e');
    expect(escapedSpine).toContain('--\\u003e');
    expect(escapedSpine).not.toContain('-->');

    const book = [
      '---',
      'id: story-old',
      'title: S',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      '# S',
      '',
      '<!-- mythos:spine',
      escapedSpine,
      '-->',
      '',
    ].join('\n');
    expect((book.match(/-->/g) ?? []).length).toBe(1);

    const next = surgicalReplaceBookIds(book, new Map(), {
      chapterFolders: [
        { partDir: 'Part 1', chapterDir: 'Chapter 01', oldId: 'ch-old', newId: 'ch-loser' },
      ],
    })!;
    expect(next).not.toBeNull();
    expect((next.match(/-->/g) ?? []).length).toBe(1);

    const fenceOpen = '<!-- mythos:spine';
    const afterOpen = next.indexOf(fenceOpen) + fenceOpen.length;
    const end = next.indexOf('-->', afterOpen);
    const spineJson = next.slice(afterOpen, end).trim();
    const parsed = JSON.parse(spineJson) as Array<{
      chapters: Array<{ id: string; title: string }>;
    }>;
    expect(parsed[0].chapters[0].id).toBe('ch-loser');
    expect(parsed[0].chapters[0].title).toBe(arrowTitle);
    expect(parsed[0].chapters[1].id).toBe('ch-keep');
  });

  it('duplicate spine chapter id: winner id stable across repeated scans', () => {
    const result = createMythosVault(tmp, { name: 'DupSpineStable', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeVeynnSeed(result.mythosRoot);
    const story = 'Dup Spine';
    const abs = path.join(result.storyVaultPath, story);
    fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 01'), { recursive: true });
    fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 02'), { recursive: true });
    const shared = 'shared-ch-id';
    fs.writeFileSync(
      path.join(abs, 'book.md'),
      [
        '---',
        'id: dup-spine-story',
        'title: Dup Spine',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# Dup Spine',
        '',
        '<!-- mythos:spine',
        JSON.stringify([
          {
            dir: 'Part 1',
            chapters: [
              { dir: 'Chapter 01', id: shared, title: 'C1' },
              { dir: 'Chapter 02', id: shared, title: 'C2' },
            ],
          },
        ]),
        '-->',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(abs, 'Part 1', 'Chapter 01', 'Scene 01.md'),
      '---\nid: sc-a\ntitle: A\nstatus: draft\n---\na\n',
    );
    fs.writeFileSync(
      path.join(abs, 'Part 1', 'Chapter 02', 'Scene 01.md'),
      '---\nid: sc-b\ntitle: B\nstatus: draft\n---\nb\n',
    );
    writeMythosFile(result.mythosRoot, {
      ...readMythosFile(result.mythosRoot),
      stories: [
        {
          id: 'dup-spine-story',
          title: story,
          folder: story,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const a = scanMythosStoryVault(result.mythosRoot);
    const b = scanMythosStoryVault(result.mythosRoot);
    const c = scanMythosStoryVault(result.mythosRoot);
    const chIds = (m: typeof a) =>
      m.stories
        .find((s) => s.path === story)!
        .chapters.map((ch) => ch.id);
    // Winner (Chapter 01, earlier in story order) keeps shared; loser reminted once then stable.
    expect(chIds(a)[0]).toBe(shared);
    expect(chIds(a)[1]).not.toBe(shared);
    expect(chIds(b)).toEqual(chIds(a));
    expect(chIds(c)).toEqual(chIds(a));
  });
});

describe('F6 idempotent + fresh template + read-only', () => {
  it('idempotent rescan writes nothing; fresh template writes nothing', () => {
    const result = createMythosVault(tmp, { name: 'Idem' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    scanMythosStoryVault(result.mythosRoot); // first may write nothing on clean seed
    const bookPath = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md');
    const before = fs.readFileSync(bookPath);
    const scenePath = path.join(
      result.storyVaultPath,
      VEYNN_STORY_FOLDER,
      'Part 1',
      'Chapter 01',
      'Scene 01.md',
    );
    const sceneBefore = fs.readFileSync(scenePath);
    scanMythosStoryVault(result.mythosRoot);
    expect(fs.readFileSync(bookPath).equals(before)).toBe(true);
    expect(fs.readFileSync(scenePath).equals(sceneBefore)).toBe(true);

    const blank = createMythosVault(tmp, { name: 'BlankFresh', seedDemo: false });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    const m = scanMythosStoryVault(blank.mythosRoot);
    expect(m.stories).toHaveLength(0);
  });

  it('read-only: no throw + unique in-memory id', () => {
    const result = createMythosVault(tmp, { name: 'RO' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copyFolder = `${VEYNN_STORY_FOLDER} copy`;
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );
    // Make copy book.md read-only.
    const copyBook = path.join(result.storyVaultPath, copyFolder, 'book.md');
    fs.chmodSync(copyBook, 0o444);
    expect(() => scanMythosStoryVault(result.mythosRoot)).not.toThrow();
    const after = scanMythosStoryVault(result.mythosRoot);
    expect(dups(after.stories.map((s) => s.id))).toEqual([]);
    // Restore perms for cleanup.
    fs.chmodSync(copyBook, 0o644);
  });
});

describe('F6 manifestHasDuplicateIds + rebuildCacheIfDuplicated', () => {
  it('true/false for each kind', () => {
    expect(manifestHasDuplicateIds({ stories: [{ id: 'a' }, { id: 'b' }], chapters: [], scenes: [] })).toBe(false);
    expect(manifestHasDuplicateIds({ stories: [{ id: 'a' }, { id: 'a' }], chapters: [], scenes: [] })).toBe(true);
    expect(
      manifestHasDuplicateIds({
        stories: [{ id: 'a', chapters: [{ id: 'c1', scenes: [] }, { id: 'c1', scenes: [] }] }],
        chapters: [],
        scenes: [],
      }),
    ).toBe(true);
    expect(
      manifestHasDuplicateIds({
        stories: [
          {
            id: 'a',
            chapters: [{ id: 'c1', scenes: [{ id: 's1' }, { id: 's1' }] }],
          },
        ],
        chapters: [],
        scenes: [],
      }),
    ).toBe(true);
  });

  it('rebuildCacheIfDuplicated: carry sections, keep-on-throw, memo on non-normalized path', () => {
    const result = createMythosVault(tmp, { name: 'Boot' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copyFolder = `${VEYNN_STORY_FOLDER} copy`;
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );
    // Restore duplicate book ids on disk (simulate pre-fix cache world).
    const origBook = fs.readFileSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md'),
      'utf-8',
    );
    fs.writeFileSync(path.join(result.storyVaultPath, copyFolder, 'book.md'), origBook);

    const poisoned = scanMythosStoryVault(result.mythosRoot);
    // Force poison again for cache content: duplicate ids in JSON.
    const shared = poisoned.stories[0].id;
    poisoned.stories.forEach((s) => {
      s.id = shared;
    });
    poisoned.smartFolders = [{ id: 'sf1', name: 'Keep Me', query: 'x' } as never];
    poisoned.suggestions = [{ id: 'sug1' } as never];
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    writeManifest(cachePath, poisoned);
    // Re-duplicate disk books for the rebuild scan.
    fs.writeFileSync(path.join(result.storyVaultPath, copyFolder, 'book.md'), origBook);

    rebuildCacheIfDuplicated(result.mythosRoot, cachePath);
    const rebuilt = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(manifestHasDuplicateIds(rebuilt)).toBe(false);
    expect(rebuilt.smartFolders?.[0]?.id).toBe('sf1');
    expect(rebuilt.suggestions?.[0]?.id).toBe('sug1');

    // Memo: second call with non-normalized path does not re-read even after we re-poison.
    writeManifest(cachePath, poisoned);
    const altPath = path.join(result.storyVaultPath, '.', '.mythos', 'manifest-cache.json');
    rebuildCacheIfDuplicated(result.mythosRoot, altPath);
    // Memo short-circuits before read — file stays poisoned (or whatever we wrote).
    expect(manifestHasDuplicateIds(JSON.parse(fs.readFileSync(cachePath, 'utf-8')))).toBe(true);

    // keep-on-throw (scan throws before write): cache stays untouched.
    _clearDupBootMemoForTests();
    writeManifest(cachePath, poisoned);
    const mythosPath = path.join(result.mythosRoot, 'mythos.json');
    const mythosBak = fs.readFileSync(mythosPath);
    fs.unlinkSync(mythosPath);
    const poisonedBytes = fs.readFileSync(cachePath);
    rebuildCacheIfDuplicated(result.mythosRoot, cachePath);
    expect(fs.readFileSync(cachePath).equals(poisonedBytes)).toBe(true);
    fs.writeFileSync(mythosPath, mythosBak);

    // keep-on-throw restore path: writeCache partial-writes then throws → bytes restored.
    _clearDupBootMemoForTests();
    writeManifest(cachePath, poisoned);
    const beforeRestore = fs.readFileSync(cachePath);
    rebuildCacheIfDuplicatedCore(
      result.mythosRoot,
      cachePath,
      () => ({ stories: [] } as never),
      (p) => {
        fs.writeFileSync(p, '{"partial');
        throw new Error('disk');
      },
      () => result.storyVaultPath,
    );
    expect(fs.readFileSync(cachePath).equals(beforeRestore)).toBe(true);
  });

  it('Probe H4: warm clean cache + untracked book.md folder → boot rescan shows copy', () => {
    const result = createMythosVault(tmp, { name: 'WarmH4' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Warm clean cache (unique ids, only tracked story).
    const warm = scanMythosStoryVault(result.mythosRoot);
    expect(warm.stories).toHaveLength(1);
    const cachePath = resolveManifestPath(result.storyVaultPath);
    writeManifest(cachePath, warm);
    expect(manifestHasDuplicateIds(JSON.parse(fs.readFileSync(cachePath, 'utf-8')))).toBe(false);

    // Finder-copy AFTER cache warm — copy is invisible without H4 rescan.
    const copyFolder = `${VEYNN_STORY_FOLDER} copy`;
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );

    _clearDupBootMemoForTests();
    rebuildCacheIfDuplicated(result.mythosRoot, cachePath);
    const after = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(after.stories.map((s: { path: string }) => s.path).sort()).toEqual(
      [VEYNN_STORY_FOLDER, copyFolder].sort(),
    );
    expect(manifestHasDuplicateIds(after)).toBe(false);
    const copyEntry = after.stories.find((s: { path: string }) => s.path === copyFolder)!;
    const origEntry = after.stories.find((s: { path: string }) => s.path === VEYNN_STORY_FOLDER)!;
    expect(copyEntry.id).not.toBe(origEntry.id);
    // Disk write-back re-IDed the copy book.
    const copyBook = fs.readFileSync(path.join(result.storyVaultPath, copyFolder, 'book.md'), 'utf-8');
    expect(copyBook).not.toContain(`id: ${origEntry.id}`);
  });
});
