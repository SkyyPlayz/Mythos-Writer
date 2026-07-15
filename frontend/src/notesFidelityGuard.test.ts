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

  it('still flags callout shapes the M17 card cannot round-trip', () => {
    const unsupported = [
      '> [!NOTE]\n> line one\n> line two', // multi-line body
      '> [!NOTE]- folded\n> body', // fold marker
      '> [!a]\n> [!b]', // back-to-back without a blank line
      '> [!NOTE]\n> body\nlazy continuation line', // lazy continuation
      '  > [!NOTE]\n> body', // indented marker would be re-written
    ];
    for (const md of unsupported) {
      expect(detectLossyFeatures(md).map((f) => f.key), md).toContain('callouts');
    }
  });

  it('supportedCalloutLineCount reports the span of supported shapes', () => {
    expect(supportedCalloutLineCount(['> [!legend]', '> body', ''], 0)).toBe(2);
    expect(supportedCalloutLineCount(['> [!legend]'], 0)).toBe(1);
    expect(supportedCalloutLineCount(['> [!legend]', '> a', '> b'], 0)).toBe(0);
    expect(supportedCalloutLineCount(['> plain quote'], 0)).toBe(0);
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
