// #1765 — plain text → blocks.

import { describe, it, expect } from 'vitest';
import { blocksToProse, segmentBlocks } from './blocks.js';
import { plainTextToBlocks } from './plainText.js';

/**
 * Linear-time check that holds on a slow or busy CI runner: parsing 4× the
 * input must take under 8× as long (a quadratic scan takes ~16×), with a
 * 500 ms floor so timer noise on fast runs can't fail it. `n` is a quarter of
 * the pathological input size; up to three attempts absorb a stray GC pause.
 * Only the parse is timed, never building the input.
 */
async function expectLinearTime<T>(prepare: (k: number) => T | Promise<T>, run: (input: T) => unknown, n: number): Promise<void> {
  const time = async (input: T) => {
    const start = performance.now();
    await run(input);
    return performance.now() - start;
  };
  const small = await prepare(n);
  const big = await prepare(4 * n);
  await time(small); // warm up
  let last = { small: 0, big: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    last = { small: await time(small), big: await time(big) };
    if (last.big < Math.max(8 * last.small, 500)) return;
  }
  expect(last.big, `4× input took ${Math.round(last.big)} ms vs ${Math.round(last.small)} ms`).toBeLessThan(Math.max(8 * last.small, 500));
}

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

  it('one paragraph per line with a blank line only after the title keeps every paragraph', () => {
    const long = (seed: string) => `${seed} ${'and the lantern swung on its hook while the road ran north '.repeat(4).trim()}.`;
    const text = `THE LANTERN ROAD\n\nChapter 1\n${long('A')}\n${long('B')}\n“Hello,” she said.\nChapter 2\n${long('C')}\n${long('D')}\n`;
    const { story } = segmentBlocks(plainTextToBlocks(text), { fallbackTitle: 'Lantern' });
    expect(story.structure).toBe('patterns');
    const chapters = Object.fromEntries(story.chapters.map((c) => [c.title, c.scenes.map((s) => s.prose.split('\n\n').length)]));
    expect(chapters['Chapter 1']).toEqual([3]);
    expect(chapters['Chapter 2']).toEqual([2]);
    expect(story.chapters.find((c) => c.title === 'Chapter 1')?.scenes[0].prose).toContain('north.\n\n“Hello,” she said.');
  });

  it('hard-wrapped prose with long paragraphs (few blank lines) is still joined per paragraph', () => {
    const wrapped = Array.from({ length: 12 }, (_, i) => `line ${i} of a paragraph that was wrapped at seventy columns by`).join('\n');
    const blocks = plainTextToBlocks(`${wrapped}\n\n${wrapped}\n`);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('a line too long to have been hard-wrapped is never joined to the next one', () => {
    const long = `${'word '.repeat(30).trim()}.`;
    expect(plainTextToBlocks(`short wrapped\nline here\n\n${long}\nNext paragraph\n\nlast`).map((b) => b.kind === 'paragraph' && b.inlines[0].text))
      .toEqual(['short wrapped line here', long, 'Next paragraph', 'last']);
  });

  it('with a paragraph per line, a blank line is an empty block (a possible scene break)', () => {
    const long = (seed: string) => `${seed} ${'she walked on and did not look back at the house '.repeat(3).trim()}.`;
    expect(plainTextToBlocks(`${long('A')}\n${long('B')}\n\n${long('C')}\n${long('D')}\n${long('E')}\n${long('F')}`).map((b) => b.kind))
      .toEqual(['paragraph', 'paragraph', 'empty', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
  });

  it('a long run of whitespace inside a line is handled in linear time', async () => {
    // The pathological size is 200k (4 × 50k).
    await expectLinearTime((k) => `x${' '.repeat(k)}y\n${'\t'.repeat(k)}z  \n`, plainTextToBlocks, 50_000);
    expect(plainTextToBlocks(`x${' '.repeat(200_000)}y\n${'\t'.repeat(200_000)}z  \n`).length).toBeGreaterThan(0);
  });

  it('a very large file (200k paragraphs) does not overflow the call stack', () => {
    const text = Array.from({ length: 200_000 }, (_, i) => `Line ${i} of the book.`).join('\n');
    const blocks = plainTextToBlocks(text);
    expect(blocks).toHaveLength(200_000);
    expect(blocks[199_999]).toEqual({ kind: 'paragraph', inlines: [{ text: 'Line 199999 of the book.' }] });
    const { story } = segmentBlocks(blocks, { fallbackTitle: 'Big' });
    expect(story.chapters[0].scenes[0].prose.endsWith('Line 199999 of the book.')).toBe(true);
  });

  it('empty input → no blocks', () => {
    expect(plainTextToBlocks('')).toEqual([]);
    expect(plainTextToBlocks('\n\n  \n')).toEqual([]);
  });
});
