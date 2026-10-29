// #1765 — Markdown importers: one .md file (a manuscript) and a Markdown
// folder — Obsidian vaults, iA Writer / Zettlr / Notable / Dendron / Foam
// folders, and the Markdown exports of Ulysses, Bear, Typora, Joplin, Logseq,
// Craft and Notion.
//
// Manuscript prose is already Markdown, so it travels verbatim as 'markdown'
// blocks (never re-escaped); only headings and scene-break lines become
// structure. A folder is a manuscript only when a folder says so (Manuscript/,
// Drafts/, Chapters/, …) or its files are numbered like chapters; everything
// else becomes notes, and notes typed (or filed) as characters, locations, …
// become entities. Chapters sort by their number — digits, Roman numerals or
// words — with a prologue first and an epilogue last. .txt files in a folder
// are plain text, not Markdown. A Bear / Ulysses `.textbundle` is one note;
// Logseq's backup folder and dated journal files never read as chapters.
//
// The folder walk never follows links, skips hidden and tool folders, and
// caps files, sizes and depth. Frontmatter is read by a small line parser that
// only understands strings and lists — nothing in it is ever evaluated.

import fs from 'node:fs';
import path from 'node:path';
import type { ImportChapter, ImportEntityType, ImportNote, ImportPlan, ImportScene, ImportStory } from './types.js';
import { inlinesToMarkdown, isSceneBreakText, matchChapterMarker, segmentBlocks, type RichBlock } from './blocks.js';
import { classifyExtension } from './importSafety.js';
import { plainTextToBlocks } from './plainText.js';

/** Markdown files above this are skipped (a whole novel is ~1 MB). */
export const MARKDOWN_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Markdown / text files read from one folder. */
export const MARKDOWN_IMPORT_MAX_FILES = 5000;
/** Folder nesting below the picked folder. */
export const MARKDOWN_IMPORT_MAX_DEPTH = 12;
/** Bytes read from one folder in total. */
export const MARKDOWN_IMPORT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** Directory entries examined before the walk stops (huge trees). */
const MAX_WALK_ENTRIES = 50000;

const NOTE_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'txt']);
/** Plain-text files: read as text, never as Markdown. */
const PLAIN_TEXT_EXTENSIONS = new Set(['txt']);
const SKIPPED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '__macosx']);
/** Logseq's own folder (backups, version files) beside a graph's pages/ and journals/. */
const LOGSEQ_GRAPH_DIRS = new Set(['pages', 'journals']);
const LOGSEQ_BACKUP_DIRS = new Set(['bak', 'version-files']);
/** Bear / Ulysses TextBundle: a folder holding text.md (or .markdown), info.json and assets/. */
const TEXTBUNDLE_RE = /\.textbundle$/i;
const TEXTBUNDLE_TEXT_NAMES = ['text.md', 'text.markdown', 'text.txt'];
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif|tiff?|ico|pdf|mp4|mov|webm|mp3|wav|m4a)$/i;

// ─── Frontmatter ─────────────────────────────────────────────────────────────

export type MarkdownFrontmatter = Record<string, string | string[]>;

