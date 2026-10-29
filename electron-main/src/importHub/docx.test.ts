// #1765 — DOCX import fidelity (release blocker). Every .docx here is built
// in memory by testFixtures/manuscriptDocx.ts; no manuscript is committed.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOCX_DAMAGED_MESSAGE, DOCX_MAX_BYTES, docxToBlocks, parseDocxStory } from './docx.js';
import type { ImportStory } from './types.js';
import {
  DOUBLE_SPACED_MANUSCRIPT_OUTLINE,
  HEADED_MANUSCRIPT_OUTLINE,
  PAGEBREAK_MANUSCRIPT_OUTLINE,
  PATTERN_MANUSCRIPT_OUTLINE,
  buildDoubleSpacedManuscriptDocx,
  buildHeadedManuscriptDocx,
  buildManuscriptDocx,
  buildPageBreakManuscriptDocx,
  buildPatternManuscriptDocx,
  centered,
  emptyPara,
  para,
  type FixtureOutline,
} from './testFixtures/manuscriptDocx.js';

function outlineOf(story: ImportStory): Omit<FixtureOutline, 'title'> & { title: string } {
  return {
    title: story.title,
    structure: story.structure as FixtureOutline['structure'],
    chapters: story.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => s.title) })),
  };
}

const allProse = (story: ImportStory) => story.chapters.flatMap((c) => c.scenes.map((s) => s.prose)).join('\n\n');

