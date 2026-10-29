// SKY-2971: Unit tests for the .docx → Story Vault importer.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { splitDocxMarkdown, htmlToSplittableMarkdown, parseDocxBuffer, DOCX_MAX_BYTES } from './docxImporter.js';
import {
  HEADED_MANUSCRIPT_OUTLINE,
  buildHeadedManuscriptDocx,
  buildPatternManuscriptDocx,
} from './importHub/testFixtures/manuscriptDocx.js';

const MAMMOTH_FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/mammoth/test/test-data',
);

// ── htmlToSplittableMarkdown ───────────────────────────────────────────────────

describe('htmlToSplittableMarkdown', () => {
  it('converts h1 to # heading lines', () => {
    const out = htmlToSplittableMarkdown('<h1>Chapter One</h1><p>Prose.</p>');
    expect(out).toContain('# Chapter One');
    expect(out).toContain('Prose.');
  });

  it('converts h2 to ## heading lines', () => {
    const out = htmlToSplittableMarkdown('<h2>Scene A</h2><p>Text here.</p>');
    expect(out).toContain('## Scene A');
  });

  it('strips inner HTML from heading tags', () => {
    const out = htmlToSplittableMarkdown('<h1><strong>Bold Title</strong></h1>');
    expect(out).toContain('# Bold Title');
    expect(out).not.toContain('<strong>');
  });
});

// ── splitDocxMarkdown ──────────────────────────────────────────────────────────

describe('splitDocxMarkdown', () => {
  it('returns a single scene for a document with no headings', () => {
    const md = 'Once upon a time.\n\nThe end.';
    const { title, chapters } = splitDocxMarkdown(md, 'My Story');
    expect(title).toBe('My Story');
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('My Story');
    expect(chapters[0].scenes).toHaveLength(1);
    expect(chapters[0].scenes[0].prose).toContain('Once upon a time');
  });

  it('uses the first H1 as docTitle', () => {
    const md = '# The Great Adventure\n\nSome prose.';
    const { title, chapters } = splitDocxMarkdown(md);
    expect(title).toBe('The Great Adventure');
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('The Great Adventure');
  });

  it('splits on H1 (chapters) and H2 (scenes)', () => {
    const md = [
      '# Chapter One',
      '',
      '## The Morning',
      '',
      'The sun rose.',
      '',
      '## The Evening',
      '',
      'Stars appeared.',
      '',
      '# Chapter Two',
      '',
      '## A New Dawn',
      '',
      'A fresh start.',
    ].join('\n');

    const { title, chapters } = splitDocxMarkdown(md);
    expect(title).toBe('Chapter One');
    expect(chapters).toHaveLength(2);

    expect(chapters[0].title).toBe('Chapter One');
    expect(chapters[0].scenes).toHaveLength(2);
    expect(chapters[0].scenes[0].title).toBe('The Morning');
    expect(chapters[0].scenes[0].prose).toContain('sun rose');
    expect(chapters[0].scenes[1].title).toBe('The Evening');

    expect(chapters[1].title).toBe('Chapter Two');
    expect(chapters[1].scenes).toHaveLength(1);
    expect(chapters[1].scenes[0].title).toBe('A New Dawn');
  });

  it('prose before first H2 (but after H1) becomes an implicit scene', () => {
    const md = '# Chapter One\n\nPreface prose.\n\n## Scene Title\n\nScene prose.';
    const { chapters } = splitDocxMarkdown(md);
    expect(chapters).toHaveLength(1);
    // preface becomes an unnamed scene before the named scene
    expect(chapters[0].scenes.length).toBeGreaterThanOrEqual(2);
    const preface = chapters[0].scenes[0];
    expect(preface.prose).toContain('Preface prose');
    const named = chapters[0].scenes.find((s) => s.title === 'Scene Title');
    expect(named).toBeDefined();
  });

  it('H2 before any H1 creates an implicit chapter', () => {
    const md = '## Scene One\n\nProse here.';
    const { chapters } = splitDocxMarkdown(md, 'Fallback');
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('Fallback');
    expect(chapters[0].scenes).toHaveLength(1);
    expect(chapters[0].scenes[0].title).toBe('Scene One');
    expect(chapters[0].scenes[0].prose).toContain('Prose here');
  });

  it('assigns correct order values to chapters and scenes', () => {
    const md = [
      '# A',
      '## A1',
      'prose a1',
      '## A2',
      'prose a2',
      '# B',
      '## B1',
      'prose b1',
    ].join('\n');
    const { chapters } = splitDocxMarkdown(md);
    expect(chapters[0].order).toBe(0);
    expect(chapters[1].order).toBe(1);
    expect(chapters[0].scenes[0].order).toBe(0);
    expect(chapters[0].scenes[1].order).toBe(1);
  });

  it('drops empty chapters (H1 with no content)', () => {
    const md = '# Empty Chapter\n# Real Chapter\n## Scene\n\nContent.';
    const { chapters } = splitDocxMarkdown(md);
    // 'Empty Chapter' has no scenes/prose → dropped
    const titles = chapters.map((c) => c.title);
    expect(titles).not.toContain('Empty Chapter');
    expect(titles).toContain('Real Chapter');
  });

  it('uses fallbackTitle when no H1 exists and H2 appears first', () => {
    const { title } = splitDocxMarkdown('## Opening\n\nHello.', 'Custom Fallback');
    expect(title).toBe('Custom Fallback');
  });

  it('returns empty prose scene for empty document', () => {
    const { title, chapters } = splitDocxMarkdown('', 'Empty Doc');
    expect(title).toBe('Empty Doc');
    expect(chapters[0].scenes[0].prose).toBe('');
  });
});

