import { describe, it, expect } from 'vitest';
import { detectLossyFeatures } from './notesFidelityGuard';

describe('detectLossyFeatures — LC-2 fidelity guard', () => {
  it('returns empty array for plain prose', () => {
    expect(detectLossyFeatures('Just plain text with [[wiki-link]] and **bold**.')).toEqual([]);
  });

  it('detects YAML frontmatter', () => {
    const md = '---\ntitle: My Note\ntags: [a, b]\n---\nContent here.';
    const features = detectLossyFeatures(md);
    expect(features.map((f) => f.key)).toContain('frontmatter');
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

  it('detects Obsidian callout blocks', () => {
    const md = '> [!NOTE]\n> This is a callout.';
    const features = detectLossyFeatures(md);
    expect(features.map((f) => f.key)).toContain('callouts');
  });

  it('detects multiple lossy features at once', () => {
    const md = '---\ntitle: x\n---\n| a | b |\n|---|---|\n| 1 | 2 |';
    const keys = detectLossyFeatures(md).map((f) => f.key);
    expect(keys).toContain('frontmatter');
    expect(keys).toContain('tables');
  });

  it('does not trigger on headings or bullet lists', () => {
    const md = '# Heading\n\n- item one\n- item two\n\n**bold** and *italic*';
    expect(detectLossyFeatures(md)).toEqual([]);
  });
});
