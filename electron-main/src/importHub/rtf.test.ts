// #1765 — RTF → blocks, and the standalone .rtf importer.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blocksToProse } from './blocks.js';
import { ImportUserError, MAX_RTF_GROUP_DEPTH, parseRtf, rtfFileToPlan, rtfToBlocks } from './rtf.js';
import { rtfToText } from '../storyImport.js';

const doc = (body: string, header = '\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}') => `{\\rtf1${header}\n${body}}`;
const prose = (rtf: string) => blocksToProse(rtfToBlocks(rtf));

describe('rtfToBlocks — character formatting', () => {
  it('bold, italic, underline and strike become marks (the old rtfToText dropped them)', () => {
    const rtf = doc('\\pard Plain {\\b bold} {\\i italic} {\\ul under}\\ulnone  {\\strike gone} end.\\par');
    expect(rtfToText(rtf)).toBe('Plain bold italic under gone end.');
    expect(prose(rtf)).toBe('Plain **bold** *italic* <u>under</u> ~~gone~~ end.');
  });

  it('toggles with \\b0 / \\i0 / \\ul0 / \\strike0 / \\striked1 and \\plain resets everything', () => {
    const rtf = doc('\\pard \\b one\\b0  \\i two\\i0  \\ul three\\ul0  \\striked1 four\\striked0  \\b\\i five\\plain  six\\par');
    expect(prose(rtf)).toBe('**one** *two* <u>three</u> ~~four~~ ***five*** six');
  });

  it('a closing brace restores the outer group\'s formatting', () => {
    expect(rtfToBlocks(doc('\\pard \\i outer {\\b\\i0 inner} outer again\\par'))).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'outer ', italic: true }, { text: 'inner', bold: true }, { text: ' outer again', italic: true }] },
    ]);
  });

  it('a font named …-Italic / …-Bold implies the mark (Cocoa / Mac Scrivener RTF)', () => {
    const rtf = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2580{\\fonttbl\\f0\\fnil\\fcharset0 Palatino-Roman;\\f1\\fnil\\fcharset0 Palatino-Italic;\\f2\\fnil\\fcharset0 Palatino-Bold;}\n'
      + '{\\colortbl;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;}\n\\pard\\pardirnatural\\partightenfactor0\n\n\\f0\\fs26 \\cf0 She was \\f1 very\\f0  sure, \\f2 truly\\f0 .}';
    expect(prose(rtf)).toBe('She was *very* sure, **truly**.');
  });

  it('hidden (\\v) and deleted revision text is never imported', () => {
    expect(prose(doc('\\pard Seen{\\v  hidden} here{\\deleted  cut}.\\par'))).toBe('Seen here.');
  });
});

describe('rtfToBlocks — characters and codepages', () => {
  it('\\\'hh escapes use Windows-1252 (smart quotes, dashes, ellipsis), not Latin-1 control codes', () => {
    const rtf = doc('\\pard \\\'93Wait\\\'85\\\'94 she said \\\'96 then \\\'97 it\\\'92s caf\\\'e9.\\par');
    expect(rtfToText(rtf)).not.toContain('“'); // the old reader produced U+0093 control characters
    expect(prose(rtf)).toBe('“Wait…” she said – then — it’s café.');
  });

  it('\\uN emits the character and skips \\ucN fallback characters (including \\\'hh fallbacks)', () => {
    expect(prose(doc('\\pard it\\u8217?s \\uc2\\u8212\\\'97-x \\uc0\\u8220 quoted\\u8221  \\uc1\\u-3913?\\par'))).toBe('it’s —x “quoted” \uf0b7');
    // Astral characters arrive as a surrogate pair.
    expect(prose(doc('\\pard \\u-10179?\\u-8704? ok\\par'))).toBe('😀 ok');
  });

  it('named symbol words', () => {
    expect(prose(doc('\\pard \\lquote a\\rquote  \\ldblquote b\\rdblquote  c\\emdash d\\endash e \\bullet  f\\~g\\par')))
      .toBe('‘a’ “b” c—d–e • f g');
  });

  it('decodes another \\ansicpg and per-font \\fcharset', () => {
    expect(prose(doc('\\pard \\\'cf\\\'f0\\\'e8\\\'e2\\\'e5\\\'f2\\par', '\\ansi\\ansicpg1251'))).toBe('Привет');
    const cyrFont = '\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times;}{\\f1\\fswiss\\fcharset204 Arial Cyr;}}';
    expect(prose(doc('\\pard caf\\\'e9 {\\f1 \\\'e4\\\'e0}\\par', cyrFont))).toBe('café да');
  });

  it('escaped braces and backslashes are literal text', () => {
    expect(prose(doc('\\pard a \\{b\\} c\\\\d\\par'))).toBe('a {b} c\\\\d');
  });
});

