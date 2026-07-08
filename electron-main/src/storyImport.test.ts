// Beta 3 M24: unit tests for the story import pipeline — heading→structure
// splits (parts/chapters/scenes), format converters, and the Story Plan note.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import {
  htmlToStoryMarkdown,
  mdToStoryMarkdown,
  splitStoryMarkdown,
  epubToStoryMarkdown,
  rtfToText,
  parseScrivxBinder,
  scrivToStoryMarkdown,
  buildStoryPlanNote,
  planNoteFileName,
  decodeHtmlEntities,
} from './storyImport.js';

// ── splitStoryMarkdown ─────────────────────────────────────────────────────────

describe('splitStoryMarkdown', () => {
  it('maps H1/H2/H3 to parts, chapters and scenes when all three are present', () => {
    const md = [
      '# Part One',
      '## The Gate',
      '### Arrival',
      'Mira reached the gate.',
      '### The Toll',
      'The keeper demanded payment.',
      '## The Crossing',
      '### Over the Water',
      'They crossed at dawn.',
      '# Part Two',
      '## The City',
      '### First Light',
      'The city woke slowly.',
    ].join('\n');

    const split = splitStoryMarkdown(md, 'The Last City');
    expect(split.title).toBe('The Last City');
    expect(split.partCount).toBe(2);
    expect(split.chapters.map((c) => c.title)).toEqual([
      'Part One · The Gate',
      'Part One · The Crossing',
      'Part Two · The City',
    ]);
    expect(split.chapters[0].scenes.map((s) => s.title)).toEqual(['Arrival', 'The Toll']);
    expect(split.chapters[0].scenes[0].prose).toContain('Mira reached the gate.');
    expect(split.chapters[2].scenes[0].title).toBe('First Light');
  });

  it('keeps the two-level H1=chapter / H2=scene convention', () => {
    const md = '# Chapter One\n## Scene A\nText A.\n## Scene B\nText B.';
    const split = splitStoryMarkdown(md, 'Fallback');
    expect(split.partCount).toBe(0);
    expect(split.title).toBe('Chapter One');
    expect(split.chapters).toHaveLength(1);
    expect(split.chapters[0].scenes.map((s) => s.title)).toEqual(['Scene A', 'Scene B']);
  });

  it('demotes H2/H3 documents (no H1) to chapters/scenes', () => {
    const md = '## The Gate\n### Arrival\nProse.\n### Departure\nMore prose.';
    const split = splitStoryMarkdown(md, 'Fallback');
    expect(split.chapters).toHaveLength(1);
    expect(split.chapters[0].title).toBe('The Gate');
    expect(split.chapters[0].scenes.map((s) => s.title)).toEqual(['Arrival', 'Departure']);
  });

  it('treats H1/H3 documents as chapters/scenes', () => {
    const md = '# The Gate\n### Arrival\nProse.';
    const split = splitStoryMarkdown(md, 'Fallback');
    expect(split.chapters[0].title).toBe('The Gate');
    expect(split.chapters[0].scenes[0].title).toBe('Arrival');
  });

  it('falls back to a single chapter/scene when there are no headings', () => {
    const split = splitStoryMarkdown('Just prose.\nMore prose.', 'Loose Pages');
    expect(split.chapters).toHaveLength(1);
    expect(split.chapters[0].scenes).toHaveLength(1);
    expect(split.chapters[0].scenes[0].prose).toContain('Just prose.');
  });
});

// ── htmlToStoryMarkdown ────────────────────────────────────────────────────────

describe('htmlToStoryMarkdown', () => {
  it('converts h1–h3 and paragraphs', () => {
    const out = htmlToStoryMarkdown(
      '<h1>Part One</h1><h2>The Gate</h2><h3>Arrival</h3><p>Mira &amp; the keeper.</p>',
    );
    expect(out).toContain('# Part One');
    expect(out).toContain('## The Gate');
    expect(out).toContain('### Arrival');
    expect(out).toContain('Mira & the keeper.');
  });

  it('drops script/style content and comments', () => {
    const out = htmlToStoryMarkdown('<style>h1{color:red}</style><script>x()</script><!-- hi --><p>Kept.</p>');
    expect(out).toBe('Kept.');
  });

  it('decodes numeric entities', () => {
    expect(decodeHtmlEntities('&#8212;&#x2014;')).toBe('——');
  });
});

