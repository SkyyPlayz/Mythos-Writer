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
});
