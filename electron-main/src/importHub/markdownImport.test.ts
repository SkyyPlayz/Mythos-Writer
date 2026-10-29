// #1765 — Markdown importers: text → blocks (frontmatter, headings, breaks,
// verbatim prose, image embeds), one .md manuscript, and Markdown folders
// (Obsidian-like vaults, iA Writer-like manuscript folders, chapter folders,
// entities, caps, links). Every folder is built in a temp dir by the test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MARKDOWN_IMPORT_MAX_DEPTH,
  MARKDOWN_IMPORT_MAX_FILE_BYTES,
  MARKDOWN_IMPORT_MAX_FILES,
  markdownFileToPlan,
  markdownFolderToPlan,
  markdownTextToBlocks,
  parseMarkdownFrontmatter,
} from './markdownImport.js';
import type { ImportPlan } from './types.js';
import { inlinesToMarkdown } from './blocks.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-import-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write `rel` (POSIX) under `root`, creating folders. */
function write(root: string, rel: string, content: string | Buffer): string {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function folder(name: string, files: Record<string, string | Buffer>): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

function chapterTitles(plan: ImportPlan): string[] {
  return plan.story?.chapters.map((c) => c.title) ?? [];
}

describe('markdownTextToBlocks', () => {
  it('strips a BOM and frontmatter and normalizes CRLF', () => {
    const md = '\ufeff---\r\ntitle: The Gate\r\ntags: [draft]\r\n---\r\n# One\r\n\r\nHello **bold** and *italic*.\r\nSecond line.\r\n';
    expect(markdownTextToBlocks(md)).toEqual([
      { kind: 'heading', level: 1, inlines: [{ text: 'One' }] },
      { kind: 'markdown', text: 'Hello **bold** and *italic*.\nSecond line.' },
    ]);
  });

  it('reads ATX headings (closing #s stripped, emphasis unwrapped) and setext headings', () => {
    const md = [
      '## Chapter 2: The *Gate* ##',
      '',
      'Book Title',
      '==========',
      '',
      'Part One',
      '--------',
      '',
      '### C#',
    ].join('\n');
    expect(markdownTextToBlocks(md)).toEqual([
      { kind: 'heading', level: 2, inlines: [{ text: 'Chapter 2: The Gate' }] },
      { kind: 'heading', level: 1, inlines: [{ text: 'Book Title' }] },
      { kind: 'heading', level: 2, inlines: [{ text: 'Part One' }] },
      { kind: 'heading', level: 3, inlines: [{ text: 'C#' }] },
    ]);
  });

  it('keeps #### and deeper headings verbatim in the prose, and #tags are not headings', () => {
    expect(markdownTextToBlocks('#### A *small* note\n\n#tag at the start')).toEqual([
      { kind: 'markdown', text: '#### A *small* note' },
      { kind: 'markdown', text: '#tag at the start' },
    ]);
  });

  it('turns scene-break lines and thematic breaks into sceneBreak blocks', () => {
    const breaks = ['***', '---', '___', '* * *', '- - -', '#', '~~~', '⁂', '§', '-'.repeat(60)];
    for (const b of breaks) {
      expect(markdownTextToBlocks(`Before.\n\n${b}\n\nAfter.`), b).toEqual([
        { kind: 'markdown', text: 'Before.' },
        { kind: 'sceneBreak' },
        { kind: 'markdown', text: 'After.' },
      ]);
    }
  });

  it('reads `---` under a sentence as a scene break, under a short title as a setext heading', () => {
    expect(markdownTextToBlocks('He left.\n---\nShe stayed.')).toEqual([
      { kind: 'markdown', text: 'He left.' },
      { kind: 'sceneBreak' },
      { kind: 'markdown', text: 'She stayed.' },
    ]);
    expect(markdownTextToBlocks('The Gate\n---\nShe stayed.')[0]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: 'The Gate' }] });
  });

  it('keeps prose, lists, quotes, wiki links and escapes verbatim — never re-escaped', () => {
    const para = 'She *ran*, **fast**, past [[Mira|the girl]] and \\*stars\\* — <u>under</u> ~~it~~.';
    const list = '- one\n- two\n  - nested';
    const quote = '> A quote\n> continues';
    expect(markdownTextToBlocks(`${para}\n\n${list}\n\n${quote}`)).toEqual([
      { kind: 'markdown', text: para },
      { kind: 'markdown', text: list },
      { kind: 'markdown', text: quote },
    ]);
  });

  it('keeps a code fence whole — blank lines, # lines and *** inside it are code', () => {
    const fence = '```js\nconst a = 1;\n\n# not a heading\n***\n![x](y.png)\n```';
    expect(markdownTextToBlocks(`${fence}\n\nAfter.`)).toEqual([
      { kind: 'markdown', text: fence },
      { kind: 'markdown', text: 'After.' },
    ]);
  });

  it('drops image embeds but keeps note embeds and wiki links', () => {
    const md = [
      'Before ![a map](img/map.png) after.',
      '',
      '![[photo.jpg|300]]',
      '',
      '![[Other note]] and [[Mira]]',
      '',
      '<img src="x.gif">',
    ].join('\n');
    expect(markdownTextToBlocks(md)).toEqual([
      { kind: 'markdown', text: 'Before after.' },
      { kind: 'markdown', text: '![[Other note]] and [[Mira]]' },
    ]);
  });

  it('turns a plain "Chapter One" line into a paragraph the segmenter can read as a marker', () => {
    expect(markdownTextToBlocks('**Chapter One**\n\nChapter 2: The Gate\n\nChapter *three*')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Chapter One', bold: true }] },
      { kind: 'paragraph', inlines: [{ text: 'Chapter 2: The Gate' }] },
      { kind: 'markdown', text: 'Chapter *three*' },
    ]);
  });

  it('leaves a document that opens with a --- break (not YAML) intact', () => {
    expect(markdownTextToBlocks('---\nOnce upon a time, a girl.\n\n---\n\nThe end.')).toEqual([
      { kind: 'sceneBreak' },
      { kind: 'markdown', text: 'Once upon a time, a girl.' },
      { kind: 'sceneBreak' },
      { kind: 'markdown', text: 'The end.' },
    ]);
  });
});

