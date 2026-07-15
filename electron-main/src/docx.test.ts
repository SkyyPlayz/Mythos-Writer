import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildDocx, type DocxInput } from './docx.js';

// A DOCX file is a ZIP — we can inspect its internals.
async function loadDocxZip(buf: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buf);
}

describe('buildDocx', () => {
  it('returns a non-empty Buffer', async () => {
    const buf = await buildDocx({ title: 'Test', chapters: [] });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('produces a valid ZIP (OOXML container)', async () => {
    const buf = await buildDocx({ title: 'Test', chapters: [] });
    const zip = await loadDocxZip(buf);
    // Every valid .docx must contain [Content_Types].xml and word/document.xml
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
  });

  it('empty manuscript: still produces a valid document', async () => {
    const buf = await buildDocx({ title: 'Empty', chapters: [] });
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Empty');
  });

  it('title appears in document.xml', async () => {
    const buf = await buildDocx({ title: 'My Great Novel', chapters: [] });
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('My Great Novel');
  });

  it('author appears in document.xml', async () => {
    const buf = await buildDocx({ title: 'T', author: 'Jane Doe', chapters: [] });
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Jane Doe');
  });

  it('chapter title appears in document.xml', async () => {
    const input: DocxInput = {
      title: 'Novel',
      chapters: [
        { id: 'ch1', title: 'Chapter One', scenes: [] },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Chapter One');
  });

  it('scene title appears in document.xml', async () => {
    const input: DocxInput = {
      title: 'Novel',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter One',
          scenes: [{ id: 'sc1', title: 'The Arrival', prose: '' }],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('The Arrival');
  });

  it('prose text appears in document.xml', async () => {
    const input: DocxInput = {
      title: 'Novel',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch1',
          scenes: [{ id: 'sc1', title: 'Scene', prose: 'It was a dark and stormy night.' }],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('dark and stormy night');
  });

  it('multi-chapter + multi-scene all appear', async () => {
    const input: DocxInput = {
      title: 'Epic Tale',
      author: 'Author Name',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter Alpha',
          scenes: [
            { id: 'sc1', title: 'Scene A1', prose: 'Prose alpha one.' },
            { id: 'sc2', title: 'Scene A2', prose: 'Prose alpha two.' },
          ],
        },
        {
          id: 'ch2',
          title: 'Chapter Beta',
          scenes: [
            { id: 'sc3', title: 'Scene B1', prose: 'Prose beta one.' },
          ],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');

    expect(docXml).toContain('Chapter Alpha');
    expect(docXml).toContain('Chapter Beta');
    expect(docXml).toContain('Scene A1');
    expect(docXml).toContain('Scene B1');
    expect(docXml).toContain('Prose alpha one');
    expect(docXml).toContain('Prose beta one');
  });

  it('large manuscript (50 chapters × 10 scenes each) completes without error', async () => {
    const chapters = Array.from({ length: 50 }, (_, ci) => ({
      id: `ch${ci}`,
      title: `Chapter ${ci + 1}`,
      scenes: Array.from({ length: 10 }, (_, si) => ({
        id: `sc${ci}-${si}`,
        title: `Scene ${si + 1}`,
        prose: `Lorem ipsum dolor sit amet. `.repeat(20),
      })),
    }));
    const buf = await buildDocx({ title: 'Large Novel', chapters });
    expect(buf.length).toBeGreaterThan(10_000);
  });

  it('bold inline formatting preserved in runs', async () => {
    const input: DocxInput = {
      title: 'T',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch',
          scenes: [{ id: 'sc1', title: 'S', prose: 'He was **very** afraid.' }],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    // The word "very" should appear and bold tag w:b should be present
    expect(docXml).toContain('very');
    expect(docXml).toContain('<w:b');
  });

  it('italic inline formatting preserved in runs (_word_)', async () => {
    const input: DocxInput = {
      title: 'T',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch',
          scenes: [{ id: 'sc1', title: 'S', prose: 'She whispered _softly_.' }],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('softly');
    expect(docXml).toContain('<w:i');
  });

  // Regression test for fuzz crash SKY-400: inlineRuns read m[4] for *italic*
  // but the regex puts *italic* content in group 3 and _italic_ in group 4.
  // m[4] was undefined when *italic* matched, causing TextRun to receive
  // text:undefined which crashes the docx library at runtime.
  it('italic inline formatting preserved in runs (*word*)', async () => {
    const input: DocxInput = {
      title: 'T',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch',
          scenes: [{ id: 'sc1', title: 'S', prose: 'He said *quietly* to her.' }],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('quietly');
    expect(docXml).toContain('<w:i');
    // Must not contain the literal string "undefined" as a text run value
    expect(docXml).not.toContain('>undefined<');
  });

  it('mixed bold and both italic forms in same prose block', async () => {
    const input: DocxInput = {
      title: 'T',
      chapters: [
        {
          id: 'ch1',
          title: 'Ch',
          scenes: [
            {
              id: 'sc1',
              title: 'S',
              prose: '**Bold** and *star-italic* and _underscore-italic_ text.',
            },
          ],
        },
      ],
    };
    const buf = await buildDocx(input);
    const zip = await loadDocxZip(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Bold');
    expect(docXml).toContain('star-italic');
    expect(docXml).toContain('underscore-italic');
    expect(docXml).not.toContain('>undefined<');
  });

  // ─── Beta 4 M14 — compile options (synopsis page + scene separators) ───

  const TWO_SCENE_INPUT: DocxInput = {
    title: 'Novel',
    synopsis: 'A city sinks; a smuggler rises.',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter One',
        scenes: [
          { id: 'sc1', title: 'First', prose: 'Alpha.' },
          { id: 'sc2', title: 'Second', prose: 'Beta.' },
        ],
      },
    ],
  };

  it('omits synopsis and separators when options are absent (pre-M14 output)', async () => {
    const buf = await buildDocx(TWO_SCENE_INPUT);
    const docXml = await (await loadDocxZip(buf)).file('word/document.xml')!.async('string');
    expect(docXml).not.toContain('Synopsis');
    expect(docXml).not.toContain('◆ ◆ ◆');
  });

  it('includeSynopsis renders a synopsis page with the story synopsis', async () => {
    const buf = await buildDocx({ ...TWO_SCENE_INPUT, options: { includeSynopsis: true } });
    const docXml = await (await loadDocxZip(buf)).file('word/document.xml')!.async('string');
    expect(docXml).toContain('Synopsis');
    expect(docXml).toContain('A city sinks; a smuggler rises.');
  });

  it('includeSynopsis without synopsis text renders no synopsis page', async () => {
    const buf = await buildDocx({
      ...TWO_SCENE_INPUT,
      synopsis: undefined,
      options: { includeSynopsis: true },
    });
    const docXml = await (await loadDocxZip(buf)).file('word/document.xml')!.async('string');
    expect(docXml).not.toContain('Synopsis');
  });

  it('sceneSeparators inserts ◆ ◆ ◆ between scenes but not before the first', async () => {
    const buf = await buildDocx({ ...TWO_SCENE_INPUT, options: { sceneSeparators: true } });
    const docXml = await (await loadDocxZip(buf)).file('word/document.xml')!.async('string');
    expect(docXml.match(/◆ ◆ ◆/g)).toHaveLength(1);
  });
});
