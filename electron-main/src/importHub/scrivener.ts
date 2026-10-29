// #1765 — Scrivener project (.scriv folder or its .scrivx) → ImportPlan.
//
// Scrivener 3 keeps each binder document at Files/Data/<UUID>/content.rtf
// (+ synopsis.txt, notes.rtf); Scrivener 2 at Files/Docs/<ID>.rtf (+
// <ID>_synopsis.txt, <ID>_notes.rtf, or <ID>.rtfd/TXT.rtf when the document
// holds images). The .scrivx binder gives the order and the tree:
//
//   - Draft → the story. Top-level folders are chapters; texts and nested
//     folders inside a chapter flatten into its scenes in binder order. A
//     top-level folder holding chapter folders (Draft → Part → Chapter →
//     Scene) is a part: its chapters are titled "Part One · Chapter 1". Texts
//     directly under Draft are chapters of their own (Prologue, Epilogue),
//     unless the Draft holds nothing but short texts without chapter-like
//     titles (the short-story template) — then they are the scenes of one
//     chapter.
//   - Scene text keeps its formatting (rtf.ts → editor Markdown); a "#" / "***"
//     paragraph inside one document starts another scene. synopsis.txt is the
//     scene synopsis, notes.rtf a note in "Scene notes".
//   - Characters / Places / Factions / Items folders (anywhere outside the
//     Draft) → entity notes; every other Research or top-level text → a plain
//     note under its binder path. Trash, Front Matter and Template Sheets are
//     skipped; PDFs, images and web archives are counted, not imported.
//
// The project name (.scriv folder) is the story title. Only files inside the
// project folder are read: binder IDs must be [A-Za-z0-9-], and every path is
// re-checked after resolving links.

import fs from 'fs';
import path from 'path';
import { decodeHtmlEntities } from '../storyImport.js';
import { blocksToProse, inlinesToMarkdown, matchChapterMarker, type RichBlock } from './blocks.js';
import { decodeRtfBytes, ImportUserError, parseRtf, rtfDropWarnings, type RtfParseResult } from './rtf.js';
import type { ImportChapter, ImportEntityType, ImportNote, ImportPlan, ImportScene } from './types.js';

export const SCRIVENER_MAX_BINDER_ITEMS = 5000;
export const SCRIVENER_MAX_RTF_BYTES = 20 * 1024 * 1024;
const SCRIVX_MAX_BYTES = 50 * 1024 * 1024;
const SYNOPSIS_MAX_BYTES = 1024 * 1024;
/** A Draft of bare texts reads as one short story's scenes below either size. */
const SHORT_STORY_MAX_WORDS = 7500;
const SCENE_MAX_AVERAGE_WORDS = 1500;

export interface ScrivenerBinderItem {
  /** UUID (Scrivener 3) or ID (Scrivener 2) attribute, as written. */
  id: string;
  type: string;
  title: string;
  /** MetaData → IncludeInCompile (absent = Yes). */
  includeInCompile: boolean;
  children: ScrivenerBinderItem[];
}

/**
 * Parse the `<Binder>` tree of a .scrivx (Scrivener 2 and 3). Only the
 * Binder section is read — collections and search results elsewhere in the
 * file reference the same items. Throws past SCRIVENER_MAX_BINDER_ITEMS.
 */
