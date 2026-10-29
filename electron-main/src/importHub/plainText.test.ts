// #1765 — plain text → blocks.

import { describe, it, expect } from 'vitest';
import { blocksToProse, segmentBlocks } from './blocks.js';
import { plainTextToBlocks } from './plainText.js';

describe('plainTextToBlocks', () => {
  it('blank lines separate paragraphs; hard-wrapped lines inside one are joined', () => {
    expect(plainTextToBlocks('One line\nwrapped here.\n\nSecond paragraph.')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'One line wrapped here.' }] },
      { kind: 'paragraph', inlines: [{ text: 'Second paragraph.' }] },
    ]);
  });

  it('with no blank lines at all, every line is a paragraph', () => {
    expect(blocksToProse(plainTextToBlocks('First.\nSecond.\n  Third, indented.\n'))).toBe('First.\n\nSecond.\n\nThird, indented.');
  });

  it('strips a BOM and normalizes CRLF / CR', () => {
    expect(plainTextToBlocks('\ufeffA\r\n\r\nB\rC')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'A' }] },
      { kind: 'paragraph', inlines: [{ text: 'B C' }] },
    ]);
  });

  it('scene-break lines become sceneBreak blocks, even without blank lines around them', () => {
    expect(plainTextToBlocks('Before.\n\n* * *\n\nAfter.\nmore\n#\nLast.').map((b) => b.kind))
      .toEqual(['paragraph', 'sceneBreak', 'paragraph', 'sceneBreak', 'paragraph']);
  });

  it('form feeds are page breaks', () => {
    expect(plainTextToBlocks('Page one.\fPage two.').map((b) => b.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    // A form feed on its own line doesn't switch a one-line-per-paragraph file into blank-line mode.
    expect(plainTextToBlocks('A\nB\n\f\nC').map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'pageBreak', 'paragraph']);
  });

  it('extra blank lines become empty blocks (a long gap can be a scene break)', () => {
    expect(plainTextToBlocks('A\n\nB\n\n\n\nC').map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'empty', 'empty', 'paragraph']);
  });

  it('chapter-marker lines stand alone so the segmenter can find chapters', () => {
    const text = 'CHAPTER ONE\nIt was dark.\nVery dark.\n\nShe waited.\n\nChapter 2: Light\nMorning.\n';
    const { story } = segmentBlocks(plainTextToBlocks(text), { fallbackTitle: 'Notes' });
    expect(story.structure).toBe('patterns');
    expect(story.chapters.map((c) => [c.title, c.scenes.map((s) => s.prose)])).toEqual([
      ['CHAPTER ONE', ['It was dark. Very dark.\n\nShe waited.']],
      ['Chapter 2: Light', ['Morning.']],
    ]);
  });

  it('text is literal: Markdown-looking lines are escaped when serialized', () => {
    expect(blocksToProse(plainTextToBlocks('# hash\n\n- dash\n\n*stars*'))).toBe('\\# hash\n\n\\- dash\n\n\\*stars\\*');
  });

  it('empty input → no blocks', () => {
    expect(plainTextToBlocks('')).toEqual([]);
    expect(plainTextToBlocks('\n\n  \n')).toEqual([]);
  });
});
