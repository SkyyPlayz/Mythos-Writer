// BOOK-BUILDER-V1 S0 — profile validation, print geometry, book.md compare-and-swap.
// No renderer and no bookBuilder IPC in this slice, so there is no e2e path and
// no SafeIpcError seam. IPC exhaust reporting is deferred to S3.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOOK_PRESET_IDS,
  BOOK_STYLE_IDS,
  GUTTER_BANDS,
  MAX_BOOK_PROFILES,
  BookProfilesCapError,
  clampPageCountToGutterBands,
  gutterBandInches,
  pageMarginsInches,
  pageSizeInchesForPreset,
  validateBookProfile,
  validateBookProfiles,
  type BookProfile,
} from './bookBuilder.js';
import { parseBookFile, serializeBookFile } from './mythosFormat/bookFile.js';
import {
  _setBookFileCasBeforeCompareForTests,
  writeBookFileCas,
  BookFileCasExhaustedError,
  BookFileIoError,
} from './vault.js';
import { createRequire } from 'node:module';

// Static import of ../test-utils would pull that .d.ts under tsconfig rootDir
// (src) and break `tsc`. require() keeps the helper outside the program.
const require = createRequire(import.meta.url);
const { makeTestTmp, cleanupTestTmp } = require('../test-utils/tmpdir.mjs') as {
  makeTestTmp: (name: string) => string;
  cleanupTestTmp: () => void;
};

const CREATED = '2026-01-01T00:00:00.000Z';
const UPDATED = '2026-01-02T00:00:00.000Z';

function profile(overrides: Partial<BookProfile> = {}): BookProfile {
  return {
    id: 'p1',
    name: 'Trade paperback',
    presetId: 'kdp-paperback',
    styleId: 'classic',
    language: 'en-US',
    matter: { titlePage: true },
    ...overrides,
  };
}