describe('parseMarkdownFrontmatter', () => {
  it('reads scalars, quoted strings, inline lists and block lists', () => {
    const { data, body } = parseMarkdownFrontmatter([
      '---',
      'title: "Mira: the Lost"',
      "alias: 'it''s her'",
      'tags: [hero, "a, b", \'c\']',
      'aliases:',
      '  - Mira',
      '  - The Girl',
      'role: protagonist # a comment',
      'age: 17',
      '---',
      'Body here.',
    ].join('\n'));
    expect(data).toEqual({
      title: 'Mira: the Lost',
      alias: "it's her",
      tags: ['hero', 'a, b', 'c'],
      aliases: ['Mira', 'The Girl'],
      role: 'protagonist',
      age: '17',
    });
    expect(body).toBe('Body here.');
  });

  it('ignores nested maps, block scalars, tags, anchors and prototype keys', () => {
    const { data } = parseMarkdownFrontmatter([
      '---',
      'meta:',
      '  author: x',
      'summary: >',
      '  folded text',
      'fn: !!js/function "function () { return 1 }"',
      'ref: *anchor',
      'map: {a: 1}',
      'nested: [a, [b]]',
      '__proto__: polluted',
      'constructor: x',
      'kept: yes',
      '---',
      '',
    ].join('\n'));
    expect(data).toEqual({ kept: 'yes' });
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns the text whole when there is no closed frontmatter', () => {
    expect(parseMarkdownFrontmatter('---\ntitle: x\nno close')).toEqual({ data: {}, body: '---\ntitle: x\nno close' });
    expect(parseMarkdownFrontmatter('# Title').body).toBe('# Title');
  });
});