const FM_KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_ .-]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const FM_LIST_ITEM_RE = /^[ \t]*-(?:[ \t]+(.*?))?[ \t]*$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** One YAML scalar → string, or undefined for anything that isn't a plain string. */
function fmScalar(raw: string): string | undefined {
  const v = raw.trim();
  if (!v || v === '~' || v === 'null') return undefined;
  if (v.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
    if (!m) return undefined;
    return m[1].replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  if (v.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(v);
    return m ? m[1].replace(/''/g, "'") : undefined;
  }
  // Flow maps, nested lists, anchors, aliases, tags and block scalars are not strings.
  if (/^[[{&*!|>%@`]/.test(v)) return undefined;
  const text = v.replace(/[ \t]+#.*$/, '').trim();
  return text || undefined;
}

/** `[a, "b, c", 'd']` → items; undefined when the list holds anything nested. */
function fmInlineList(raw: string): string[] | undefined {
  const inner = raw.trim().slice(1, -1);
  const items: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < inner.length) cur += inner[++i];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '[' || c === ']' || c === '{' || c === '}') {
      return undefined;
    } else if (c === ',') {
      items.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (quote) return undefined;
  if (cur.trim()) items.push(cur);
  const out: string[] = [];
  for (const item of items) {
    const s = fmScalar(item);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/** YAML between the fences → keys, or null when it doesn't read as YAML at all. */
function parseYamlLines(lines: string[]): MarkdownFrontmatter | null {
  const data: MarkdownFrontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^[ \t]*#/.test(line)) continue;
    const m = FM_KEY_RE.exec(line);
    if (!m) {
      // Indented lines belong to a nested value already skipped; anything else isn't YAML.
      if (/^[ \t]/.test(line) || FM_LIST_ITEM_RE.test(line)) continue;
      return null;
    }
    const key = m[1].trim();
    const raw = m[2] ?? '';
    let value: string | string[] | undefined;
    if (raw === '') {
      // A block list (`tags:` then `  - a` lines), a nested map, or nothing.
      const list: string[] = [];
      let nested = false;
      while (i + 1 < lines.length && (FM_LIST_ITEM_RE.test(lines[i + 1]) || /^[ \t]+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        const next = lines[++i];
        if (!next.trim()) continue;
        const item = FM_LIST_ITEM_RE.exec(next);
        if (!item) { nested = true; continue; }
        const s = item[1] === undefined ? undefined : fmScalar(item[1]);
        if (s !== undefined && !/^[^"'\s][^:]*:(?:\s|$)/.test(item[1] ?? '')) list.push(s);
        else if (item[1] !== undefined) nested = true;
      }
      if (!nested && list.length > 0) value = list;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      value = fmInlineList(raw);
    } else if (/^[|>][+-]?\d*$/.test(raw)) {
      // Block scalar: skip its indented lines.
      while (i + 1 < lines.length && (/^[ \t]+/.test(lines[i + 1]) || !lines[i + 1].trim())) i++;
    } else {
      value = fmScalar(raw);
    }
    if (value === undefined || UNSAFE_KEYS.has(key)) continue;
    data[key] = value;
  }
  return data;
}

/**
 * Split YAML frontmatter (`---` … `---` or `...`) off a Markdown text. Strips
 * a BOM and normalizes line endings first. Only plain strings and lists of
 * strings are kept; nested maps, block scalars, anchors and tags are dropped.
 * Text whose opening fence isn't followed by YAML-looking lines (a manuscript
 * starting with a `---` scene break) is returned whole.
 */
export function parseMarkdownFrontmatter(text: string): { data: MarkdownFrontmatter; body: string } {
  const normalized = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(normalized)) return { data: {}, body: normalized };
  const lines = normalized.split('\n');
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) return { data: {}, body: normalized };
  const data = parseYamlLines(lines.slice(1, close));
  if (!data) return { data: {}, body: normalized };
  return { data, body: lines.slice(close + 1).join('\n') };
}

function fmString(fm: MarkdownFrontmatter, key: string): string | undefined {
  const v = fm[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

// ─── Text → blocks ───────────────────────────────────────────────────────────

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_RE = /^ {0,3}(=+|-{2,})[ \t]*$/;
const THEMATIC_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A tilde fence opens only on a language word ("~~~ python", "~~~ js {.x}"); "~~~ The End ~~~" is prose. */
const TILDE_INFO_RE = /^[ \t]*(?:[\w+#.-]+[ \t]*(?:\{[^}\n]*\})?[ \t]*)?$/;
/**
 * A link destination: `(<…>)`, or `(…)` with one level of balanced
 * parentheses (`map(1).png`), optionally titled.
 */
const LINK_DEST = '\\((?:[ \\t]*<[^>\\n]*>(?:[ \\t]+(?:"[^"\\n]*"|\'[^\'\\n]*\'|\\([^()\\n]*\\)))?[ \\t]*|(?:[^()\\n]|\\([^()\\n]*\\))*)\\)';
/** Lines a setext underline can't turn into a heading (list items, quotes, tables). */
const NOT_SETEXT_LINE_RE = /^\s*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|>|\|)/;

/** Heading source text → plain title text (emphasis, links and escapes unwrapped). */
function headingPlainText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(new RegExp(`!?\\[([^\\]\\n]*)\\]${LINK_DEST}`, 'g'), '$1')
    .replace(/<\/?(?:u|em|strong|b|i|s|del|mark)>/gi, '')
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/**
 * Remove image embeds from one prose line; returns the line and how many went.
 * Only the space beside an embed goes with it: indentation, a trailing
 * two-space hard break and the spacing elsewhere on the line stay.
 */
function dropImages(line: string): { line: string; count: number } {
  let count = 0;
  let out = line;
  const remove = (source: string, keep?: (core: string) => boolean) => {
    out = out.replace(new RegExp(`([ \\t]*)(${source})([ \\t]*)`, 'g'), (whole: string, pre: string, core: string, post: string, offset: number, all: string) => {
      if (keep?.(core)) return whole;
      count++;
      const atStart = all.slice(0, offset).trim() === '';
      const atEnd = offset + whole.length === all.length;
      if (atStart) return atEnd ? '' : pre;
      if (atEnd) return post;
      return pre || post ? ' ' : '';
    });
  };
  // A linked image `[![alt](img)](url)` goes whole.
  remove(`\\[!\\[[^\\]\\n]*\\]${LINK_DEST}\\]${LINK_DEST}`);
  remove(`!\\[[^\\]\\n]*\\]${LINK_DEST}`);
  remove('!\\[[^\\]\\n]*\\]\\[[^\\]\\n]*\\]');
  remove('<img\\b[^>\\n]*>');
  // Obsidian `![[photo.png|300]]` — a note embed `![[Other note]]` stays.
  remove('!\\[\\[[^\\]\\n]+\\]\\]', (core) => !IMAGE_EXT_RE.test(core.slice(3, -2).split('|')[0].split('#')[0].trim()));
  return { line: out, count };
}

/**
 * A one-line "Chapter One" / "**Part Two**" paragraph → a paragraph block, so
 * the segmenter can read it as a chapter marker (it only reads paragraphs).
 * Only lines with no Markdown in them beyond a whole-line bold wrap, so the
 * block serializes back to the same text.
 */
function markerParagraph(text: string): RichBlock | null {
  const t = text.trim();
  if (t.includes('\n') || t.length > 80) return null;
  const wrap = /^(\*\*|__)(?=\S)(.+?)(?<=\S)\1$/.exec(t);
  const inner = wrap ? wrap[2] : t;
  if (/[\\`*_[\]<>#|~=!]/.test(inner) || /^\s*(?:[-+]\s|\d{1,9}[.)](?:\s|$))/.test(inner)) return null;
  if (!matchChapterMarker(inner)) return null;
  return { kind: 'paragraph', inlines: [{ text: inner, ...(wrap ? { bold: true } : {}) }] };
}

interface ParsedMarkdown {
  frontmatter: MarkdownFrontmatter;
  /** The text without frontmatter, BOM stripped, `\n` line endings. */
  body: string;
  blocks: RichBlock[];
  droppedImages: number;
}

interface Fence {
  ch: string;
  len: number;
}

/** The fence a line would open in the editor (markdown-it), or null. */
function fenceOpener(line: string): (Fence & { info: string }) | null {
  const f = FENCE_RE.exec(line);
  // A backtick fence can't carry a backtick in its info string (CommonMark).
  if (!f || (f[1][0] === '`' && f[2].includes('`'))) return null;
  return { ch: f[1][0], len: f[1].length, info: f[2] };
}

function closesFence(fence: Fence, line: string): boolean {
  return new RegExp(`^ {0,3}${fence.ch === '`' ? '`' : '~'}{${fence.len},}[ \\t]*$`).test(line);
}

/**
 * Which fence-looking lines open a code block. A scene-break line (`~~~`,
 * `~~~ * ~~~`) is never a fence — manuscripts use those far more than code.
 * A `~~~` line opens one only with a language word after it, and no fence
 * opens unless it closes: an unclosed fence would swallow the rest of the
 * book. The fence lines that don't open (`literal`) are escaped so the
 * editor doesn't open them either.
 */
function scanFences(lines: string[]): { open: Set<number>; literal: Set<number> } {
  const open = new Set<number>();
  const literal = new Set<number>();
  // Once a fence of some length never closes, no longer one of that kind can.
  const unclosedFrom: Record<string, number> = { '`': Infinity, '~': Infinity };
  for (let i = 0; i < lines.length; i++) {
    const f = fenceOpener(lines[i]);
    if (!f || isSceneBreakText(lines[i])) continue;
    if ((f.ch === '~' && !TILDE_INFO_RE.test(f.info)) || f.len >= unclosedFrom[f.ch]) {
      literal.add(i);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !closesFence(f, lines[j])) j++;
    if (j < lines.length) {
      open.add(i);
      i = j;
    } else {
      unclosedFrom[f.ch] = f.len;
      literal.add(i);
    }
  }
  return { open, literal };
}

function parseMarkdown(md: string): ParsedMarkdown {
  const { data, body } = parseMarkdownFrontmatter(md);
  const lines = body.split('\n');
  const blocks: RichBlock[] = [];
  let para: Array<{ text: string; code: boolean }> = [];
  let fence: Fence | null = null;
  let droppedImages = 0;
  const fences = scanFences(lines);

  const flush = () => {
    if (para.length === 0) return;
    const kept: string[] = [];
    for (const p of para) {
      if (p.code) { kept.push(p.text); continue; }
      const { line, count } = dropImages(p.text);
      droppedImages += count;
      // A line that held nothing but images goes with them.
      if (count > 0 && !line.trim()) continue;
      kept.push(line);
    }
    para = [];
    const text = kept.join('\n');
    if (!text.trim()) return;
    blocks.push(markerParagraph(text) ?? { kind: 'markdown', text });
  };

  for (const [i, line] of lines.entries()) {
    if (fence) {
      para.push({ text: line, code: true });
      if (closesFence(fence, line)) fence = null;
      continue;
    }
    if (fences.open.has(i)) {
      fence = fenceOpener(line);
      para.push({ text: line, code: true });
      continue;
    }
    if (fences.literal.has(i)) {
      para.push({ text: line.replace(/^( {0,3})([`~])/, '$1\\$2'), code: false });
      continue;
    }
    if (!line.trim()) { flush(); continue; }

    const atx = ATX_RE.exec(line);
    if (atx) {
      flush();
      const level = atx[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = headingPlainText(atx[2] ?? '');
      if (!text || isSceneBreakText(text)) blocks.push({ kind: 'sceneBreak' });
      // Headings below ### never carry structure: they stay in the prose verbatim.
      else if (level >= 4) blocks.push({ kind: 'markdown', text: line.trim() });
      else blocks.push({ kind: 'heading', level, inlines: [{ text }] });
      continue;
    }

    const setext = SETEXT_RE.exec(line);
    if (setext && para.length === 1 && !para[0].code && !NOT_SETEXT_LINE_RE.test(para[0].text)) {
      const text = headingPlainText(para[0].text);
      const underline = setext[1][0];
      // `He left.` over `---` is a sentence and a scene break, not an H2.
      const titleLike = text.length > 0 && text.length <= 120 && (underline === '=' || !/[.!?…,;:"”’)]$/.test(text));
      if (titleLike) {
        para = [];
        blocks.push({ kind: 'heading', level: underline === '=' ? 1 : 2, inlines: [{ text }] });
        continue;
      }
    }

    if (THEMATIC_RE.test(line) || isSceneBreakText(line)) {
      flush();
      blocks.push({ kind: 'sceneBreak' });
      continue;
    }
    para.push({ text: line, code: false });
  }
  flush();
  return { frontmatter: data, body, blocks, droppedImages };
}

/**
 * Markdown → blocks. Strips YAML frontmatter and a BOM, normalizes line
 * endings. `#`–`###` and setext headings become heading blocks; `####` and
 * deeper stay in the prose. Scene-break lines (`***`, `---`, `* * *`, `#`,
 * `~~~`, `⁂` …) become sceneBreak blocks. Everything else is grouped into
 * blank-line-separated 'markdown' blocks, verbatim — lists, quotes, code
 * fences, `[[wiki links]]` and emphasis exactly as written. A fence that
 * never closes (or a `~~~` line with no language word) is escaped rather
 * than opened, so it can't swallow the rest of the book. Image embeds
 * (`![](…)`, `![[x.png]]`, `<img>`) are dropped: the images aren't imported.
 */
export function markdownTextToBlocks(md: string): RichBlock[] {
  return parseMarkdown(md).blocks;
}

function imagesWarning(n: number): string[] {
  if (n === 0) return [];
  return [`${n} image${n === 1 ? '' : 's'} in the manuscript ${n === 1 ? 'wasn’t' : 'weren’t'} imported — Mythos brings in the text only.`];
}

/** Decode a text file: UTF-8 unless a UTF-16 byte-order mark says otherwise. */
function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^\ufeff/, '');
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

// ─── One Markdown file ───────────────────────────────────────────────────────

/**
 * One .md file = one manuscript: `#` / `##` / `###` headings, "Chapter One"
 * lines or scene breaks give it chapters and scenes. A frontmatter `title:`
 * is the story title; otherwise the book's own title heading or the file name.
 */
export async function markdownFileToPlan(absPath: string, name: string): Promise<ImportPlan> {
  const doc = parseMarkdown(decodeText(await fs.promises.readFile(absPath)));
  const fmTitle = fmString(doc.frontmatter, 'title');
  const seg = segmentBlocks(doc.blocks, fmTitle
    ? { fallbackTitle: fmTitle, titleIsAuthoritative: true }
    : { fallbackTitle: stripExtension(name).trim() || 'Imported Story' });
  return {
    source: { kind: 'markdown', name },
    story: seg.story,
    notes: [],
    warnings: [...imagesWarning(doc.droppedImages), ...seg.warnings],
  };
}

// ─── Folder walk ─────────────────────────────────────────────────────────────

interface MdFile {
  /** Name with extension. */
  name: string;
  abs: string;
  /** POSIX path from the picked folder. */
  rel: string;
  size: number;
  text?: string;
}

interface DirNode {
  name: string;
  /** POSIX path from the picked folder, '' for the folder itself. */
  rel: string;
  files: MdFile[];
  dirs: DirNode[];
}

interface WalkStats {
  links: number;
  unsafe: number;
  attachments: number;
  oversize: number;
  tooDeep: number;
  overCount: number;
  overTotal: number;
  unreadable: number;
  truncated: boolean;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Numeric-aware name order ("2 …" before "10 …"), ties broken by code point. */
function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function extOf(name: string): string {
  return path.extname(name).replace(/^\./, '').toLowerCase();
}

async function walkFolder(root: string): Promise<{ tree: DirNode; files: MdFile[]; stats: WalkStats }> {
  const stats: WalkStats = {
    links: 0, unsafe: 0, attachments: 0, oversize: 0, tooDeep: 0, overCount: 0, overTotal: 0, unreadable: 0, truncated: false,
  };
  const files: MdFile[] = [];
  let entriesSeen = 0;
  let totalBytes = 0;

  const visit = async (abs: string, rel: string, name: string, depth: number): Promise<DirNode> => {
    const node: DirNode = { name, rel, files: [], dirs: [] };
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      stats.unreadable++;
      return node;
    }
    entries.sort((a, b) => naturalCompare(a.name, b.name));
    const isLogseqGraph = entries.some((e) => e.isDirectory() && LOGSEQ_GRAPH_DIRS.has(e.name.toLowerCase()));
    const inLogseqDir = name.toLowerCase() === 'logseq';
    for (const entry of entries) {
      if (stats.truncated) break;
      if (++entriesSeen > MAX_WALK_ENTRIES) { stats.truncated = true; break; }
      // Hidden files and folders (.obsidian, .DS_Store, .trash …) are app state, not writing.
      if (entry.name.startsWith('.')) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      // Dirent reports a link as a link (never what it points at): never followed.
      if (entry.isSymbolicLink()) { stats.links++; continue; }
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (SKIPPED_DIRS.has(lower)) continue;
        // Logseq's own folder beside pages/ and journals/ holds backups and settings, not notes.
        if ((lower === 'logseq' && isLogseqGraph) || (inLogseqDir && LOGSEQ_BACKUP_DIRS.has(lower))) continue;
        if (TEXTBUNDLE_RE.test(entry.name)) {
          await visitTextBundle(node, childAbs, rel, entry.name);
          continue;
        }
        if (depth + 1 > MARKDOWN_IMPORT_MAX_DEPTH) { stats.tooDeep++; continue; }
        node.dirs.push(await visit(childAbs, childRel, entry.name, depth + 1));
        continue;
      }
      if (!entry.isFile()) continue;
      if (classifyExtension(entry.name) === 'denied') { stats.unsafe++; continue; }
      if (!NOTE_EXTENSIONS.has(extOf(entry.name))) { stats.attachments++; continue; }
      await addFile(node, entry.name, childAbs, childRel);
    }
    return node;
  };

  const addFile = async (node: DirNode, fileName: string, fileAbs: string, fileRel: string): Promise<void> => {
    if (files.length >= MARKDOWN_IMPORT_MAX_FILES) { stats.overCount++; return; }
    let size: number;
    try {
      const st = await fs.promises.lstat(fileAbs);
      if (!st.isFile()) { stats.links++; return; }
      size = st.size;
    } catch {
      stats.unreadable++;
      return;
    }
    if (size > MARKDOWN_IMPORT_MAX_FILE_BYTES) { stats.oversize++; return; }
    if (totalBytes + size > MARKDOWN_IMPORT_MAX_TOTAL_BYTES) { stats.overTotal++; return; }
    totalBytes += size;
    const file: MdFile = { name: fileName, abs: fileAbs, rel: fileRel, size };
    node.files.push(file);
    files.push(file);
  };

  // A TextBundle is one note: "Mira.textbundle/text.md" reads as "Mira.md" in the bundle's folder.
  const visitTextBundle = async (node: DirNode, bundleAbs: string, parentRel: string, bundleName: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(bundleAbs, { withFileTypes: true });
    } catch {
      stats.unreadable++;
      return;
    }
    entriesSeen += entries.length;
    const textEntry = TEXTBUNDLE_TEXT_NAMES
      .map((n) => entries.find((e) => e.name.toLowerCase() === n))
      .find((e) => e !== undefined);
    const assets = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'assets');
    if (assets) {
      try {
        const inner = await fs.promises.readdir(path.join(bundleAbs, assets.name), { withFileTypes: true });
        entriesSeen += inner.length;
        stats.attachments += inner.filter((e) => e.isFile()).length;
      } catch {
        stats.unreadable++;
      }
    }
    if (!textEntry) { stats.unreadable++; return; }
    if (textEntry.isSymbolicLink()) { stats.links++; return; }
    if (!textEntry.isFile()) { stats.unreadable++; return; }
    const fileName = `${stripExtension(bundleName)}${path.extname(textEntry.name).toLowerCase()}`;
    await addFile(node, fileName, path.join(bundleAbs, textEntry.name), parentRel ? `${parentRel}/${fileName}` : fileName);
  };

  const tree = await visit(root, '', path.basename(root), 0);
  for (const file of files) {
    try {
      const buf = await fs.promises.readFile(file.abs);
      const text = decodeText(buf);
      // A NUL in UTF-8 text means a binary file wearing a .md name.
      if (text.includes('\0')) { stats.unreadable++; continue; }
      file.text = text;
    } catch {
      stats.unreadable++;
    }
  }
  return { tree, files, stats };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function walkWarnings(stats: WalkStats): string[] {
  const w: string[] = [];
  if (stats.truncated) {
    w.push(`This folder is very large — Mythos stopped looking after ${MAX_WALK_ENTRIES.toLocaleString('en-US')} files and folders. Import it in smaller parts.`);
  }
  if (stats.overCount > 0) {
    w.push(`This folder has more than ${MARKDOWN_IMPORT_MAX_FILES.toLocaleString('en-US')} Markdown files — only the first ${MARKDOWN_IMPORT_MAX_FILES.toLocaleString('en-US')} were included.`);
  }
  if (stats.oversize > 0) {
    w.push(`Skipped ${stats.oversize} ${plural(stats.oversize, 'file', 'files')} larger than ${MARKDOWN_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  if (stats.overTotal > 0) {
    w.push(`Skipped ${stats.overTotal} ${plural(stats.overTotal, 'file', 'files')} — the folder holds more than ${MARKDOWN_IMPORT_MAX_TOTAL_BYTES / (1024 * 1024)} MB of text.`);
  }
  if (stats.tooDeep > 0) {
    w.push(`Skipped ${stats.tooDeep} ${plural(stats.tooDeep, 'folder', 'folders')} nested more than ${MARKDOWN_IMPORT_MAX_DEPTH} levels deep.`);
  }
  if (stats.unsafe > 0) {
    w.push(`Skipped ${stats.unsafe} ${plural(stats.unsafe, 'file that isn’t', 'files that aren’t')} safe to import.`);
  }
  if (stats.links > 0) {
    w.push(`Skipped ${stats.links} linked ${plural(stats.links, 'file or folder', 'files or folders')} — Mythos doesn’t follow links out of the folder you picked.`);
  }
  if (stats.attachments > 0) {
    w.push(`${stats.attachments} ${plural(stats.attachments, 'attachment', 'attachments')} (images, PDFs and other files that aren’t Markdown) ${plural(stats.attachments, 'wasn’t', 'weren’t')} imported.`);
  }
  if (stats.unreadable > 0) {
    w.push(`${stats.unreadable} ${plural(stats.unreadable, 'file or folder', 'files or folders')} couldn’t be read and ${plural(stats.unreadable, 'was', 'were')} skipped.`);
  }
  return w;
}

// ─── Manuscript ──────────────────────────────────────────────────────────────

const MANUSCRIPT_DIR_RE = /^(?:manuscript|manuscripts|draft|drafts|chapters|story|book|novel)$/i;
/** "01 Opening", "1 - Opening", "Chapter 1", "Ch01", "Part 2", "Scene 3". */
const NUMBERED_NAME_RE = /^(?:(?:chapter|chap|ch|part|scene|sc)[\s._-]*)?\d{1,4}(?:[\s._)\-–—:]|$)/i;
/**
 * Daily notes are dated, not numbered: "2024-03-01", Logseq's "2024_03_01",
 * "2024.03.01", "20240301", and day- or month-first "01.03.2024" / "03-01-2024".
 */
const DATED_NAME_RE = /^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}(?:\D|$)|^\d{1,2}[-_.]\d{1,2}[-_.]\d{4}(?:\D|$)|^\d{8}(?:\D|$)/;
/** Notion export suffix: "Page 1a2b…(32 hex)". */
const NOTION_ID_RE = /\s+[0-9a-f]{32}$/i;

function cleanSegment(name: string): string {
  return name.replace(NOTION_ID_RE, '').trim() || name;
}

function isNumberedName(base: string): boolean {
  const b = cleanSegment(base);
  if (DATED_NAME_RE.test(b)) return false;
  return NUMBERED_NAME_RE.test(b) || matchChapterMarker(b) !== null;
}

/** "01 Opening" → "Opening"; "Chapter 1" and "Ch01" stay as they are. */
function chapterTitleFromName(base: string): string {
  const b = cleanSegment(base);
  const stripped = b.replace(/^\d{1,4}(?:\s*[-–—_.:)]\s*|\s+)(?=\S)/, '').trim();
  return /\p{L}/u.test(stripped) ? stripped : b;
}

function hasFiles(dir: DirNode): boolean {
  return dir.files.some((f) => f.text !== undefined) || dir.dirs.some(hasFiles);
}

type Entry = { file: MdFile } | { dir: DirNode };

function entryName(e: Entry): string {
  return 'file' in e ? stripExtension(e.file.name) : e.dir.name;
}

const NUMBER_WORD_VALUES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ROMAN_DIGITS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const ROMAN_NUMERAL_RE = /^(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

function romanValue(roman: string): number {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const v = ROMAN_DIGITS[roman[i]];
    const next = i + 1 < roman.length ? ROMAN_DIGITS[roman[i + 1]] : 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** The number a name tail starts with: "12 …", "XIV …", "Twenty-One …", "one hundred and five". */
function leadingNumber(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  const digits = /^\d{1,4}/.exec(t);
  if (digits) return Number(digits[0]);
  const roman = /^[ivxlcdm]+(?=$|[\s._:)\-–—])/.exec(t);
  if (roman && ROMAN_NUMERAL_RE.test(roman[0])) return romanValue(roman[0]);
  let total = 0;
  let seen = false;
  for (const word of t.split(/[^a-z]+/).filter(Boolean)) {
    if (seen && word === 'hundred') { total *= 100; continue; }
    if (seen && word === 'and') continue;
    if (!Object.prototype.hasOwnProperty.call(NUMBER_WORD_VALUES, word)) break;
    total += NUMBER_WORD_VALUES[word];
    seen = true;
  }
  return seen ? total : undefined;
}

const FRONT_MATTER_RE = /^(?:prologue|prelude|foreword|preface|introduction)\b/i;
const BACK_MATTER_RE = /^(?:epilogue|afterword|postscript|coda)\b/i;
/** "Chapter …", "Ch. …", "Part …", "Scene …"; the separator, if any, follows. */
const ORDER_PREFIX_RE = /^(?:chapter|chap|ch|part|book|act|scene|sc)(\.?[\s._-]*)/i;

/**
 * Where an entry sits in a manuscript: front matter (Prologue, Foreword …)
 * first, then entries by their number — digits, Roman numerals or words
 * ("01 Opening", "Chapter XIV", "Part Two") — then unnumbered entries, then
 * back matter (Epilogue, Afterword …). A leading number is the writer's own
 * order, so "00 Prologue" and "99 Epilogue" keep theirs.
 */
function orderKey(name: string): { rank: number; num: number } {
  const b = cleanSegment(name);
  if (/^\d/.test(b)) return { rank: 1, num: leadingNumber(b) ?? Infinity };
  const front = FRONT_MATTER_RE.exec(b);
  if (front) return { rank: 0, num: leadingNumber(b.slice(front[0].length)) ?? 0 };
  const back = BACK_MATTER_RE.exec(b);
  if (back) return { rank: 2, num: leadingNumber(b.slice(back[0].length)) ?? 0 };
  const prefix = ORDER_PREFIX_RE.exec(b);
  if (prefix) {
    const tail = b.slice(prefix[0].length);
    // "Ch01" needs no separator; "Chix" or "Actually" is not a number.
    const n = prefix[1] || /^\d/.test(tail) ? leadingNumber(tail) : undefined;
    if (n !== undefined) return { rank: 1, num: n };
  }
  return { rank: 1, num: Infinity };
}

function manuscriptCompare(a: string, b: string): number {
  const ka = orderKey(a);
  const kb = orderKey(b);
  if (ka.rank !== kb.rank) return ka.rank - kb.rank;
  if (ka.num !== kb.num) return ka.num < kb.num ? -1 : 1;
  return naturalCompare(a, b);
}

/** A folder's readable files and non-empty subfolders, in manuscript order. */
function entriesOf(dir: DirNode): Entry[] {
  const entries: Entry[] = [
    ...dir.files.filter((f) => f.text !== undefined).map((file) => ({ file })),
    ...dir.dirs.filter(hasFiles).map((d) => ({ dir: d })),
  ];
  return entries.sort((a, b) => manuscriptCompare(entryName(a), entryName(b)));
}

/**
 * A numbered chapter file ("01 Opening.md", "Chapter 1.md"), or a folder
 * named like a chapter or part ("Chapter 1/", "Part Two/", "Prologue/") — a
 * number alone doesn't make a folder a chapter ("01 Inbox/", "10 Projects/").
 */
function isChapterEntry(e: Entry): boolean {
  return 'file' in e ? isNumberedName(entryName(e)) : matchChapterMarker(cleanSegment(e.dir.name)) !== null;
}

function isMostlyNumbered(dir: DirNode): boolean {
  const entries = entriesOf(dir).filter((e) => !('dir' in e && entityTypeForFolder(e.dir.name)));
  const numbered = entries.filter(isChapterEntry).length;
  return numbered >= 2 && numbered * 2 > entries.length;
}

/**
 * The story's folder: a Manuscript/Drafts/Chapters/… folder at the first or
 * second level, else the first folder (the picked one included) whose
 * entries are mostly numbered like chapters. `numberedOnly` keeps a
 * numbered folder's unnumbered files and folders (README, Research/) as notes.
 */
function findManuscriptDir(tree: DirNode): { dir: DirNode; numberedOnly: boolean } | null {
  const level1 = tree.dirs.filter(hasFiles);
  const level2 = level1.flatMap((d) => d.dirs.filter(hasFiles));
  const named = [...level1, ...level2].find((d) => MANUSCRIPT_DIR_RE.test(cleanSegment(d.name)));
  if (named) return { dir: named, numberedOnly: false };
  const numbered = [tree, ...level1, ...level2].find((d) => !entityTypeForFolder(d.name) && isMostlyNumbered(d));
  return numbered ? { dir: numbered, numberedOnly: true } : null;
}

/** Every readable file under a folder, depth-first in manuscript order. */
function filesUnder(dir: DirNode): MdFile[] {
  return entriesOf(dir).flatMap((e) => ('file' in e ? [e.file] : filesUnder(e.dir)));
}

/**
 * One file → its title and scenes. A single heading on top at the file's
 * shallowest level is the file's own title; the next heading level down
 * starts scenes, and scene breaks split scenes as everywhere else.
 */
function fileScenes(doc: ParsedMarkdown, fallbackTitle: string): { title: string; scenes: ImportScene[]; warnings: string[] } {
  let blocks = doc.blocks;
  type Heading = Extract<RichBlock, { kind: 'heading' }>;
  const isStructural = (b: RichBlock): b is Heading => b.kind === 'heading' && b.level <= 3;
  let leadTitle: string | undefined;
  const structural = blocks.filter(isStructural);
  if (structural.length > 0) {
    const top = structural.reduce((min, h) => Math.min(min, h.level), Infinity);
    const atTop = structural.filter((h) => h.level === top);
    if (atTop.length === 1 && blocks[0] === atTop[0]) {
      leadTitle = atTop[0].inlines.map((r) => r.text).join('').trim() || undefined;
      blocks = blocks.slice(1);
    }
  }
  const title = fmString(doc.frontmatter, 'title') || leadTitle || fallbackTitle;
  const remaining = blocks.filter(isStructural);
  const sceneLevel = remaining.length > 0 ? remaining.reduce((min, h) => Math.min(min, h.level), Infinity) : 0;
  const lowered = blocks.map((b): RichBlock => {
    // Inside one file a "Chapter Two" line is just a line: the file is the chapter.
    if (b.kind === 'paragraph') return { kind: 'markdown', text: inlinesToMarkdown(b.inlines) };
    if (!isStructural(b)) return b;
    // The scene level becomes ##; anything deeper drops below ### so it stays in the prose.
    const level = b.level === sceneLevel ? 2 : Math.min(6, 4 + (b.level - sceneLevel - 1));
    return { ...b, level: level as Heading['level'] };
  });
  const seg = segmentBlocks([{ kind: 'heading', level: 1, inlines: [{ text: title }] }, ...lowered], {
    fallbackTitle: title,
    titleIsAuthoritative: true,
  });
  const scenes = seg.story.chapters.flatMap((c) => c.scenes).map((s, i) => ({ ...s, order: i }));
  // Per-file "no text" / "no chapters" notices would repeat for every file; the long-scene check stays.
  const warnings = seg.warnings.filter((w) => w.includes('single scene'));
  return { title, scenes, warnings };
}

function isPlainTextFile(file: MdFile): boolean {
  return PLAIN_TEXT_EXTENSIONS.has(extOf(file.name));
}

/**
 * A plain-text file read the way the .txt importer reads it: paragraphs as
 * text, so the segmenter escapes them — a tab-indented paragraph is not a
 * code block and a literal `*` is not emphasis.
 */
function parsePlainText(text: string): ParsedMarkdown {
  const body = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  return { frontmatter: {}, body, blocks: plainTextToBlocks(body), droppedImages: 0 };
}

function parsedOf(file: MdFile, cache: Map<MdFile, ParsedMarkdown>): ParsedMarkdown {
  let doc = cache.get(file);
  if (!doc) {
    doc = isPlainTextFile(file) ? parsePlainText(file.text ?? '') : parseMarkdown(file.text ?? '');
    cache.set(file, doc);
  }
  return doc;
}

function buildManuscript(
  found: { dir: DirNode; numberedOnly: boolean },
  storyTitle: string,
  cache: Map<MdFile, ParsedMarkdown>,
): { story: ImportStory | null; used: Set<MdFile>; warnings: string[]; droppedImages: number } {
  const used = new Set<MdFile>();
  const warnings: string[] = [];
  let droppedImages = 0;
  const chapters: ImportChapter[] = [];
  let partCount = 0;

  const fileChapter = (file: MdFile, prefix: string) => {
    const doc = parsedOf(file, cache);
    used.add(file);
    droppedImages += doc.droppedImages;
    const { title, scenes, warnings: w } = fileScenes(doc, chapterTitleFromName(stripExtension(file.name)));
    for (const x of w) warnings.push(x);
    chapters.push({ title: prefix ? `${prefix} · ${title}` : title, order: 0, scenes });
  };
  // A chapter folder: each file under it is a scene (a file with its own scene breaks gives several).
  const dirChapter = (dir: DirNode, prefix: string) => {
    const chapterTitle = chapterTitleFromName(dir.name);
    const scenes: ImportScene[] = [];
    for (const file of filesUnder(dir)) {
      const doc = parsedOf(file, cache);
      used.add(file);
      droppedImages += doc.droppedImages;
      const r = fileScenes(doc, chapterTitleFromName(stripExtension(file.name)));
      for (const x of r.warnings) warnings.push(x);
      for (const s of r.scenes) {
        const title = r.scenes.length === 1 || s.title === r.title ? r.title : `${r.title} · ${s.title}`;
        scenes.push({ ...s, title, order: scenes.length });
      }
    }
    chapters.push({ title: prefix ? `${prefix} · ${chapterTitle}` : chapterTitle, order: 0, scenes });
  };

  for (const entry of entriesOf(found.dir)) {
    if (found.numberedOnly && !isChapterEntry(entry)) continue;
    if ('file' in entry) {
      fileChapter(entry.file, '');
      continue;
    }
    const dir = entry.dir;
    // Character/location folders inside the manuscript folder are world notes, not chapters.
    if (entityTypeForFolder(dir.name)) continue;
    const loose = dir.files.some((f) => f.text !== undefined);
    if (!loose || matchChapterMarker(cleanSegment(dir.name))?.kind === 'part') {
      // A "Part One" folder, or a folder of chapter folders, is a part: "Part One · The Gate".
      partCount++;
      const partTitle = cleanSegment(dir.name);
      for (const sub of entriesOf(dir)) {
        if ('file' in sub) fileChapter(sub.file, partTitle);
        else dirChapter(sub.dir, partTitle);
      }
    } else {
      dirChapter(dir, '');
    }
  }

  if (chapters.length === 0) return { story: null, used, warnings, droppedImages };
  chapters.forEach((c, i) => {
    c.order = i;
    if (c.scenes.length === 0) c.scenes = [{ title: c.title, prose: '', order: 0 }];
  });
  return { story: { title: storyTitle, chapters, partCount, structure: 'files' }, used, warnings, droppedImages };
}

// ─── Notes and entities ──────────────────────────────────────────────────────

const ENTITY_TYPE_ALIASES: Record<string, ImportEntityType> = {
  character: 'character', person: 'character', people: 'character', npc: 'character',
  location: 'location', place: 'location', setting: 'location', city: 'location',
  faction: 'faction', organization: 'faction', organisation: 'faction', org: 'faction', group: 'faction', guild: 'faction',
  item: 'item', object: 'item', artifact: 'item', artefact: 'item', weapon: 'item',
  event: 'event',
  concept: 'concept',
};

/**
 * Folders that file a note as an entity. Generic names a research or app
 * folder also uses (History, Timeline, Settings, Systems, Magic, Groups,
 * Objects) are left out: there only a `type:` makes an entity.
 */
const ENTITY_FOLDERS: Record<string, ImportEntityType> = {
  characters: 'character', people: 'character', cast: 'character', npcs: 'character',
  locations: 'location', places: 'location', 'world map': 'location',
  factions: 'faction', organizations: 'faction', organisations: 'faction',
  items: 'item', artifacts: 'item', artefacts: 'item',
  events: 'event',
  concepts: 'concept', lore: 'concept',
};

function entityTypeForFolder(name: string): ImportEntityType | undefined {
  const key = cleanSegment(name).toLowerCase();
  return Object.prototype.hasOwnProperty.call(ENTITY_FOLDERS, key) ? ENTITY_FOLDERS[key] : undefined;
}

function entityTypeFromFrontmatter(fm: MarkdownFrontmatter): ImportEntityType | undefined {
  const raw = fmString(fm, 'type')?.toLowerCase();
  if (!raw) return undefined;
  return Object.prototype.hasOwnProperty.call(ENTITY_TYPE_ALIASES, raw) ? ENTITY_TYPE_ALIASES[raw] : undefined;
}

/** Keys the commit writer sets itself. */
const WRITER_KEYS = new Set(['id', 'title', 'type']);
/** The commit writer's frontmatter key rule (importCommit FM_KEY). */
const CARRY_KEY_RE = /^[A-Za-z0-9_-]+$/;

function carriedFrontmatter(fm: MarkdownFrontmatter): Record<string, string | string[]> | undefined {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (WRITER_KEYS.has(key.toLowerCase()) || !CARRY_KEY_RE.test(key)) continue;
    if (Array.isArray(value)) {
      const items = value.map((v) => v.trim()).filter(Boolean);
      if (items.length > 0) out[key] = items;
    } else if (value.trim()) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Plain text → a note body: escaped Markdown paragraphs, `* * *` for scene breaks. */
function plainTextNoteBody(text: string): string {
  const parts: string[] = [];
  for (const b of plainTextToBlocks(text)) {
    if (b.kind === 'paragraph') {
      const md = inlinesToMarkdown(b.inlines);
      if (md) parts.push(md);
    } else if (b.kind === 'sceneBreak') {
      parts.push('* * *');
    }
  }
  return parts.join('\n\n');
}

function fileToNote(file: MdFile): ImportNote {
  const doc = isPlainTextFile(file)
    ? { data: {} as MarkdownFrontmatter, body: plainTextNoteBody(file.text ?? '') }
    : parseMarkdownFrontmatter(file.text ?? '');
  const dirSegs = file.rel.split('/').slice(0, -1);
  // Only the note's own folder or a top-level one files it as an entity:
  // "Characters/Main/Mira.md" is a character, "Research/Events/Rome/x.md" is research.
  const entityType = entityTypeFromFrontmatter(doc.data)
    ?? (dirSegs.length > 0 ? entityTypeForFolder(dirSegs[dirSegs.length - 1]) ?? entityTypeForFolder(dirSegs[0]) : undefined);
  const title = fmString(doc.data, 'title') || cleanSegment(stripExtension(file.name)) || 'Untitled';
  const frontmatter = carriedFrontmatter(doc.data);
  return {
    title,
    folder: entityType ? '' : dirSegs.map(cleanSegment).join('/'),
    body: doc.body.replace(/^\n+/, ''),
    ...(entityType ? { entityType } : {}),
    ...(frontmatter ? { frontmatter } : {}),
  };
}

// ─── One Markdown folder ─────────────────────────────────────────────────────

/**
 * A folder of Markdown → a plan. A Manuscript/Drafts/Chapters/… folder (or a
 * folder of numbered files) becomes the story — chapter folders hold scene
 * files, otherwise each file is a chapter — titled after the picked folder.
 * Every other file is a note in its folder, or an entity when its `type:` (or
 * a Characters/Locations/… folder) says so. No manuscript → notes only.
 */
export async function markdownFolderToPlan(absDir: string, name: string): Promise<ImportPlan> {
  const { tree, files, stats } = await walkFolder(absDir);
  const cache = new Map<MdFile, ParsedMarkdown>();
  const warnings = walkWarnings(stats);

  let story: ImportStory | null = null;
  let used = new Set<MdFile>();
  const found = findManuscriptDir(tree);
  if (found) {
    const built = buildManuscript(found, cleanSegment(name).trim() || 'Imported Story', cache);
    story = built.story;
    used = built.used;
    for (const x of [...imagesWarning(built.droppedImages), ...built.warnings]) warnings.push(x);
  }

  const notes: ImportNote[] = [];
  for (const file of files) {
    if (file.text === undefined || used.has(file)) continue;
    notes.push(fileToNote(file));
  }
  return { source: { kind: 'markdown-folder', name }, story, notes, warnings };
}
