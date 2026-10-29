// #1765 — rich-text core: inline serializer, prose, manuscript markers, segmenter.

import { describe, it, expect } from 'vitest';
import {
  blocksToProse,
  inlinesToMarkdown,
  inlinesToPlainText,
  isSceneBreakText,
  matchChapterMarker,
  segmentBlocks,
  type RichBlock,
  type RichInline,
} from './blocks.js';

const p = (...inlines: Array<string | RichInline>): RichBlock => ({
  kind: 'paragraph',
  inlines: inlines.map((r) => (typeof r === 'string' ? { text: r } : r)),
});
const h = (level: 1 | 2 | 3 | 4 | 5 | 6, text: string, part = false): RichBlock => ({
  kind: 'heading', level, inlines: [{ text }], ...(part ? { part: true } : {}),
});
const title = (text: string): RichBlock => ({ kind: 'title', inlines: [{ text }] });
const scene: RichBlock = { kind: 'sceneBreak' };
const page: RichBlock = { kind: 'pageBreak' };
const empty: RichBlock = { kind: 'empty' };

function outline(blocks: RichBlock[], fallbackTitle = 'Fallback', titleIsAuthoritative = false) {
  const { story } = segmentBlocks(blocks, { fallbackTitle, titleIsAuthoritative });
  return {
    title: story.title,
    structure: story.structure,
    partCount: story.partCount,
    chapters: story.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => s.title) })),
  };
}

// ── inlinesToMarkdown ────────────────────────────────────────────────────────

describe('inlinesToMarkdown', () => {
  it('writes every mark in the editor dialect', () => {
    expect(inlinesToMarkdown([
      { text: 'a ' }, { text: 'bold', bold: true }, { text: ' ' }, { text: 'ital', italic: true }, { text: ' ' },
      { text: 'under', underline: true }, { text: ' ' }, { text: 'gone', strike: true },
    ])).toBe('a **bold** *ital* <u>under</u> ~~gone~~');
  });

  it('nests marks in the fixed order: bold, italic, strike, underline', () => {
    expect(inlinesToMarkdown([{ text: 'x', bold: true, italic: true }])).toBe('***x***');
    expect(inlinesToMarkdown([{ text: 'x', underline: true, strike: true, italic: true, bold: true }]))
      .toBe('***~~<u>x</u>~~***');
  });

  it('merges runs that Word split with identical marks', () => {
    expect(inlinesToMarkdown([{ text: 'Hel', bold: true }, { text: 'lo', bold: true }, { text: ' there', bold: true }]))
      .toBe('**Hello there**');
  });

  it('keeps an outer mark open across an inner one', () => {
    expect(inlinesToMarkdown([
      { text: 'with ', bold: true }, { text: 'great', bold: true, italic: true }, { text: ' care', bold: true },
    ])).toBe('**with *great* care**');
  });

  it('moves leading and trailing whitespace outside the markers', () => {
    expect(inlinesToMarkdown([{ text: 'a' }, { text: ' bold ', bold: true }, { text: 'b' }])).toBe('a **bold** b');
    expect(inlinesToMarkdown([{ text: 'x ', italic: true }, { text: 'y' }])).toBe('*x* y');
    expect(inlinesToMarkdown([{ text: 'one ', bold: true }, { text: ' two', bold: true }])).toBe('**one two**');
  });

  it('writes a hard break as backslash + newline and drops breaks at the ends', () => {
    expect(inlinesToMarkdown([{ text: 'line one ' }, { text: '', hardBreak: true }, { text: ' line two' }]))
      .toBe('line one\\\nline two');
    expect(inlinesToMarkdown([{ text: '', hardBreak: true }, { text: 'x' }, { text: '', hardBreak: true }])).toBe('x');
  });

  it('drops empty runs and collapses whitespace', () => {
    expect(inlinesToMarkdown([{ text: '' , bold: true }, { text: '  a\t\tb  ' }, { text: '', italic: true }])).toBe('a b');
    expect(inlinesToMarkdown([{ text: '   ', bold: true }])).toBe('');
  });

  it('escapes Markdown-significant characters in text', () => {
    const md = (text: string) => inlinesToMarkdown([{ text }]);
    expect(md('# not a heading')).toBe('\\# not a heading');
    expect(md('#hashtag')).toBe('\\#hashtag');
    expect(md('- not a list')).toBe('\\- not a list');
    expect(md('+ not a list')).toBe('\\+ not a list');
    expect(md('* not a list')).toBe('\\* not a list');
    expect(md('1. not a list')).toBe('1\\. not a list');
    expect(md('1999) was a year')).toBe('1999\\) was a year');
    expect(md('> not a quote')).toBe('&gt; not a quote');
    expect(md('===')).toBe('\\===');
    expect(md('The *** mark in a sentence')).toBe('The \\*\\*\\* mark in a sentence');
    expect(md('snake_case and _under_ and 2*3')).toBe('snake_case and \\_under\\_ and 2\\*3');
    expect(md('a <tag> b')).toBe('a &lt;tag&gt; b');
    expect(md('AT&T and &amp; and &#169;')).toBe('AT&T and &amp;amp; and &amp;#169;');
    expect(md('[link](x) `code` ~~no~~ back\\slash')).toBe('\\[link\\](x) \\`code\\` \\~\\~no\\~\\~ back\\\\slash');
  });

  it('only escapes block syntax at the start of a line', () => {
    expect(inlinesToMarkdown([{ text: 'Score: 1. Then - more # here' }])).toBe('Score: 1. Then - more # here');
    expect(inlinesToMarkdown([{ text: 'a' }, { text: '', hardBreak: true }, { text: '- b' }])).toBe('a\\\n\\- b');
    // Behind an opening marker, `#` can't start a heading — no escape needed.
    expect(inlinesToMarkdown([{ text: '# x', bold: true }])).toBe('**# x**');
  });
});