describe('markdownFileToPlan', () => {
  it('splits a headed manuscript into chapters and scenes, keeping bold/italics', async () => {
    const md = [
      '# The Long Night',
      '',
      '## Chapter 1',
      '',
      '### Arrival',
      '',
      'Mira **ran** to the *gate*.',
      '',
      '### Night',
      '',
      'The stars came out.',
      '',
      '## Chapter 2',
      '',
      'Morning.',
      '',
      '***',
      '',
      'Noon.',
    ].join('\n');
    const plan = await markdownFileToPlan(write(tmp, 'novel.md', md), 'novel.md');
    expect(plan.source).toEqual({ kind: 'markdown', name: 'novel.md' });
    expect(plan.notes).toEqual([]);
    const story = plan.story!;
    expect(story.title).toBe('The Long Night');
    expect(story.structure).toBe('headings');
    expect(story.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ['Chapter 1', ['Arrival', 'Night']],
      ['Chapter 2', ['Scene 1', 'Scene 2']],
    ]);
    expect(story.chapters[0].scenes[0].prose).toBe('Mira **ran** to the *gate*.');
    expect(story.chapters[1].scenes.map((s) => s.prose)).toEqual(['Morning.', 'Noon.']);
  });

  it('takes the frontmatter title as the story title, reading CRLF + BOM files', async () => {
    const md = '\ufeff---\r\ntitle: Real Title\r\n---\r\n# Not The Title\r\n\r\n## One\r\n\r\nText.\r\n\r\n## Two\r\n\r\nMore.\r\n';
    const plan = await markdownFileToPlan(write(tmp, 'draft-v3.md', md), 'draft-v3.md');
    expect(plan.story!.title).toBe('Real Title');
    expect(plan.story!.chapters.flatMap((c) => c.scenes.map((s) => s.prose)).join('\n')).not.toMatch(/\r|\ufeff|title:/);
  });

  it('falls back to the file name, finds "Chapter One" lines, and warns about dropped images', async () => {
    const md = 'Chapter One\n\nIt began. ![x](a.png)\n\nChapter Two\n\nIt ended.\n\n![[b.png]]';
    const plan = await markdownFileToPlan(write(tmp, 'My Book.md', md), 'My Book.md');
    expect(plan.story!.title).toBe('My Book');
    expect(plan.story!.structure).toBe('patterns');
    expect(chapterTitles(plan)).toEqual(['Chapter One', 'Chapter Two']);
    expect(plan.warnings.some((w) => w.startsWith('2 images in the manuscript'))).toBe(true);
  });
});

