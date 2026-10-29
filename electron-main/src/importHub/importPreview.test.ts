// #1765 — import hub preview builder + single-use token cache.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildExcerpt,
  countWords,
  createImportSession,
  IMPORT_SESSION_MAX,
  IMPORT_SESSION_TTL_MS,
  scrubAbsolutePaths,
  SOURCE_LABELS,
  takeImportSession,
  _clearImportSessionsForTest,
  _importSessionCountForTest,
} from './importPreview.js';
import type { ImportPlan } from './types.js';

const SOURCE = { realPath: '/home/writer/Private Books/Secret Novel.docx', size: 1234, mtimeMs: 1700000000000 };
const CTX = { canCommit: true };

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    source: { kind: 'docx', name: 'Secret Novel.docx' },
    story: {
      title: 'The Gate',
      partCount: 0,
      structure: 'headings',
      chapters: [
        {
          title: 'Chapter Two',
          order: 1,
          scenes: [{ title: 'Scene 1', order: 0, prose: 'Three more words.' }],
        },
        {
          title: 'Chapter One',
          order: 0,
          scenes: [
            { title: 'Empty', order: 0, prose: '   ' },
            { title: 'Arrival', order: 1, prose: '**Bold** start and *italic* end.\n\nSecond <u>para</u>.' },
          ],
        },
      ],
    },
    notes: [
      { title: 'Mira', folder: '', body: 'A thief.', entityType: 'character' },
      { title: 'Research', folder: 'Notes/World', body: 'stuff' },
      { title: 'Veynn', folder: '', body: 'A city.', entityType: 'location' },
    ],
    warnings: ['Images were skipped.', 'Images were skipped.', '  ', 'Footnotes were dropped.'],
    ...overrides,
  };
}

beforeEach(() => {
  _clearImportSessionsForTest();
});

afterEach(() => {
  vi.useRealTimers();
  _clearImportSessionsForTest();
});