describe('inlinesToPlainText', () => {
  it('drops marks, turns hard breaks into spaces, collapses whitespace', () => {
    expect(inlinesToPlainText([{ text: ' Chapter ', bold: true }, { text: '', hardBreak: true }, { text: 'One\u00a0' }]))
      .toBe('Chapter One');
  });
});

// ── blocksToProse ────────────────────────────────────────────────────────────

describe('blocksToProse', () => {
  it('joins paragraphs with a blank line and skips structural blocks', () => {
    expect(blocksToProse([p('One.'), empty, scene, page, title('T'), p('Two.')])).toBe('One.\n\nTwo.');
  });

  it('writes alignment as a trailing {.align} marker', () => {
    expect(blocksToProse([
      { kind: 'paragraph', inlines: [{ text: 'Mid' }], align: 'center' },
      { kind: 'paragraph', inlines: [{ text: 'Right' }], align: 'right' },
      { kind: 'paragraph', inlines: [{ text: 'Both' }], align: 'justify' },
    ])).toBe('Mid {.center}\n\nRight {.right}\n\nBoth {.justify}');
  });

  it('writes headings left in prose as Markdown headings and Markdown blocks verbatim', () => {
    expect(blocksToProse([h(4, 'Letter'), { kind: 'markdown', text: '\n**Already** *md*\n\n' }, h(2, 'A # sign')]))
      .toBe('#### Letter\n\n**Already** *md*\n\n## A # sign');
  });

  it('drops empty paragraphs', () => {
    expect(blocksToProse([p('  '), p('x')])).toBe('x');
  });
});

// ── markers ──────────────────────────────────────────────────────────────────

describe('isSceneBreakText', () => {
  it.each([
    '***', '* * *', '*', '#', '# # #', '~~~', '~', '⁂', '§', '—', '–', '- - -', '---', 'o0o', 'oOo',
    '•••', '• • •', '◇', '◆', '❧', '☙', '✦', '+', 'x x x', '  *  *  *  ', '\u00a0#\u00a0',
  ])('treats %j as a scene break', (t) => {
    expect(isSceneBreakText(t)).toBe(true);
  });

  it.each([
    '', 'Ah.', 'I', 'x', 'No — never.', '***Stop!***', '# Heading', 'xox', 'ooo', '1', 'Oh. Oh.', '...', '…',
  ])('never treats %j as a scene break', (t) => {
    expect(isSceneBreakText(t)).toBe(false);
  });
});

