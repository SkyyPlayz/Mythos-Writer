// #1765 — ePub → blocks / story. ePubs are zipped in-test with JSZip.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { EPUB_MAX_ENTRIES, EPUB_MAX_INFLATED_BYTES, epubToBlocks, parseEpubStory } from './epub.js';

interface EpubDoc {
  id: string;
  href: string;
  body: string;
  linear?: boolean;
  nav?: boolean;
}

async function makeEpub(docs: EpubDoc[], opts: { title?: string; opfPath?: string; extraFiles?: number; opfTail?: string } = {}): Promise<Buffer> {
  const opfPath = opts.opfPath ?? 'OEBPS/content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">`
    + `<rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const manifest = docs.map((d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"${d.nav ? ' properties="nav"' : ''}/>`).join('');
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

  it('without dc:title the fallback title is used', async () => {
    const { story } = await parseEpubStory(await makeEpub(THREE_CHAPTERS), 'From File');
    expect(story.title).toBe('From File');
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
    const timed = async (buf: Buffer) => {
      const start = performance.now();
      const result = await parseEpubStory(buf, 'Fallback');
      return { result, ms: performance.now() - start };
    };
    const noTitle = await timed(await makeEpub(THREE_CHAPTERS, { opfTail: '<dc:title>'.repeat(200_000) }));
    expect(noTitle.ms).toBeLessThan(2000);
    expect(noTitle.result.story.title).toBe('Fallback');
    const junkTags = await timed(await makeEpub(THREE_CHAPTERS, { title: 'Book', opfTail: `${'<item'.repeat(200_000)}${'<itemref'.repeat(200_000)}` }));
    expect(junkTags.ms).toBeLessThan(2000);
    expect(junkTags.result.story.title).toBe('Book');
    expect(junkTags.result.story.chapters).toHaveLength(3);
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