export function parseScrivenerBinder(xml: string): ScrivenerBinderItem[] {
  const start = xml.search(/<Binder[\s>]/);
  const end = xml.lastIndexOf('</Binder>');
  const section = start >= 0 ? xml.slice(start, end > start ? end : undefined) : xml;
  const roots: ScrivenerBinderItem[] = [];
  const stack: Array<{ item: ScrivenerBinderItem; titled: boolean; compileSeen: boolean }> = [];
  // Titles and the compile flag are XML-escaped text and attributes never hold
  // `<`, so every match stops at the next tag — an unclosed tag cannot make
  // the scan quadratic.
  const re = /<BinderItem\b([^<>]*?)(\/)?>|<\/BinderItem>|<Title>([^<]*)<\/Title>|<IncludeInCompile>([^<]*)<\/IncludeInCompile>/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    if (m[0].startsWith('</BinderItem')) {
      stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<BinderItem')) {
      if (++count > SCRIVENER_MAX_BINDER_ITEMS) {
        throw new ImportUserError(`This Scrivener project has more than ${SCRIVENER_MAX_BINDER_ITEMS.toLocaleString('en-US')} binder items. Import it in smaller parts.`);
      }
      const attrs = m[1] ?? '';
      const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
      const idMatch = attr('UUID') ?? attr('ID');
      const typeMatch = attr('Type');
      const item: ScrivenerBinderItem = {
        id: decodeHtmlEntities(idMatch?.[1] ?? idMatch?.[2] ?? '').trim(),
        type: typeMatch?.[1] ?? typeMatch?.[2] ?? '',
        title: '',
        includeInCompile: true,
        children: [],
      };
      (top ? top.item.children : roots).push(item);
      if (!m[2]) stack.push({ item, titled: false, compileSeen: false });
      continue;
    }
    if (!top) continue;
    // The first <Title> / <IncludeInCompile> inside an item is its own (its
    // children's come later, inside <Children>, after they open).
    if (m[3] !== undefined && !top.titled) {
      top.item.title = decodeHtmlEntities(m[3]).replace(/\s+/g, ' ').trim();
      top.titled = true;
    } else if (m[4] !== undefined && !top.compileSeen) {
      top.item.includeInCompile = !/^\s*no\s*$/i.test(m[4]);
      top.compileSeen = true;
    }
  }
  return roots;
}

/** Binder IDs become path segments: never anything but letters, digits and dashes. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

const ENTITY_FOLDERS: Array<[RegExp, ImportEntityType]> = [
  [/^(?:characters?|character sketches|people)$/i, 'character'],
  [/^(?:places?|locations?|settings?)$/i, 'location'],
  [/^(?:factions?|organi[sz]ations?)$/i, 'faction'],
  [/^items?$/i, 'item'],
];
const SKIPPED_ROOT_FOLDERS = /^(?:front ?matter|back ?matter|template sheets?|templates?)$/i;
const TEXT_TYPES = new Set(['Text', 'Folder', 'DraftFolder', 'ResearchFolder']);

function entityTypeFor(title: string): ImportEntityType | undefined {
  return ENTITY_FOLDERS.find(([re]) => re.test(title.trim()))?.[1];
}

/** PDFs, images, web archives, media — binder files with no text Mythos can import. */
function isMediaItem(item: ScrivenerBinderItem): boolean {
  return !TEXT_TYPES.has(item.type) && item.type !== 'TrashFolder';
}

/** "1", "12", "IV" — a bare number titles a chapter. */
const BARE_NUMBER_TITLE = /^(?:\d{1,4}|(?=[IVXLC])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))\.?$/;

function hasChapterTitle(item: ScrivenerBinderItem): boolean {
  return matchChapterMarker(item.title) !== null || BARE_NUMBER_TITLE.test(item.title.trim());
}

function wordCount(scenes: ImportScene[]): number {
  return scenes.reduce((n, s) => n + (s.prose.match(/\S+/g)?.length ?? 0), 0);
}

function isContainer(item: ScrivenerBinderItem): boolean {
  return item.type === 'Folder' || item.children.length > 0;
}

/** A binder title as one note-folder path segment (no separators). */
function folderSegment(title: string): string {
  return title.replace(/[\\/]+/g, '-').trim() || 'Untitled';
}

interface LoadedDoc {
  /** Parsed content, or null when the document has no text file. */
  content: RtfParseResult | null;
  synopsis: string;
  notes: RtfParseResult | null;
}

interface Counters {
  missing: number;
  tooLarge: number;
  damaged: number;
  invalidId: number;
  media: number;
  notCompiled: number;
  footnotes: number;
  annotations: number;
  images: number;
}

class ScrivenerProject {
  private readonly rootReal: string;
  readonly counters: Counters = {
    missing: 0, tooLarge: 0, damaged: 0, invalidId: 0, media: 0, notCompiled: 0, footnotes: 0, annotations: 0, images: 0,
  };

  constructor(readonly dir: string) {
    this.rootReal = fs.realpathSync(dir);
  }

