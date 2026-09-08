import { describe, it, expect } from 'vitest';
import { detectLossyFeatures, supportedCalloutLineCount } from './notesFidelityGuard';

describe('detectLossyFeatures — LC-2 fidelity guard', () => {
  it('returns empty array for plain prose', () => {
    expect(detectLossyFeatures('Just plain text with [[wiki-link]] and **bold**.')).toEqual([]);
  });

  it('does NOT flag YAML frontmatter — W0.2 holds it aside verbatim, Rich mode never sees it', () => {
    const md = '---\ntitle: My Note\ntags: [a, b]\n---\nContent here.';
    expect(detectLossyFeatures(md)).toEqual([]);
  });

  it('detects Markdown tables', () => {
    const md = '| Col A | Col B |\n|-------|-------|\n| val 1 | val 2 |';
    const features = detectLossyFeatures(md);
    expect(features.map((f) => f.key)).toContain('tables');
  });

  it('detects footnotes', () => {
    const md = 'See note[^1].\n\n[^1]: The footnote text.';
    const features = detectLossyFeatures(md);
    expect(features.map((f) => f.key)).toContain('footnotes');
  });

  it('detects raw HTML', () => {
    const md = 'Some text <div class="callout">important</div> here.';
    const features = detectLossyFeatures(md);
    expect(features.map((f) => f.key)).toContain('rawHtml');
  });

  it('does NOT flag <u> underline — the shared editor core round-trips it losslessly (SKY-3204)', () => {
    const md = 'An <u>underlined</u> word saved from Rich mode.';
    expect(detectLossyFeatures(md)).toEqual([]);
  });

  it('still flags other tags starting with u (e.g. <ul>) as raw HTML', () => {
    const md = 'A list <ul><li>item</li></ul> in HTML.';
    expect(detectLossyFeatures(md).map((f) => f.key)).toContain('rawHtml');
  });

  it('does NOT flag the simple callout shape — M17 renders it as a lossless card', () => {
    // NoteCalloutExtension round-trips `> [!Title]` + one body line byte-
    // identically, so the guard must not warn for it anymore.
    const md = '> [!NOTE]\n> This is a callout.';
    expect(detectLossyFeatures(md).map((f) => f.key)).not.toContain('callouts');
  });

  it('does NOT flag multi-line callout bodies — M17 round-trips them line-for-line', () => {
    const md = '> [!NOTE]\n> line one\n> line two';
    expect(detectLossyFeatures(md).map((f) => f.key)).not.toContain('callouts');
  });

  it('does NOT flag foldable callout markers (-/+) — M17 preserves them losslessly', () => {
    expect(detectLossyFeatures('> [!NOTE]-\n> body').map((f) => f.key)).not.toContain('callouts');
    expect(detectLossyFeatures('> [!NOTE]+\n> body').map((f) => f.key)).not.toContain('callouts');
    expect(detectLossyFeatures('> [!NOTE]-').map((f) => f.key)).not.toContain('callouts');
  });

  it('still flags callout shapes the M17 card cannot round-trip', () => {
    const unsupported = [
      '> [!NOTE]- folded\n> body', // trailing text after the fold marker
      '> [!a]\n> [!b]', // back-to-back without a blank line
      '> [!NOTE]\n> body\nlazy continuation line', // lazy continuation
      '  > [!NOTE]\n> body', // indented marker would be re-written
      '> [!NOTE]\n> > nested quote', // nested quote inside the body
    ];
    for (const md of unsupported) {
      expect(detectLossyFeatures(md).map((f) => f.key), md).toContain('callouts');
    }
  });

  it('supportedCalloutLineCount reports the span of supported shapes', () => {
    expect(supportedCalloutLineCount(['> [!legend]', '> body', ''], 0)).toBe(2);
    expect(supportedCalloutLineCount(['> [!legend]'], 0)).toBe(1);
    expect(supportedCalloutLineCount(['> [!legend]', '> a', '> b'], 0)).toBe(3); // multi-line body now supported
    expect(supportedCalloutLineCount(['> [!legend]-', '> a', ''], 0)).toBe(2); // fold marker
    expect(supportedCalloutLineCount(['> plain quote'], 0)).toBe(0);
    expect(supportedCalloutLineCount(['> [!a]', '> [!b]'], 0)).toBe(0); // back-to-back
    expect(supportedCalloutLineCount(['> [!a]', '> > nested'], 0)).toBe(0); // nested quote
  });

  it('detects multiple lossy features at once', () => {
    const md = 'See note[^1].\n\n[^1]: text\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const keys = detectLossyFeatures(md).map((f) => f.key);
    expect(keys).toContain('footnotes');
    expect(keys).toContain('tables');
  });

  it('does not trigger on headings or bullet lists', () => {
    const md = '# Heading\n\n- item one\n- item two\n\n**bold** and *italic*';
    expect(detectLossyFeatures(md)).toEqual([]);
  });
});

