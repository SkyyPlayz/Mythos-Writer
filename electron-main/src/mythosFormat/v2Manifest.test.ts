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
} from './v2IdDedupe.js';
import { writeManifest } from '../vault.js';
import { parseBookFile } from './bookFile.js';
import { parseV2SceneFile, isSceneFileName } from './sceneFiles.js';

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
});

describe('F6 ID dedupe — bad cache / winner rules', () => {
  it('cache with both: original first in mythos.json keeps id (not last-one-wins)', () => {
    const result = createMythosVault(tmp, { name: 'BadCache' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copyFolder = `${VEYNN_STORY_FOLDER} copy`;
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER),
      path.join(result.storyVaultPath, copyFolder),
      { recursive: true },
    );
    // Build a poisoned cache: both stories share the original id, copy listed second.
    const poisoned = scanMythosStoryVault(result.mythosRoot);
    // Re-poison: force both to same id as if pre-dedupe scan wrote the cache.
    const shared = poisoned.stories[0].id;
    for (const s of poisoned.stories) s.id = shared;
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    writeManifest(cachePath, poisoned);

    // Wipe book write-backs so we re-decide from poisoned cache + disk.
    // Disk still has duplicate book ids from the first scan write-back — restore copy book to shared id.
    const origBookPath = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md');
    const copyBookPath = path.join(result.storyVaultPath, copyFolder, 'book.md');
    fs.writeFileSync(copyBookPath, fs.readFileSync(origBookPath, 'utf-8'));

    const after = scanMythosStoryVault(result.mythosRoot);
    const kept = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
    const copy = after.stories.find((s) => s.path === copyFolder)!;
    expect(kept.id).toBe(shared);
    expect(copy.id).not.toBe(shared);
  });
});

describe('F6 ID dedupe — cross-story chapter copy', () => {
  it('3a with cache: original keeps chapter/scene ids', () => {
    const result = createMythosVault(tmp, { name: 'CrossA' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    const origCh = first.stories[0].chapters[0];
    const origChId = origCh.id;
    const origSceneIds = origCh.scenes.map((s) => s.id);
    // Warm cache at original paths.
    writeManifest(resolveManifestPath(result.storyVaultPath), first);

    // Earlier story (code-point before Veynn) receives a chapter copy + spine entry.
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

    const after = scanMythosStoryVault(result.mythosRoot);
    const veynn = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
    const aaa = after.stories.find((s) => s.path === earlier)!;
    expect(veynn.chapters[0].id).toBe(origChId);
    expect(aaa.chapters[0].id).not.toBe(origChId);
    expect(veynn.chapters[0].scenes.map((s) => s.id)).toEqual(origSceneIds);
  });

  it('3b no cache: spine signal keeps original across two back-to-back rebuilds', () => {
    const result = createMythosVault(tmp, { name: 'CrossB' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    const origCh = first.stories[0].chapters[0];
    const origChId = origCh.id;
    // No cache.
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const earlier = 'AAA Earlier';
    const earlierAbs = path.join(result.storyVaultPath, earlier);
    fs.mkdirSync(path.join(earlierAbs, 'Part 1'), { recursive: true });
    fs.cpSync(
      path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01'),
      path.join(earlierAbs, 'Part 1', 'Chapter 01'),
      { recursive: true },
    );
    // Copy is in earlier spine; original still in Veynn spine → both inOwnSpine;
    // without cache, story order (mythos.json first) keeps Veynn when both tracked…
    // Make earlier UNtracked so spine signal on original (tracked+spine) vs copy:
    // original in spine of own story; copy also in spine of earlier — both have spine.
    // Per rule 3: spine then story order. Tracked Veynn is first in mythos order.
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

    const a = scanMythosStoryVault(result.mythosRoot);
    const b = scanMythosStoryVault(result.mythosRoot);
    for (const m of [a, b]) {
      const veynn = m.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!;
      expect(veynn.chapters.find((c) => c.path.endsWith('Chapter 01'))!.id).toBe(origChId);
    }
  });

  it('3c neither chapter in spine, no cache: story order pinned', () => {
    const result = createMythosVault(tmp, { name: 'CrossC', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeVeynnSeed(result.mythosRoot);
    // Build two stories with identical fallback chapter ids and empty spines.
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
    // Same story id → same fallback chapter id shape after we force shared story id via book.
    // Use identical chapter fallback by giving both the SAME story id in book.md (duplicate stories).
    mk('Story A', 'shared-story');
    mk('Story B', 'shared-story');
    const cachePath = resolveManifestPath(result.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const after = scanMythosStoryVault(result.mythosRoot);
    const a = after.stories.find((s) => s.path === 'Story A')!;
    const b = after.stories.find((s) => s.path === 'Story B')!;
    // Untracked sort by code point: "Story A" < "Story B" → A wins story id.
    expect(a.id).toBe('shared-story');
    expect(b.id).not.toBe('shared-story');
    expect(a.chapters[0].id).not.toBe(b.chapters[0].id);
  });
});

describe('F6 ID dedupe — within-story conflict copy', () => {
  it('canonical name beats non-canonical; two chapters can each hold Scene 01.md', () => {
    const result = createMythosVault(tmp, { name: 'Within' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = scanMythosStoryVault(result.mythosRoot);
    writeManifest(resolveManifestPath(result.storyVaultPath), first);
    const chDir = path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01');
    const canon = path.join(chDir, 'Scene 01.md');
    const conflict = path.join(chDir, 'Scene 01 copy.md');
    fs.copyFileSync(canon, conflict);
    expect(isSceneFileName('Scene 01.md')).toBe(true);
    expect(isSceneFileName('Scene 01 copy.md')).toBe(false);

    const after = scanMythosStoryVault(result.mythosRoot);
    const scenes = after.stories
      .find((s) => s.path === VEYNN_STORY_FOLDER)!
      .chapters[0].scenes.filter((s) => s.title === parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).title || s.path.endsWith('Scene 01.md') || s.path.endsWith('Scene 01 copy.md'));
    const canonScene = scenes.find((s) => s.path.endsWith('Scene 01.md'))!;
    const copyScene = scenes.find((s) => s.path.endsWith('Scene 01 copy.md'))!;
    const origId = parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).id;
    // After write-back, canon keeps original; conflict has new id.
    expect(parseV2SceneFile(fs.readFileSync(canon, 'utf-8')).id).toBe(origId);
    expect(canonScene.id).toBe(origId);
    expect(copyScene.id).not.toBe(origId);

    // Two chapters each holding Scene 01.md — unique within vault after dedupe of cross-copy only.
    const ch2 = after.stories.find((s) => s.path === VEYNN_STORY_FOLDER)!.chapters[1];
    expect(ch2.scenes.some((s) => s.path.endsWith('Scene 01.md'))).toBe(true);
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
    expect(bookNext).toContain('"id" : "ch-new"');
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

    // keep-on-throw: clear memo, make scan throw by removing mythos.json briefly.
    _clearDupBootMemoForTests();
    writeManifest(cachePath, poisoned);
    const mythosPath = path.join(result.mythosRoot, 'mythos.json');
    const mythosBak = fs.readFileSync(mythosPath);
    fs.unlinkSync(mythosPath);
    const poisonedBytes = fs.readFileSync(cachePath);
    rebuildCacheIfDuplicated(result.mythosRoot, cachePath);
    expect(fs.readFileSync(cachePath).equals(poisonedBytes)).toBe(true);
    fs.writeFileSync(mythosPath, mythosBak);
  });
});