// ── parseDocxBuffer ────────────────────────────────────────────────────────────

describe('parseDocxBuffer', () => {
  it('rejects buffers larger than DOCX_MAX_BYTES', async () => {
    const huge = Buffer.alloc(DOCX_MAX_BYTES + 1);
    await expect(parseDocxBuffer(huge)).rejects.toThrow(/50 MB/);
  });

  it('rejects a non-.docx buffer (corrupt file)', async () => {
    const junk = Buffer.from('this is not a docx file at all');
    await expect(parseDocxBuffer(junk)).rejects.toThrow(/Failed to parse .docx/);
  });

  it('parses the mammoth empty.docx fixture without throwing', async () => {
    const buf = fs.readFileSync(path.join(MAMMOTH_FIXTURES, 'empty.docx'));
    const result = await parseDocxBuffer(buf, 'Empty');
    expect(result.title).toBe('Empty');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].scenes).toHaveLength(1);
  });

  it('parses the mammoth single-paragraph.docx fixture and returns prose', async () => {
    const buf = fs.readFileSync(path.join(MAMMOTH_FIXTURES, 'single-paragraph.docx'));
    const result = await parseDocxBuffer(buf, 'Test Doc');
    // Content exists in at least one scene
    const allProse = result.chapters.flatMap((ch) => ch.scenes.map((s) => s.prose)).join(' ');
    expect(allProse.length).toBeGreaterThan(0);
  });

  it('returns warnings array (may be empty for clean docs)', async () => {
    const buf = fs.readFileSync(path.join(MAMMOTH_FIXTURES, 'single-paragraph.docx'));
    const result = await parseDocxBuffer(buf, 'Test');
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ── parseDocxBuffer → import hub pipeline (#1765) ──────────────────────────────
// parseDocxBuffer used to flatten mammoth HTML with regexes: every mark was
// stripped, a whole chapter became one line, page breaks glued words and
// files without heading styles became one chapter. It now delegates to
// importHub/docx.ts — same exported shape, real fidelity.

describe('parseDocxBuffer — import hub fidelity (#1765)', () => {
  it('returns the same {title, chapters, warnings} shape', async () => {
    const result = await parseDocxBuffer(await buildHeadedManuscriptDocx(), 'manuscript');
    expect(Object.keys(result).sort()).toEqual(['chapters', 'title', 'warnings']);
    for (const ch of result.chapters) {
      expect(Object.keys(ch).sort()).toEqual(['order', 'scenes', 'title']);
      for (const sc of ch.scenes) expect(Object.keys(sc).sort()).toEqual(['order', 'prose', 'title']);
    }
    expect(result.title).toBe(HEADED_MANUSCRIPT_OUTLINE.title);
    expect(result.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => s.title) })))
      .toEqual(HEADED_MANUSCRIPT_OUTLINE.chapters);
    expect(result.chapters.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it('keeps bold / italic / underline / strike and separates paragraphs with a blank line', async () => {
    const { chapters } = await parseDocxBuffer(await buildHeadedManuscriptDocx(), 'manuscript');
    expect(chapters[0].scenes[0].prose).toBe(
      'Mara reached the **iron gate** at dusk, and the *lanterns* were already lit.\n\n'
      + 'She had <u>never</u> seen it ~~closed~~ before.',
    );
  });

  it('never glues words across an in-run page break', async () => {
    const { chapters } = await parseDocxBuffer(await buildHeadedManuscriptDocx(), 'manuscript');
    const prose = chapters.flatMap((c) => c.scenes.map((s) => s.prose)).join('\n');
    expect(prose).toContain('The fire burned low');
    expect(prose).toContain('and morning came.');
    expect(prose).not.toContain('lowand');
  });

  it('finds chapters in a manuscript with no heading styles', async () => {
    const { chapters } = await parseDocxBuffer(await buildPatternManuscriptDocx(), 'Pattern');
    expect(chapters.map((c) => c.title)).toEqual([
      'Prologue', 'PART ONE · CHAPTER ONE', 'PART ONE · Chapter 2: The Gate', 'Part Two · Chapter 3: The Inn',
    ]);
  });
});