function bookMarkdown(title = 'T'): string {
  return serializeBookFile({
    id: 'story-1',
    title,
    createdAt: CREATED,
    updatedAt: UPDATED,
    spine: [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-1', title: 'One' }] }],
  });
}

describe('book presets and trim', () => {
  it('lists the four presets and the three styles', () => {
    expect([...BOOK_PRESET_IDS]).toEqual(['kdp-ebook', 'kdp-paperback', 'ingram-print', 'generic-epub']);
    expect([...BOOK_STYLE_IDS]).toEqual(['classic', 'modern', 'fantasy']);
  });

  it('print presets are 6 by 9 inches; ebook presets have no trim', () => {
    expect(pageSizeInchesForPreset('kdp-paperback')).toEqual({ width: 6, height: 9 });
    expect(pageSizeInchesForPreset('ingram-print')).toEqual({ width: 6, height: 9 });
    expect(pageSizeInchesForPreset('kdp-ebook')).toBeNull();
    expect(pageSizeInchesForPreset('generic-epub')).toBeNull();
  });
});

describe('gutter bands', () => {
  it('locks the KDP inside-gutter table', () => {
    expect(GUTTER_BANDS.map((band) => [band.min, band.max, band.inches])).toEqual([
      [24, 150, 0.375],
      [151, 300, 0.5],
      [301, 500, 0.625],
      [501, 700, 0.75],
      [701, 828, 0.875],
    ]);
  });

  it('pins both sides of every boundary and both clamps', () => {
    const expected: Array<[number, number]> = [
      [0, 0.375],
      [23, 0.375],
      [24, 0.375],
      [25, 0.375],
      [149, 0.375],
      [150, 0.375],
      [151, 0.5],
      [152, 0.5],
      [299, 0.5],
      [300, 0.5],
      [301, 0.625],
      [302, 0.625],
      [499, 0.625],
      [500, 0.625],
      [501, 0.75],
      [502, 0.75],
      [699, 0.75],
      [700, 0.75],
      [701, 0.875],
      [702, 0.875],
      [827, 0.875],
      [828, 0.875],
      [829, 0.875],
      [10_000, 0.875],
    ];
    for (const [pages, inches] of expected) {
      expect(gutterBandInches(pages), `page count ${pages}`).toBe(inches);
    }
    expect(clampPageCountToGutterBands(23)).toBe(24);
    expect(clampPageCountToGutterBands(829)).toBe(828);
    expect(clampPageCountToGutterBands(Number.NaN)).toBe(24);
    expect(gutterBandInches(-4)).toBe(0.375);
  });

  it('uses symmetric margins: side is max(gutter, 0.5in), top and bottom are 0.5in', () => {
    const thin = pageMarginsInches(100);
    expect(thin).toEqual({ top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 });
    expect(gutterBandInches(100)).toBe(0.375);

    const thick = pageMarginsInches(701);
    expect(thick.left).toBe(0.875);
    expect(thick.right).toBe(thick.left);
    expect(thick.top).toBe(0.5);
    expect(thick.bottom).toBe(0.5);

    for (const pages of [24, 151, 301, 501, 828, 23, 900]) {
      const margins = pageMarginsInches(pages);
      expect(margins.left).toBe(margins.right);
      expect(margins.top).toBe(0.5);
      expect(margins.bottom).toBe(0.5);
      expect(margins.left).toBe(Math.max(gutterBandInches(pages), 0.5));
    }
  });
});

describe('validateBookProfile', () => {
  it('accepts a print profile and a blank ebook isbn', () => {
    const print = validateBookProfile(profile({ isbn: '9780000000000', author: 'A. Writer', copyrightYear: 2026 }));
    expect(print.ok).toBe(true);
    if (!print.ok) return;
    expect(print.profile.isbn).toBe('9780000000000');

    const ebook = validateBookProfile(profile({ presetId: 'kdp-ebook', isbn: '' }));
    expect(ebook.ok).toBe(true);
    if (!ebook.ok) return;
    expect(ebook.profile.isbn).toBe('');

    const generic = validateBookProfile(profile({ presetId: 'generic-epub', styleId: 'fantasy', language: 'fr', isbn: '' }));
    expect(generic.ok).toBe(true);
  });

  it('rejects empty language, bad enums, a blank print isbn, and a missing matter record', () => {
    expect(validateBookProfile(profile({ language: '' })).ok).toBe(false);
    expect(validateBookProfile(profile({ language: '   ' })).ok).toBe(false);
    expect(validateBookProfile(profile({ language: 'en_US' })).ok).toBe(false);
    expect(validateBookProfile(profile({ language: 'e' })).ok).toBe(false);
    expect(validateBookProfile({ ...profile(), presetId: 'letter' }).ok).toBe(false);
    expect(validateBookProfile({ ...profile(), styleId: 'noir' }).ok).toBe(false);
    expect(validateBookProfile(profile({ id: '  ' })).ok).toBe(false);
    expect(validateBookProfile(profile({ name: '' })).ok).toBe(false);
    expect(validateBookProfile({ ...profile(), matter: null }).ok).toBe(false);
    expect(validateBookProfile({ ...profile(), matter: [] }).ok).toBe(false);
    expect(validateBookProfile(profile({ isbn: '' })).ok).toBe(false);
    expect(validateBookProfile(profile({ author: '' })).ok).toBe(false);
    expect(validateBookProfile(profile({ publisher: '   ' })).ok).toBe(false);
    expect(validateBookProfile(profile({ copyrightYear: 2026.5 })).ok).toBe(false);
    expect(validateBookProfile(profile()).ok).toBe(true);
  });

  it('rejects more than 50 profiles', () => {
    const fifty = Array.from({ length: MAX_BOOK_PROFILES }, (_, i) => profile({ id: `p${i}`, name: `N${i}` }));
    const over = [...fifty, profile({ id: 'extra', name: 'Extra' })];
    expect(validateBookProfiles(fifty).ok).toBe(true);
    const rejected = validateBookProfiles(over);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.field).toBe('cap');
    expect(() =>
      serializeBookFile({
        id: 's',
        title: 'T',
        createdAt: CREATED,
        updatedAt: UPDATED,
        spine: [],
        profiles: over,
      }),
    ).toThrow(BookProfilesCapError);
  });
});

