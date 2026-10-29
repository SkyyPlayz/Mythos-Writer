// #1765 — rich-text core: inline serializer, prose, manuscript markers, segmenter.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import MarkdownIt from 'markdown-it';
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

// ── Round trip through markdown-it (what tiptap-markdown parses with) ────────

// tiptap-markdown's defaults: inline HTML on (for <u>), linkify and breaks off.
const markdownIt = new MarkdownIt({ html: true });
const HTML_MARK: Record<string, string> = { strong: 'b', em: 'i', s: 's', u: 'u' };

/** Characters of one paragraph with their marks ('b', 'i', 's', 'u'); '\n' is a hard break. */
type MarkedChars = Array<[string, string]>;

/** What the editor reads back from serialized Markdown, as marked characters. */
function readBack(src: string): MarkedChars | string {
  const tokens = markdownIt.parse(src, {});
  if (src === '') return tokens.length === 0 ? [] : 'tokens for empty input';
  if (tokens.length !== 3 || tokens[0].type !== 'paragraph_open' || tokens[1].type !== 'inline') {
    return `not one paragraph: ${tokens.map((t) => t.type).join(',')}`;
  }
  const open: Record<string, number> = { b: 0, i: 0, s: 0, u: 0 };
  const out: MarkedChars = [];
  const key = () => Object.keys(open).filter((k) => open[k] > 0).join('');
  for (const t of tokens[1].children ?? []) {
    const html = t.type === 'html_inline' ? /^<(\/?)(strong|em|s|u)>$/.exec(t.content) : null;
    if (t.type === 'text' || t.type === 'text_special') for (const ch of t.content) out.push([ch, key()]);
    else if (t.type === 'hardbreak') out.push(['\n', '']);
    else if (/^(strong|em|s)_(open|close)$/.test(t.type)) {
      const [tag, dir] = t.type.split('_');
      open[HTML_MARK[tag]] += dir === 'open' ? 1 : -1;
    } else if (html) open[HTML_MARK[html[2]]] += html[1] ? -1 : 1;
    else return `unexpected ${t.type} ${JSON.stringify(t.content)}`;
  }
  return out;
}

/** The serializer's contract: whitespace collapsed, lines trimmed, end breaks dropped, marks kept. */
function expectedChars(runs: RichInline[]): MarkedChars {
  const lines: MarkedChars[] = [[]];
  for (const r of runs) {
    if (r.hardBreak) { lines.push([]); continue; }
    const k = [r.bold && 'b', r.italic && 'i', r.strike && 's', r.underline && 'u'].filter(Boolean).join('');
    for (const ch of r.text.replace(/[\t\n\r\f\v\u00a0]/g, ' ')) {
      const line = lines[lines.length - 1];
      if (ch === ' ' && (line.length === 0 || line[line.length - 1][0] === ' ')) continue;
      line.push([ch, k]);
    }
  }
  for (const line of lines) while (line.length && line[line.length - 1][0] === ' ') line.pop();
  while (lines.length && lines[0].length === 0) lines.shift();
  while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  const out: MarkedChars = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(['\n', '']);
    out.push(...line);
  });
  return out;
}

/** Marks on whitespace are the serializer's choice (it moves spaces outside markers). */
const comparable = (chars: MarkedChars) => chars.map(([ch, k]) => (ch === ' ' || ch === '\n' ? ch : `${ch}:${k}`));

function expectRoundTrip(runs: RichInline[]): void {
  const md = inlinesToMarkdown(runs);
  const back = readBack(md);
  expect(typeof back === 'string' ? `${back} in ${JSON.stringify(md)}` : comparable(back), JSON.stringify(md))
    .toEqual(comparable(expectedChars(runs)));
}