describe('markdownFolderToPlan — Obsidian-like vault', () => {
  function vault(): string {
    const root = folder('My Vault', {
      '.obsidian/workspace.json': '{}',
      '.obsidian/notes.md': 'app state, not a note',
      '.trash/old.md': 'deleted',
      'Welcome.md': 'Hi [[Mira]].\n\n![[map.png]]',
      'Research/Swords.md': '---\ntags:\n  - weapons\n  - history\nsource_url: "https://example.com/a"\n---\nNotes about *swords*.',
      'Research/Deep/Ships.md': 'Boats.',
      'Characters/Mira.md': '---\ntitle: Mira Vale\naliases: [Mira, The Girl]\nid: abc\ntype: note\n---\n# Mira\n\nShe runs.',
      'Characters/Old/Bram.md': 'A smith.',
      'World/Veynn.md': '---\ntype: city\n---\nA city.',
      'World/Guild.md': '---\ntype: Guild\n---\nTraders.',
      'World/Blade.md': '---\ntype: artifact\n---\nSharp.',
      'World/Tom.md': '---\ntype: NPC\n---\nInnkeeper.',
      'Lore/Magic Rules.md': 'Rules.',
      'attachments/map.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'attachments/scan.pdf': '%PDF-1.4',
      'scripts/run.sh': '#!/bin/sh\necho hi',
      'scripts/tool.exe': 'MZ',
      'Daily/2024-03-01.md': 'Wrote 500 words.',
      'Daily/2024-03-02.md': 'Wrote 800 words.',
      'Daily/2024-03-03.md': 'Rested.',
    });
    const outside = folder('outside', { 'secret.md': 'not in the vault', 'dir/inner.md': 'not in the vault' });
    fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'Linked'), 'junction');
    if (process.platform !== 'win32') fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
    return root;
  }

  it('imports notes with their folders, entities by type or folder, and no story', async () => {
    const plan = await markdownFolderToPlan(vault(), 'My Vault');
    expect(plan.source).toEqual({ kind: 'markdown-folder', name: 'My Vault' });
    expect(plan.story).toBeNull();
    const byTitle = new Map(plan.notes.map((n) => [n.title, n]));
    expect([...byTitle.keys()].sort()).toEqual([
      '2024-03-01', '2024-03-02', '2024-03-03', 'Blade', 'Bram', 'Guild', 'Magic Rules', 'Mira Vale', 'Ships', 'Swords', 'Tom', 'Veynn', 'Welcome',
    ]);
    // Plain notes keep their POSIX folder and verbatim body.
    expect(byTitle.get('Welcome')).toEqual({ title: 'Welcome', folder: '', body: 'Hi [[Mira]].\n\n![[map.png]]' });
    expect(byTitle.get('Ships')!.folder).toBe('Research/Deep');
    expect(byTitle.get('Swords')).toEqual({
      title: 'Swords',
      folder: 'Research',
      body: 'Notes about *swords*.',
      frontmatter: { tags: ['weapons', 'history'], source_url: 'https://example.com/a' },
    });
    // Entities: folder names, then type aliases (type wins when it is an entity type).
    expect(byTitle.get('Mira Vale')).toEqual({
      title: 'Mira Vale',
      folder: '',
      body: '# Mira\n\nShe runs.',
      entityType: 'character',
      frontmatter: { aliases: ['Mira', 'The Girl'] },
    });
    expect(byTitle.get('Bram')!.entityType).toBe('character');
    expect(byTitle.get('Veynn')!.entityType).toBe('location');
    expect(byTitle.get('Guild')!.entityType).toBe('faction');
    expect(byTitle.get('Blade')!.entityType).toBe('item');
    expect(byTitle.get('Tom')!.entityType).toBe('character');
    expect(byTitle.get('Magic Rules')!.entityType).toBe('concept');
    expect(byTitle.get('2024-03-01')!.entityType).toBeUndefined();
  });

  it('skips .obsidian/.trash, never follows links, and warns about unsafe files and attachments', async () => {
    const plan = await markdownFolderToPlan(vault(), 'My Vault');
    const bodies = plan.notes.map((n) => n.body).join('\n');
    expect(bodies).not.toMatch(/app state|deleted|not in the vault|echo hi/);
    expect(plan.warnings).toContain('Skipped 2 files that aren’t safe to import.');
    expect(plan.warnings.some((w) => w.startsWith('2 attachments'))).toBe(true);
    const links = process.platform === 'win32' ? 1 : 2;
    expect(plan.warnings).toContain(`Skipped ${links} linked files or folders — Mythos doesn’t follow links out of the folder you picked.`);
  });

  it('is deterministic', async () => {
    const root = vault();
    const a = await markdownFolderToPlan(root, 'My Vault');
    const b = await markdownFolderToPlan(root, 'My Vault');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not read numbered PARA-style top folders as chapters', async () => {
    const root = folder('PARA', {
      '00 Inbox/a.md': 'a',
      '01 Projects/b.md': 'b',
      '02 Areas/c.md': 'c',
    });
    const plan = await markdownFolderToPlan(root, 'PARA');
    expect(plan.story).toBeNull();
    expect(plan.notes.map((n) => n.folder)).toEqual(['00 Inbox', '01 Projects', '02 Areas']);
  });
});