describe('matchChapterMarker', () => {
  it.each([
    ['Chapter One', 'chapter', 'Chapter One'],
    ['CHAPTER 1', 'chapter', 'CHAPTER 1'],
    ['Chapter 12: The Gate', 'chapter', 'Chapter 12: The Gate'],
    ['Chapter Twenty-One', 'chapter', 'Chapter Twenty-One'],
    ['Chapter XIV.', 'chapter', 'Chapter XIV'],
    ['Ch. 3', 'chapter', 'Ch. 3'],
    ['chapter one hundred and five', 'chapter', 'chapter one hundred and five'],
    ['Prologue', 'front', 'Prologue'],
    ['EPILOGUE', 'front', 'EPILOGUE'],
    ['Interlude: The Inn', 'front', 'Interlude: The Inn'],
    ['Afterword', 'front', 'Afterword'],
    ['Foreword', 'front', 'Foreword'],
    ['Preface', 'front', 'Preface'],
    ['Introduction', 'front', 'Introduction'],
    ['Part One', 'part', 'Part One'],
    ['PART II', 'part', 'PART II'],
    ['Book Two', 'part', 'Book Two'],
    ['Act 1', 'part', 'Act 1'],
  ])('matches %j', (text, kind, t) => {
    expect(matchChapterMarker(text)).toEqual({ kind, title: t });
  });

  it.each([
    'Chapter one was hard to write.',
    'Chapters 1-3',
    'Part of me wanted to leave.',
    'Book two of the series sold well.',
    'Prologues are overrated.',
    'The Chapter One problem',
    '7',
    'IV',
    `Chapter 3: ${'and then the long night went on and on and on until morning'}`,
    `Chapter 1. ${'x '.repeat(40)}`,
  ])('does not match %j', (text) => {
    expect(matchChapterMarker(text)).toBeNull();
  });
});

// ── segmentBlocks: heading styles (storyImport.splitStoryMarkdown rules) ─────