describe('parseDocxStory — (a) heading-styled multi-chapter manuscript', () => {
  it('finds the exact chapters and scenes', async () => {
    const { story, warnings } = await parseDocxStory(await buildHeadedManuscriptDocx(), 'manuscript');
    expect(outlineOf(story)).toEqual(HEADED_MANUSCRIPT_OUTLINE);
    expect(story.partCount).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('keeps bold, italic, underline, strike, bold-italic and mixed runs as editor Markdown', async () => {
    const { story } = await parseDocxStory(await buildHeadedManuscriptDocx(), 'manuscript');
    const [arrival, keeper] = story.chapters[0].scenes;
    expect(arrival.prose).toBe(
      'Mara reached the **iron gate** at dusk, and the *lanterns* were already lit.\n\n'
      + 'She had <u>never</u> seen it ~~closed~~ before.',
    );
    expect(keeper.prose).toBe(
      '***Who goes there?*** called the keeper.\n\n'
      + 'He spoke *slowly*, **carefully** and **with *great* care**.',
    );
  });

  it('splits scenes on "* * *", "#" and an in-run page break without gluing words', async () => {
    const { story } = await parseDocxStory(await buildHeadedManuscriptDocx(), 'manuscript');
    const [one, two, three] = story.chapters[1].scenes.map((s) => s.prose);
    expect(one).toBe('The road ran north for three days.\n\nNobody spoke.');
    expect(two).toBe('On the fourth day the rain came.\n\nThe fire burned low');
    expect(three).toBe('and morning came.');
    expect(allProse(story)).not.toMatch(/lowand|\* \* \*|^#$/m);
    expect(story.chapters[2].scenes.map((s) => s.prose)).toEqual([
      'Interlude at the Inn {.center}\n\nThe innkeeper counted coins.',
      'Mara slept.\n\nThen she dreamed.',
    ]);
  });
});

describe('parseDocxStory — (b) no heading styles: "CHAPTER ONE" lines', () => {
  it('finds chapters from marker lines, folds part names, structure "patterns"', async () => {
    const { story } = await parseDocxStory(await buildPatternManuscriptDocx(), 'Pattern Manuscript');
    expect(outlineOf(story)).toEqual(PATTERN_MANUSCRIPT_OUTLINE);
    expect(story.partCount).toBe(2);
    expect(story.chapters[1].scenes[0].prose).toBe('Mara reached the **iron gate** at dusk.');
    expect(story.chapters[2].scenes[0].prose).toBe('Beyond the gate the road ran *north*.');
  });
});

describe('parseDocxStory — (c) page breaks only', () => {
  it('uses page breaks as chapters, structure "pagebreaks"', async () => {
    const { story } = await parseDocxStory(await buildPageBreakManuscriptDocx(), 'Pagebreak Manuscript');
    expect(outlineOf(story)).toEqual(PAGEBREAK_MANUSCRIPT_OUTLINE);
    expect(story.chapters[0].scenes[0].prose.split('\n\n')).toHaveLength(2);
  });
});

describe('parseDocxStory — (d) custom Word styles', () => {
  it('"Chapter Title" / "Part Title" / "Scene Break" paragraph styles and Emphasis / Book Title character styles survive', async () => {
    const buf = await buildManuscriptDocx([
      { heading: 'title', text: 'Night Book' },
      { style: 'PartTitle', text: 'Part One' },
      { style: 'ChapterTitle', text: 'The First Night' },
      para('She ', { text: 'whispered', style: 'Emphasis' }, ' the name of ', { text: 'The Old Road', style: 'BookTitle' }, '.'),
      { style: 'SceneBreak', text: '◆' },
      para('Dawn.'),
      { style: 'ChapterTitle', text: 'The Second Night' },
      para('Again.'),
    ], {
      paragraphStyles: [
        { id: 'ChapterTitle', name: 'Chapter Title', bold: true, center: true },
        { id: 'PartTitle', name: 'Part Title', bold: true },
        { id: 'SceneBreak', name: 'Scene Break', center: true },
      ],
      characterStyles: [
        { id: 'Emphasis', name: 'Emphasis', italic: true },
        { id: 'BookTitle', name: 'Book Title', bold: true, italic: true },
      ],
    });
    const { story, warnings } = await parseDocxStory(buf, 'night');
    expect(outlineOf(story)).toEqual({
      title: 'Night Book',
      structure: 'headings',
      chapters: [
        { title: 'Part One · The First Night', scenes: ['Scene 1', 'Scene 2'] },
        { title: 'Part One · The Second Night', scenes: ['Part One · The Second Night'] },
      ],
    });
    expect(story.partCount).toBe(1);
    expect(story.chapters[0].scenes[0].prose).toBe('She *whispered* the name of ***The Old Road***.');
    expect(allProse(story)).not.toContain('◆');
    // Unknown-style chatter from mammoth is not a writer's problem.
    expect(warnings.join(' ')).not.toMatch(/Unrecognised/i);
  });
});

describe('parseDocxStory — (e) footnotes', () => {
  it('footnote text never leaks into the last scene', async () => {
    const buf = await buildManuscriptDocx([
      { heading: 1, text: 'Chapter One' },
      para('First.'),
      { heading: 1, text: 'Chapter Two' },
      para('The last line', { footnote: 1 }, ' of the book.'),
    ], { footnotes: { 1: 'This note must not leak.' } });
    const { story, warnings } = await parseDocxStory(buf, 'notes');
    const last = story.chapters[story.chapters.length - 1].scenes.at(-1);
    expect(last?.prose).toBe('The last line of the book.');
    expect(allProse(story)).not.toMatch(/must not leak|↑|\[1\]/);
    expect(warnings).toContain('1 footnote was left out of the story — Mythos doesn’t import footnotes yet.');
  });
});

describe('parseDocxStory — (f) escaping literal text', () => {
  it('text that looks like Markdown survives as text', async () => {
    const buf = await buildManuscriptDocx([
      para('# not a heading'),
      para('- not a list'),
      para('1. not a list'),
      para('The *** mark sits in a sentence.'),
      para('Literal *stars* and _underscores_ and snake_case.'),
      para('A <tag> & an &amp; entity.'),
      para('> not a quote'),
    ]);
    const { story } = await parseDocxStory(buf, 'escapes');
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0].scenes).toHaveLength(1);
    expect(story.chapters[0].scenes[0].prose).toBe([
      '\\# not a heading',
      '\\- not a list',
      '1\\. not a list',
      'The \\*\\*\\* mark sits in a sentence.',
      'Literal \\*stars\\* and \\_underscores\\_ and snake_case.',
      'A &lt;tag&gt; & an &amp;amp; entity.',
      '&gt; not a quote',
    ].join('\n\n'));
  });
});

describe('parseDocxStory — real-world Word habits', () => {
  it('(double spacing) an empty paragraph after every paragraph is spacing, not hundreds of scenes', async () => {
    const { story } = await parseDocxStory(await buildDoubleSpacedManuscriptDocx(), 'Double Spaced');
    expect(outlineOf(story)).toEqual(DOUBLE_SPACED_MANUSCRIPT_OUTLINE);
    expect(story.chapters[0].scenes[0].prose.split('\n\n')).toHaveLength(12);
  });

  it('two empty paragraphs are a scene break in a normally spaced manuscript', async () => {
    const buf = await buildManuscriptDocx([
      { heading: 1, text: 'One' }, para('a'), para('b'), para('c'), emptyPara(), emptyPara(), para('d'), para('e'), emptyPara(), para('f'),
      { heading: 1, text: 'Two' }, para('g'),
    ]);
    const { story } = await parseDocxStory(buf, 'gaps');
    expect(story.chapters[0].scenes.map((s) => s.prose)).toEqual(['a\n\nb\n\nc', 'd\n\ne\n\nf']);
  });

  it('strips tab / NBSP / space indents, keeps smart quotes, merges rsid-split runs, line breaks are hard breaks', async () => {
    const buf = await buildManuscriptDocx([
      para('\t“Hello,” she said.'),
      para('\u00a0\u00a0\u00a0Indented with NBSP.'),
      para({ text: 'Spl', bold: true }, { text: 'it', bold: true }, ' word.'),
      para('Roses are red', { lineBreak: true }, 'violets are blue'),
    ]);
    const { story } = await parseDocxStory(buf, 'habits');
    expect(story.chapters[0].scenes[0].prose).toBe(
      '“Hello,” she said.\n\nIndented with NBSP.\n\n**Split** word.\n\nRoses are red\\\nviolets are blue',
    );
  });

  it('centered/right lines keep their alignment; a manuscript justified throughout does not get {.justify} everywhere', async () => {
    const centeredOnly = await parseDocxStory(await buildManuscriptDocx([
      centered('The End'), { text: 'Signed', align: 'right' }, para('Plain.'), para('Plain.'), para('Plain.'),
    ]), 'align');
    expect(centeredOnly.story.chapters[0].scenes[0].prose).toBe('The End {.center}\n\nSigned {.right}\n\nPlain.\n\nPlain.\n\nPlain.');

    const justified = await parseDocxStory(await buildManuscriptDocx([
      { text: 'One.', align: 'justify' }, { text: 'Two.', align: 'justify' }, { text: 'Three.', align: 'justify' }, centered('* * *'), { text: 'Four.', align: 'justify' },
    ]), 'justified');
    expect(justified.story.chapters[0].scenes.map((s) => s.prose)).toEqual(['One.\n\nTwo.\n\nThree.', 'Four.']);
  });

  it('a centered line that starts after an in-run page break keeps its alignment', async () => {
    const buf = await buildManuscriptDocx([
      para('Before.'),
      { runs: [{ pageBreak: true }, 'Centered after the break'], align: 'center' },
      para('After.'),
    ]);
    const { blocks } = await docxToBlocks(buf);
    expect(blocks).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Before.' }] },
      { kind: 'pageBreak' },
      { kind: 'paragraph', inlines: [{ text: 'Centered after the break' }], align: 'center' },
      { kind: 'paragraph', inlines: [{ text: 'After.' }] },
    ]);
  });

  it('an empty Heading 1 (Enter pressed in a heading style) does not create a chapter', async () => {
    const buf = await buildManuscriptDocx([
      { heading: 1, text: 'One' }, para('a'), { heading: 1, text: '' }, para('b'), { heading: 1, text: 'Two' }, para('c'),
    ]);
    const { story } = await parseDocxStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['One', 'Two']);
  });
});

