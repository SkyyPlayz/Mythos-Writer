// #1765 — ePub → blocks / story. ePubs are zipped in-test with JSZip.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { EPUB_MAX_ENTRIES, EPUB_MAX_INFLATED_BYTES, epubToBlocks, parseEpubStory } from './epub.js';

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

interface EpubDoc {
  id: string;
  href: string;
  body: string;
  linear?: boolean;
  nav?: boolean;
  /** OPF media-type. Defaults to application/xhtml+xml. */
  mediaType?: string;
}

async function makeEpub(docs: EpubDoc[], opts: { title?: string; opfPath?: string; extraFiles?: number; opfTail?: string } = {}): Promise<Buffer> {
  const opfPath = opts.opfPath ?? 'OEBPS/content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">`
    + `<rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const manifest = docs.map((d) => `<item id="${d.id}" href="${d.href}" media-type="${d.mediaType ?? 'application/xhtml+xml'}"${d.nav ? ' properties="nav"' : ''}/>`).join('');
  const spine = docs.map((d) => `<itemref idref="${d.id}"${d.linear === false ? ' linear="no"' : ''}/>`).join('');
  zip.file(opfPath,
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`
    + (opts.title ? `<dc:title>${opts.title}</dc:title>` : '')
    + `</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>${opts.opfTail ?? ''}`);
  for (const d of docs) {
    const entry = decodeURIComponent(`${opfDir}${d.href}`).replace(/[^/]+\/\.\.\//g, '');
    zip.file(entry, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${d.body}</body></html>`);
  }
  for (let i = 0; i < (opts.extraFiles ?? 0); i++) zip.file(`OEBPS/junk/${i}.txt`, '');
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

const THREE_CHAPTERS: EpubDoc[] = [
  { id: 'nav', href: 'nav.xhtml', body: '<nav epub:type="toc"><ol><li>Chapter 1</li><li>Chapter 2</li></ol></nav>', nav: true },
  { id: 'c1', href: 'Text/chapter%201.xhtml', body: '<h1>Chapter 1</h1><p>With <em>italic</em> and <strong>bold</strong>.</p><p>Second &amp; last.</p>' },
  { id: 'c2', href: 'Text/ch2.xhtml', body: '<h1>Chapter 2</h1><p>Plain.</p><hr/><p>After a break.</p>' },
  { id: 'notes', href: 'Text/notes.xhtml', body: '<p>Aux notes</p>', linear: false },
  { id: 'c3', href: '../OEBPS/Text/ch3.xhtml', body: '<h1>Chapter 3</h1><p><u>Under</u> and <s>gone</s>.</p>' },
];

describe('epubToBlocks / parseEpubStory — (i)', () => {
  it('reads the spine in order: 3 chapters, dc:title authoritative, formatting kept', async () => {
    const buf = await makeEpub(THREE_CHAPTERS, { title: 'The Lantern &amp; Road' });
    const { story, warnings } = await parseEpubStory(buf, 'file-name');
    expect(story.title).toBe('The Lantern & Road');
    expect(story.structure).toBe('headings');
    expect(story.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(story.chapters[0].scenes[0].prose).toBe('With *italic* and **bold**.\n\nSecond & last.');
    expect(story.chapters[1].scenes.map((s) => s.prose)).toEqual(['Plain.', 'After a break.']);
    expect(story.chapters[2].scenes[0].prose).toBe('<u>Under</u> and ~~gone~~.');
    // The nav document and the non-linear notes document are not story text.
    expect(JSON.stringify(story)).not.toMatch(/Aux notes|<li>/);
    expect(warnings).toEqual([]);
  });

  it('joins spine documents with a page break', async () => {
    const { blocks, title } = await epubToBlocks(await makeEpub(THREE_CHAPTERS, { title: 'T' }));
    expect(title).toBe('T');
    expect(blocks.filter((b) => b.kind === 'pageBreak')).toHaveLength(2);
  });

  it('spine documents without headings are still chapters, however short', async () => {
    const buf = await makeEpub([
      { id: 'a', href: 'a.xhtml', body: '<p>One.</p>' },
      { id: 'b', href: 'b.xhtml', body: '<p>Two.</p>' },
      { id: 'c', href: 'c.xhtml', body: '<p>Three.</p>' },
    ], { title: 'Short' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.structure).toBe('pagebreaks');
    expect(story.chapters.map((c) => [c.title, c.scenes[0].prose])).toEqual([['Chapter 1', 'One.'], ['Chapter 2', 'Two.'], ['Chapter 3', 'Three.']]);
  });

  it('a short title-page document before the chapters is Front Matter; dc:title stays the title', async () => {
    const prose = (seed: string) => `<p>${seed} ${'and the road ran on '.repeat(40).trim()}.</p>`;
    const buf = await makeEpub([
      { id: 't', href: 't.xhtml', body: '<p>The Lantern Road</p><p>by Skyy</p>' },
      { id: 'a', href: 'a.xhtml', body: prose('A') },
      { id: 'b', href: 'b.xhtml', body: prose('B') },
    ], { title: 'Dc Title' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.structure).toBe('pagebreaks');
    expect(story.title).toBe('Dc Title');
    expect(story.chapters.map((c) => c.title)).toEqual(['Front Matter', 'Chapter 1', 'Chapter 2']);
    expect(story.chapters[0].scenes[0].prose).toBe('The Lantern Road\n\nby Skyy');
  });

  it('a spine document with 200k paragraphs does not overflow the call stack', async () => {
    const body = Array.from({ length: 200_000 }, (_, i) => `<p>P${i}</p>`).join('');
    const { blocks } = await epubToBlocks(await makeEpub([{ id: 'a', href: 'a.xhtml', body }], { title: 'Big' }));
    expect(blocks.length).toBeGreaterThanOrEqual(200_000);
    expect(blocks[blocks.length - 1]).toEqual({ kind: 'paragraph', inlines: [{ text: 'P199999' }] });
  });

  it('without dc:title the fallback title is used', async () => {
    const { story } = await parseEpubStory(await makeEpub(THREE_CHAPTERS), 'From File');
    expect(story.title).toBe('From File');
  });

  it('an NCX spine item yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'ncx',
        href: 'toc.ncx',
        mediaType: 'application/x-dtbncx+xml',
        body: '<h1>NCX Ghost Chapter</h1><p>This navigation file is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/NCX Ghost Chapter/);
  });

  it('a non-XHTML item with a .xml href yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'ncx',
        href: 'toc.xml',
        mediaType: 'application/x-dtbncx+xml',
        body: '<h1>NCX Xml Chapter</h1><p>Navigation named xml.</p>',
      },
      {
        id: 'svg',
        href: 'cover.xml',
        mediaType: 'image/svg+xml',
        body: '<h1>SVG Xml Chapter</h1><p>An svg is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/NCX Xml Chapter|SVG Xml Chapter/);
  });

  it('an empty media-type with a .xml href yields no chapter', async () => {
    const buf = await makeEpub([
      { id: 'xml', href: 'notes.xml', mediaType: '', body: '<h1>Xml Notes Chapter</h1><p>Not a chapter.</p>' },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/Xml Notes Chapter/);
  });

  it('a declared non-HTML type with an .xhtml href yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'ncx',
        href: 'toc.xhtml',
        mediaType: 'application/x-dtbncx+xml',
        body: '<h1>NCX Xhtml Chapter</h1><p>Navigation named xhtml.</p>',
      },
      {
        id: 'svg',
        href: 'cover.xhtml',
        mediaType: 'image/svg+xml',
        body: '<h1>SVG Xhtml Chapter</h1><p>An svg named xhtml is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/NCX Xhtml Chapter|SVG Xhtml Chapter/);
  });

  it('a text/html-custom media type with an .xhtml href yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'look',
        href: 'custom.xhtml',
        mediaType: 'text/html-custom',
        body: '<h1>Html Custom Chapter</h1><p>A lookalike type is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/Html Custom Chapter/);
  });

  it('an application/xhtml+xml-x media type with an .xhtml href yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'look',
        href: 'extra.xhtml',
        mediaType: 'application/xhtml+xml-x',
        body: '<h1>Xhtml Extra Chapter</h1><p>A lookalike type is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/Xhtml Extra Chapter/);
  });

  it('a space before a media-type parameter is still a chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'c1',
        href: 'ch1.xhtml',
        mediaType: 'application/xhtml+xml ; charset=utf-8',
        body: '<h1>Spaced Type Chapter</h1><p>Still read.</p>',
      },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Spaced Type Chapter']);
  });

  it('a charset parameter on application/xhtml+xml is still a chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'c1',
        href: 'ch1.xhtml',
        mediaType: 'application/xhtml+xml; charset=utf-8',
        body: '<h1>Charset Chapter</h1><p>Still read.</p>',
      },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Charset Chapter']);
    expect(story.chapters[0].scenes[0].prose).toBe('Still read.');
  });

  it('a mixed-case Application/XHTML+XML media type is still a chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'c1',
        href: 'ch1.xhtml',
        mediaType: 'Application/XHTML+XML',
        body: '<h1>Mixed Case Chapter</h1><p>Still read.</p>',
      },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Mixed Case Chapter']);
    expect(story.chapters[0].scenes[0].prose).toBe('Still read.');
  });

  it('text/html with surrounding whitespace is still a chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'c1',
        href: 'ch1.html',
        mediaType: ' text/html ',
        body: '<h1>Padded Chapter</h1><p>Still read.</p>',
      },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Padded Chapter']);
    expect(story.chapters[0].scenes[0].prose).toBe('Still read.');
  });

  it('a declared non-HTML type with parameters and an .xhtml href yields no chapter', async () => {
    const buf = await makeEpub([
      {
        id: 'svg',
        href: 'cover.xhtml',
        mediaType: 'image/svg+xml; charset=utf-8',
        body: '<h1>SVG Param Chapter</h1><p>An svg is not a chapter.</p>',
      },
      {
        id: 'ncx',
        href: 'toc.xhtml',
        mediaType: ' application/x-dtbncx+xml ',
        body: '<h1>NCX Padded Chapter</h1><p>Navigation is not a chapter.</p>',
      },
      { id: 'c1', href: 'ch1.xhtml', body: '<h1>The Road</h1><p>She walked.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['The Road']);
    expect(JSON.stringify(story)).not.toMatch(/SVG Param Chapter|NCX Padded Chapter/);
  });

  it('a whitespace-only media type uses the extension fallback, and .xml stays out', async () => {
    const buf = await makeEpub([
      {
        id: 'xml',
        href: 'notes.xml',
        mediaType: '   ',
        body: '<h1>Blank Xml Chapter</h1><p>Not a chapter.</p>',
      },
      {
        id: 'xh',
        href: 'blank.xhtml',
        mediaType: ' \t ',
        body: '<h1>Blank Xhtml Chapter</h1><p>Still read.</p>',
      },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Blank Xhtml Chapter']);
    expect(story.chapters[0].scenes[0].prose).toBe('Still read.');
    expect(JSON.stringify(story)).not.toMatch(/Blank Xml Chapter/);
  });

  it('an empty media-type .xhtml item is still a chapter', async () => {
    const buf = await makeEpub([
      { id: 'c1', href: 'ch1.xhtml', mediaType: '', body: '<h1>Untyped Chapter</h1><p>Still read.</p>' },
    ], { title: 'Book' });
    const { story } = await parseEpubStory(buf, 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Untyped Chapter']);
    expect(story.chapters[0].scenes[0].prose).toBe('Still read.');
  });

  it('warns about a missing spine document and still imports the rest', async () => {
    const zipBuf = await makeEpub(THREE_CHAPTERS, { title: 'T' });
    const zip = await JSZip.loadAsync(zipBuf);
    zip.remove('OEBPS/Text/ch2.xhtml');
    const { story, warnings } = await parseEpubStory(Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })), 'x');
    expect(story.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 3']);
    expect(warnings).toEqual(['A chapter file listed in the book is missing: ch2.xhtml']);
  });
});

describe('epubToBlocks — damaged files and zip bombs', () => {
  it('rejects a non-zip and a zip with no package document', async () => {
    await expect(epubToBlocks(Buffer.from('nope'))).rejects.toThrow('This ePub file looks damaged or isn\'t really an ePub.');
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    await expect(epubToBlocks(Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })))).rejects.toThrow(/looks damaged/);
  });

  it('refuses archives with too many entries', async () => {
    expect(EPUB_MAX_ENTRIES).toBe(5000);
    const buf = await makeEpub(THREE_CHAPTERS, { extraFiles: 20 });
    await expect(epubToBlocks(buf, { maxEntries: 10 })).rejects.toThrow(/far more files than a book should/);
  });

  it('a package document full of unclosed tags is read in linear time', async () => {
    const noTitle = (k: number) => makeEpub(THREE_CHAPTERS, { opfTail: '<dc:title>'.repeat(k) });
    const junkTags = (k: number) => makeEpub(THREE_CHAPTERS, { title: 'Book', opfTail: `${'<item'.repeat(k)}${'<itemref'.repeat(k)}` });
    // The pathological sizes are 200k repeats (4 × 50k).
    await expectLinearTime(noTitle, (buf) => parseEpubStory(buf, 'Fallback'), 50_000);
    await expectLinearTime(junkTags, (buf) => parseEpubStory(buf, 'Fallback'), 50_000);
    const a = await parseEpubStory(await noTitle(200_000), 'Fallback');
    expect(a.story.title).toBe('Fallback');
    const b = await parseEpubStory(await junkTags(200_000), 'Fallback');
    expect(b.story.title).toBe('Book');
    expect(b.story.chapters).toHaveLength(3);
  });

  it('stops inflating once the byte budget is spent', async () => {
    expect(EPUB_MAX_INFLATED_BYTES).toBe(200 * 1024 * 1024);
    const big = `<p>${'x'.repeat(50_000)}</p>`;
    const buf = await makeEpub([{ id: 'a', href: 'a.xhtml', body: big }], { title: 'Bomb' });
    await expect(epubToBlocks(buf, { maxInflatedBytes: 10_000 })).rejects.toThrow(/unpacks to far more data/);
    // The same book under the real budget is fine.
    await expect(epubToBlocks(buf)).resolves.toMatchObject({ title: 'Bomb' });
  });
});