describe('countWords', () => {
  it('ignores Markdown syntax', () => {
    expect(countWords('**Bold** start and *italic* end.')).toBe(5);
    expect(countWords('# Heading here\n\n> quoted words\n\n- list item')).toBe(6);
    expect(countWords('Centered line {.center}')).toBe(2);
    expect(countWords('a <u>b</u> ~~c~~ \\*d\\* [link text](http://x.y)')).toBe(6);
    expect(countWords('***\n\n* * *')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

describe('buildPreview via createImportSession', () => {
  it('converts the plan in order, with labels, counts, notes/entities split and deduped warnings', () => {
    const preview = createImportSession(plan(), SOURCE, CTX);
    expect(preview.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(preview.source).toEqual({ kind: 'docx', label: 'Word document', name: 'Secret Novel.docx' });
    expect(preview.story?.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(preview.story?.chapters[0].scenes).toEqual([
      { title: 'Empty', words: 0 },
      { title: 'Arrival', words: 7 },
    ]);
    expect(preview.story?.chapters[0].words).toBe(7);
    expect(preview.story?.words).toBe(10);
    expect(preview.story?.excerpt).toBe('**Bold** start and *italic* end.\n\nSecond <u>para</u>.');
    expect(preview.notes).toEqual([{ title: 'Research', folder: 'Notes/World' }]);
    expect(preview.entities).toEqual([
      { title: 'Mira', type: 'character' },
      { title: 'Veynn', type: 'location' },
    ]);
    expect(preview.warnings).toEqual(['Images were skipped.', 'Footnotes were dropped.']);
    expect(preview.canCommit).toBe(true);
    expect(preview.commitBlockedReason).toBeUndefined();
  });

  it('carries the blocked reason when commit is not possible', () => {
    const preview = createImportSession(plan(), SOURCE, { canCommit: false, commitBlockedReason: 'Open a vault.' });
    expect(preview.canCommit).toBe(false);
    expect(preview.commitBlockedReason).toBe('Open a vault.');
  });

  it('labels every source kind', () => {
    expect(SOURCE_LABELS).toEqual({
      docx: 'Word document',
      'gdoc-html': 'Google Docs (web page export)',
      html: 'Web page',
      markdown: 'Markdown file',
      'markdown-folder': 'Markdown folder',
      scrivener: 'Scrivener project',
      epub: 'ePub book',
      rtf: 'Rich Text (.rtf)',
      text: 'Plain text',
    });
  });

  it('contains no absolute path, even when the importer leaked one', () => {
    const leaky = plan({
      source: { kind: 'docx', name: '/home/writer/Private Books/Secret Novel.docx' },
      notes: [{ title: 'N', folder: '/home/writer/Private Books', body: '' }],
      warnings: [
        'Could not read /home/writer/Private Books/media/image1.png',
        'Skipped C:\\Users\\writer\\Books\\pic.png',
      ],
    });
    const preview = createImportSession(leaky, SOURCE, CTX);
    const json = JSON.stringify(preview);
    expect(json).not.toContain('/home/writer');
    expect(json).not.toContain('C:\\\\Users');
    expect(preview.source.name).toBe('Secret Novel.docx');
    expect(preview.warnings).toEqual(['Could not read image1.png', 'Skipped pic.png']);
  });

  it('returns a null story for a notes-only plan', () => {
    const preview = createImportSession(plan({ story: null }), SOURCE, CTX);
    expect(preview.story).toBeNull();
  });
});

describe('buildExcerpt', () => {
  it('cuts at a word boundary near 600 chars', () => {
    const prose = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const excerpt = buildExcerpt(plan({
      story: { title: 'T', partCount: 0, structure: 'none', chapters: [{ title: 'C', order: 0, scenes: [{ title: 'S', order: 0, prose }] }] },
    }));
    expect(excerpt.endsWith('…')).toBe(true);
    const body = excerpt.slice(0, -1);
    expect([...body].length).toBeLessThanOrEqual(600);
    expect(prose.startsWith(body)).toBe(true);
    // Ends on a whole word.
    expect(prose[body.length]).toBe(' ');
  });
});

describe('scrubAbsolutePaths', () => {
  it('keeps relative paths and plain text', () => {
    expect(scrubAbsolutePaths('Part 1/Chapter 01 is fine and/or ok')).toBe('Part 1/Chapter 01 is fine and/or ok');
    expect(scrubAbsolutePaths('see /tmp/x/y.md')).toBe('see y.md');
  });
});

describe('import session store', () => {
  it('is single-use', () => {
    const { token } = createImportSession(plan(), SOURCE, CTX);
    const first = takeImportSession(token);
    expect(first?.plan.story?.title).toBe('The Gate');
    expect(first?.source).toEqual(SOURCE);
    expect(takeImportSession(token)).toBeNull();
  });

  it('rejects unknown and non-string tokens', () => {
    expect(takeImportSession('nope')).toBeNull();
    expect(takeImportSession(undefined as unknown as string)).toBeNull();
    expect(takeImportSession('')).toBeNull();
  });

  it('expires after 15 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = createImportSession(plan(), SOURCE, CTX).token;
    const b = createImportSession(plan(), SOURCE, CTX).token;
    vi.setSystemTime(Date.now() + IMPORT_SESSION_TTL_MS - 1000);
    expect(takeImportSession(a)).not.toBeNull();
    vi.setSystemTime(Date.now() + 2000);
    expect(takeImportSession(b)).toBeNull();
    expect(IMPORT_SESSION_TTL_MS).toBe(15 * 60 * 1000);
  });

  it(`keeps at most ${IMPORT_SESSION_MAX} sessions, evicting the oldest`, () => {
    const tokens = Array.from({ length: IMPORT_SESSION_MAX + 1 }, () => createImportSession(plan(), SOURCE, CTX).token);
    expect(_importSessionCountForTest()).toBe(IMPORT_SESSION_MAX);
    expect(takeImportSession(tokens[0])).toBeNull();
    for (const t of tokens.slice(1)) expect(takeImportSession(t)).not.toBeNull();
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