describe('segmentBlocks — heading styles', () => {
  it('H1 chapters + H2 scenes; the first H1 is the story title (legacy rule)', () => {
    expect(outline([h(1, 'Chapter One'), h(2, 'Morning'), p('Sun.'), h(2, 'Evening'), p('Stars.'), h(1, 'Chapter Two'), h(2, 'Dawn'), p('Fresh.')]))
      .toEqual({
        title: 'Chapter One',
        structure: 'headings',
        partCount: 0,
        chapters: [
          { title: 'Chapter One', scenes: ['Morning', 'Evening'] },
          { title: 'Chapter Two', scenes: ['Dawn'] },
        ],
      });
  });

  it('three levels: H1 part folded into "Part · Chapter", H2 chapter, H3 scene; title stays the fallback', () => {
    expect(outline([
      h(1, 'Part One'), h(2, 'The Gate'), h(3, 'Arrival'), p('a'), h(3, 'Keeper'), p('b'),
      h(1, 'Part Two'), h(2, 'The Road'), h(3, 'North'), p('c'),
    ])).toEqual({
      title: 'Fallback',
      structure: 'headings',
      partCount: 2,
      chapters: [
        { title: 'Part One · The Gate', scenes: ['Arrival', 'Keeper'] },
        { title: 'Part Two · The Road', scenes: ['North'] },
      ],
    });
  });

  it('a single H1 above H2 chapters + H3 scenes is the book title, not a part', () => {
    expect(outline([h(1, 'The Lantern Road'), h(2, 'One'), h(3, 'a'), p('x'), h(2, 'Two'), h(3, 'b'), p('y')])).toEqual({
      title: 'The Lantern Road',
      structure: 'headings',
      partCount: 0,
      chapters: [{ title: 'One', scenes: ['a'] }, { title: 'Two', scenes: ['b'] }],
    });
  });

  it('H1 + H3 (no H2): H1 chapters, H3 scenes', () => {
    expect(outline([h(1, 'A'), h(3, 'A1'), p('x'), h(1, 'B'), h(3, 'B1'), p('y')]).chapters)
      .toEqual([{ title: 'A', scenes: ['A1'] }, { title: 'B', scenes: ['B1'] }]);
  });

  it('H2 + H3 (no H1): H2 chapters, H3 scenes, first H2 is the title', () => {
    const o = outline([h(2, 'A'), h(3, 'A1'), p('x'), h(2, 'B'), h(3, 'B1'), p('y')]);
    expect(o.title).toBe('A');
    expect(o.chapters).toEqual([{ title: 'A', scenes: ['A1'] }, { title: 'B', scenes: ['B1'] }]);
  });

  it('a single heading level is chapters', () => {
    expect(outline([h(2, 'One'), p('x'), h(2, 'Two'), p('y')]).chapters)
      .toEqual([{ title: 'One', scenes: ['One'] }, { title: 'Two', scenes: ['Two'] }]);
  });

  it('prose before the first scene heading becomes a scene named after the chapter', () => {
    expect(outline([h(1, 'Chapter One'), p('Preface.'), h(2, 'Scene Title'), p('Body.')]).chapters)
      .toEqual([{ title: 'Chapter One', scenes: ['Chapter One', 'Scene Title'] }]);
  });

  it('prose before the first chapter heading becomes a chapter titled with the fallback', () => {
    expect(outline([p('Dedication.'), h(1, 'A'), h(2, 'A1'), p('x'), h(1, 'B'), h(2, 'B1'), p('y')], 'Book').chapters[0])
      .toEqual({ title: 'Book', scenes: ['Book'] });
  });

  it('a Title block wins over the first-H1 rule; titleIsAuthoritative wins over both', () => {
    const blocks = [title('The Lantern Road'), h(1, 'Chapter One'), p('x'), h(1, 'Chapter Two'), p('y')];
    expect(outline(blocks).title).toBe('The Lantern Road');
    expect(outline(blocks, 'Dc Title', true).title).toBe('Dc Title');
  });

  it('drops a content-less title H1 and chapter, keeps heading-titled empty scenes (an outline)', () => {
    expect(outline([h(1, 'My Book'), h(1, 'Chapter One'), h(2, 'Todo scene'), h(2, 'Written'), p('x')]).chapters)
      .toEqual([{ title: 'Chapter One', scenes: ['Todo scene', 'Written'] }]);
  });

  it('scene breaks split scenes inside a heading chapter; trailing breaks add no empty scene', () => {
    const o = outline([h(1, 'A'), p('one'), scene, p('two'), { kind: 'paragraph', inlines: [{ text: '* * *' }] }, p('three'), scene, page, empty, empty]);
    expect(o.chapters).toEqual([{ title: 'A', scenes: ['Scene 1', 'Scene 2', 'Scene 3'] }]);
  });

  it('explicit part headings fold into chapter titles whatever their level', () => {
    const o = outline([h(1, 'Part One', true), h(1, 'Night'), p('x'), h(1, 'Day'), p('y')]);
    expect(o.partCount).toBe(1);
    expect(o.chapters.map((c) => c.title)).toEqual(['Part One · Night', 'Part One · Day']);
  });

  it('a part with its own prose (an epigraph) becomes a chapter named after the part', () => {
    const o = outline([h(1, 'Part One', true), p('Epigraph.'), h(1, 'Night'), p('x')]);
    expect(o.chapters).toEqual([{ title: 'Part One', scenes: ['Part One'] }, { title: 'Part One · Night', scenes: ['Part One · Night'] }]);
  });

  it('keeps H4–H6 headings inside scene prose', () => {
    const { story } = segmentBlocks([h(1, 'A'), h(4, 'A letter'), p('Dear you.'), h(1, 'B'), p('y')], { fallbackTitle: 'F' });
    expect(story.chapters[0].scenes[0].prose).toBe('#### A letter\n\nDear you.');
  });

  it('ignores empty headings (Enter pressed in a heading style)', () => {
    const o = outline([h(1, 'A'), p('x'), { kind: 'heading', level: 1, inlines: [{ text: '  ' }] }, p('y'), h(1, 'B'), p('z')]);
    expect(o.chapters.map((c) => c.title)).toEqual(['A', 'B']);
  });
});

// ── segmentBlocks: chapter-marker lines ──────────────────────────────────────

