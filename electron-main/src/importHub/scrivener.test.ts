// #1765 — Scrivener 2 / 3 projects → ImportPlan. Projects are built in a
// temp dir per test: a .scrivx binder plus RTF / synopsis files.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseScrivenerBinder, scrivenerToPlan, SCRIVENER_MAX_BINDER_ITEMS } from './scrivener.js';
import { scrivToStoryMarkdown } from '../storyImport.js';
import { ImportUserError } from './rtf.js';
import type { ImportPlan } from './types.js';

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

interface Node {
  id: string;
  type: string;
  title: string;
  compile?: boolean;
  children?: Node[];
}
interface Doc {
  content?: string;
  synopsis?: string;
  notes?: string;
}

const rtf = (body: string) => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times;}}{\\colortbl;\\red0\\green0\\blue0;}\n\\pard ${body}}`;

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function binderXml(nodes: Node[], version: 2 | 3): string {
  const idAttr = version === 3 ? 'UUID' : 'ID';
  const item = (n: Node): string => [
    `<BinderItem ${idAttr}="${xmlEscape(n.id)}" Type="${n.type}" Created="2024-01-01 10:00:00 +0000">`,
    `<Title>${xmlEscape(n.title)}</Title>`,
    `<MetaData><IncludeInCompile>${n.compile === false ? 'No' : 'Yes'}</IncludeInCompile></MetaData>`,
    n.children?.length ? `<Children>${n.children.map(item).join('\n')}</Children>` : '',
    '</BinderItem>',
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ScrivenerProject Version="${version === 3 ? '2.0' : '1.0'}">\n`
    + `<Binder>\n${nodes.map(item).join('\n')}\n</Binder>\n`
    // Collections reference binder items too — never parsed as the binder.
    + '<Collections><Collection Type="Binder"><Title>Binder</Title></Collection></Collections>\n</ScrivenerProject>\n';
}