describe('writeBookFileCas', () => {
  afterEach(() => {
    _setBookFileCasBeforeCompareForTests(null);
    cleanupTestTmp();
  });

  function vault(): { root: string; abs: string } {
    const root = makeTestTmp('book-cas');
    return { root, abs: path.join(root, 'book.md') };
  }

  it('mutate(null) creates a book with no profiles and no invented identity fields', () => {
    const { root, abs } = vault();
    const seen: Array<string | null> = [];
    writeBookFileCas(root, 'book.md', (prev) => {
      seen.push(prev);
      return bookMarkdown('Created');
    });
    expect(seen).toEqual([null]);
    const text = fs.readFileSync(abs, 'utf8');
    expect(text).not.toContain('mythos:book-profiles');
    expect(text).not.toMatch(/^isbn:/m);
    expect(text).not.toMatch(/^author:/m);
    expect(text).not.toMatch(/^publisher:/m);
    const parsed = parseBookFile(text);
    expect(parsed.profiles).toBeUndefined();
    expect(parsed.extraFrontmatter).toBeUndefined();
    expect(parsed.title).toBe('Created');
  });

  it('re-runs mutate on the fresh bytes when the file changes before compare', () => {
    const { root, abs } = vault();
    fs.writeFileSync(abs, bookMarkdown('Old'));
    const seen: Array<string | null> = [];
    writeBookFileCas(
      root,
      'book.md',
      (prev) => {
        seen.push(prev);
        const current = parseBookFile(prev ?? '');
        return serializeBookFile({ ...current, title: 'Synced' });
      },
      {
        beforeCompare() {
          if (seen.length === 1) {
            const current = parseBookFile(fs.readFileSync(abs, 'utf8'));
            fs.writeFileSync(abs, serializeBookFile({ ...current, profiles: [profile()] }));
          }
        },
      },
    );
    expect(seen).toHaveLength(2);
    expect(parseBookFile(seen[1] ?? '').profiles?.[0]?.id).toBe('p1');
    const disk = parseBookFile(fs.readFileSync(abs, 'utf8'));
    expect(disk.title).toBe('Synced');
    expect(disk.profiles).toEqual([expect.objectContaining({ id: 'p1', name: 'Trade paperback' })]);
  });

  it('exhausts after three mismatched compares and does not write the stale snapshot', () => {
    const { root, abs } = vault();
    fs.writeFileSync(abs, 'ORIGINAL');
    const mutate = vi.fn((prev: string | null) => `MUTATED:${prev ?? ''}`);
    let races = 0;
    let caught: unknown;
    expect(() => {
      try {
        writeBookFileCas(root, 'book.md', mutate, {
          beforeCompare() {
            races += 1;
            fs.writeFileSync(abs, `RACER-${races}`);
          },
        });
      } catch (err) {
        caught = err;
        throw err;
      }
    }).toThrow(BookFileCasExhaustedError);
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(races).toBe(3);
    const disk = fs.readFileSync(abs, 'utf8');
    expect(disk).toBe('RACER-3');
    expect(disk).not.toContain('MUTATED:');
    expect(caught).toBeInstanceOf(BookFileCasExhaustedError);
    expect((caught as Error).message).toBe('book-file-cas-exhausted');
    expect((caught as Error).message).not.toContain(root);
    expect((caught as Error).message).not.toContain('book.md');
  });

  it('is synchronous: not a thenable, and it reads with readFileSync only', () => {
    const { root } = vault();
    expect(writeBookFileCas.constructor.name).toBe('Function');
    const lstatSpy = vi.spyOn(fs, 'lstatSync');
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const promiseRead = vi.spyOn(fs.promises, 'readFile');
    const promiseWrite = vi.spyOn(fs.promises, 'writeFile');
    const ret = writeBookFileCas(root, 'book.md', () => bookMarkdown('Sync'));
    writeBookFileCas(root, 'book.md', (prev) => prev ?? bookMarkdown('Sync'));
    expect(ret).toBeUndefined();
    expect((ret as { then?: unknown } | undefined)?.then).toBeUndefined();
    expect(lstatSpy).toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalled();
    expect(promiseRead).not.toHaveBeenCalled();
    expect(promiseWrite).not.toHaveBeenCalled();
    lstatSpy.mockRestore();
    readSpy.mockRestore();
    promiseRead.mockRestore();
    promiseWrite.mockRestore();
  });

  it('does not create a book when a present file then fails to read with ENOENT', () => {
    const { root, abs } = vault();
    fs.writeFileSync(abs, 'KEEP');
    const orig = fs.readFileSync;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (p === abs) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return orig.call(fs, p, ...(args as [BufferEncoding?]));
    }) as typeof fs.readFileSync);
    let caught: unknown;
    try {
      expect(() => {
        try {
          writeBookFileCas(root, 'book.md', () => 'NEW');
        } catch (err) {
          caught = err;
          throw err;
        }
      }).toThrow(BookFileIoError);
    } finally {
      spy.mockRestore();
    }
    expect((caught as BookFileIoError).code).toBe('ENOENT');
    expect((caught as Error).message).toBe('book-file-io');
    expect((caught as Error).message).not.toContain(abs);
    expect(orig.call(fs, abs, 'utf8')).toBe('KEEP');
  });

  it('refuses a parent directory symlink that escapes the vault', () => {
    const parent = makeTestTmp('book-cas-parent');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'book.md'), 'secret');
    const root = path.join(parent, 'vault');
    fs.mkdirSync(root);
    fs.symlinkSync(outside, path.join(root, 'Story'));
    expect(() => writeBookFileCas(root, 'Story/book.md', () => 'pwned')).toThrow(/symlink|Path traversal denied/);
    expect(fs.readFileSync(path.join(outside, 'book.md'), 'utf8')).toBe('secret');
    expect(fs.readdirSync(outside)).toEqual(['book.md']);
  });

  it('refuses a symlink book.md and leaves the link target unchanged', () => {
    const parent = makeTestTmp('book-cas-link');
    const outside = path.join(parent, 'outside.md');
    fs.writeFileSync(outside, 'secret');
    const root = path.join(parent, 'vault');
    fs.mkdirSync(root);
    fs.symlinkSync(outside, path.join(root, 'book.md'));
    expect(() => writeBookFileCas(root, 'book.md', () => 'pwned')).toThrow(/symlink/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('secret');
  });
});