describe('rtfToBlocks — paragraphs and breaks', () => {
  it('\\par ends a paragraph; Cocoa\'s backslash-newline does too; raw newlines are not text', () => {
    expect(rtfToBlocks(doc('\\pard One\nstill one\\par Two\\\nThree'))).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Onestill one' }] },
      { kind: 'paragraph', inlines: [{ text: 'Two' }] },
      { kind: 'paragraph', inlines: [{ text: 'Three' }] },
    ]);
  });

  it('\\qc / \\qr / \\qj align per paragraph and \\pard resets', () => {
    const blocks = rtfToBlocks(doc('\\pard\\qc Centered\\par\\pard\\qr Right\\par\\pard\\qj Justified\\par\\pard Left\\par'));
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.align ?? 'left' : b.kind))).toEqual(['center', 'right', 'justify', 'left']);
    expect(prose(doc('\\pard\\qc Centered\\par'))).toBe('Centered {.center}');
  });

  it('\\line is a hard break, \\tab a space', () => {
    expect(rtfToBlocks(doc('\\pard Roses are red,\\line violets\\tab blue.\\par'))).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Roses are red,' }, { text: '', hardBreak: true }, { text: 'violets blue.' }] },
    ]);
  });

  it('\\page and \\sect are page breaks; the break\'s own empty paragraph is swallowed', () => {
    expect(rtfToBlocks(doc('\\pard One\\par\\page\\par Two\\par\\sect Three\\page Four\\par')).map((b) => b.kind))
      .toEqual(['paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph']);
  });

  it('\\pagebb puts a page break before its paragraph', () => {
    expect(rtfToBlocks(doc('\\pard One\\par\\pard\\pagebb Two\\par')).map((b) => b.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('a "#" / "* * *" paragraph is a scene break; empty paragraphs stay as empties', () => {
    expect(rtfToBlocks(doc('\\pard A\\par\\par\\pard\\qc #\\par B\\par * * *\\par C\\par')).map((b) => b.kind))
      .toEqual(['paragraph', 'empty', 'sceneBreak', 'paragraph', 'sceneBreak', 'paragraph']);
  });

  it('Word heading paragraphs (\\outlinelevelN) become headings', () => {
    expect(rtfToBlocks(doc('\\pard\\outlinelevel0 Chapter One\\par\\pard Text\\par'))).toEqual([
      { kind: 'heading', level: 1, inlines: [{ text: 'Chapter One' }] },
      { kind: 'paragraph', inlines: [{ text: 'Text' }] },
    ]);
  });
});

describe('rtfToBlocks — destinations', () => {
  it('skips font/color/style tables, info, pictures, headers and every {\\* …} group', () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}{\\colortbl;\\red0\\green0\\blue0;}{\\stylesheet{\\s0 Normal;}}'
      + '{\\info{\\title Secret Title}{\\author Someone}}{\\*\\generator Riched20;}{\\header Running head\\par}'
      + '{\\footer Page\\par}\\pard Body{\\pict\\pngblip 89504e47} text.{\\*\\bkmkstart b1}\\par}';
    const parsed = parseRtf(rtf);
    expect(blocksToProse(parsed.blocks)).toBe('Body text.');
    expect(parsed.droppedImages).toBe(1);
  });

  it('keeps a field\'s result text but drops its instruction', () => {
    expect(prose(doc('\\pard See {\\field{\\*\\fldinst{HYPERLINK "https://example.com"}}{\\fldrslt the site}} now.\\par')))
      .toBe('See the site now.');
  });

  it('drops footnotes and annotations and counts them', () => {
    const parsed = parseRtf(doc('\\pard Main{\\super\\chftn}{\\footnote \\pard\\plain {\\super\\chftn} A footnote.} text'
      + '{\\*\\atnid JD}{\\*\\annotation \\pard Fix this.}.\\par'));
    expect(blocksToProse(parsed.blocks)).toBe('Main text.');
    expect(parsed.droppedFootnotes).toBe(1);
    expect(parsed.droppedAnnotations).toBe(1);
  });

  it('drops Scrivener inline annotations and inline footnotes', () => {
    const parsed = parseRtf(doc('\\pard She left.{\\Scrv_annot \\color={\\R=1.0\\G=0.0\\B=0.0} \\text=Check the date\\end_Scrv_annot} Then'
      + ' rain{\\Scrv_fn=It rained a lot.\\end_Scrv_fn}.\\par'));
    expect(blocksToProse(parsed.blocks)).toBe('She left. Then rain.');
    expect(parsed.droppedAnnotations).toBe(1);
    expect(parsed.droppedFootnotes).toBe(1);
  });

  it('skips \\binN data unread', () => {
    expect(prose(doc('\\pard A{\\object{\\objdata\\bin4 {}\\x}} B\\par'))).toBe('A B');
  });
});