function writeProject(dir: string, name: string, nodes: Node[], docs: Record<string, Doc>, version: 2 | 3 = 3): string {
  const proj = path.join(dir, `${name}.scriv`);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${name}.scrivx`), binderXml(nodes, version));
  for (const [id, d] of Object.entries(docs)) {
    if (version === 3) {
      const docDir = path.join(proj, 'Files', 'Data', id);
      fs.mkdirSync(docDir, { recursive: true });
      if (d.content !== undefined) fs.writeFileSync(path.join(docDir, 'content.rtf'), d.content, 'latin1');
      if (d.synopsis !== undefined) fs.writeFileSync(path.join(docDir, 'synopsis.txt'), d.synopsis);
      if (d.notes !== undefined) fs.writeFileSync(path.join(docDir, 'notes.rtf'), d.notes, 'latin1');
    } else {
      const docsDir = path.join(proj, 'Files', 'Docs');
      fs.mkdirSync(docsDir, { recursive: true });
      if (d.content !== undefined) fs.writeFileSync(path.join(docsDir, `${id}.rtf`), d.content, 'latin1');
      if (d.synopsis !== undefined) fs.writeFileSync(path.join(docsDir, `${id}_synopsis.txt`), d.synopsis);
      if (d.notes !== undefined) fs.writeFileSync(path.join(docsDir, `${id}_notes.rtf`), d.notes, 'latin1');
    }
  }
  return proj;
}

const shape = (plan: ImportPlan) => plan.story?.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)]);

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-scriv-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const U = (n: number) => `0000000${n}-AAAA-BBBB-CCCC-DDDDDDDDDDDD`;

/** A Scrivener 3 novel: Draft → chapter folders → scenes, plus research and entities. */
function novel(): string {
  const nodes: Node[] = [
    { id: U(1), type: 'DraftFolder', title: 'Draft', children: [
      { id: U(10), type: 'Folder', title: 'Chapter 1', children: [
        { id: U(11), type: 'Text', title: 'Arrival' },
        { id: U(12), type: 'Text', title: 'The Inn' },
      ] },
      { id: U(20), type: 'Folder', title: 'Chapter 2', children: [
        { id: U(21), type: 'Text', title: 'Night', compile: false },
        { id: U(22), type: 'Folder', title: 'Flashback', children: [
          { id: U(23), type: 'Text', title: 'Years Ago' },
        ] },
        { id: U(24), type: 'Text', title: 'Missing' },
        { id: '../../../outside', type: 'Text', title: 'Sneaky' },
      ] },
    ] },
    { id: U(2), type: 'ResearchFolder', title: 'Research', children: [
      { id: U(30), type: 'Folder', title: 'Places', children: [{ id: U(31), type: 'Text', title: 'Harbor Town' }] },
      { id: U(32), type: 'Folder', title: 'World', children: [
        { id: U(33), type: 'Folder', title: 'Magic', children: [{ id: U(34), type: 'Text', title: 'Rules of Fire' }] },
      ] },
      { id: U(35), type: 'PDF', title: 'Map scan' },
      { id: U(36), type: 'Image', title: 'Portrait' },
      { id: U(37), type: 'WebArchive', title: 'Article' },
    ] },
    { id: U(3), type: 'Folder', title: 'Characters', children: [{ id: U(40), type: 'Text', title: 'Mara Vell' }] },
    { id: U(4), type: 'Folder', title: 'Front Matter', children: [{ id: U(41), type: 'Text', title: 'Title Page' }] },
    { id: U(5), type: 'TrashFolder', title: 'Trash', children: [{ id: U(42), type: 'Text', title: 'Deleted Scene' }] },
  ];
  const docs: Record<string, Doc> = {
    [U(11)]: { content: rtf('She came {\\b by boat} and {\\i alone}.\\par {\\ul Underlined} and {\\strike struck}.\\par\\pard\\qc The End?\\par'), synopsis: 'Mara arrives\nat the harbor.' },
    [U(12)]: { content: rtf('\\\'93Room?\\\'94 she asked. It\\u8217?s late.\\par\\pard\\qc #\\par\\pard Morning.\\par'), notes: rtf('Check the {\\b timeline}.\\par') },
    [U(21)]: { content: rtf('Dark.\\par\\page\\par Darker.\\par') },
    [U(23)]: { content: rtf('Long ago.\\par') },
    [U(31)]: { content: rtf('A {\\i windy} port.\\par'), synopsis: 'Where it starts.' },
    [U(34)]: { content: rtf('Fire needs a name.\\par') },
    [U(40)]: { content: rtf('Tall, quiet.\\par'), synopsis: 'The heroine.', notes: rtf('Born in winter.\\par') },
    [U(41)]: { content: rtf('TITLE PAGE\\par') },
    [U(42)]: { content: rtf('Should never appear.\\par') },
  };
  const proj = writeProject(tmp, 'Harbor Lights', nodes, docs);
  // A file the traversal ID would reach if it were used as a path.
  fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'outside', 'content.rtf'), rtf('SECRET\\par'));
  return proj;
}

describe('scrivenerToPlan — Scrivener 3 novel', () => {
  it('Draft folders → chapters, texts and nested folders → scenes in binder order', async () => {
    const plan = await scrivenerToPlan(novel(), 'Harbor Lights.scriv');
    expect(plan.source).toEqual({ kind: 'scrivener', name: 'Harbor Lights.scriv' });
    expect(plan.story?.title).toBe('Harbor Lights');
    expect(plan.story?.structure).toBe('binder');
    expect(plan.story?.partCount).toBe(0);
    expect(shape(plan)).toEqual([
      ['Chapter 1', ['Arrival', 'The Inn', 'The Inn (2)']],
      ['Chapter 2', ['Night', 'Years Ago', 'Missing', 'Sneaky']],
    ]);
    expect(plan.story?.chapters.map((c) => c.order)).toEqual([0, 1]);
    expect(plan.story?.chapters[1].scenes.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('keeps bold / italic / underline / strike / centering (the old importer kept plain text only)', async () => {
    const proj = novel();
    const old = scrivToStoryMarkdown(proj).markdown;
    expect(old).toContain('She came by boat and alone.');
    expect(old).not.toContain('**');
    const plan = await scrivenerToPlan(proj, 'Harbor Lights.scriv');
    expect(plan.story?.chapters[0].scenes[0].prose).toBe('She came **by boat** and *alone*.\n\n<u>Underlined</u> and ~~struck~~.\n\nThe End? {.center}');
  });

  it('decodes cp1252 smart quotes and \\u escapes; a "#" paragraph splits the document into scenes', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    const [inn, inn2] = plan.story!.chapters[0].scenes.slice(1);
    expect(inn.prose).toBe('“Room?” she asked. It’s late.');
    expect(inn2.prose).toBe('Morning.');
  });

  it('page breaks inside a scene document do not leave stray text', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    expect(plan.story?.chapters[1].scenes[0].prose).toBe('Dark.\n\nDarker.');
  });

  it('carries the synopsis on one line and turns notes.rtf into a "Scene notes" note', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    expect(plan.story?.chapters[0].scenes[0].synopsis).toBe('Mara arrives at the harbor.');
    expect(plan.notes).toContainEqual({ title: 'The Inn — notes', folder: 'Scene notes', body: 'Check the **timeline**.' });
  });

  it('Characters / Places folders → entities with the synopsis first; other research → notes under its binder path', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    expect(plan.notes.filter((n) => n.entityType)).toEqual([
      { title: 'Harbor Town', folder: '', body: 'Where it starts.\n\nA *windy* port.', entityType: 'location' },
      { title: 'Mara Vell', folder: '', body: 'The heroine.\n\nTall, quiet.\n\n## Notes\n\nBorn in winter.', entityType: 'character' },
    ]);
    expect(plan.notes).toContainEqual({ title: 'Rules of Fire', folder: 'Research/World/Magic', body: 'Fire needs a name.' });
  });

  it('skips Trash and Front Matter, and counts PDFs / images / web pages', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    const everything = JSON.stringify(plan);
    expect(everything).not.toContain('Should never appear');
    expect(everything).not.toContain('Deleted Scene');
    expect(everything).not.toContain('TITLE PAGE');
    expect(plan.warnings).toContain('3 research files (PDFs/images/web pages) were not imported.');
  });

  it('a missing content.rtf is an empty scene with a warning; not-compiled documents are imported with a warning', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    const missing = plan.story!.chapters[1].scenes.find((s) => s.title === 'Missing');
    expect(missing?.prose).toBe('');
    expect(plan.warnings).toContain('1 document had no text in the project and was imported empty.');
    expect(plan.story!.chapters[1].scenes.find((s) => s.title === 'Night')?.prose).toBe('Dark.\n\nDarker.');
    expect(plan.warnings).toContain('1 document is set not to compile in Scrivener — imported anyway.');
  });

  it('never reads outside the project: a traversal ID is ignored', async () => {
    const plan = await scrivenerToPlan(novel(), 'x');
    expect(JSON.stringify(plan)).not.toContain('SECRET');
    expect(plan.story!.chapters[1].scenes.find((s) => s.title === 'Sneaky')?.prose).toBe('');
    expect(plan.warnings).toContain('1 binder item has an unreadable ID and was imported empty.');
  });

  it('never follows a link out of the project folder', async () => {
    const proj = writeProject(tmp, 'Linked', [
      { id: 'DRAFT', type: 'DraftFolder', title: 'Draft', children: [{ id: 'LINKED', type: 'Text', title: 'Linked' }] },
    ], {});
    const outside = path.join(tmp, 'elsewhere');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'content.rtf'), rtf('SECRET\\par'));
    fs.mkdirSync(path.join(proj, 'Files', 'Data'), { recursive: true });
    // 'junction' lets Windows create a directory link without admin rights; ignored elsewhere.
    fs.symlinkSync(outside, path.join(proj, 'Files', 'Data', 'LINKED'), 'junction');
    const plan = await scrivenerToPlan(proj, 'Linked.scriv');
    expect(JSON.stringify(plan)).not.toContain('SECRET');
    expect(plan.story?.chapters[0].scenes[0].prose).toBe('');
  });

  it('accepts the .scrivx file as the input path and is deterministic', async () => {
    const proj = novel();
    const viaFolder = await scrivenerToPlan(proj, 'Harbor Lights.scriv');
    const viaFile = await scrivenerToPlan(path.join(proj, 'Harbor Lights.scrivx'), 'Harbor Lights.scriv');
    expect(viaFile).toEqual(viaFolder);
    expect(await scrivenerToPlan(proj, 'Harbor Lights.scriv')).toEqual(viaFolder);
  });
});

describe('scrivenerToPlan — binder shapes', () => {
  it('Draft → Part → Chapter → Scene folds part titles into chapter titles', async () => {
    const t = (id: string, title: string): Node => ({ id, type: 'Text', title });
    const proj = writeProject(tmp, 'Epic', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        t('P0', 'Prologue'),
        { id: 'P1', type: 'Folder', title: 'Part One', children: [
          t('EP', 'Epigraph'),
          { id: 'C1', type: 'Folder', title: 'Chapter 1', children: [t('S1', 'Scene A'), t('S2', 'Scene B')] },
          { id: 'C2', type: 'Folder', title: 'Chapter 2', children: [t('S3', 'Scene C')] },
        ] },
        { id: 'P2', type: 'Folder', title: 'Part Two', children: [
          { id: 'C3', type: 'Folder', title: 'Chapter 3', children: [t('S4', 'Scene D')] },
        ] },
      ] },
    ], Object.fromEntries(['P0', 'EP', 'S1', 'S2', 'S3', 'S4'].map((id) => [id, { content: rtf(`Text ${id}.\\par`) }])));
    const plan = await scrivenerToPlan(proj, 'Epic.scriv');
    expect(plan.story?.partCount).toBe(2);
    expect(shape(plan)).toEqual([
      ['Prologue', ['Prologue']],
      ['Part One', ['Epigraph']],
      ['Part One · Chapter 1', ['Scene A', 'Scene B']],
      ['Part One · Chapter 2', ['Scene C']],
      ['Part Two · Chapter 3', ['Scene D']],
    ]);
    expect(plan.story?.chapters[2].scenes[1].prose).toBe('Text S2.');
  });

  it('a Draft of scene-titled texts only (short story) is one chapter; chapter-titled texts are chapters', async () => {
    const story = writeProject(tmp, 'Short', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'A', type: 'Text', title: 'Opening' }, { id: 'B', type: 'Text', title: 'Ending' },
      ] },
    ], { A: { content: rtf('One.\\par') }, B: { content: rtf('Two.\\par') } });
    expect(shape(await scrivenerToPlan(story, 'Short.scriv'))).toEqual([['Short', ['Opening', 'Ending']]]);

    const chapters = writeProject(tmp, 'Flat', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'A', type: 'Text', title: 'Chapter 1' }, { id: 'B', type: 'Text', title: 'Chapter 2' },
      ] },
    ], { A: { content: rtf('One.\\par') }, B: { content: rtf('Two.\\par') } });
    expect(shape(await scrivenerToPlan(chapters, 'Flat.scriv'))).toEqual([['Chapter 1', ['Chapter 1']], ['Chapter 2', ['Chapter 2']]]);
  });

  it('texts with children act as chapters; a folder synopsis goes to its notes; Mac (Cocoa) RTF keeps its italics', async () => {
    const cocoa = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2580\n{\\fonttbl\\f0\\fnil\\fcharset0 Palatino-Roman;\\f1\\fnil\\fcharset0 Palatino-Italic;}\n'
      + '\\pard\\pardirnatural\\partightenfactor0\n\\f0\\fs26 \\cf0 First \\f1 line\\f0 .\\\nSecond line.}';
    const proj = writeProject(tmp, 'Docs', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'C1', type: 'Text', title: 'Chapter 1', children: [{ id: 'S1', type: 'Text', title: 'Scene 1' }] },
        { id: 'C2', type: 'Text', title: 'Chapter 2', children: [{ id: 'S2', type: 'Text', title: 'Scene 2' }] },
        { id: 'C3', type: 'Folder', title: 'Chapter 3', children: [{ id: 'S3', type: 'Text', title: 'Scene 3' }] },
      ] },
    ], {
      C1: { content: rtf('Chapter opening.\\par') },
      S1: { content: cocoa },
      S2: { content: rtf('Two.\\par') },
      C3: { synopsis: 'The siege.' },
      S3: { content: rtf('Three.\\par') },
    });
    const plan = await scrivenerToPlan(proj, 'Docs.scriv');
    expect(shape(plan)).toEqual([['Chapter 1', ['Chapter 1', 'Scene 1']], ['Chapter 2', ['Scene 2']], ['Chapter 3', ['Scene 3']]]);
    expect(plan.story?.chapters[0].scenes[1].prose).toBe('First *line*.\n\nSecond line.');
    expect(plan.notes).toEqual([{ title: 'Chapter 3 — notes', folder: 'Scene notes', body: 'The siege.' }]);
    expect(plan.warnings).toEqual([]);
  });

  it('reads a Scrivener 2 project (ID= attributes, Files/Docs/<ID>.rtf, _synopsis.txt, _notes.rtf)', async () => {
    const proj = writeProject(tmp, 'Old Book', [
      { id: '0', type: 'DraftFolder', title: 'Draft', children: [
        { id: '3', type: 'Folder', title: 'Chapter One', children: [{ id: '4', type: 'Text', title: 'Dawn' }] },
      ] },
      { id: '1', type: 'ResearchFolder', title: 'Research', children: [
        { id: '5', type: 'Folder', title: 'Character Sketches', children: [{ id: '6', type: 'Text', title: 'Old Tom' }] },
        { id: '7', type: 'Text', title: 'Timeline' },
      ] },
      { id: '2', type: 'TrashFolder', title: 'Trash' },
    ], {
      4: { content: rtf('The sun {\\i rose}.\\par'), synopsis: 'Day one.', notes: rtf('Make it colder.\\par') },
      6: { content: rtf('A fisherman.\\par') },
      7: { content: rtf('Year 1: war.\\par') },
    }, 2);
    const plan = await scrivenerToPlan(path.join(proj, 'Old Book.scrivx'), 'Old Book.scrivx');
    expect(plan.story?.title).toBe('Old Book');
    expect(plan.story?.chapters).toEqual([
      { title: 'Chapter One', order: 0, scenes: [{ title: 'Dawn', prose: 'The sun *rose*.', order: 0, synopsis: 'Day one.' }] },
    ]);
    expect(plan.notes).toEqual([
      { title: 'Dawn — notes', folder: 'Scene notes', body: 'Make it colder.' },
      { title: 'Old Tom', folder: '', body: 'A fisherman.', entityType: 'character' },
      { title: 'Timeline', folder: 'Research', body: 'Year 1: war.' },
    ]);
  });

  it('without a .scrivx, imports every document in ID order as one chapter', async () => {
    const proj = path.join(tmp, 'Lost.scriv');
    for (const [id, text] of [['B-2', 'Second.'], ['A-1', 'First.']]) {
      fs.mkdirSync(path.join(proj, 'Files', 'Data', id), { recursive: true });
      fs.writeFileSync(path.join(proj, 'Files', 'Data', id, 'content.rtf'), rtf(`${text}\\par`));
    }
    const plan = await scrivenerToPlan(proj, 'Lost.scriv');
    expect(plan.story?.chapters.map((c) => c.scenes.map((s) => s.prose))).toEqual([['First.', 'Second.']]);
    expect(plan.warnings[0]).toMatch(/No \.scrivx binder found/);
  });

  it('a notes-only project has no story; an empty one is an error', async () => {
    const notesOnly = writeProject(tmp, 'Notes', [
      { id: 'D', type: 'DraftFolder', title: 'Draft' },
      { id: 'R', type: 'ResearchFolder', title: 'Research', children: [{ id: 'N', type: 'Text', title: 'Idea' }] },
    ], { N: { content: rtf('A thought.\\par') } });
    const plan = await scrivenerToPlan(notesOnly, 'Notes.scriv');
    expect(plan.story).toBeNull();
    expect(plan.notes).toEqual([{ title: 'Idea', folder: 'Research', body: 'A thought.' }]);

    const empty = writeProject(tmp, 'Empty', [{ id: 'D', type: 'DraftFolder', title: 'Draft' }], {});
    await expect(scrivenerToPlan(empty, 'Empty.scriv')).rejects.toThrow(/no documents/);
    await expect(scrivenerToPlan(empty, 'Empty.scriv')).rejects.toBeInstanceOf(ImportUserError);
  });

  it('a Draft of texts titled "1", "2", "3" (or I, II, III) is one chapter per text', async () => {
    const proj = writeProject(tmp, 'Numbered', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'A', type: 'Text', title: '1' }, { id: 'B', type: 'Text', title: '2' }, { id: 'C', type: 'Text', title: 'III' },
      ] },
    ], { A: { content: rtf('One.\\par') }, B: { content: rtf('Two.\\par') }, C: { content: rtf('Three.\\par') } });
    expect(shape(await scrivenerToPlan(proj, 'Numbered.scriv'))).toEqual([['1', ['1']], ['2', ['2']], ['III', ['III']]]);
  });

  it('chapter-length texts with descriptive titles are chapters; short ones are the scenes of one chapter', async () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    const titles = ['The Arrival', 'Under the Bridge', 'Departure'];
    const nodes = (): Node[] => [{ id: 'D', type: 'DraftFolder', title: 'Draft', children: titles.map((title, i) => ({ id: `T${i}`, type: 'Text', title })) }];
    const novelProj = writeProject(tmp, 'Long', nodes(), Object.fromEntries(titles.map((_, i) => [`T${i}`, { content: rtf(`${words(3000)}.\\par`) }])));
    expect(shape(await scrivenerToPlan(novelProj, 'Long.scriv'))).toEqual(titles.map((t) => [t, [t]]));

    const shortProj = writeProject(tmp, 'Brief', nodes(), Object.fromEntries(titles.map((_, i) => [`T${i}`, { content: rtf(`${words(400)}.\\par`) }])));
    expect(shape(await scrivenerToPlan(shortProj, 'Brief.scriv'))).toEqual([['Brief', titles]]);
  });

  it('a "Chapter 1" folder whose scenes sit in sub-folders stays one chapter (not a part)', async () => {
    const t = (id: string, title: string): Node => ({ id, type: 'Text', title });
    const proj = writeProject(tmp, 'Grouped', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'C1', type: 'Folder', title: 'Chapter 1', children: [
          { id: 'M', type: 'Folder', title: 'Morning', children: [t('W', 'Wake'), t('E', 'Eat')] },
          { id: 'V', type: 'Folder', title: 'Evening', children: [t('S', 'Sleep')] },
        ] },
        { id: 'C2', type: 'Folder', title: 'Chapter 2', children: [t('N', 'Next')] },
      ] },
    ], Object.fromEntries(['W', 'E', 'S', 'N'].map((id) => [id, { content: rtf(`${id}.\\par`) }])));
    const plan = await scrivenerToPlan(proj, 'Grouped.scriv');
    expect(shape(plan)).toEqual([['Chapter 1', ['Wake', 'Eat', 'Sleep']], ['Chapter 2', ['Next']]]);
    expect(plan.story?.partCount).toBe(0);
  });

  it('a damaged document is imported empty with a warning; the rest of the project still imports', async () => {
    const proj = writeProject(tmp, 'Broken', [
      { id: 'D', type: 'DraftFolder', title: 'Draft', children: [
        { id: 'C', type: 'Folder', title: 'Chapter 1', children: [{ id: 'A', type: 'Text', title: 'Good' }, { id: 'B', type: 'Text', title: 'Bad' }] },
      ] },
    ], { A: { content: rtf('Fine.\\par') }, B: { content: `{\\rtf1 ${'{'.repeat(100_000)}` } });
    const plan = await scrivenerToPlan(proj, 'Broken.scriv');
    expect(plan.story?.chapters[0].scenes.map((s) => s.prose)).toEqual(['Fine.', '']);
    expect(plan.warnings).toContain('1 document could not be read (the file may be damaged) and was imported empty.');
  });
});

describe('parseScrivenerBinder', () => {
  it('reads titles, types, IDs and IncludeInCompile, ignoring nested items\' fields', () => {
    const items = parseScrivenerBinder(binderXml([
      { id: 'A', type: 'DraftFolder', title: 'Draft &amp; more', children: [{ id: 'B', type: 'Text', title: 'Kid', compile: false }] },
    ], 3));
    expect(items).toEqual([{
      id: 'A', type: 'DraftFolder', title: 'Draft &amp; more', includeInCompile: true,
      children: [{ id: 'B', type: 'Text', title: 'Kid', includeInCompile: false, children: [] }],
    }]);
  });

  it(`refuses more than ${SCRIVENER_MAX_BINDER_ITEMS} binder items`, () => {
    const many = Array.from({ length: SCRIVENER_MAX_BINDER_ITEMS + 1 }, (_, i) => `<BinderItem UUID="X${i}" Type="Text"/>`).join('');
    expect(() => parseScrivenerBinder(`<Binder>${many}</Binder>`)).toThrow(/more than 5,000 binder items/);
    const enough = Array.from({ length: SCRIVENER_MAX_BINDER_ITEMS }, (_, i) => `<BinderItem UUID="X${i}" Type="Text"/>`).join('');
    expect(parseScrivenerBinder(`<Binder>${enough}</Binder>`)).toHaveLength(SCRIVENER_MAX_BINDER_ITEMS);
    expect(() => parseScrivenerBinder(`<Binder>${many}</Binder>`)).toThrow(ImportUserError);
  });

  it('unclosed tags take linear time, not quadratic', async () => {
    expect(parseScrivenerBinder(`<Binder><BinderItem UUID="A" Type="Text">${'<Title>'.repeat(100_000)}</BinderItem></Binder>`))
      .toEqual([{ id: 'A', type: 'Text', title: '', includeInCompile: true, children: [] }]);
    // The quadratic scan took tens of seconds at 4 × these sizes.
    await expectLinearTime((k) => `<Binder><BinderItem UUID="A" Type="Text">${'<Title>'.repeat(k)}</BinderItem></Binder>`, parseScrivenerBinder, 25_000);
    await expectLinearTime((k) => `<Binder>${'<IncludeInCompile>'.repeat(k)}${'<BinderItem UUID="x"'.repeat(k / 2)}</Binder>`, parseScrivenerBinder, 25_000);
  });

});
