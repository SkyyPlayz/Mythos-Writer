// #1765 — HTML → blocks: mammoth output, Google Docs exports, ePub XHTML.

import { describe, it, expect } from 'vitest';
import { blocksToProse, segmentBlocks, type RichBlock } from './blocks.js';
import { decodeEntities, dropBodyWideAlignment, htmlToBlocks, isGoogleDocsHtml } from './htmlBlocks.js';

const blocksOf = (html: string) => htmlToBlocks(html).blocks;
const proseOf = (html: string) => blocksToProse(blocksOf(html));

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

describe('htmlToBlocks — mammoth-shaped HTML', () => {
  it('keeps marks and splits paragraphs (no newlines between blocks)', () => {
    expect(proseOf('<p>Plain <strong>bold</strong> and <em>ital</em>.</p><p>Second <u>u</u> <s>s</s> <b>b</b> <i>i</i> <del>d</del> <strike>k</strike>.</p>'))
      .toBe('Plain **bold** and *ital*.\n\nSecond <u>u</u> ~~s~~ **b** *i* ~~d k~~.');
  });

  it('nested marks become nested Markdown', () => {
    expect(proseOf('<p><strong><em>both</em></strong> then <strong>b <em>bi</em></strong></p>')).toBe('***both*** then **b *bi***');
  });

  it('maps headings, the mythos title / part classes and lists', () => {
    expect(blocksOf('<p class="mythos-title">T</p><h1 class="mythos-part">Part One</h1><h2>Ch</h2><h6>Deep</h6><ul><li>one</li><li>two</li></ul>'))
      .toEqual([
        { kind: 'title', inlines: [{ text: 'T' }] },
        { kind: 'heading', level: 1, part: true, inlines: [{ text: 'Part One' }] },
        { kind: 'heading', level: 2, inlines: [{ text: 'Ch' }] },
        { kind: 'heading', level: 6, inlines: [{ text: 'Deep' }] },
        { kind: 'paragraph', inlines: [{ text: 'one' }] },
        { kind: 'paragraph', inlines: [{ text: 'two' }] },
      ]);
  });

  it('a page-break <hr> inside a <p> splits the paragraph — never "beforeafter"', () => {
    expect(blocksOf('<p>before<hr class="mythos-pagebreak" />after</p>')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'before' }] },
      { kind: 'pageBreak' },
      { kind: 'paragraph', inlines: [{ text: 'after' }] },
    ]);
  });

  it('a paragraph that only holds a page break emits no empty paragraph', () => {
    expect(blocksOf('<p>a</p><p><hr class="mythos-pagebreak" /></p><p>b</p>').map((b) => b.kind))
      .toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('plain <hr> is a scene break; mammoth\'s Scene Break <hr>…</hr> drops its text', () => {
    expect(blocksOf('<p>a</p><hr /><p>b</p><hr class="mythos-scene">* * *</hr><p>c</p>').map((b) => b.kind))
      .toEqual(['paragraph', 'sceneBreak', 'paragraph', 'sceneBreak', 'paragraph']);
  });

  it('a plain <hr> stays void even when another <hr></hr> later in the file is closed', () => {
    expect(blocksOf('<p>a</p><hr><p>b</p><hr></hr><p>c</p>')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'a' }] },
      { kind: 'sceneBreak' },
      { kind: 'paragraph', inlines: [{ text: 'b' }] },
      { kind: 'sceneBreak' },
      { kind: 'paragraph', inlines: [{ text: 'c' }] },
    ]);
  });

  it('real text inside an <hr>…</hr> is kept after the break', () => {
    expect(blocksOf('<p>a</p><hr><p>b</p></hr><p>c</p>').map((b) => (b.kind === 'paragraph' ? b.inlines[0].text : b.kind)))
      .toEqual(['a', 'sceneBreak', 'b', 'c']);
  });

  it('keeps empty paragraphs as empty blocks', () => {
    expect(blocksOf('<p>a</p><p></p><p>  </p><p>b</p>').map((b) => b.kind)).toEqual(['paragraph', 'empty', 'empty', 'paragraph']);
  });

  it('<br> is a hard break; whitespace collapses like a browser; leading tabs / NBSP indents go', () => {
    expect(proseOf('<p>\tline   one<br />line\u00a0two</p><p>&nbsp;&nbsp;&nbsp;Indented &nbsp; text</p>'))
      .toBe('line one\\\nline two\n\nIndented text');
  });

  it('decodes entities once, at text level', () => {
    expect(blocksOf('<p>&amp;amp; &lt;b&gt; &rsquo;&#8212;&#x2026; &bogus;</p>')).toEqual([
      { kind: 'paragraph', inlines: [{ text: '&amp; <b> ’—… &bogus;' }] },
    ]);
    expect(decodeEntities('&#0;&#xD800;&#99999999;')).toBe('���');
  });

  it('drops mammoth footnote trailers and reference markers (with a warning)', () => {
    const r = htmlToBlocks('<p>Text<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup> end.</p>'
      + '<ol><li id="footnote-1"><p>The note. <a href="#footnote-ref-1">↑</a></p></li><li id="endnote-2"><p>End note.</p></li></ol>');
    expect(blocksToProse(r.blocks)).toBe('Text end.');
    expect(r.warnings).toEqual(['2 footnotes were left out of the story — Mythos doesn’t import footnotes yet.']);
  });

  it('drops images with a count warning (no base64 in prose)', () => {
    const r = htmlToBlocks('<p>a<img src="data:image/png;base64,AAAA" /></p><p><img src="" /></p>');
    expect(blocksToProse(r.blocks)).toBe('a');
    expect(r.warnings).toEqual(['2 images were not imported.']);
  });

  it('never turns <head>, <script>, <style> or comments into text', () => {
    expect(proseOf('<html><head><title>Doc</title><style>p{x:1}</style></head><body><script>alert(1)</script><!-- c --><p>Only</p></body></html>'))
      .toBe('Only');
    expect(htmlToBlocks('<head><title> My  Doc </title></head><p>x</p>').title).toBe('My Doc');
  });

  it('tables: one paragraph per row, cells joined by " | "', () => {
    expect(proseOf('<table><tr><th>Name</th><th>Role</th></tr><tr><td><p>Mara</p></td><td><strong>Lead</strong></td></tr><tr><td></td></tr></table>'))
      .toBe('Name | Role\n\nMara | **Lead**');
  });

  it('blockquote content becomes paragraphs; links keep only their text', () => {
    expect(proseOf('<blockquote><p>Quoted.</p></blockquote><p>See <a href="https://x.test">the map</a>.</p>'))
      .toBe('Quoted.\n\nSee the map.');
  });

  it('reads alignment from mythos classes, style= and align=', () => {
    expect(blocksOf('<p class="mythos-center">c</p><p style="text-align: right">r</p><p align="justify">j</p><p>plain</p><p>plain</p>'))
      .toEqual([
        { kind: 'paragraph', inlines: [{ text: 'c' }], align: 'center' },
        { kind: 'paragraph', inlines: [{ text: 'r' }], align: 'right' },
        { kind: 'paragraph', inlines: [{ text: 'j' }], align: 'justify' },
        { kind: 'paragraph', inlines: [{ text: 'plain' }] },
        { kind: 'paragraph', inlines: [{ text: 'plain' }] },
      ]);
  });

  it('survives unclosed tags, stray close tags and deep nesting', () => {
    expect(proseOf('<p>one<p>two</span></div><p><b>bold')).toBe('one\n\ntwo\n\n**bold**');
    const deep = `${'<div>'.repeat(5000)}<p>deep</p>${'</div>'.repeat(5000)}`;
    expect(proseOf(deep)).toBe('deep');
  });

  it('an unbalanced quote in a tag does not swallow the rest of the document', () => {
    expect(proseOf('<p class="a>one</p><p>two</p>')).toBe('one\n\ntwo');
  });

  it('hostile input parses in linear time (no backtracking scans of untrusted text)', async () => {
    // Each of these took seconds to hours with backtracking regexes (sizes: the last argument × 4).
    await expectLinearTime((k) => `<style>${'a'.repeat(k)}</style><p>x</p>`, (html) => expect(proseOf(html)).toBe('x'), 250_000);
    await expectLinearTime((k) => `<style>${'/*'.repeat(k)}</style>`, htmlToBlocks, 75_000);
    await expectLinearTime((k) => `<style>${'@import'.repeat(k)}</style>`, htmlToBlocks, 37_500);
    await expectLinearTime((k) => `<style>.c1{font-weight:${' '.repeat(k)}x}</style>`, htmlToBlocks, 125_000);
    await expectLinearTime((k) => `<p style="color:${' '.repeat(k)}x">y</p>`, htmlToBlocks, 125_000);
    await expectLinearTime((k) => '<meta'.repeat(k), isGoogleDocsHtml, 10_000);
    await expectLinearTime((k) => '<style></style>'.repeat(k), htmlToBlocks, 15_000);
    await expectLinearTime((k) => `${'<a "x>'.repeat(k)}<p>end</p>`, htmlToBlocks, 25_000);
    await expectLinearTime((k) => `${'<hr>'.repeat(k)}</hr>`, htmlToBlocks, 25_000);
  });

  it('a "<" that is not a tag stays text', () => {
    expect(blocksOf('<p>1 < 2 and 3<4</p>')).toEqual([{ kind: 'paragraph', inlines: [{ text: '1 < 2 and 3<4' }] }]);
  });
});

