import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMythosVault } from './mythosFormat/createVault.js';
import { scanMythosStoryVault } from './mythosFormat/v2Manifest.js';
import { serializeV2SceneFile } from './mythosFormat/sceneFiles.js';
import { serializeBookFile } from './mythosFormat/bookFile.js';
import { sanitizeIpcError } from './ipcErrors.js';
import {
  partIdFromChapterPath,
  resolveNotesTierFromManifest,
  runNotesTierContext,
} from './notesTierContext.js';

describe('partIdFromChapterPath', () => {
  it('extracts Part N from a v2 chapter path', () => {
    expect(partIdFromChapterPath('My Story/Part 2/Chapter 01')).toBe('Part 2');
    expect(partIdFromChapterPath('My Story/Chapter 01')).toBeNull();
  });
});

describe('resolveNotesTierFromManifest', () => {
  it('uses legacy story.parts when present', () => {
    const res = resolveNotesTierFromManifest(
      {
        stories: [
          {
            id: 'book-1',
            parts: [{ id: 'p-legacy', chapters: [{ id: 'ch-1' }] }],
            chapters: [
              {
                id: 'ch-1',
                path: 'Story/Part 9/Chapter 01',
                scenes: [{ id: 'sc-1' }],
              },
            ],
          },
        ],
      },
      'sc-1',
    );
    expect(res).toEqual({
      ok: true,
      bookId: 'book-1',
      partId: 'p-legacy',
      chapterId: 'ch-1',
      sceneId: 'sc-1',
    });
  });

  it('rejects invalid scene ids', () => {
    expect(resolveNotesTierFromManifest({ stories: [] }, '../x').ok).toBe(false);
  });

  it('runNotesTierContext returns path-free error when readManifest throws', () => {
    const res = runNotesTierContext(
      'sc-1',
      () => {
        throw new Error('ENOENT: no such file or directory, open \'/Users/sky/Vault/.mythos/manifest.json\'');
      },
      (err) => sanitizeIpcError('notes:tierContext', err),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/\/Users\//);
    expect(res.error).not.toMatch(/manifest\.json/);
  });
});

describe('resolveNotesTierFromManifest — seeded 2-part v2 vault (no mocked partId)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tier-v2-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves Part 1 and Part 2 from real disk structure when story.parts is empty', () => {
    const created = createMythosVault(tmp, { name: 'TwoPart', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const storyFolder = 'Two Part Story';
    const storyAbs = path.join(created.storyVaultPath, storyFolder);
    for (const part of ['Part 1', 'Part 2'] as const) {
      const chAbs = path.join(storyAbs, part, 'Chapter 01');
      fs.mkdirSync(chAbs, { recursive: true });
      fs.writeFileSync(
        path.join(chAbs, 'Scene 01.md'),
        serializeV2SceneFile({
          id: part === 'Part 1' ? 'scene-in-part-1' : 'scene-in-part-2',
          title: `${part} Scene`,
          status: 'draft',
          prose: `${part} body`,
        }),
      );
    }
    fs.writeFileSync(
      path.join(storyAbs, 'book.md'),
      serializeBookFile({
        id: 'two-part-book',
        title: 'Two Part Story',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        spine: [
          {
            dir: 'Part 1',
            chapters: [{ dir: 'Chapter 01', id: 'ch-p1', title: 'Ch1' }],
          },
          {
            dir: 'Part 2',
            chapters: [{ dir: 'Chapter 01', id: 'ch-p2', title: 'Ch2' }],
          },
        ],
      }),
    );

    const manifest = scanMythosStoryVault(created.mythosRoot);
    const story = manifest.stories.find((s) => s.id === 'two-part-book');
    expect(story).toBeDefined();
    if (!story) return;

    // Probe FAIL root cause: v2 cache never fills story.parts
    expect(story.parts ?? []).toEqual([]);
    expect(story.chapters.length).toBeGreaterThanOrEqual(2);
    for (const ch of story.chapters) {
      expect(ch.path).toMatch(/Part [12]/);
    }

    const p1 = resolveNotesTierFromManifest(manifest, 'scene-in-part-1');
    expect(p1.ok).toBe(true);
    expect(p1.partId).toBe('Part 1');
    expect(p1.bookId).toBe('two-part-book');
    expect(p1.chapterId).toBeTruthy();

    const p2 = resolveNotesTierFromManifest(manifest, 'scene-in-part-2');
    expect(p2.ok).toBe(true);
    expect(p2.partId).toBe('Part 2');
    expect(p2.bookId).toBe('two-part-book');
  });
});