describe('markdownFolderToPlan — manuscripts', () => {
  const names = ['01 Opening', '02 The Road', '03 River', '04 Fire', '05 Gate', '06 Siege', '07 Fall', '08 Ash', '09 Dawn', '10 Ending'];

  it('reads an iA Writer-like Manuscript/ folder: one chapter per file in natural order', async () => {
    const files: Record<string, string> = { 'Notes/Ideas.md': 'An idea.' };
    // Written in reverse so the order can't come from creation order.
    for (const n of [...names].reverse()) files[`Manuscript/${n}.md`] = `Text of ${n} with **bold** and *italic*.`;
    files['Manuscript/03 River.md'] = 'Mira **swam**.\n\n## Downstream\n\nThe *current* pulled.\n\n***\n\nShe climbed out.';
    const plan = await markdownFolderToPlan(folder('The Book', files), 'The Book');
    const story = plan.story!;
    expect(story.title).toBe('The Book');
    expect(story.structure).toBe('files');
    expect(chapterTitles(plan)).toEqual(names.map((n) => n.replace(/^\d+ /, '')));
    expect(story.chapters.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(story.chapters[0].scenes).toEqual([{ title: 'Opening', prose: 'Text of 01 Opening with **bold** and *italic*.', order: 0 }]);
    // ## starts a scene and *** breaks one, inside a chapter file.
    expect(story.chapters[2].scenes.map((s) => [s.title, s.prose])).toEqual([
      // The untitled lead scene of a chapter with a break is "Scene 1" (segmentBlocks' rule).
      ['Scene 1', 'Mira **swam**.'],
      ['Downstream', 'The *current* pulled.'],
      ['Scene 3', 'She climbed out.'],
    ]);
    expect(plan.notes.map((n) => [n.title, n.folder])).toEqual([['Ideas', 'Notes']]);
  });

  it('uses a single top heading in a chapter file as the chapter title, frontmatter title first', async () => {
    const plan = await markdownFolderToPlan(folder('B', {
      'Drafts/1 - one.md': '# The Gate\n\nShe knocked.',
      'Drafts/2 - two.md': '---\ntitle: Override\n---\n# Ignored\n\n## A\n\nx\n\n## B\n\ny',
    }), 'B');
    expect(plan.story!.chapters.map((c) => [c.title, c.scenes.map((s) => [s.title, s.prose])])).toEqual([
      ['The Gate', [['The Gate', 'She knocked.']]],
      ['Override', [['A', 'x'], ['B', 'y']]],
    ]);
  });

  it('reads chapter subfolders as chapters and their files as scenes', async () => {
    const plan = await markdownFolderToPlan(folder('Saga', {
      'Chapters/Chapter 10/1 Ten.md': 'ten',
      'Chapters/Chapter 2/2 Later.md': 'later *on*',
      'Chapters/Chapter 2/1 First.md': '# Start\n\nfirst',
      'Chapters/Chapter 2/10 Last.md': 'one\n\n***\n\ntwo',
      'Chapters/Characters/Mira.md': 'A girl.',
    }), 'Saga');
    expect(plan.story!.chapters.map((c) => [c.title, c.scenes.map((s) => [s.title, s.prose])])).toEqual([
      ['Chapter 2', [['Start', 'first'], ['Later', 'later *on*'], ['Last · Scene 1', 'one'], ['Last · Scene 2', 'two']]],
      ['Chapter 10', [['Ten', 'ten']]],
    ]);
    expect(plan.notes).toEqual([{ title: 'Mira', folder: '', body: 'A girl.', entityType: 'character' }]);
  });

  it('folds part folders into chapter titles', async () => {
    const plan = await markdownFolderToPlan(folder('P', {
      'Manuscript/Part One/Chapter 1/a.md': 'a',
      'Manuscript/Part One/Chapter 2/b.md': 'b',
      'Manuscript/Part Two/Chapter 3.md': 'c',
    }), 'P');
    expect(plan.story!.partCount).toBe(2);
    expect(chapterTitles(plan)).toEqual(['Part One · Chapter 1', 'Part One · Chapter 2', 'Part Two · Chapter 3']);
  });

  it('reads a picked folder of numbered files as the manuscript, keeping unnumbered files as notes', async () => {
    const plan = await markdownFolderToPlan(folder('Novel Draft', {
      'Ch01.md': 'one',
      'Ch02.md': 'two',
      'Chapter 3.md': 'three',
      'README.md': 'read me',
    }), 'Novel Draft');
    expect(chapterTitles(plan)).toEqual(['Ch01', 'Ch02', 'Chapter 3']);
    expect(plan.notes.map((n) => n.title)).toEqual(['README']);
  });

  it('does not read daily notes as numbered chapters', async () => {
    const plan = await markdownFolderToPlan(folder('Journal', {
      '2024-01-01.md': 'a',
      '2024-01-02.md': 'b',
      '2024-01-03.md': 'c',
    }), 'Journal');
    expect(plan.story).toBeNull();
    expect(plan.notes).toHaveLength(3);
  });

  it('strips Notion export ids from titles and folders', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    const plan = await markdownFolderToPlan(folder('Export', { [`Ideas ${id}/Page ${id}.md`]: 'x' }), 'Export');
    expect(plan.notes).toEqual([{ title: 'Page', folder: 'Ideas', body: 'x' }]);
  });
});