describe('segmentBlocks — "Chapter One" lines', () => {
  it('splits on marker paragraphs and folds part markers', () => {
    expect(outline([
      p('Prologue'), p('Long ago.'), page,
      p('PART ONE'), page, p('CHAPTER ONE'), p('Mara came.'), page,
      p('Chapter 2: The Gate'), p('North.'), page,
      p('Part Two'), p('Chapter 3'), p('Rain.'),
    ])).toEqual({
      title: 'Fallback',
      structure: 'patterns',
      partCount: 2,
      chapters: [
        { title: 'Prologue', scenes: ['Prologue'] },
        { title: 'PART ONE · CHAPTER ONE', scenes: ['PART ONE · CHAPTER ONE'] },
        { title: 'PART ONE · Chapter 2: The Gate', scenes: ['PART ONE · Chapter 2: The Gate'] },
        { title: 'Part Two · Chapter 3', scenes: ['Part Two · Chapter 3'] },
      ],
    });
  });

  it('needs at least two chapter markers', () => {
    expect(outline([p('Chapter One'), p('Text.'), p('More text.')]).structure).toBe('none');
  });

  it('never splits on a sentence that starts with "Chapter"', () => {
    expect(outline([p('Chapter one was hard to write.'), p('Chapter two was worse.'), p('The end.')]).structure).toBe('none');
  });

  it('folds a centered / bold / all-caps title line under a bare marker', () => {
    const o = outline([
      p('CHAPTER ONE'), { kind: 'paragraph', inlines: [{ text: 'The Gate' }], align: 'center' }, p('Text.'),
      p('CHAPTER TWO'), p('THE ROAD'), p('Text.'),
      p('CHAPTER THREE'), p({ text: 'Rain', bold: true }), p('Text.'),
      p('CHAPTER FOUR'), p('She ran.'),
    ]);
    expect(o.chapters.map((c) => c.title)).toEqual([
      'CHAPTER ONE: The Gate', 'CHAPTER TWO: THE ROAD', 'CHAPTER THREE: Rain', 'CHAPTER FOUR',
    ]);
  });

  it('trusts bare numbers only with a layout signal', () => {
    const centeredNum = (n: string): RichBlock => ({ kind: 'paragraph', inlines: [{ text: n }], align: 'center' });
    expect(outline([centeredNum('1'), p('a'), centeredNum('2'), p('b'), centeredNum('3'), p('c')]).chapters.map((c) => c.title))
      .toEqual(['1', '2', '3']);
    expect(outline([p('I'), p('a'), page, p('II'), p('b')]).chapters.map((c) => c.title)).toEqual(['Fallback']);
    expect(outline([page, p('ONE'), p('a'), page, p('Twenty-Two'), p('b')]).chapters.map((c) => c.title)).toEqual(['ONE', 'Twenty-Two']);
    expect(outline([p('One'), p('a'), p('Two'), p('b')]).structure).toBe('none');
    expect(outline([p('a'), page, p('One.'), page, p('Two.')]).structure).toBe('none');
  });

  it('"Chapter" lines that outnumber the chapter headings win (styled title + Acknowledgements heading)', () => {
    const o = outline([
      h(1, 'The Lantern Road'), p('Chapter 1'), p('a'), p('Chapter 2'), p('b'), p('Chapter 3'), p('c'), h(1, 'Acknowledgements'), p('Thanks.'),
    ]);
    expect(o.structure).toBe('patterns');
    expect(o.title).toBe('The Lantern Road');
    expect(o.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
  });

  it('a lone heading before the markers is the book title', () => {
    const o = outline([h(1, 'The Lantern Road'), p('Chapter 1'), p('a'), p('Chapter 2'), p('b')]);
    expect(o.title).toBe('The Lantern Road');
    expect(o.structure).toBe('patterns');
    expect(o.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });
});

// ── segmentBlocks: page breaks, none, empties ────────────────────────────────

const words = (n: number, seed: string) => `${seed} ${Array.from({ length: n - 1 }, (_, i) => `w${i}`).join(' ')}.`;

describe('segmentBlocks — page breaks and no structure', () => {
  it('uses page breaks as chapters when there are at least three substantial chunks', () => {
    const o = outline([p(words(200, 'a')), page, p(words(200, 'b')), page, p(words(180, 'c'))]);
    expect(o.structure).toBe('pagebreaks');
    expect(o.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
  });

  it('short pages stay one chapter, each page a scene', () => {
    const o = outline([p('Poem one.'), page, p('Poem two.'), page, p('Poem three.')]);
    expect(o.structure).toBe('none');
    expect(o.chapters).toEqual([{ title: 'Fallback', scenes: ['Scene 1', 'Scene 2', 'Scene 3'] }]);
  });

  it('pageBreaksAreChapters makes every page a chapter, however short (ePub spine)', () => {
    const { story } = segmentBlocks([p('One.'), page, p('Two.')], { fallbackTitle: 'F', pageBreaksAreChapters: true });
    expect(story.structure).toBe('pagebreaks');
    expect(story.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });

  it('no structure → one chapter, one scene, both named after the story (legacy shape)', () => {
    const { story, warnings } = segmentBlocks([p('Once.'), p('The end.')], { fallbackTitle: 'My Story' });
    expect(story).toEqual({
      title: 'My Story',
      structure: 'none',
      partCount: 0,
      chapters: [{ title: 'My Story', order: 0, scenes: [{ title: 'My Story', prose: 'Once.\n\nThe end.', order: 0 }] }],
    });
    expect(warnings).toEqual([]);
  });

  it('warns in plain words when a long document has no structure', () => {
    const { warnings } = segmentBlocks([p(words(3500, 'Long'))], { fallbackTitle: 'F' });
    expect(warnings.join(' ')).toMatch(/couldn’t find chapters/);
  });

  it('warns about a very large single scene', () => {
    const { warnings } = segmentBlocks([h(1, 'A'), p(words(21000, 'x')), h(1, 'B'), p('y')], { fallbackTitle: 'F' });
    expect(warnings.join(' ')).toMatch(/“A” has a single scene of about 21000 words/);
  });

  it('an empty document → one empty scene and a warning', () => {
    const { story, warnings } = segmentBlocks([empty, empty], { fallbackTitle: 'Empty' });
    expect(story.chapters).toEqual([{ title: 'Empty', order: 0, scenes: [{ title: 'Empty', prose: '', order: 0 }] }]);
    expect(warnings).toEqual(['This document has no text to import.']);
  });
});

describe('segmentBlocks — empty paragraphs', () => {
  it('two or more empty paragraphs are a scene break in a normally spaced document', () => {
    const o = outline([h(1, 'A'), p('1'), p('2'), p('3'), empty, empty, p('4'), p('5'), empty, p('6')]);
    expect(o.chapters).toEqual([{ title: 'A', scenes: ['Scene 1', 'Scene 2'] }]);
  });

  it('a double-spaced manuscript (empty paragraph after every paragraph) is NOT hundreds of scenes', () => {
    const blocks: RichBlock[] = [h(1, 'A')];
    for (let i = 0; i < 40; i++) blocks.push(p(`Paragraph ${i}.`), empty);
    blocks.push(empty, empty); // the one real scene break: a longer gap
    for (let i = 0; i < 20; i++) blocks.push(p(`Later ${i}.`), empty);
    const { story } = segmentBlocks(blocks, { fallbackTitle: 'F' });
    expect(story.chapters[0].scenes.map((s) => s.title)).toEqual(['Scene 1', 'Scene 2']);
    expect(story.chapters[0].scenes[0].prose.split('\n\n')).toHaveLength(40);
  });

  it('a double-spaced manuscript with no longer gaps stays one scene', () => {
    const blocks: RichBlock[] = [];
    for (let i = 0; i < 30; i++) blocks.push(p(`Paragraph ${i}.`), empty);
    expect(outline(blocks).chapters).toEqual([{ title: 'Fallback', scenes: ['Fallback'] }]);
  });

  it('long gaps that are as common as ordinary ones are spacing, not breaks', () => {
    const blocks: RichBlock[] = [];
    for (let i = 0; i < 10; i++) blocks.push(p(`P${i}.`), ...(i % 2 ? [empty, empty] : []));
    expect(outline(blocks).chapters[0].scenes).toHaveLength(1);
  });
});

describe('segmentBlocks — determinism', () => {
  it('same input → identical output', () => {
    const blocks = [title('T'), h(1, 'A'), p('x', { text: 'y', bold: true }), scene, p('z'), h(1, 'B'), p('w')];
    expect(segmentBlocks(blocks, { fallbackTitle: 'F' })).toEqual(segmentBlocks(structuredClone(blocks), { fallbackTitle: 'F' }));
  });
});