describe('rtfFileToPlan', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rtf-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('splits a manuscript on "Chapter One" lines, keeping formatting and scene breaks', async () => {
    const body = [
      '\\pard\\qc\\b Chapter One\\b0\\par',
      '\\pard It was a {\\i dark} night.\\par',
      '\\pard\\qc #\\par',
      '\\pard \\\'93Run,\\\'94 she said.\\par',
      '\\pard\\qc\\b Chapter Two\\b0\\par',
      '\\pard Morning came.\\par',
    ].join('\n');
    const file = path.join(tmp, 'The Lantern.rtf');
    fs.writeFileSync(file, doc(body), 'latin1');
    const plan = await rtfFileToPlan(file, 'The Lantern.rtf');
    expect(plan.source).toEqual({ kind: 'rtf', name: 'The Lantern.rtf' });
    expect(plan.notes).toEqual([]);
    expect(plan.story?.title).toBe('The Lantern');
    expect(plan.story?.structure).toBe('patterns');
    expect(plan.story?.chapters.map((c) => [c.title, c.scenes.map((s) => s.prose)])).toEqual([
      ['Chapter One', ['It was a *dark* night.', '“Run,” she said.']],
      ['Chapter Two', ['Morning came.']],
    ]);
  });

  it('warns about left-out footnotes', async () => {
    const file = path.join(tmp, 'notes.rtf');
    fs.writeFileSync(file, doc('\\pard Text{\\footnote One.}{\\footnote Two.}.\\par'));
    const plan = await rtfFileToPlan(file, 'notes.rtf');
    expect(plan.warnings).toContain('2 footnotes were left out — Mythos imports the main text only.');
  });

  it('reads a UTF-8 file with literal characters', async () => {
    const file = path.join(tmp, 'utf8.rtf');
    fs.writeFileSync(file, doc('\\pard Zoë’s “book”.\\par'), 'utf-8');
    const plan = await rtfFileToPlan(file, 'utf8.rtf');
    expect(plan.story?.chapters[0].scenes[0].prose).toBe('Zoë’s “book”.');
  });

  it('splits on stylesheet headings with descriptive titles (LibreOffice-saved RTF)', async () => {
    const file = path.join(tmp, 'styled.rtf');
    const para = (t: string) => `\\pard\\plain\\s0 ${t}\\par`;
    fs.writeFileSync(file, '{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1\\sbasedon15 Heading 1;}}\n'
      + `\\pard\\plain\\s1 The Arrival\\par${para('They came.')}\\pard\\plain\\s1 Under the Bridge\\par${para('Water.')}}`);
    const plan = await rtfFileToPlan(file, 'styled.rtf');
    expect(plan.story?.chapters.map((c) => c.title)).toEqual(['The Arrival', 'Under the Bridge']);
  });

  it('a damaged file is a plain-language ImportUserError, not a crash', async () => {
    const file = path.join(tmp, 'deep.rtf');
    fs.writeFileSync(file, `{\\rtf1 ${'{'.repeat(200_000)}`);
    await expect(rtfFileToPlan(file, 'deep.rtf')).rejects.toBeInstanceOf(ImportUserError);
  });

  it('is deterministic', async () => {
    const file = path.join(tmp, 'd.rtf');
    fs.writeFileSync(file, doc('\\pard Chapter 1\\par A {\\b b}.\\par\\page Chapter 2\\par C.\\par'));
    expect(await rtfFileToPlan(file, 'd.rtf')).toEqual(await rtfFileToPlan(file, 'd.rtf'));
  });
});