describe('markdownFolderToPlan — caps', () => {
  it('skips a file over the size cap with a warning', async () => {
    const plan = await markdownFolderToPlan(folder('Big', {
      'small.md': 'ok',
      'huge.md': 'x'.repeat(MARKDOWN_IMPORT_MAX_FILE_BYTES + 1),
    }), 'Big');
    expect(plan.notes.map((n) => n.title)).toEqual(['small']);
    expect(plan.warnings).toContain('Skipped 1 file larger than 5 MB.');
  });

  it('skips folders nested deeper than the depth cap', async () => {
    const segs = Array.from({ length: MARKDOWN_IMPORT_MAX_DEPTH + 1 }, (_, i) => `d${i + 1}`);
    const root = folder('Deep', {
      [`${segs.slice(0, MARKDOWN_IMPORT_MAX_DEPTH).join('/')}/ok.md`]: 'reachable',
      [`${segs.join('/')}/too-deep.md`]: 'too deep',
    });
    const plan = await markdownFolderToPlan(root, 'Deep');
    expect(plan.notes.map((n) => n.title)).toEqual(['ok']);
    expect(plan.warnings).toContain(`Skipped 1 folder nested more than ${MARKDOWN_IMPORT_MAX_DEPTH} levels deep.`);
  });

  it('reads at most the file cap and says so', async () => {
    const root = path.join(tmp, 'Many');
    fs.mkdirSync(root);
    for (let i = 0; i <= MARKDOWN_IMPORT_MAX_FILES; i++) fs.writeFileSync(path.join(root, `n${i}.md`), 'x');
    const plan = await markdownFolderToPlan(root, 'Many');
    expect(plan.notes).toHaveLength(MARKDOWN_IMPORT_MAX_FILES);
    expect(plan.notes[0].title).toBe('n0');
    expect(plan.notes[plan.notes.length - 1].title).toBe(`n${MARKDOWN_IMPORT_MAX_FILES - 1}`);
    expect(plan.warnings.some((w) => w.startsWith('This folder has more than 5,000 Markdown files'))).toBe(true);
  });
});

describe('markdownTextToBlocks — fences and embeds', () => {
  it('reads a decorated tilde line as a scene break, not an unclosed code fence', () => {
    for (const b of ['~~~ * ~~~', '~~~ ❦ ~~~']) {
      expect(markdownTextToBlocks(`She ran.\n\n${b}\n\nShe stopped.\n\n# Chapter 2\n\nMorning.`), b).toEqual([
        { kind: 'markdown', text: 'She ran.' },
        { kind: 'sceneBreak' },
        { kind: 'markdown', text: 'She stopped.' },
        { kind: 'heading', level: 1, inlines: [{ text: 'Chapter 2' }] },
        { kind: 'markdown', text: 'Morning.' },
      ]);
    }
  });

  it('never lets an unclosed fence swallow the rest of the text', () => {
    expect(markdownTextToBlocks('Before.\n\n```js\ncode\n\n# Chapter 2\n\nAfter.')).toEqual([
      { kind: 'markdown', text: 'Before.' },
      // Escaped, so the editor doesn't open the fence either.
      { kind: 'markdown', text: '\\```js\ncode' },
      { kind: 'heading', level: 1, inlines: [{ text: 'Chapter 2' }] },
      { kind: 'markdown', text: 'After.' },
    ]);
    // A tilde line whose info string isn't a language word is prose, not a fence.
    expect(markdownTextToBlocks('~~~ The End ~~~\n\n# Next\n\n~~~')).toEqual([
      { kind: 'markdown', text: '\\~~~ The End ~~~' },
      { kind: 'heading', level: 1, inlines: [{ text: 'Next' }] },
      { kind: 'sceneBreak' },
    ]);
    // A closed tilde fence with a language is still code.
    expect(markdownTextToBlocks('~~~ python\n# x\n~~~')).toEqual([{ kind: 'markdown', text: '~~~ python\n# x\n~~~' }]);
  });

  it('drops images whose URL holds parentheses, and only the space beside the embed', () => {
    expect(markdownTextToBlocks('She saw ![map](map(1).png) here.')).toEqual([{ kind: 'markdown', text: 'She saw here.' }]);
    expect(markdownTextToBlocks('She saw ![map](<my map (1).png> "Map") here.')).toEqual([{ kind: 'markdown', text: 'She saw here.' }]);
    // A trailing two-space hard break survives.
    expect(markdownTextToBlocks('Line one ![i](a.png)  \nline two')).toEqual([{ kind: 'markdown', text: 'Line one  \nline two' }]);
    // List-continuation indentation survives.
    expect(markdownTextToBlocks('- a ![i](x.png)\n    - b  c')).toEqual([{ kind: 'markdown', text: '- a\n    - b  c' }]);
  });
});