// ── Google Docs ──────────────────────────────────────────────────────────────

const GOOGLE_EXPORT = [
  '<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type">',
  '<style type="text/css">@import url(\'https://themes.googleusercontent.com/fonts/css?kit=abc\');',
  '.lst-kix_abc-0>li:before{content:"\\0025cf  "}ol{margin:0;padding:0}',
  '.c0{color:#000000;font-weight:400;text-decoration:none;font-style:normal}',
  '.c3{font-weight:700}.c5{font-style:italic}.c2{text-align:center}.c7{text-decoration:underline}',
  '.c9{text-decoration:line-through}.c1{padding-top:0pt;line-height:1.15}.c4{height:11pt}',
  '.c6{color:#1155cc;text-decoration:underline}.title{font-size:26pt}.subtitle{font-size:15pt}</style></head>',
  '<body class="c8 doc-content">',
  '<p class="c1 title" id="h.abc"><span class="c0">The Lantern Road</span></p>',
  '<p class="c1 subtitle" id="h.def"><span class="c0">A novel</span></p>',
  '<h1 class="c1" id="h.1"><span class="c0">Chapter One</span></h1>',
  '<p class="c1"><span class="c0">Mara reached the </span><span class="c3">iron gate</span><span class="c0"> at </span>',
  '<span class="c5">dusk</span><span class="c0">, </span><span class="c3 c5">really</span><span class="c0"> </span>',
  '<span class="c7">truly</span><span class="c0"> and </span><span class="c9">never</span><span class="c0">.</span>',
  '<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup></p>',
  '<p class="c1 c4"><span class="c0"></span></p>',
  '<p class="c1 c2"><span class="c0">Centered line</span></p>',
  '<hr style="page-break-before:always;display:none;">',
  '<h1 class="c1" id="h.2"><span class="c0">Chapter Two</span></h1>',
  '<p class="c1"><span class="c0">See </span><span class="c6"><a class="c6" href="https://www.google.com/url?q=https://example.com&amp;sa=D&amp;ust=1">the map</a></span>',
  '<span class="c0">.</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup></p>',
  '<hr class="c10">',
  '<div><p class="c1"><a href="#ftnt_ref1" id="ftnt1">[1]</a><span class="c0">&nbsp;A footnote that must not leak.</span></p></div>',
  '<div class="c11"><p class="c1"><a href="#cmnt_ref1" id="cmnt1">[a]</a><span class="c0">A comment that must not leak.</span></p></div>',
  '</body></html>',
].join('');