describe('inlinesToMarkdown — markdown-it round trip', () => {
  it('runs of underscores (redacted names, blanks to fill in) stay literal', () => {
    expect(inlinesToMarkdown([{ text: 'Mr. ______ and Mrs. ______ came' }])).toBe('Mr. \\_\\_\\_\\_\\_\\_ and Mrs. \\_\\_\\_\\_\\_\\_ came');
    expectRoundTrip([{ text: 'Mr. ______ and Mrs. ______ came' }]);
    expectRoundTrip([{ text: 'Name: __________ Date: ____' }]);
    expectRoundTrip([{ text: 'run __main__ now, a__b and snake_case' }]);
    expect(inlinesToMarkdown([{ text: 'snake_case' }])).toBe('snake_case');
  });

  it('a mark next to punctuation that a delimiter can\'t flank uses the HTML form', () => {
    expect(inlinesToMarkdown([{ text: 'It was ' }, { text: 'over—', italic: true }, { text: 'and' }])).toBe('It was <em>over—</em>and');
    expect(inlinesToMarkdown([{ text: 'She stopped' }, { text: '—then', italic: true }])).toBe('She stopped<em>—then</em>');
    expect(inlinesToMarkdown([{ text: 'Chapter 1:', bold: true }, { text: 'The Gate' }])).toBe('<strong>Chapter 1:</strong>The Gate');
    expect(inlinesToMarkdown([{ text: 'Wait' }, { text: '...', bold: true }, { text: 'what' }])).toBe('Wait<strong>...</strong>what');
    expect(inlinesToMarkdown([{ text: 'no' }, { text: '(gone)', strike: true }, { text: 'more' }])).toBe('no<s>(gone)</s>more');
    // Where delimiters do flank, the editor's own form stays.
    expect(inlinesToMarkdown([{ text: 'It was ' }, { text: 'over—', italic: true }, { text: ' and' }])).toBe('It was *over—* and');
    expect(inlinesToMarkdown([{ text: '“' }, { text: 'Go', bold: true }, { text: ',” she said.' }])).toBe('“**Go**,” she said.');
    for (const runs of [
      [{ text: 'It was ' }, { text: 'over—', italic: true }, { text: 'and' }],
      [{ text: 'She stopped' }, { text: '—then', italic: true }],
      [{ text: 'Chapter 1:', bold: true }, { text: 'The Gate' }],
      [{ text: 'Wait' }, { text: '...', bold: true }, { text: 'what' }],
      [{ text: 'no' }, { text: '(gone)', strike: true }, { text: 'more' }],
      [{ text: 'un' }, { text: 'believ', italic: true }, { text: 'able' }],
    ]) expectRoundTrip(runs);
  });

  it('a mark that ends while a longer one continues does not close and reopen it', () => {
    expect(inlinesToMarkdown([{ text: 'a', bold: true, italic: true }, { text: ' b', italic: true }])).toBe('***a** b*');
    expectRoundTrip([{ text: 'a', bold: true, italic: true }, { text: ' b', italic: true }]);
    // Italic then bold with no space between: the run "*a***b**" would be ambiguous.
    expectRoundTrip([{ text: 'a', italic: true }, { text: 'b', bold: true }]);
  });

  it('any runs of text and marks read back as the same characters and marks', () => {
    const unit = fc.constantFrom(
      'a', 'b', 'Z', '1', '9', ' ', ' ', ' ', '*', '_', '~', '-', '#', '.', ',', '—', '(', ')', '<', '>', '&', '\\', '`',
      '[', ']', '!', '"', '“', '’', ':', '=', '+', '\u00a0', 'é', '\t', '$', '%', ';', '?', '/', '{', '}', '^', '\'',
    );
    const run = fc.oneof(
      { weight: 9, arbitrary: fc.record({
        text: fc.string({ unit, maxLength: 6 }),
        bold: fc.boolean(), italic: fc.boolean(), underline: fc.boolean(), strike: fc.boolean(),
      }) },
      { weight: 1, arbitrary: fc.constant<RichInline>({ text: '', hardBreak: true }) },
    );
    fc.assert(fc.property(fc.array(run, { maxLength: 8 }), (runs) => { expectRoundTrip(runs); }), { numRuns: 4000, seed: 1765 });
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
    expect(outline([h(1, 'The Gate'), h(2, 'Morning'), p('Sun.'), h(2, 'Evening'), p('Stars.'), h(1, 'The Road'), h(2, 'Dawn'), p('Fresh.')]))
      .toEqual({
        title: 'The Gate',
        structure: 'headings',
        partCount: 0,
        chapters: [
          { title: 'The Gate', scenes: ['Morning', 'Evening'] },
          { title: 'The Road', scenes: ['Dawn'] },
        ],
      });
  });

  it('a first H1 that reads "Chapter One" / "Prologue" is not the story title: the file name stays', () => {
    expect(outline([h(1, 'Chapter One'), h(2, 'Morning'), p('Sun.'), h(2, 'Evening'), p('Stars.'), h(1, 'Chapter Two'), h(2, 'Dawn'), p('Fresh.')], 'My Novel'))
      .toEqual({
        title: 'My Novel',
        structure: 'headings',
        partCount: 0,
        chapters: [
          { title: 'Chapter One', scenes: ['Morning', 'Evening'] },
          { title: 'Chapter Two', scenes: ['Dawn'] },
        ],
      });
    expect(outline([h(1, 'Prologue'), p('x'), h(1, 'Chapter 1'), p('y')], 'My Novel').title).toBe('My Novel');
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

  it('a short run of text before the first chapter heading is kept as "Front Matter", not a chapter named after the file', () => {
    expect(outline([p('Dedication.'), h(1, 'A'), h(2, 'A1'), p('x'), h(1, 'B'), h(2, 'B1'), p('y')], 'Book').chapters[0])
      .toEqual({ title: 'Front Matter', scenes: ['Front Matter'] });
  });

  it('a Normal-style title page names the book (ALL CAPS tidied), skipping the byline; its words stay in Front Matter', () => {
    const blocks = [
      p('THE LANTERN ROAD OF THE NORTH'), p('a novel by Skyy'), page, p('For my brother.'), page,
      h(1, 'Chapter One'), p('x'), h(1, 'Chapter Two'), p('y'),
    ];
    const o = outline(blocks, 'lantern-final-v3');
    expect(o.title).toBe('The Lantern Road of the North');
    expect(o.chapters.map((c) => c.title)).toEqual(['Front Matter', 'Chapter One', 'Chapter Two']);
    const { story } = segmentBlocks(blocks, { fallbackTitle: 'lantern-final-v3' });
    const frontProse = story.chapters[0].scenes.map((sc) => sc.prose).join('\n');
    expect(frontProse).toContain('a novel by Skyy');
    expect(frontProse).toContain('For my brother.');
  });

  it('same for typed "CHAPTER ONE" lines; a byline or sentence never becomes the title', () => {
    const typed = [p('by Skyy'), page, p('CHAPTER ONE'), p('x'), page, p('CHAPTER TWO'), p('y')];
    expect(outline(typed, 'draft').title).toBe('draft');
    expect(outline(typed, 'draft').chapters[0].title).toBe('Front Matter');
    expect(outline([p('It was a dark night.'), p('CHAPTER ONE'), p('x'), p('CHAPTER TWO'), p('y')], 'draft').title).toBe('draft');
  });

  it('a Title block or authoritative title is never replaced by the title page line', () => {
    const blocks = [p('Working Title'), h(1, 'Chapter One'), p('x'), h(1, 'Chapter Two'), p('y')];
    expect(outline([title('Real Name'), ...blocks]).title).toBe('Real Name');
    expect(outline(blocks, 'Dc Title', true).title).toBe('Dc Title');
  });

  it('a long unlabelled opening (> 250 words) is a real chapter, not Front Matter', () => {
    const long = p(Array.from({ length: 260 }, (_, i) => `w${i}`).join(' '));
    const o = outline([long, h(1, 'Chapter One'), p('x'), h(1, 'Chapter Two'), p('y')], 'Book');
    expect(o.chapters[0].title).toBe('Book');
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

  it('H1 "Part …" over H2 "Chapter …" (two levels) is parts over chapters, not chapters over scenes', () => {
    expect(outline([
      h(1, 'Part One'), h(2, 'Chapter 1'), p('a'), h(2, 'Chapter 2'), p('b'),
      h(1, 'Part Two'), h(2, 'Chapter 3'), p('c'),
    ], 'My Novel')).toEqual({
      title: 'My Novel',
      structure: 'headings',
      partCount: 2,
      chapters: [
        { title: 'Part One · Chapter 1', scenes: ['Part One · Chapter 1'] },
        { title: 'Part One · Chapter 2', scenes: ['Part One · Chapter 2'] },
        { title: 'Part Two · Chapter 3', scenes: ['Part Two · Chapter 3'] },
      ],
    });
  });

  it('H2 "Part …" over H3 "Chapter …" under a book-title H1; scene breaks still split scenes', () => {
    expect(outline([
      h(1, 'The Lantern Road'), h(2, 'Book One'), h(3, 'Chapter 1'), p('a'), scene, p('b'), h(2, 'Book Two'), h(3, 'Prologue'), p('c'),
    ])).toEqual({
      title: 'The Lantern Road',
      structure: 'headings',
      partCount: 2,
      chapters: [
        { title: 'Book One · Chapter 1', scenes: ['Scene 1', 'Scene 2'] },
        { title: 'Book Two · Prologue', scenes: ['Book Two · Prologue'] },
      ],
    });
  });

  it('a single "Part One" H1 above H2 chapters + H3 scenes is a part, not the book title', () => {
    const o = outline([h(1, 'Part One'), h(2, 'Night'), h(3, 'a'), p('x'), h(2, 'Day'), h(3, 'b'), p('y')], 'My Novel');
    expect(o.title).toBe('My Novel');
    expect(o.partCount).toBe(1);
    expect(o.chapters.map((c) => c.title)).toEqual(['Part One · Night', 'Part One · Day']);
  });

  it('"Part …" headings at the same level as the chapter headings are parts', () => {
    const o = outline([
      h(1, 'Part One'), h(1, 'Chapter 1'), p('a'), h(1, 'Chapter 2'), p('b'), h(1, 'Part Two'), h(1, 'Chapter 3'), p('c'),
    ], 'My Novel');
    expect(o.title).toBe('My Novel');
    expect(o.partCount).toBe(2);
    expect(o.chapters.map((c) => c.title)).toEqual(['Part One · Chapter 1', 'Part One · Chapter 2', 'Part Two · Chapter 3']);
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

  it('a chapter styled as a heading among typed "Chapter …" lines is still a chapter, not the title', () => {
    const o = outline([h(1, 'Chapter 1'), p('a'), p('Chapter 2'), p('b'), p('Chapter 3'), p('c')], 'My Novel');
    expect(o.structure).toBe('patterns');
    expect(o.title).toBe('My Novel');
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

  it('one empty paragraph is a scene break in a single-spaced manuscript where gaps are rare', () => {
    const { story } = segmentBlocks([
      p('Chapter 1'), p('A1.'), p('A2.'), p('A3.'), empty, p('B1.'), p('B2.'), p('Chapter 2'), p('C1.'), p('C2.'),
    ], { fallbackTitle: 'F' });
    expect(story.chapters.map((c) => [c.title, c.scenes.map((s) => s.prose)])).toEqual([
      ['Chapter 1', ['A1.\n\nA2.\n\nA3.', 'B1.\n\nB2.']],
      ['Chapter 2', ['C1.\n\nC2.']],
    ]);
  });

  it('single empty paragraphs scattered too often to be scene breaks are ignored', () => {
    const blocks: RichBlock[] = [h(1, 'A')];
    for (let i = 0; i < 12; i++) blocks.push(p(`P${i}.`), ...(i % 3 === 0 ? [empty] : []));
    expect(outline(blocks).chapters[0].scenes).toHaveLength(1);
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