describe('markdownFileToPlan — decorated breaks', () => {
  it('keeps every chapter after a `~~~ * ~~~` break', async () => {
    const md = '# Chapter 1\n\nShe ran.\n\n~~~ * ~~~\n\nShe stopped.\n\n# Chapter 2\n\nMorning.\n\n# Chapter 3\n\nNight.';
    const plan = await markdownFileToPlan(write(tmp, 'book.md', md), 'book.md');
    expect(plan.story!.chapters.map((c) => [c.title, c.scenes.map((s) => s.prose)])).toEqual([
      ['Chapter 1', ['She ran.', 'She stopped.']],
      ['Chapter 2', ['Morning.']],
      ['Chapter 3', ['Night.']],
    ]);
  });
});

describe('markdownFolderToPlan — chapter order', () => {
  it('puts a prologue first and an epilogue last', async () => {
    const plan = await markdownFolderToPlan(folder('Book', {
      'Manuscript/Prologue.md': 'p',
      'Manuscript/Chapter 1.md': 'a',
      'Manuscript/Chapter 2.md': 'b',
      'Manuscript/Epilogue.md': 'e',
    }), 'Book');
    expect(chapterTitles(plan)).toEqual(['Prologue', 'Chapter 1', 'Chapter 2', 'Epilogue']);
  });

  it('orders spelled-out chapter numbers by value', async () => {
    const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Twenty-One'];
    const files: Record<string, string> = {};
    for (const w of [...words].reverse()) files[`Chapter ${w}.md`] = w;
    const plan = await markdownFolderToPlan(folder('Words', files), 'Words');
    expect(chapterTitles(plan)).toEqual(words.map((w) => `Chapter ${w}`));
  });

  it('orders Roman-numeral chapters by value', async () => {
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XIV', 'XL'];
    const files: Record<string, string> = {};
    for (const r of romans) files[`Draft/Chapter ${r}.md`] = r;
    const plan = await markdownFolderToPlan(folder('Romans', files), 'Romans');
    expect(chapterTitles(plan)).toEqual(romans.map((r) => `Chapter ${r}`));
  });

  it('orders part folders and the scene files inside a chapter folder by their numbers', async () => {
    const plan = await markdownFolderToPlan(folder('Parts', {
      'Manuscript/Part Three/Chapter 3.md': 'c',
      'Manuscript/Part One/Chapter 1.md': 'a',
      'Manuscript/Part Two/Chapter Two/Scene Three.md': 's3',
      'Manuscript/Part Two/Chapter Two/Scene One.md': 's1',
      'Manuscript/Part Two/Chapter Two/Scene Two.md': 's2',
    }), 'Parts');
    expect(chapterTitles(plan)).toEqual(['Part One · Chapter 1', 'Part Two · Chapter Two', 'Part Three · Chapter 3']);
    expect(plan.story!.chapters[1].scenes.map((s) => s.prose)).toEqual(['s1', 's2', 's3']);
  });
});

describe('markdownFolderToPlan — plain text files', () => {
  it('reads .txt chapters as plain text: indents and one-line paragraphs are not Markdown', async () => {
    const plan = await markdownFolderToPlan(folder('Txt', {
      'Manuscript/01 One.txt': '\tIt was dark.\n\n\tShe ran.',
      'Manuscript/02 Two.txt': 'Line one.\nLine two.\nLine three.',
      'Manuscript/03 Three.txt': 'She paid 2 * 3 coins_ and #won.',
    }), 'Txt');
    expect(plan.story!.chapters.map((c) => c.scenes.map((s) => s.prose))).toEqual([
      ['It was dark.\n\nShe ran.'],
      ['Line one.\n\nLine two.\n\nLine three.'],
      [inlinesToMarkdown([{ text: 'She paid 2 * 3 coins_ and #won.' }])],
    ]);
  });

  it('reads .txt notes as escaped Markdown paragraphs', async () => {
    const plan = await markdownFolderToPlan(folder('TxtNotes', {
      'Notes/todo.txt': '\t# not a heading\n1. not a list\n*not italic*',
    }), 'TxtNotes');
    expect(plan.notes).toEqual([{
      title: 'todo',
      folder: 'Notes',
      body: [
        inlinesToMarkdown([{ text: '# not a heading' }]),
        inlinesToMarkdown([{ text: '1. not a list' }]),
        inlinesToMarkdown([{ text: '*not italic*' }]),
      ].join('\n\n'),
    }]);
  });
});