  /**
   * Read a file under the project folder. null when it is absent, not a
   * regular file, or resolves outside the project; 'too-large' past `max`.
   */
  async read(segments: string[], max: number): Promise<Buffer | null | 'too-large'> {
    let real: string;
    try {
      real = await fs.promises.realpath(path.join(this.dir, ...segments));
    } catch {
      return null;
    }
    if (!real.startsWith(this.rootReal + path.sep)) return null;
    try {
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) return null;
      if (stat.size > max) return 'too-large';
      return await fs.promises.readFile(real);
    } catch {
      return null;
    }
  }

  private async readRtf(candidates: string[][]): Promise<RtfParseResult | null | 'too-large' | 'damaged'> {
    for (const segs of candidates) {
      const buf = await this.read(segs, SCRIVENER_MAX_RTF_BYTES);
      if (buf === 'too-large') return buf;
      if (!buf) continue;
      try {
        return parseRtf(decodeRtfBytes(buf));
      } catch (err) {
        // One damaged document never sinks the whole project.
        if (err instanceof ImportUserError) return 'damaged';
        throw err;
      }
    }
    return null;
  }

  private tally(parsed: RtfParseResult | null): void {
    if (!parsed) return;
    this.counters.footnotes += parsed.droppedFootnotes;
    this.counters.annotations += parsed.droppedAnnotations;
    this.counters.images += parsed.droppedImages;
  }

  /** One binder document's text, synopsis and notes (Scrivener 3 layout first, then 2). */
  async load(item: ScrivenerBinderItem): Promise<LoadedDoc & { tooLarge: boolean; damaged: boolean; invalid: boolean }> {
    const empty = { content: null, synopsis: '', notes: null, tooLarge: false, damaged: false, invalid: false };
    if (!SAFE_ID.test(item.id)) return { ...empty, invalid: true };
    const id = item.id;
    const content = await this.readRtf([
      ['Files', 'Data', id, 'content.rtf'],
      ['Files', 'Docs', `${id}.rtf`],
      ['Files', 'Docs', `${id}.rtfd`, 'TXT.rtf'],
    ]);
    const notes = await this.readRtf([['Files', 'Data', id, 'notes.rtf'], ['Files', 'Docs', `${id}_notes.rtf`]]);
    let synopsis = '';
    for (const segs of [['Files', 'Data', id, 'synopsis.txt'], ['Files', 'Docs', `${id}_synopsis.txt`]]) {
      const buf = await this.read(segs, SYNOPSIS_MAX_BYTES);
      if (buf && buf !== 'too-large') {
        synopsis = buf.toString('utf-8').replace(/^\ufeff/, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }
    const parsed = (r: typeof content) => (r === 'too-large' || r === 'damaged' ? null : r);
    const doc = {
      content: parsed(content),
      synopsis,
      notes: parsed(notes),
      tooLarge: content === 'too-large' || notes === 'too-large',
      damaged: content === 'damaged' || notes === 'damaged',
      invalid: false,
    };
    this.tally(doc.content);
    this.tally(doc.notes);
    return doc;
  }
}

/** Split a document's blocks at scene-break paragraphs; empty pieces go (at least one stays). */
function splitAtSceneBreaks(blocks: RichBlock[]): string[] {
  const pieces: RichBlock[][] = [[]];
  for (const b of blocks) {
    if (b.kind === 'sceneBreak') pieces.push([]);
    else pieces[pieces.length - 1].push(b);
  }
  const prose = pieces.map(blocksToProse).filter((p) => p !== '');
  return prose.length > 0 ? prose : [''];
}

function noteBody(doc: LoadedDoc): string {
  const parts: string[] = [];
  if (doc.synopsis) parts.push(inlinesToMarkdown([{ text: doc.synopsis }]));
  const content = doc.content ? blocksToProse(doc.content.blocks) : '';
  if (content) parts.push(content);
  const notes = doc.notes ? blocksToProse(doc.notes.blocks) : '';
  if (notes) parts.push('## Notes', notes);
  return parts.join('\n\n');
}

class PlanBuilder {
  readonly notes: ImportNote[] = [];

  constructor(private readonly project: ScrivenerProject) {}

  private get counters(): Counters {
    return this.project.counters;
  }

  private async load(item: ScrivenerBinderItem): Promise<LoadedDoc> {
    const doc = await this.project.load(item);
    if (doc.invalid) this.counters.invalidId++;
    else if (doc.tooLarge) this.counters.tooLarge++;
    else if (doc.damaged) this.counters.damaged++;
    else if (!doc.content && item.type === 'Text' && item.children.length === 0) this.counters.missing++;
    return doc;
  }

  /** A scene document's notes (and a folder's synopsis) → a note in "Scene notes". */
  private sceneNote(title: string, doc: LoadedDoc, withSynopsis: boolean): void {
    const notes = doc.notes ? blocksToProse(doc.notes.blocks) : '';
    const synopsis = withSynopsis && doc.synopsis ? inlinesToMarkdown([{ text: doc.synopsis }]) : '';
    if (!notes && !synopsis) return;
    this.notes.push({ title: `${title} — notes`, folder: 'Scene notes', body: [synopsis, notes].filter(Boolean).join('\n\n') });
  }

  /**
   * A document's own text → scenes. Containers (folders, texts with
   * children) only contribute a scene when they hold text; a leaf text
   * document always does (empty when it has none).
   */
  private async ownScenes(item: ScrivenerBinderItem, out: ImportScene[]): Promise<void> {
    if (isMediaItem(item)) {
      this.counters.media++;
      return;
    }
    const doc = await this.load(item);
    const title = item.title || 'Untitled scene';
    if (item.type === 'Text' && !item.includeInCompile) this.counters.notCompiled++;
    const pieces = doc.content ? splitAtSceneBreaks(doc.content.blocks) : [''];
    const hasScene = !(isContainer(item) && pieces.length === 1 && pieces[0] === '');
    // A folder's synopsis describes the whole chapter: it goes with its notes.
    const sceneSynopsis = hasScene && item.type === 'Text' && doc.synopsis !== '';
    if (hasScene) {
      pieces.forEach((prose, k) => {
        const scene: ImportScene = { title: k === 0 ? title : `${title} (${k + 1})`, prose, order: 0 };
        if (k === 0 && sceneSynopsis) scene.synopsis = doc.synopsis;
        out.push(scene);
      });
    }
    this.sceneNote(title, doc, !sceneSynopsis);
  }

  /** An item and everything under it, flattened into scenes in binder order. */
  private async flatScenes(item: ScrivenerBinderItem, out: ImportScene[]): Promise<void> {
    await this.ownScenes(item, out);
    for (const child of item.children) await this.flatScenes(child, out);
  }

  private chapter(title: string, scenes: ImportScene[]): ImportChapter {
    scenes.forEach((s, i) => { s.order = i; });
    return { title, order: 0, scenes };
  }

  private static isPart(item: ScrivenerBinderItem): boolean {
    if (!isContainer(item)) return false;
    // "Chapter 1" with its scenes grouped in sub-folders is still a chapter.
    const marker = matchChapterMarker(item.title)?.kind;
    if (marker === 'chapter' || marker === 'front') return false;
    const containers = item.children.filter(isContainer).length;
    const texts = item.children.length - containers;
    return containers >= 1 && containers >= texts
      && (containers >= 2 || matchChapterMarker(item.title)?.kind === 'part');
  }

  /** Draft children → chapters (+ how many parts were folded into titles). */
  async story(items: ScrivenerBinderItem[], storyTitle: string): Promise<{ chapters: ImportChapter[]; partCount: number }> {
    const chapters: ImportChapter[] = [];
    let partCount = 0;
    const content = items.filter((it) => it.type !== 'TrashFolder');
    // Nothing but texts: one per chapter (the Blank template's usual novel
    // shape), unless they are short and not titled like chapters — the
    // short-story template's scenes, gathered into one chapter.
    if (content.length > 0 && content.every((it) => !isContainer(it))) {
      const markers = content.filter(hasChapterTitle).length;
      if (markers * 2 <= content.length) {
        const perItem: Array<{ item: ScrivenerBinderItem; scenes: ImportScene[] }> = [];
        for (const item of content) {
          const scenes: ImportScene[] = [];
          await this.ownScenes(item, scenes);
          perItem.push({ item, scenes });
        }
        const texts = perItem.filter((p) => !isMediaItem(p.item));
        const words = wordCount(texts.flatMap((p) => p.scenes));
        if (words < SHORT_STORY_MAX_WORDS || words < SCENE_MAX_AVERAGE_WORDS * texts.length) {
          return { chapters: [this.chapter(storyTitle, texts.flatMap((p) => p.scenes))], partCount: 0 };
        }
        texts.forEach((p) => chapters.push(this.chapter(p.item.title || 'Untitled chapter', p.scenes)));
        chapters.forEach((c, i) => { c.order = i; });
        return { chapters, partCount: 0 };
      }
    }
    for (const item of content) {
      const title = item.title || 'Untitled chapter';
      if (PlanBuilder.isPart(item)) {
        partCount++;
        // The part's own text and loose texts between its chapters gather
        // into chapters titled with the part alone.
        let loose: ImportScene[] = [];
        await this.ownScenes(item, loose);
        const flushLoose = () => {
          if (loose.length) chapters.push(this.chapter(title, loose));
          loose = [];
        };
        for (const child of item.children) {
          if (isContainer(child)) {
            flushLoose();
            const scenes: ImportScene[] = [];
            await this.flatScenes(child, scenes);
            chapters.push(this.chapter(`${title} · ${child.title || 'Untitled chapter'}`, scenes));
          } else {
            await this.ownScenes(child, loose);
          }
        }
        flushLoose();
        continue;
      }
      if (isMediaItem(item) && item.children.length === 0) {
        this.counters.media++;
        continue;
      }
      const scenes: ImportScene[] = [];
      await this.flatScenes(item, scenes);
      chapters.push(this.chapter(title, scenes));
    }
    chapters.forEach((c, i) => { c.order = i; });
    return { chapters, partCount };
  }

  /** Research / other binder items → notes and entities. */
  async notesFrom(items: ScrivenerBinderItem[], folderPath: string[], entity: ImportEntityType | undefined): Promise<void> {
    for (const item of items) {
      if (item.type === 'TrashFolder') continue;
      if (isMediaItem(item)) {
        this.counters.media++;
        await this.notesFrom(item.children, folderPath, entity);
        continue;
      }
      const title = item.title || 'Untitled';
      if (item.type === 'Folder') {
        const doc = await this.load(item);
        const body = noteBody(doc);
        if (body) this.notes.push({ title, folder: folderPath.join('/'), body });
        await this.notesFrom(item.children, [...folderPath, folderSegment(title)], entity ?? entityTypeFor(title));
        continue;
      }
      const doc = await this.load(item);
      const body = noteBody(doc);
      this.notes.push(entity ? { title, folder: '', body, entityType: entity } : { title, folder: folderPath.join('/'), body });
      if (item.children.length) await this.notesFrom(item.children, [...folderPath, folderSegment(title)], entity);
    }
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function counterWarnings(c: Counters): string[] {
  const w: string[] = [];
  if (c.missing) w.push(`${plural(c.missing, 'document had', 'documents had')} no text in the project and ${c.missing === 1 ? 'was' : 'were'} imported empty.`);
  if (c.damaged) w.push(`${plural(c.damaged, 'document', 'documents')} could not be read (the file may be damaged) and ${c.damaged === 1 ? 'was' : 'were'} imported empty.`);
  if (c.tooLarge) w.push(`${plural(c.tooLarge, 'document was', 'documents were')} larger than 20 MB and ${c.tooLarge === 1 ? 'was' : 'were'} imported empty.`);
  if (c.invalidId) w.push(`${plural(c.invalidId, 'binder item has', 'binder items have')} an unreadable ID and ${c.invalidId === 1 ? 'was' : 'were'} imported empty.`);
  if (c.notCompiled) w.push(`${plural(c.notCompiled, 'document is', 'documents are')} set not to compile in Scrivener — imported anyway.`);
  if (c.media) w.push(`${plural(c.media, 'research file', 'research files')} (PDFs/images/web pages) ${c.media === 1 ? 'was' : 'were'} not imported.`);
  for (const x of rtfDropWarnings({ droppedFootnotes: c.footnotes, droppedAnnotations: c.annotations, droppedImages: c.images })) w.push(x);
  return w;
}

async function locateProject(inputPath: string): Promise<{ dir: string; scrivx: string | null; title: string }> {
  const stat = await fs.promises.stat(inputPath);
  if (stat.isDirectory()) {
    const scrivx = (await fs.promises.readdir(inputPath, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.scrivx$/i.test(e.name))
      .map((e) => e.name)
      .sort()[0];
    const base = path.basename(inputPath);
    return { dir: inputPath, scrivx: scrivx ? path.join(inputPath, scrivx) : null, title: base.replace(/\.scriv$/i, '') };
  }
  const dir = path.dirname(inputPath);
  const base = path.basename(dir);
  const title = /\.scriv$/i.test(base) ? base.replace(/\.scriv$/i, '') : path.basename(inputPath).replace(/\.scrivx$/i, '');
  return { dir, scrivx: /\.scrivx$/i.test(inputPath) ? inputPath : null, title };
}

/** No .scrivx: every document in the project, in ID order, as the scenes of one chapter. */
async function binderlessScenes(project: ScrivenerProject): Promise<ImportScene[]> {
  const ids = new Set<string>();
  const list = async (segs: string[]) => {
    try {
      return await fs.promises.readdir(path.join(project.dir, ...segs));
    } catch {
      return [];
    }
  };
  for (const name of await list(['Files', 'Data'])) if (SAFE_ID.test(name)) ids.add(name);
  for (const name of await list(['Files', 'Docs'])) {
    const m = /^([A-Za-z0-9-]+)\.rtfd?$/i.exec(name);
    if (m) ids.add(m[1]);
  }
  const scenes: ImportScene[] = [];
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const id of sorted) {
    const doc = await project.load({ id, type: 'Text', title: '', includeInCompile: true, children: [] });
    if (!doc.content) continue;
    const prose = blocksToProse(doc.content.blocks);
    if (prose) scenes.push({ title: `Scene ${scenes.length + 1}`, prose, order: scenes.length });
  }
  return scenes;
}

/** A .scriv project folder or its .scrivx file → an ImportPlan. */
export async function scrivenerToPlan(inputPath: string, name: string): Promise<ImportPlan> {
  const loc = await locateProject(inputPath);
  const storyTitle = loc.title.trim() || name.replace(/\.(scrivx|scriv)$/i, '').trim() || 'Imported Story';
  const project = new ScrivenerProject(loc.dir);
  const builder = new PlanBuilder(project);
  const warnings: string[] = [];
  const plan = (chapters: ImportChapter[] | null, partCount: number): ImportPlan => ({
    source: { kind: 'scrivener', name },
    story: chapters ? { title: storyTitle, chapters, partCount, structure: 'binder' } : null,
    notes: builder.notes,
    warnings: [...warnings, ...counterWarnings(project.counters)],
  });

  const scrivxBuf = loc.scrivx ? await project.read([path.basename(loc.scrivx)], SCRIVX_MAX_BYTES) : null;
  if (scrivxBuf === 'too-large') throw new ImportUserError('This Scrivener project file (.scrivx) is larger than 50 MB.');
  if (!scrivxBuf) {
    warnings.push('No .scrivx binder found — imported every document in the project as one chapter.');
    const scenes = await binderlessScenes(project);
    if (scenes.length === 0) throw new ImportUserError('No Scrivener documents found in this project.');
    return plan([{ title: storyTitle, order: 0, scenes }], 0);
  }

  const binder = parseScrivenerBinder(scrivxBuf.toString('utf-8'));
  const draft = binder.find((b) => b.type === 'DraftFolder')
    ?? binder.find((b) => b.type === 'Folder' && /^(?:draft|manuscript)$/i.test(b.title));
  const rest = binder.filter((b) => b !== draft);
  let draftItems: ScrivenerBinderItem[];
  if (draft) {
    draftItems = draft.children;
  } else {
    warnings.push('No Draft folder in the binder — imported the whole binder as the story.');
    draftItems = rest.filter((b) => b.type !== 'TrashFolder' && b.type !== 'ResearchFolder'
      && !SKIPPED_ROOT_FOLDERS.test(b.title) && !entityTypeFor(b.title));
  }

  const { chapters, partCount } = await builder.story(draftItems, storyTitle);

  for (const item of rest) {
    if (item.type === 'TrashFolder' || SKIPPED_ROOT_FOLDERS.test(item.title)) continue;
    if (!draft && draftItems.includes(item)) continue;
    if (item.type === 'ResearchFolder') {
      await builder.notesFrom(item.children, [folderSegment(item.title || 'Research')], undefined);
    } else {
      await builder.notesFrom([item], [], undefined);
    }
  }

  if (chapters.length === 0 && builder.notes.length === 0) {
    throw new ImportUserError('The Scrivener binder contained no documents.');
  }
  return plan(chapters.length > 0 ? chapters : null, partCount);
}