describe('rtfToBlocks — damaged and unusual input', () => {
  it('refuses absurd group nesting with a plain-language error instead of exhausting memory', () => {
    const deep = `{\\rtf1 ${'{'.repeat(1_000_000)}x${'}'.repeat(1_000_000)}}`;
    expect(() => parseRtf(deep)).toThrow(ImportUserError);
    expect(() => parseRtf(deep)).toThrow(/damaged/);
    // Real documents nest a few levels; the cap is far above that.
    const ok = `{\\rtf1 ${'{'.repeat(MAX_RTF_GROUP_DEPTH - 2)}\\b deep${'}'.repeat(MAX_RTF_GROUP_DEPTH - 2)} plain\\par}`;
    expect(prose(ok)).toBe('**deep** plain');
  });

  it('only Scrivener inline annotations / footnotes hide text; other Scrv_ markers are ignored', () => {
    expect(prose(doc('\\pard A{\\*\\Scrv_sty Body} B\\par C\\par'))).toBe('A B\n\nC');
    expect(prose(doc('\\pard A{\\Scrv_ps=0}B\\par C\\par'))).toBe('AB\n\nC');
  });

  it('an unterminated Scrivener annotation ends with its own group', () => {
    const parsed = parseRtf(doc('\\pard A {\\Scrv_annot \\text=x} B\\par C\\par D\\par'));
    expect(blocksToProse(parsed.blocks)).toBe('A B\n\nC\n\nD');
    expect(parsed.droppedAnnotations).toBe(1);
    // Outside a group of its own it ends with its paragraph.
    expect(prose(doc('\\pard A \\Scrv_annot \\text=x B\\par C\\par'))).toBe('A\n\nC');
  });

  it('headings marked only by a stylesheet style ("heading 1", or a style with \\outlinelevel) are headings', () => {
    const rtf = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Liberation Serif;}}'
      + '{\\stylesheet{\\s0\\snext0 Normal;}{\\s1\\sbasedon15\\snext16\\b\\fs36 Heading 1;}'
      + '{\\s2\\outlinelevel1\\snext0 Section Title;}{\\*\\cs15 Default Paragraph Font;}}\n'
      + '\\pard\\plain\\s1\\b The Arrival\\par\\pard\\plain\\s0 Text.\\par\\pard\\plain\\s2 Later\\par'
      + '\\pard\\plain\\s1\\outlinelevel2 Override\\par\\pard Plain again\\par}';
    expect(rtfToBlocks(rtf)).toEqual([
      { kind: 'heading', level: 1, inlines: [{ text: 'The Arrival', bold: true }] },
      { kind: 'paragraph', inlines: [{ text: 'Text.' }] },
      { kind: 'heading', level: 2, inlines: [{ text: 'Later' }] },
      { kind: 'heading', level: 3, inlines: [{ text: 'Override' }] },
      { kind: 'paragraph', inlines: [{ text: 'Plain again' }] },
    ]);
  });

  it('U+2028 (Cocoa soft return) is a hard break and U+2029 ends the paragraph', () => {
    expect(rtfToBlocks(doc('\\pard It was late.\\uc0\\u8232  Next line.\\u8233 New para.\\par'))).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'It was late.' }, { text: '', hardBreak: true }, { text: 'Next line.' }] },
      { kind: 'paragraph', inlines: [{ text: 'New para.' }] },
    ]);
    expect(rtfToBlocks(doc('\\pard Roses\u2028Violets\\par'))).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Roses' }, { text: '', hardBreak: true }, { text: 'Violets' }] },
    ]);
  });

  it('a continuous section break (\\sbknone) is not a page break; other section breaks are', () => {
    expect(rtfToBlocks(doc('\\pard A\\par\\sect\\sectd\\sbknone\\pard B\\par')).map((b) => b.kind))
      .toEqual(['paragraph', 'paragraph']);
    expect(rtfToBlocks(doc('\\pard A\\par\\sect\\sectd\\sbkpage\\pard B\\par')).map((b) => b.kind))
      .toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(rtfToBlocks(doc('\\pard A\\sect\\sectd\\pard\\par B\\par')).map((b) => b.kind))
      .toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });
});