describe('detectLossyFeatures — SKY-11443 false positives', () => {
  const clean: Array<[string, string]> = [
    ['plain prose', 'A quiet chapter about the harbor.'],
    ['wikilinks', 'See [[Chapter One]] and [[Chapter Two]].'],
    ['comparisons and arrows', 'Then 5 < 6 and a -> b, so the ward holds.'],
    ['URL autolink', 'Reference: <https://example.com/lore>'],
    ['scheme autolink', 'Open <mailto:ed@example.com> or <ftp://host/path>.'],
    ['email autolink', 'Contact <ed@example.com> for the archive key.'],
    ['uppercase underline', 'A <U>word</U> here.'],
    ['underline with attributes', 'A <u class="x">word</u> here.'],
    ['closing underline only', 'Trailing </u> from a paste.'],
    ['HTML inside a fenced block', '```html\n<div>hi</div>\n```'],
    ['table inside a fenced block', '```\n| a | b |\n|---|---|\n```'],
    ['footnote inside a fenced block', '```\nSee[^1].\n\n[^1]: note\n```'],
    ['tilde fence', '~~~\n| a | b |\n~~~'],
    ['indented fence', '  ```\n  <div>hi</div>\n  ```'],
    ['unclosed fence runs to EOF', '```\n<div>hi</div>'],
    ['longer fence closed by a matching run', '````\n```\n| a | b |\n```\n````'],
    ['inline code span', 'Type `<div>` or `| a | b |` to see it.'],
    ['multi-backtick inline span', 'Use ``a ` b <div>`` inline.'],
    ['callout shape inside a fence', '```\n> [!NOTE]- folded\n> body\n```'],
    ['multi-line callout body outside a fence', '> [!NOTE]\n> line one\n> line two'],
  ];

  for (const [name, md] of clean) {
    it(`stays clean: ${name}`, () => {
      expect(detectLossyFeatures(md), md).toEqual([]);
    });
  }

  const flagged: Array<[string, string, string]> = [
    ['real table', '| Col A | Col B |\n|-------|-------|\n| v | w |', 'tables'],
    ['real footnote', 'See note[^1].\n\n[^1]: The footnote text.', 'footnotes'],
    ['real raw HTML', 'Some text <div class="callout">important</div> here.', 'rawHtml'],
    ['raw HTML after a closed fence', '```\ncode\n```\n\n<div>real</div>', 'rawHtml'],
    ['table after a closed fence', '```\ncode\n```\n\n| a | b |\n|---|---|', 'tables'],
    ['tag that merely starts with u', 'A list <ul><li>item</li></ul> in HTML.', 'rawHtml'],
    ['self-closing tag', 'A line break <br/> mid-sentence.', 'rawHtml'],
    ['unsupported callout outside a fence', '> [!NOTE]\n> > nested quote', 'callouts'],
  ];

  for (const [name, md, key] of flagged) {
    it(`still flags: ${name}`, () => {
      expect(detectLossyFeatures(md).map((f) => f.key), md).toContain(key);
    });
  }

  it('masking preserves block structure — a fence after a callout body still flags', () => {
    // The fence lines are masked to filler, not removed, so the callout is
    // still "title + body with no blank line after" and stays lossy.
    const md = '> [!NOTE]\n> body\n```\ncode\n```';
    expect(detectLossyFeatures(md).map((f) => f.key)).toContain('callouts');
  });

  it('handles CRLF bodies', () => {
    expect(detectLossyFeatures('```\r\n| a | b |\r\n```\r\n')).toEqual([]);
  });
});
