// F6 guard cases from Shield's #1656 review: prior-cache winner rule (c3) and restore-on-throw (d).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMythosVault } from './createVault.js';
import { VEYNN_STORY_FOLDER } from './veynnSeed.js';
import { _clearDetectionCache, resolveManifestPath, readMythosFile, writeMythosFile } from './mythosJson.js';
import { scanMythosStoryVault, _clearDupBootMemoForTests } from './v2Manifest.js';
import { rebuildCacheIfDuplicated as core } from './v2IdDedupe.js';
import { writeManifest } from '../vault.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-guards-'));
  _clearDetectionCache();
  _clearDupBootMemoForTests();
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ids = (s: any) => ({
  ch: s.chapters.map((c: any) => c.id),
  sc: s.chapters.flatMap((c: any) => c.scenes.map((x: any) => x.id)),
});
const COPY = `${VEYNN_STORY_FOLDER} copy`;

describe('F6 dedupe guards', () => {
  it('prior-cache rule: original keeps its ids even when the copy is listed first in mythos.json', () => {
    const r = createMythosVault(tmp, { name: 'F' });
    if (!r.ok) throw new Error('vault');
    const first = scanMythosStoryVault(r.mythosRoot);
    writeManifest(resolveManifestPath(r.storyVaultPath), first);
    const before = ids(first.stories.find((s: any) => s.path === VEYNN_STORY_FOLDER));
    fs.cpSync(path.join(r.storyVaultPath, VEYNN_STORY_FOLDER), path.join(r.storyVaultPath, COPY), { recursive: true });
    const mf = readMythosFile(r.mythosRoot);
    mf.stories.unshift({ id: 'copy-ref', title: COPY, folder: COPY, createdAt: 'x', updatedAt: 'x' } as any);
    writeMythosFile(r.mythosRoot, mf);
    const after = scanMythosStoryVault(r.mythosRoot);
    expect(ids(after.stories.find((s: any) => s.path === VEYNN_STORY_FOLDER))).toEqual(before);
  });

  it('restore-on-throw: a cache write that leaves a partial file and throws is restored byte-for-byte', () => {
    const cache = path.join(tmp, 'c.json');
    const dup = JSON.stringify({ stories: [{ id: 'a' }, { id: 'a' }] });
    fs.writeFileSync(cache, dup);
    core('/m', cache, () => ({ stories: [] } as any), (p: string) => {
      fs.writeFileSync(p, '{"partial');
      throw new Error('disk');
    }, () => '/v');
    expect(fs.readFileSync(cache, 'utf-8')).toBe(dup);
  });

  it('R3: EACCES/read-only registry does not throw repeatedly after memo', () => {
    const cache = path.join(tmp, 'c.json');
    fs.writeFileSync(cache, JSON.stringify({ stories: [{ id: 'a' }, { id: 'a' }] }));
    let resolveCalls = 0;
    const resolveEACCES = () => {
      resolveCalls += 1;
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    // First call: memo set, resolve throws inside try → swallowed.
    expect(() =>
      core('/ro-mythos', cache, () => ({ stories: [] } as any), () => {}, resolveEACCES),
    ).not.toThrow();
    expect(resolveCalls).toBe(1);
    // Second call: memo short-circuits — resolve must not run again.
    expect(() =>
      core('/ro-mythos', cache, () => ({ stories: [] } as any), () => {}, resolveEACCES),
    ).not.toThrow();
    expect(resolveCalls).toBe(1);
  });

  it('R12 story tie-break: untracked duplicate ids pick code-point winner (not localeCompare)', () => {
    // "Zebra" < "apple" by code point; localeCompare prefers "apple".
    const r = createMythosVault(tmp, { name: 'R12Story', seedDemo: false });
    if (!r.ok) throw new Error('vault');
    const cachePath = resolveManifestPath(r.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const mk = (folder: string) => {
      const abs = path.join(r.storyVaultPath, folder);
      fs.mkdirSync(path.join(abs, 'Part 1', 'Chapter 01'), { recursive: true });
      fs.writeFileSync(
        path.join(abs, 'book.md'),
        [
          '---',
          'id: shared-untracked',
          `title: ${folder}`,
          'createdAt: 2026-01-01T00:00:00.000Z',
          'updatedAt: 2026-01-01T00:00:00.000Z',
          '---',
          `# ${folder}`,
          '',
          '<!-- mythos:spine',
          JSON.stringify([
            { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: `${folder}-ch`, title: 'C' }] },
          ]),
          '-->',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(abs, 'Part 1', 'Chapter 01', 'Scene 01.md'),
        `---\nid: ${folder}-sc\ntitle: S\nstatus: draft\n---\nbody\n`,
      );
    };
    mk('Zebra');
    mk('apple');
    // Leave both untracked so rule 2 falls through to code-point folder sort.
    writeMythosFile(r.mythosRoot, { ...readMythosFile(r.mythosRoot), stories: [] });

    const after = scanMythosStoryVault(r.mythosRoot);
    const zebra = after.stories.find((s: any) => s.path === 'Zebra')!;
    const apple = after.stories.find((s: any) => s.path === 'apple')!;
    expect(zebra.id).toBe('shared-untracked');
    expect(apple.id).not.toBe('shared-untracked');
  });

  it('R12 scene tie-break: within-story non-canonical duplicate picks code-point path (not localeCompare)', () => {
    // storyRelPath ends with "Banana notes.md" vs "apple notes.md".
    // Code point → Banana wins; localeCompare → apple wins.
    const r = createMythosVault(tmp, { name: 'R12Scene', seedDemo: false });
    if (!r.ok) throw new Error('vault');
    const cachePath = resolveManifestPath(r.storyVaultPath);
    fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });

    const story = 'R12 Scene Story';
    const chDir = path.join(r.storyVaultPath, story, 'Part 1', 'Chapter 01');
    fs.mkdirSync(chDir, { recursive: true });
    fs.writeFileSync(
      path.join(r.storyVaultPath, story, 'book.md'),
      [
        '---',
        'id: r12-scene-story',
        'title: R12 Scene Story',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '---',
        '# R12 Scene Story',
        '',
        '<!-- mythos:spine',
        JSON.stringify([
          { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'r12-ch', title: 'C' }] },
        ]),
        '-->',
        '',
      ].join('\n'),
    );
    const shared = 'r12-shared-scene';
    for (const name of ['Banana notes.md', 'apple notes.md']) {
      fs.writeFileSync(
        path.join(chDir, name),
        `---\nid: ${shared}\ntitle: ${name}\nstatus: draft\n---\nbody\n`,
      );
    }
    writeMythosFile(r.mythosRoot, {
      ...readMythosFile(r.mythosRoot),
      stories: [
        {
          id: 'r12-scene-story',
          title: story,
          folder: story,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const after = scanMythosStoryVault(r.mythosRoot);
    const scenes = after.stories.find((s: any) => s.path === story)!.chapters[0].scenes;
    const banana = scenes.find((s: any) => s.path.endsWith('Banana notes.md'))!;
    const apple = scenes.find((s: any) => s.path.endsWith('apple notes.md'))!;
    expect(banana.id).toBe(shared);
    expect(apple.id).not.toBe(shared);
  });
});
