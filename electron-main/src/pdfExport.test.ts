// Beta 4 M14 — buildManuscriptHtml unit tests (PDF print pipeline input).

import { describe, it, expect } from 'vitest';
import { buildManuscriptHtml, escapeHtml } from './pdfExport';

const CHAPTERS = [
  {
    title: 'The Descent',
    scenes: [
      { title: 'The Watcher', prose: 'First paragraph.\n\nSecond paragraph.' },
      { title: 'Undercity', prose: 'Deeper still.' },
    ],
  },
  {
    title: 'The Gate',
    scenes: [{ title: 'Arrival', prose: 'They arrive.' }],
  },
];

describe('escapeHtml', () => {
  it('escapes &, <, > and quotes', () => {
    expect(escapeHtml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
  });
});

describe('buildManuscriptHtml', () => {
  it('produces a complete HTML document with the title page', () => {
    const html = buildManuscriptHtml({ title: 'My Book', chapters: CHAPTERS });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My Book</title>');
    expect(html).toContain('<h1>My Book</h1>');
    expect(html).toContain('— END OF DRAFT —');
  });

  it('renders every chapter with a numbered kicker and every scene title', () => {
    const html = buildManuscriptHtml({ title: 'T', chapters: CHAPTERS });
    expect(html).toContain('Chapter 1');
    expect(html).toContain('Chapter 2');
    expect(html).toContain('The Descent');
    expect(html).toContain('The Gate');
    expect(html).toContain('The Watcher');
    expect(html).toContain('Undercity');
  });

  it('splits prose into paragraphs on double newlines', () => {
    const html = buildManuscriptHtml({ title: 'T', chapters: CHAPTERS });
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('omits synopsis and separators by default (pre-M14 behavior preserved)', () => {
    const html = buildManuscriptHtml({
      title: 'T',
      synopsis: 'A tale.',
      chapters: CHAPTERS,
    });
    expect(html).not.toContain('Synopsis');
    expect(html).not.toContain('◆ ◆ ◆');
  });

  it('includes a synopsis page when includeSynopsis is set', () => {
    const html = buildManuscriptHtml({
      title: 'T',
      synopsis: 'A tale of two tests.',
      chapters: CHAPTERS,
      options: { includeSynopsis: true },
    });
    expect(html).toContain('Synopsis');
    expect(html).toContain('A tale of two tests.');
  });

  it('skips the synopsis page when the story has no synopsis text', () => {
    const html = buildManuscriptHtml({
      title: 'T',
      synopsis: '   ',
      chapters: CHAPTERS,
      options: { includeSynopsis: true },
    });
    expect(html).not.toContain('class="synopsis-page"');
  });

  it('inserts ◆ ◆ ◆ separators between scenes (not before the first) when enabled', () => {
    const html = buildManuscriptHtml({
      title: 'T',
      chapters: CHAPTERS,
      options: { sceneSeparators: true },
    });
    // Chapter 1 has 2 scenes → exactly one separator; chapter 2 has 1 scene → none.
    expect(html.match(/◆ ◆ ◆/g)).toHaveLength(1);
  });

  it('escapes HTML in titles and prose', () => {
    const html = buildManuscriptHtml({
      title: '<script>alert(1)</script>',
      chapters: [
        {
          title: 'A & B',
          scenes: [{ title: 'S<1>', prose: 'x < y & "z"' }],
        },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('x &lt; y &amp; &quot;z&quot;');
  });

  it('handles an empty manuscript without throwing', () => {
    const html = buildManuscriptHtml({ title: 'Empty', chapters: [] });
    expect(html).toContain('<h1>Empty</h1>');
    expect(html).toContain('— END OF DRAFT —');
  });
});
