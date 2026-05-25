import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildEpub, type EpubInput } from './epub.js';

async function loadZip(buf: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buf);
}

describe('buildEpub', () => {
  it('returns a Buffer', async () => {
    const input: EpubInput = { title: 'Test', chapters: [] };
    const buf = await buildEpub(input);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('empty manuscript: ZIP contains required EPUB files', async () => {
    const buf = await buildEpub({ title: 'Empty Book', chapters: [] });
    const zip = await loadZip(buf);
    expect(zip.file('mimetype')).not.toBeNull();
    expect(zip.file('META-INF/container.xml')).not.toBeNull();
    expect(zip.file('OEBPS/content.opf')).not.toBeNull();
    expect(zip.file('OEBPS/nav.xhtml')).not.toBeNull();
    expect(zip.file('OEBPS/style.css')).not.toBeNull();
  });

  it('empty manuscript: placeholder scene present', async () => {
    const buf = await buildEpub({ title: 'Empty', chapters: [] });
    const zip = await loadZip(buf);
    expect(zip.file('OEBPS/scene-0.xhtml')).not.toBeNull();
  });

  it('mimetype entry contains correct value', async () => {
    const buf = await buildEpub({ title: 'T', chapters: [] });
    const zip = await loadZip(buf);
    const content = await zip.file('mimetype')!.async('string');
    expect(content).toBe('application/epub+zip');
  });

  it('multi-chapter: scene files and spine entries exist', async () => {
    const input: EpubInput = {
      title: 'My Novel',
      author: 'Jane Author',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter One',
          scenes: [
            { id: 'sc1', title: 'Scene 1', prose: 'It was a dark night.' },
            { id: 'sc2', title: 'Scene 2', prose: 'The morning came.' },
          ],
        },
        {
          id: 'ch2',
          title: 'Chapter Two',
          scenes: [
            { id: 'sc3', title: 'Scene 3', prose: 'A new adventure began.' },
          ],
        },
      ],
    };
    const buf = await buildEpub(input);
    const zip = await loadZip(buf);

    expect(zip.file('OEBPS/scene-0.xhtml')).not.toBeNull();
    expect(zip.file('OEBPS/scene-1.xhtml')).not.toBeNull();
    expect(zip.file('OEBPS/scene-2.xhtml')).not.toBeNull();

    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('My Novel');
    expect(opf).toContain('Jane Author');
    expect(opf).toContain('scene-0');
    expect(opf).toContain('scene-2');
  });

  it('multi-chapter: prose appears in scene XHTML', async () => {
    const input: EpubInput = {
      title: 'Novel',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch 1',
          scenes: [{ id: 'sc1', title: 'The Beginning', prose: 'Once upon a time.' }],
        },
      ],
    };
    const buf = await buildEpub(input);
    const zip = await loadZip(buf);
    const html = await zip.file('OEBPS/scene-0.xhtml')!.async('string');
    expect(html).toContain('Once upon a time.');
    expect(html).toContain('The Beginning');
    expect(html).toContain('Ch 1');
  });

  it('nav.xhtml contains chapter and scene titles', async () => {
    const input: EpubInput = {
      title: 'T',
      chapters: [
        {
          id: 'ch1',
          title: 'Alpha Chapter',
          scenes: [{ id: 'sc1', title: 'First Scene', prose: '' }],
        },
      ],
    };
    const buf = await buildEpub(input);
    const zip = await loadZip(buf);
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('Alpha Chapter');
    expect(nav).toContain('First Scene');
  });

  it('container.xml points to OEBPS/content.opf', async () => {
    const buf = await buildEpub({ title: 'T', chapters: [] });
    const zip = await loadZip(buf);
    const container = await zip.file('META-INF/container.xml')!.async('string');
    expect(container).toContain('OEBPS/content.opf');
  });

  it('metadata block includes language', async () => {
    const buf = await buildEpub({ title: 'T', language: 'fr', chapters: [] });
    const zip = await loadZip(buf);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:language>fr</dc:language>');
  });
});