describe('htmlToBlocks — Google Docs "Web page" export', () => {
  it('reads marks from the <style> class table, title/subtitle, page-break <hr>, and drops trailers', () => {
    const r = htmlToBlocks(GOOGLE_EXPORT);
    expect(r.blocks).toEqual([
      { kind: 'title', inlines: [{ text: 'The Lantern Road' }] },
      { kind: 'paragraph', inlines: [{ text: 'A novel' }] },
      { kind: 'heading', level: 1, inlines: [{ text: 'Chapter One' }] },
      {
        kind: 'paragraph',
        inlines: [
          { text: 'Mara reached the ' }, { text: 'iron gate', bold: true }, { text: ' at ' }, { text: 'dusk', italic: true },
          { text: ', ' }, { text: 'really', bold: true, italic: true }, { text: ' ' }, { text: 'truly', underline: true },
          { text: ' and ' }, { text: 'never', strike: true }, { text: '.' },
        ],
      },
      { kind: 'empty' },
      { kind: 'paragraph', inlines: [{ text: 'Centered line' }], align: 'center' },
      { kind: 'pageBreak' },
      { kind: 'heading', level: 1, inlines: [{ text: 'Chapter Two' }] },
      // Link text only, no [a] comment marker, and no link underline from Google's link class.
      { kind: 'paragraph', inlines: [{ text: 'See ' }, { text: 'the map' }, { text: '.' }] },
      { kind: 'sceneBreak' },
    ]);
    expect(r.warnings).toEqual([
      '1 footnote was left out of the story — Mythos doesn’t import footnotes yet.',
      '1 comment was left out.',
    ]);
  });

  it('segments into a titled story with formatted prose', () => {
    const { story } = segmentBlocks(htmlToBlocks(GOOGLE_EXPORT).blocks, { fallbackTitle: 'export' });
    expect(story.title).toBe('The Lantern Road');
    expect(story.structure).toBe('headings');
    // The subtitle before the first heading is the title page: kept as "Front Matter".
    expect(story.chapters.map((c) => c.title)).toEqual(['Front Matter', 'Chapter One', 'Chapter Two']);
    expect(story.chapters[1].scenes[0].prose).toBe(
      'Mara reached the **iron gate** at *dusk*, ***really*** <u>truly</u> and ~~never~~.\n\nCentered line {.center}',
    );
    expect(JSON.stringify(story)).not.toMatch(/must not leak|\[1\]|\[a\]/);
  });

  it('the docs-internal-guid <b> wrapper (copied from Docs) is NOT bold; inline style= marks are', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b"><p dir="ltr" style="text-align: center;">'
      + '<span style="font-weight:700;">Bold</span><span style="font-weight:400;"> plain </span>'
      + '<span style="font-style:italic;text-decoration:underline">iu</span></p></b>';
    expect(blocksOf(html)).toEqual([{
      kind: 'paragraph',
      align: 'center',
      inlines: [{ text: 'Bold', bold: true }, { text: ' plain ' }, { text: 'iu', italic: true, underline: true }],
    }]);
  });

  it('reads the class table around @media blocks and malformed rules', () => {
    const html = '<style>@media print{.c1{font-weight:700}}.c2{font-style:italic !important}x{y{.c4{}.c3{font-weight:bold}</style>'
      + '<p><span class="c1">a</span> <span class="c2">b</span> <span class="c3">c</span></p>';
    expect(proseOf(html)).toBe('a *b* **c**');
  });

  it('isGoogleDocsHtml detects exports and copied HTML, not ordinary pages', () => {
    expect(isGoogleDocsHtml(GOOGLE_EXPORT)).toBe(true);
    expect(isGoogleDocsHtml('<html><head><meta name="generator" content="Google-Docs"></head></html>')).toBe(true);
    expect(isGoogleDocsHtml('<meta charset="utf-8"><meta name="x" content="y"><p>docs.google.com is a site</p>')).toBe(false);
    expect(isGoogleDocsHtml('<b id="docs-internal-guid-1">x</b>')).toBe(true);
    expect(isGoogleDocsHtml('<html><body><p>Hello</p></body></html>')).toBe(false);
  });
});