describe('markdownFolderToPlan — Logseq, TextBundle and entity folders', () => {
  it('reads a Logseq graph as notes: journals are not chapters and logseq/bak is skipped', async () => {
    const plan = await markdownFolderToPlan(folder('Graph', {
      'journals/2024_03_01.md': '- wrote',
      'journals/2024_03_02.md': '- wrote more',
      'journals/2024_03_03.md': '- rested',
      'pages/Mira.md': '- a girl',
      'logseq/bak/pages/Mira/2024-03-01T10_00_00.000Z.Desktop.md': '- old copy',
      'logseq/version-files/base/pages/Mira.md': '- old copy',
      'logseq/config.edn': '{}',
    }), 'Graph');
    expect(plan.story).toBeNull();
    expect(plan.notes.map((n) => [n.title, n.folder])).toEqual([
      ['2024_03_01', 'journals'], ['2024_03_02', 'journals'], ['2024_03_03', 'journals'], ['Mira', 'pages'],
    ]);
  });

  it('does not read other date styles as numbered chapters', async () => {
    for (const names of [['2024.03.01', '2024.03.02', '2024.03.03'], ['03-01-2024', '03-02-2024', '03-03-2024'], ['01.03.2024', '02.03.2024', '03.03.2024']]) {
      const files: Record<string, string> = {};
      for (const n of names) files[`${n}.md`] = n;
      const plan = await markdownFolderToPlan(folder(`J ${names[0]}`, files), 'J');
      expect(plan.story, names[0]).toBeNull();
      expect(plan.notes).toHaveLength(3);
    }
  });

  it('reads a .textbundle folder as one note named after the bundle', async () => {
    const plan = await markdownFolderToPlan(folder('Bear', {
      'Mira.textbundle/text.md': 'A *girl*.',
      'Mira.textbundle/info.json': '{"version":2}',
      'Mira.textbundle/assets/face.png': Buffer.from([0x89, 0x50]),
      'Ships/Ship.textbundle/text.markdown': 'A boat.',
      'Characters/Bram.textbundle/text.md': 'A smith.',
    }), 'Bear');
    expect(plan.notes).toEqual([
      { title: 'Bram', folder: '', body: 'A smith.', entityType: 'character' },
      { title: 'Mira', folder: '', body: 'A *girl*.' },
      { title: 'Ship', folder: 'Ships', body: 'A boat.' },
    ]);
    expect(plan.warnings.some((w) => w.startsWith('1 attachment '))).toBe(true);
  });

  it('infers entities only from the note’s own folder or a top-level one, never generic names', async () => {
    const plan = await markdownFolderToPlan(folder('Research Vault', {
      'Research/History/Rome/Legions.md': 'x',
      'Settings/Editor prefs.md': 'y',
      'World/Characters/Mira.md': 'z',
      'Characters/Main/Bram.md': 'w',
      'Places/North/Veynn.md': 'v',
      'Research/Characters Notes/Ideas.md': 'i',
    }), 'Research Vault');
    const byTitle = new Map(plan.notes.map((n) => [n.title, n]));
    expect(byTitle.get('Legions')).toEqual({ title: 'Legions', folder: 'Research/History/Rome', body: 'x' });
    expect(byTitle.get('Editor prefs')).toEqual({ title: 'Editor prefs', folder: 'Settings', body: 'y' });
    expect(byTitle.get('Mira')!.entityType).toBe('character');
    expect(byTitle.get('Bram')!.entityType).toBe('character');
    expect(byTitle.get('Veynn')!.entityType).toBe('location');
    expect(byTitle.get('Ideas')!.entityType).toBeUndefined();
  });
});