// ── mdToStoryMarkdown ──────────────────────────────────────────────────────────

describe('mdToStoryMarkdown', () => {
  it('strips YAML frontmatter and normalizes CRLF', () => {
    const raw = '---\r\ntitle: X\r\n---\r\n# Chapter\r\nProse.';
    expect(mdToStoryMarkdown(raw)).toBe('# Chapter\nProse.');
  });

  it('passes plain markdown through', () => {
    expect(mdToStoryMarkdown('# A\nB')).toBe('# A\nB');
  });
});

// ── ePub ──────────────────────────────────────────────────────────────────────

describe('epubToStoryMarkdown', () => {
  async function makeEpub(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml',
      '<?xml version="1.0"?><container><rootfiles>'
      + '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
      + '</rootfiles></container>');
    zip.file('OEBPS/content.opf',
      '<?xml version="1.0"?><package><metadata>'
      + '<dc:title>The Sunken Gate</dc:title></metadata><manifest>'
      + '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="css" href="style.css" media-type="text/css"/>'
      + '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
    zip.file('OEBPS/ch1.xhtml', '<html><body><h1>Chapter One</h1><h2>Scene A</h2><p>First words.</p></body></html>');
    zip.file('OEBPS/ch2.xhtml', '<html><body><h1>Chapter Two</h1><p>Second chapter prose.</p></body></html>');
    zip.file('OEBPS/style.css', 'h1 { color: red }');
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('extracts spine documents in order and reads dc:title', async () => {
    const buffer = await makeEpub();
    const res = await epubToStoryMarkdown(buffer);
    expect(res.title).toBe('The Sunken Gate');
    expect(res.markdown.indexOf('# Chapter One')).toBeGreaterThanOrEqual(0);
    expect(res.markdown.indexOf('# Chapter One')).toBeLessThan(res.markdown.indexOf('# Chapter Two'));
    expect(res.markdown).toContain('## Scene A');
    expect(res.markdown).toContain('First words.');
    // Splits into two chapters downstream
    const split = splitStoryMarkdown(res.markdown, res.title ?? 'Untitled');
    expect(split.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
  });

  it('rejects archives without an OPF', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not an epub');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(epubToStoryMarkdown(buffer)).rejects.toThrow(/OPF/);
  });
});

// ── RTF ───────────────────────────────────────────────────────────────────────

describe('rtfToText', () => {
  it('extracts paragraphs and drops font/color tables', () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}{\colortbl;\red0\green0\blue0;}\f0\fs24 Hello world.\par Second paragraph.\par}`;
    const text = rtfToText(rtf);
    expect(text).toContain('Hello world.');
    expect(text).toContain('Second paragraph.');
    expect(text).not.toContain('Helvetica');
  });

  it('decodes hex and unicode escapes', () => {
    expect(rtfToText("{\\rtf1 caf\\'e9 \\u8212?dash}")).toBe('café —dash');
  });

  it('skips starred destination groups', () => {
    expect(rtfToText(String.raw`{\rtf1{\*\expandedcolortbl hidden}Visible}`)).toBe('Visible');
  });
});

// ── Scrivener ─────────────────────────────────────────────────────────────────

describe('parseScrivxBinder', () => {
  const SCRIVX = `<?xml version="1.0"?>
<ScrivenerProject>
  <Binder>
    <BinderItem UUID="AAA" Type="DraftFolder" Created="x">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="CH1" Type="Folder"><Title>The Gate &amp; Toll</Title>
          <Children>
            <BinderItem UUID="SC1" Type="Text"><Title>Arrival</Title></BinderItem>
            <BinderItem UUID="SC2" Type="Text"><Title>The Toll</Title></BinderItem>
          </Children>
        </BinderItem>
        <BinderItem UUID="SC3" Type="Text"><Title>Interlude</Title></BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="BBB" Type="ResearchFolder"><Title>Research</Title></BinderItem>
  </Binder>
</ScrivenerProject>`;

  it('builds the nested binder tree with decoded titles', () => {
    const roots = parseScrivxBinder(SCRIVX);
    expect(roots).toHaveLength(2);
    const draft = roots[0];
    expect(draft.type).toBe('DraftFolder');
    expect(draft.children).toHaveLength(2);
    expect(draft.children[0].title).toBe('The Gate & Toll');
    expect(draft.children[0].children.map((c) => c.title)).toEqual(['Arrival', 'The Toll']);
    expect(draft.children[1].type).toBe('Text');
  });
});

describe('scrivToStoryMarkdown', () => {
  it('converts a Scrivener 3 project into chapter/scene markdown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm24-scriv-'));
    try {
      const proj = path.join(dir, 'My Novel.scriv');
      fs.mkdirSync(proj, { recursive: true });
      fs.writeFileSync(path.join(proj, 'My Novel.scrivx'), `<?xml version="1.0"?>
<ScrivenerProject><Binder>
  <BinderItem UUID="D" Type="DraftFolder"><Title>Draft</Title><Children>
    <BinderItem UUID="CH1" Type="Folder"><Title>Chapter One</Title><Children>
      <BinderItem UUID="SC1" Type="Text"><Title>Arrival</Title></BinderItem>
    </Children></BinderItem>
  </Children></BinderItem>
</Binder></ScrivenerProject>`);
      fs.mkdirSync(path.join(proj, 'Files', 'Data', 'SC1'), { recursive: true });
      fs.writeFileSync(
        path.join(proj, 'Files', 'Data', 'SC1', 'content.rtf'),
        String.raw`{\rtf1\ansi Mira reached the gate.\par}`,
      );

      const res = scrivToStoryMarkdown(path.join(proj, 'My Novel.scrivx'));
      expect(res.title).toBe('My Novel');
      expect(res.markdown).toContain('# Chapter One');
      expect(res.markdown).toContain('## Arrival');
      expect(res.markdown).toContain('Mira reached the gate.');

      const split = splitStoryMarkdown(res.markdown, res.title);
      expect(split.chapters[0].title).toBe('Chapter One');
      expect(split.chapters[0].scenes[0].title).toBe('Arrival');
      expect(split.chapters[0].scenes[0].prose).toContain('Mira reached the gate.');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Story Plan note ────────────────────────────────────────────────────────────

describe('buildStoryPlanNote / planNoteFileName', () => {
  it('writes frontmatter + a structure outline with scene checkboxes', () => {
    const note = buildStoryPlanNote({
      id: 'test-id',
      title: 'The Last City',
      format: 'docx',
      sourceFile: '/tmp/The Last City.docx',
      importedAt: '2026-07-07T00:00:00.000Z',
      partCount: 2,
      chapters: [
        { title: 'Part One · The Gate', order: 0, scenes: [
          { title: 'Arrival', prose: 'one two three', order: 0 },
          { title: 'The Toll', prose: '', order: 1 },
        ] },
      ],
    });
    expect(note).toContain('id: test-id');
    expect(note).toContain('title: "Plan — The Last City"');
    expect(note).toContain('type: story-plan');
    expect(note).toContain('# Plan — The Last City');
    expect(note).toContain('- **Part One · The Gate** (2 scenes)');
    expect(note).toContain('- [ ] Arrival — 3 words');
    expect(note).toContain('- [ ] The Toll');
  });

  it('sanitizes unsafe filename characters', () => {
    expect(planNoteFileName('A/B: "C"?')).toBe('Plan — A B C.md');
    expect(planNoteFileName('///')).toBe('Plan — Imported Story.md');
  });
});