describe('htmlToBlocks — ePub XHTML', () => {
  it('handles XML prologue, CDATA, namespaced tags, noteref links and footnote asides', () => {
    const xhtml = '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
      + '<body><section epub:type="chapter"><h1>One</h1><p>Text<a epub:type="noteref" href="#n1">1</a> <![CDATA[a & b]]>'
      + '<span epub:type="pagebreak" title="12">12</span>.</p>'
      + '<aside epub:type="footnote" id="n1"><p>Leaky note.</p></aside></section></body></html>';
    const r = htmlToBlocks(xhtml);
    expect(blocksToProse(r.blocks)).toBe('# One\n\nText a & b.');
    expect(r.warnings).toEqual(['1 footnote was left out of the story — Mythos doesn’t import footnotes yet.']);
  });
});

describe('dropBodyWideAlignment', () => {
  it('drops justify when most paragraphs are justified, keeps centering', () => {
    const j = (t: string): RichBlock => ({ kind: 'paragraph', inlines: [{ text: t }], align: 'justify' });
    const out = dropBodyWideAlignment([j('a'), j('b'), { kind: 'paragraph', inlines: [{ text: 'c' }], align: 'center' }]);
    expect(out.map((b) => (b.kind === 'paragraph' ? b.align : null))).toEqual([undefined, undefined, 'center']);
  });

  it('keeps a justified paragraph that stands out', () => {
    const blocks: RichBlock[] = [
      { kind: 'paragraph', inlines: [{ text: 'a' }], align: 'justify' },
      { kind: 'paragraph', inlines: [{ text: 'b' }] },
      { kind: 'paragraph', inlines: [{ text: 'c' }] },
    ];
    expect(dropBodyWideAlignment(blocks)).toEqual(blocks);
  });
});

describe('htmlToBlocks — determinism', () => {
  it('same input → identical output', () => {
    expect(htmlToBlocks(GOOGLE_EXPORT)).toEqual(htmlToBlocks(GOOGLE_EXPORT));
  });
});