describe('docxToBlocks — (h) damaged, empty and oversize files', () => {
  it('rejects a non-zip with a plain-words error', async () => {
    await expect(docxToBlocks(Buffer.from('this is not a docx file at all'))).rejects.toThrow(DOCX_DAMAGED_MESSAGE);
  });

  it('rejects an empty buffer', async () => {
    await expect(docxToBlocks(Buffer.alloc(0))).rejects.toThrow(DOCX_DAMAGED_MESSAGE);
  });

  it('rejects a zip that is not a Word document', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(docxToBlocks(buf)).rejects.toThrow(DOCX_DAMAGED_MESSAGE);
  });

  it('enforces the 50 MB cap before parsing', async () => {
    expect(DOCX_MAX_BYTES).toBe(50 * 1024 * 1024);
    await expect(docxToBlocks(Buffer.alloc(DOCX_MAX_BYTES + 1))).rejects.toThrow(/too large to import \(over 50 MB\)/);
  });

  it('an empty document parses to one empty scene with a warning', async () => {
    const { story, warnings } = await parseDocxStory(await buildManuscriptDocx([]), 'Blank');
    expect(story.chapters).toEqual([{ title: 'Blank', order: 0, scenes: [{ title: 'Blank', prose: '', order: 0 }] }]);
    expect(warnings).toEqual(['This document has no text to import.']);
  });
});

describe('parseDocxStory — (k) determinism', () => {
  it('the same file always gives the same story', async () => {
    const buf = await buildHeadedManuscriptDocx();
    const a = await parseDocxStory(buf, 'same');
    const b = await parseDocxStory(buf, 'same');
    expect(b).toEqual(a);
    // A rebuilt file (new zip timestamps) gives the same story too.
    expect(await parseDocxStory(await buildHeadedManuscriptDocx(), 'same')).toEqual(a);
  });
});
