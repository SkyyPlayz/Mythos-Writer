// #1765 — Import hub rich-text core.
//
// Every manuscript importer (DOCX via mammoth HTML, Google Docs HTML, ePub
// XHTML, Scrivener RTF, plain text) lowers its source to the same flat list
// of RichBlocks. One segmenter turns blocks into chapters/scenes, and one
// serializer turns block inlines into the editor's Markdown dialect
// (frontend/src/lib/useRichEditor.ts — tiptap-markdown: **bold**, *italic*,
// <u>underline</u>, ~~strike~~ — or <strong>/<em>/<s> where CommonMark's
// flanking rules would leave a delimiter literal — blank-line paragraphs,
// `\`+newline hard breaks, ` {.center}` alignment suffix, backslash-escaped
// block syntax).
//
// Pure — no Electron, no fs.

import type { ImportChapter, ImportScene, ImportStory, StructureSource } from './types.js';

/** One run of text with the marks that apply to it. */
export interface RichInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** A hard line break (<br>, RTF \line) — `text` is ignored. */
  hardBreak?: boolean;
}

export type RichBlock =
  | {
      kind: 'heading';
      level: 1 | 2 | 3 | 4 | 5 | 6;
      inlines: RichInline[];
      /**
       * A part heading (Word "Part" style). Never a chapter or scene: the
       * segmenter folds it into the following chapter titles whatever its level.
       */
      part?: boolean;
    }
  /** The document title (Word/Google "Title" style, ePub dc:title). */
  | { kind: 'title'; inlines: RichInline[] }
  | { kind: 'paragraph'; inlines: RichInline[]; align?: 'center' | 'right' | 'justify' }
  /** An explicit scene separator (`***`, `#`, Scene Break style, plain <hr>). */
  | { kind: 'sceneBreak' }
  /** A hard page break. */
  | { kind: 'pageBreak' }
  /** An empty paragraph (kept so 2+ in a row can read as a scene break). */
  | { kind: 'empty' }
  /**
   * Prose that is ALREADY in the editor's Markdown dialect (a line/paragraph
   * from a .md source). Emitted verbatim by the serializer — never escaped.
   */
  | { kind: 'markdown'; text: string };

// ─── Inline serialization (editor Markdown dialect) ──────────────────────────

type MarkName = 'bold' | 'italic' | 'strike' | 'underline';

/** Nesting order, outermost first, for marks that start and end together. */
const MARK_ORDER: readonly MarkName[] = ['bold', 'italic', 'strike', 'underline'];
/** Delimiter form (underline has none in the editor dialect). */
const MARK_DELIM: Record<MarkName, string> = { bold: '**', italic: '*', strike: '~~', underline: '' };
/** HTML form: used when CommonMark's flanking rules would leave the delimiter literal. */
const MARK_TAG: Record<MarkName, string> = { bold: 'strong', italic: 'em', strike: 's', underline: 'u' };

interface Piece {
  text: string;
  marks: MarkName[];
}

/** One opened-and-closed stretch of a mark in the output. */
interface Span {
  mark: MarkName;
  html: boolean;
}

type Seg = { t: 'text'; md: string } | { t: 'mark'; span: Span; open: boolean; group: number };

const ALNUM = /[\p{L}\p{N}]/u;
// CommonMark / markdown-it character classes for delimiter flanking.
const MD_WHITESPACE = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/;
const MD_PUNCT = /^[\p{P}\p{S}]$/u;

function renderMark(s: Seg & { t: 'mark' }): string {
  if (!s.span.html) return MARK_DELIM[s.span.mark];
  return s.open ? `<${MARK_TAG[s.span.mark]}>` : `</${MARK_TAG[s.span.mark]}>`;
}

function firstChar(s: string): string {
  return String.fromCodePoint(s.codePointAt(0) ?? 0x20);
}

function lastChar(s: string): string {
  const c = s.charCodeAt(s.length - 1);
  return (c & 0xfc00) === 0xdc00 && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

function marksOf(r: RichInline): MarkName[] {
  return MARK_ORDER.filter((m) => r[m] === true);
}

function sameMarks(a: readonly MarkName[], b: readonly MarkName[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/** Append, merging into the previous piece when the marks match (Word splits runs on every rsid). */
function pushPiece(out: Piece[], text: string, marks: MarkName[]): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && sameMarks(last.marks, marks)) last.text += text;
  else out.push({ text, marks });
}

/**
 * Escape text so markdown-it reads it back as the same literal characters.
 * Mirrors prosemirror-markdown's `esc` (what the editor itself writes) plus
 * tiptap-markdown's `<`/`>` → entity step, and also guards `&entity;`
 * look-alikes, `1)` lists and `===` setext underlines.
 */
function escapeText(s: string, atLineStart: boolean): string {
  // An `_` between two letters/digits can't open or close emphasis, so
  // `snake_case` stays readable; anywhere else (`______`, `__main__`) it is escaped.
  let r = s.replace(/[`*\\~[\]_]/g, (m: string, i: number) =>
    m === '_' && i > 0 && i + 1 < s.length && ALNUM.test(s[i - 1]) && ALNUM.test(s[i + 1]) ? m : `\\${m}`);
  r = r.replace(/&(?=#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]*;)/gi, '&amp;');
  r = r.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (atLineStart) {
    r = r
      .replace(/^(\+(?= |$)|-|#)/, '\\$1')
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^(=+\s*)$/, '\\$1');
  }
  return r;
}

/** One hard-break-free line of inlines → Markdown. */
function lineToMarkdown(runs: RichInline[]): string {
  // 1. Normalize whitespace and merge identical-mark neighbours.
  const merged: Piece[] = [];
  for (const r of runs) pushPiece(merged, r.text.replace(/[\t\n\r\f\v\u00a0]/g, ' '), marksOf(r));
  for (const piece of merged) piece.text = piece.text.replace(/ {2,}/g, ' ');
  // Collapse spaces across run boundaries, then trim the line.
  let spaceBefore = true; // also trims the line start
  for (const piece of merged) {
    if (spaceBefore && piece.text.startsWith(' ')) piece.text = piece.text.slice(1);
    if (piece.text) spaceBefore = piece.text.endsWith(' ');
  }
  for (let i = merged.length - 1; i >= 0; i--) {
    merged[i].text = merged[i].text.replace(/ +$/, '');
    if (merged[i].text) break;
  }

  // 2. Move whitespace out of markers: a space keeps only the marks shared by
  //    its neighbours, so `**bold **` can never be written.
  const split: Array<Piece & { ws: boolean }> = [];
  for (const p of merged) {
    const m = /^( *)(.*?)( *)$/s.exec(p.text);
    if (!m) continue;
    if (m[1]) split.push({ text: m[1], marks: p.marks, ws: true });
    if (m[2]) split.push({ text: m[2], marks: p.marks, ws: false });
    if (m[3]) split.push({ text: m[3], marks: p.marks, ws: true });
  }
  const pieces: Piece[] = [];
  for (let i = 0; i < split.length; i++) {
    const p = split[i];
    if (!p.ws) {
      pushPiece(pieces, p.text, p.marks);
      continue;
    }
    let prev: MarkName[] | null = null;
    for (let j = i - 1; j >= 0; j--) if (!split[j].ws) { prev = split[j].marks; break; }
    let next: MarkName[] | null = null;
    for (let j = i + 1; j < split.length; j++) if (!split[j].ws) { next = split[j].marks; break; }
    const shared = prev && next ? prev.filter((m) => next.includes(m)) : [];
    pushPiece(pieces, p.text, shared);
  }

  // 3. Lay out open/close markers: keep marks that continue open, close from
  //    the top down to the first one that ends, open new ones with the one that
  //    runs furthest outermost (fixed order on ties) so a shorter mark can close
  //    without closing and reopening a longer one.
  const runEnd: Record<MarkName, number[]> = { bold: [], italic: [], strike: [], underline: [] };
  for (const m of MARK_ORDER) {
    for (let i = pieces.length - 1; i >= 0; i--) {
      runEnd[m][i] = !pieces[i].marks.includes(m) ? -1 : (runEnd[m][i + 1] ?? -1) >= 0 ? runEnd[m][i + 1] : i;
    }
  }
  const segs: Seg[] = [];
  let group = -1;
  let inGroup = false;
  const pushMark = (span: Span, open: boolean) => {
    if (!inGroup) { group++; inGroup = true; }
    segs.push({ t: 'mark', span, open, group });
  };
  const active: Span[] = [];
  pieces.forEach((p, i) => {
    let keep = 0;
    while (keep < active.length && p.marks.includes(active[keep].mark)) keep++;
    while (active.length > keep) pushMark(active.pop() as Span, false);
    const opening = MARK_ORDER
      .filter((m) => p.marks.includes(m) && !active.some((s) => s.mark === m))
      .sort((a, b) => runEnd[b][i] - runEnd[a][i]);
    for (const mark of opening) {
      const span: Span = { mark, html: mark === 'underline' };
      pushMark(span, true);
      active.push(span);
    }
    segs.push({ t: 'text', md: escapeText(p.text, segs.length === 0) });
    inGroup = false;
  });
  while (active.length) pushMark(active.pop() as Span, false);

  // 4. Pick each span's form: `**` / `*` / `~~` where markdown-it will read the
  //    delimiter as emphasis, the HTML tag where it would stay literal.
  resolveMarkForms(segs, group + 1);
  return segs.map((s) => (s.t === 'text' ? s.md : renderMark(s))).join('');
}

/**
 * CommonMark only reads a delimiter run as emphasis when it is left-flanking
 * (to open) or right-flanking (to close): `It was *over—*and` stays literal
 * because the closing `*` sits between punctuation and a letter. Such spans
 * switch to their HTML form (`<em>over—</em>and`), which tiptap-markdown
 * reads the same way. A run mixing closers and openers (`*a***b**`) is
 * ambiguous, so its openers switch too. Each marker group sits between two
 * text segments, so a switch only changes the two groups of that span.
 */
function resolveMarkForms(segs: Seg[], groupCount: number): void {
  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  segs.forEach((s, i) => { if (s.t === 'mark') groups[s.group].push(i); });
  const spanGroups = new Map<Span, number[]>();
  for (const s of segs) if (s.t === 'mark') spanGroups.set(s.span, [...(spanGroups.get(s.span) ?? []), s.group]);

  const charBefore = (i: number): string => {
    const s = segs[i - 1];
    if (!s) return ' ';
    return s.t === 'text' ? lastChar(s.md) : lastChar(renderMark(s));
  };
  const charAfter = (i: number): string => {
    const s = segs[i + 1];
    if (!s) return ' ';
    return s.t === 'text' ? firstChar(s.md) : firstChar(renderMark(s));
  };

  /** Spans in group `g` whose delimiter would not parse; empty when the group is fine. */
  const badSpans = (g: number): Span[] => {
    const idx = groups[g];
    const bad: Span[] = [];
    for (let k = 0; k < idx.length;) {
      const s = segs[idx[k]] as Seg & { t: 'mark' };
      if (s.span.html) { k++; continue; }
      // A run: consecutive delimiters made of the same character.
      const ch = MARK_DELIM[s.span.mark][0];
      let end = k;
      while (end + 1 < idx.length) {
        const n = segs[idx[end + 1]] as Seg & { t: 'mark' };
        if (n.span.html || MARK_DELIM[n.span.mark][0] !== ch) break;
        end++;
      }
      const run = idx.slice(k, end + 1).map((i) => segs[i] as Seg & { t: 'mark' });
      const before = charBefore(idx[k]);
      const after = charAfter(idx[end]);
      const lastWs = MD_WHITESPACE.test(before);
      const nextWs = MD_WHITESPACE.test(after);
      const lastPunct = MD_PUNCT.test(before);
      const nextPunct = MD_PUNCT.test(after);
      const leftFlanking = !nextWs && (!nextPunct || lastWs || lastPunct);
      const rightFlanking = !lastWs && (!lastPunct || nextWs || nextPunct);
      // A `*` run that could both open and close (`a*b`, `#*:`) gets paired by
      // markdown-it's "rule of 3" against the wrong neighbour, so `*` runs must
      // be one-sided. `~~` can't nest in itself, so a two-sided run is safe.
      const oneSided = ch !== '*' || leftFlanking !== rightFlanking;
      const openers = run.filter((r) => r.open);
      const closers = run.filter((r) => !r.open);
      if (openers.length && (closers.length || !leftFlanking || !oneSided)) for (const r of openers) bad.push(r.span);
      if (closers.length && (!rightFlanking || !oneSided)) for (const r of closers) bad.push(r.span);
      k = end + 1;
    }
    return bad;
  };

  const queue = groups.map((_, g) => g);
  const queued = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const g = queue[head];
    queued.delete(g);
    const bad = badSpans(g);
    for (const span of bad) {
      if (span.html) continue;
      span.html = true;
      for (const other of spanGroups.get(span) ?? []) {
        if (!queued.has(other)) { queue.push(other); queued.add(other); }
      }
    }
  }
}

/**
 * Inline runs → the editor's Markdown: `**bold**`, `*italic*`, `~~strike~~`,
 * `<u>underline</u>` (marks that start and end together nest in that order,
 * outermost first; otherwise the longer-running mark is outermost), the
 * `<strong>` / `<em>` / `<s>` form where a delimiter would not parse (`It was
 * <em>over—</em>and`), `\` + newline for a hard break, markdown-significant
 * text escaped.
 */
export function inlinesToMarkdown(inlines: RichInline[]): string {
  const lines: RichInline[][] = [[]];
  for (const r of inlines) {
    if (r.hardBreak) lines.push([]);
    else if (r.text) lines[lines.length - 1].push(r);
  }
  const out = lines.map(lineToMarkdown);
  // A hard break at either end of a paragraph has no Markdown form.
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\\\n');
}

/** Inline runs → plain text (marks dropped, hard breaks as spaces, whitespace collapsed). */
export function inlinesToPlainText(inlines: RichInline[]): string {
  return inlines
    .map((r) => (r.hardBreak ? ' ' : r.text))
    .join('')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/**
 * Blocks → scene prose: blank-line-separated paragraphs, ` {.center}`-style
 * alignment suffixes, `#### …` for headings left inside a scene, Markdown
 * blocks verbatim. Breaks, empties and title blocks are structure, not prose.
 */
export function blocksToProse(blocks: RichBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'paragraph': {
        const md = inlinesToMarkdown(b.inlines);
        if (md) parts.push(b.align ? `${md} {.${b.align}}` : md);
        break;
      }
      case 'heading': {
        const md = inlinesToMarkdown(b.inlines.map((r) => (r.hardBreak ? { text: ' ' } : r)));
        if (md) parts.push(`${'#'.repeat(b.level)} ${md}`);
        break;
      }
      case 'markdown': {
        const text = b.text.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
        if (text) parts.push(text);
        break;
      }
      default:
        break;
    }
  }
  return parts.join('\n\n');
}

// ─── Manuscript conventions ──────────────────────────────────────────────────

const SCENE_BREAK_SYMBOLS = /^[*#~⁂§—–\-•·◇◆◈❧☙✦✧❦※⸻=_+]{1,20}$/;
const SCENE_BREAK_WORDLIKE = /^(?:o0o|oOo|OoO|0o0|O0O|[xX](?: ?[xX]){2})$/;

/**
 * True when a whole paragraph is a scene-break marker (`***`, `* * *`, `#`,
 * `~`, `⁂`, `§`, `—`, `- - -`, `o0o`, `•••`, `❧`, `x x x` …). Never true for
 * a paragraph with real words in it.
 */
export function isSceneBreakText(text: string): boolean {
  const t = text.replace(/[\s\u00a0]+/g, ' ').trim();
  if (!t || t.length > 40) return false;
  if (SCENE_BREAK_WORDLIKE.test(t)) return true;
  return SCENE_BREAK_SYMBOLS.test(t.replace(/ /g, ''));
}

const ONES = 'one|two|three|four|five|six|seven|eight|nine';
const TEENS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const BELOW_100 = `(?:(?:${TENS})(?:[- ](?:${ONES}))?|${TEENS}|${ONES})`;
const NUMBER_WORDS = `(?:(?:${ONES}) hundred(?: (?:and )?${BELOW_100})?|${BELOW_100})`;
const ROMAN = '(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
const NUMBER = `(?:\\d{1,4}|${ROMAN}|${NUMBER_WORDS})`;
/** What may follow the number: nothing, or a separator and a short title. */
const TITLE_TAIL = '(?:\\s*[:.\\-–—]\\s*(.*))?';

const CHAPTER_RE = new RegExp(`^(?:chapter|chap\\.|ch\\.)\\s*${NUMBER}${TITLE_TAIL}$`, 'i');
const PART_RE = new RegExp(`^(?:part|book|act)\\s+${NUMBER}${TITLE_TAIL}$`, 'i');
const FRONT_RE = new RegExp(
  `^(?:prologue|epilogue|interlude|afterword|foreword|preface|introduction|postscript)(?:\\s+${NUMBER})?${TITLE_TAIL}$`,
  'i',
);

/**
 * Recognize a chapter-marker line: "Chapter One", "CHAPTER 1", "Chapter 12:
 * The Gate", "Ch. 3", "Prologue" (kind 'front' — still a chapter), "Part
 * Two", "Book II", "Act 1" (kind 'part'). Short lines only; a sentence such as
 * "Chapter one was hard to write." never matches.
 */
export function matchChapterMarker(text: string): { kind: 'chapter' | 'part' | 'front'; title: string } | null {
  const m = matchMarker(text);
  return m ? { kind: m.kind, title: m.title } : null;
}

function matchMarker(text: string): { kind: 'chapter' | 'part' | 'front'; title: string; tail: string } | null {
  const t = text.replace(/[\s\u00a0]+/g, ' ').trim();
  if (!t || t.length > 80) return null;
  const tries: Array<['chapter' | 'part' | 'front', RegExp]> = [['chapter', CHAPTER_RE], ['part', PART_RE], ['front', FRONT_RE]];
  for (const [kind, re] of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const tail = (m[1] ?? '').trim();
    // A long tail, or one ending like a sentence, is prose that happens to start "Chapter 3." …
    const tailWords = tail ? tail.split(' ').length : 0;
    if (tailWords > 10 || (/[.!?]$/.test(tail) && tailWords > 6)) return null;
    return { kind, title: t.replace(/\s*[:.\-–—]\s*$/, ''), tail };
  }
  return null;
}

// ─── Segmentation ────────────────────────────────────────────────────────────

/** Bare chapter numbers ("7", "IV") — only trusted with a layout signal (centered, bold, after a page break). */
const BARE_NUMBER_RE = /^(?:\d{1,3}|(?=[IVXLC])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))\.?$/;
/** Bare spelled-out chapter numbers ("ONE", "Twenty-Three") — same signal rule. */
// No trailing period: "One." alone after a page break is more likely a line of prose.
const BARE_NUMBER_WORD_RE = new RegExp(`^${NUMBER_WORDS}$`, 'i');
/** A single scene this long probably lost its scene breaks. */
const LARGE_SCENE_WORDS = 20000;
/** One-chapter imports shorter than this are fine as they are (a short story). */
const NO_STRUCTURE_WARN_WORDS = 3000;
/** A page-break chunk this long reads as a chapter. */
const PAGE_CHUNK_MIN_WORDS = 150;
/** Text before the first chapter up to this long is a title page / dedication, not a story chapter. */
const FRONT_MATTER_MAX_WORDS = 250;
export const FRONT_MATTER_TITLE = 'Front Matter';

type Item =
  | { t: 'heading'; level: number; part: boolean; text: string; block: RichBlock }
  | { t: 'content'; block: RichBlock; text: string }
  | { t: 'empty' }
  | { t: 'scene' }
  | { t: 'page' };

type Struct =
  | { t: 'part'; title: string }
  | { t: 'chapter'; title: string }
  | { t: 'scene'; title: string }
  | { t: 'content'; block: RichBlock }
  | { t: 'break' };

interface SceneDraft {
  title?: string;
  blocks: RichBlock[];
  /** Started by a scene/page break rather than the chapter start. */
  byBreak: boolean;
}

interface ChapterDraft {
  title: string;
  scenes: SceneDraft[];
  /** Opened for text that came before any chapter marker (title page, dedication…). */
  implicit?: boolean;
}

function blockText(b: RichBlock): string {
  if (b.kind === 'markdown') return b.text;
  if (b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'title') return inlinesToPlainText(b.inlines);
  return '';
}

/** A title page's first line can name the book: short, no sentence end, not a byline. */
function isTitleLikeLine(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80 || t.split(/\s+/).length > 10) return false;
  if (/[.!?…,;:]$/.test(t) && !/\.\.\.$/.test(t)) return false;
  if (/^(?:by|a novel|a story|a novella|copyright|©|for\b|dedicated|draft|version|v\d)/i.test(t)) return false;
  return !matchChapterMarker(t);
}

const TITLE_SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "THE LANTERN ROAD" → "The Lantern Road"; any other casing is the author's and stays. */
function tidyTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase() || t === t.toLowerCase()) return t;
  return t.toLowerCase().split(' ').map((w, i) => (
    i > 0 && TITLE_SMALL_WORDS.has(w) ? w : w.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, c: string) => pre + c.toUpperCase())
  )).join(' ');
}

function countWords(s: string): number {
  return (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function allMarked(b: RichBlock, mark: 'bold' | 'italic'): boolean {
  if (b.kind !== 'paragraph') return false;
  const runs = b.inlines.filter((r) => !r.hardBreak && r.text.trim());
  return runs.length > 0 && runs.every((r) => r[mark] === true);
}

/** Blocks → items: first title pulled out, empties/scene-break text classified. */
function toItems(blocks: RichBlock[]): { items: Item[]; titleText?: string } {
  const items: Item[] = [];
  let titleText: string | undefined;
  for (const b of blocks) {
    switch (b.kind) {
      case 'title': {
        const text = inlinesToPlainText(b.inlines);
        if (!text) break;
        if (titleText === undefined) titleText = text;
        else items.push({ t: 'content', block: { kind: 'paragraph', inlines: b.inlines }, text });
        break;
      }
      case 'heading': {
        const text = inlinesToPlainText(b.inlines);
        if (!text) items.push({ t: 'empty' });
        else if (isSceneBreakText(text)) items.push({ t: 'scene' });
        else items.push({ t: 'heading', level: b.level, part: b.part === true, text, block: b });
        break;
      }
      case 'paragraph': {
        const text = inlinesToPlainText(b.inlines);
        if (!text) items.push({ t: 'empty' });
        else if (isSceneBreakText(text)) items.push({ t: 'scene' });
        else items.push({ t: 'content', block: b, text });
        break;
      }
      case 'markdown': {
        const text = b.text.trim();
        if (!text) items.push({ t: 'empty' });
        else if (isSceneBreakText(text)) items.push({ t: 'scene' });
        else items.push({ t: 'content', block: b, text });
        break;
      }
      case 'sceneBreak': items.push({ t: 'scene' }); break;
      case 'pageBreak': items.push({ t: 'page' }); break;
      case 'empty': items.push({ t: 'empty' }); break;
    }
  }
  return { items, titleText };
}

/**
 * Decide which runs of empty paragraphs are scene breaks. Many manuscripts
 * put an empty paragraph between EVERY paragraph (manual double spacing), so
 * the usual gap is measured first: only runs longer than the usual gap, at
 * least two long, and clearly rarer than ordinary gaps count. All other
 * empties go.
 */
function resolveEmpties(items: Item[]): Item[] {
  const gaps: number[] = [];
  const runs: Array<{ start: number; len: number }> = [];
  let last: 'none' | 'content' | 'other' = 'none';
  let runStart = -1;
  let runLen = 0;
  items.forEach((it, i) => {
    if (it.t === 'empty') {
      if (runLen === 0) runStart = i;
      runLen++;
      return;
    }
    if (it.t === 'content' && last === 'content') {
      gaps.push(runLen);
      if (runLen > 0) runs.push({ start: runStart, len: runLen });
    }
    last = it.t === 'content' ? 'content' : 'other';
    runLen = 0;
  });

  const freq = new Map<number, number>();
  for (const g of gaps) freq.set(g, (freq.get(g) ?? 0) + 1);
  let usual = 0;
  let best = -1;
  for (const [g, n] of [...freq.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > best) { usual = g; best = n; }
  }
  const threshold = Math.max(2, usual + 1);
  let candidates = runs.filter((r) => r.len >= threshold);
  // "Rarer than spacing": at most one gap in three may be a scene break.
  if (candidates.length * 3 > gaps.length) candidates = [];
  // A single-spaced manuscript whose writer leaves one empty paragraph between
  // scenes: when every gap of any length is rare (one in five at most), each is a break.
  if (usual === 0 && runs.length > 0 && runs.length * 5 <= gaps.length) candidates = runs;
  const breakStarts = new Set(candidates.map((r) => r.start));

  const out: Item[] = [];
  items.forEach((it, i) => {
    if (it.t !== 'empty') out.push(it);
    else if (breakStarts.has(i)) out.push({ t: 'scene' });
  });
  return out;
}

function proseWords(items: Item[]): number {
  let n = 0;
  for (const it of items) if (it.t === 'content') n += countWords(it.text);
  return n;
}

/** A short, title-like line right after a bare chapter marker ("CHAPTER ONE" / "The Gate"). */
function isSubtitleLine(it: Item | undefined): it is Item & { t: 'content' } {
  if (!it || it.t !== 'content' || it.block.kind !== 'paragraph') return false;
  const t = it.text;
  if (t.length > 60 || /[.!?…,;:"”’)]$/.test(t) || matchChapterMarker(t)) return false;
  const centered = it.block.align === 'center';
  const caps = /\p{L}.*\p{L}/u.test(t) && t === t.toUpperCase() && t !== t.toLowerCase();
  return centered || caps || allMarked(it.block, 'bold');
}

type Marker = { role: 'chapter' | 'part'; title: string; hasTail: boolean };

function findMarkers(items: Item[]): Map<number, Marker> {
  const markers = new Map<number, Marker>();
  items.forEach((it, i) => {
    if (it.t !== 'content' || it.block.kind !== 'paragraph') return;
    const m = matchMarker(it.text);
    if (m) {
      markers.set(i, { role: m.kind === 'part' ? 'part' : 'chapter', title: m.title, hasTail: m.tail !== '' });
      return;
    }
    if (BARE_NUMBER_RE.test(it.text) || BARE_NUMBER_WORD_RE.test(it.text)) {
      const prev = items[i - 1];
      const signal = it.block.align === 'center' || allMarked(it.block, 'bold') || prev?.t === 'page';
      if (signal) markers.set(i, { role: 'chapter', title: it.text.replace(/\.$/, ''), hasTail: false });
    }
  });
  return markers;
}

function walk(structs: Struct[], implicitChapterTitle: string): { chapters: ChapterDraft[]; partCount: number } {
  const chapters: ChapterDraft[] = [];
  let ch: ChapterDraft | null = null;
  let sc: SceneDraft | null = null;
  let part = '';
  let partCount = 0;
  let nextByBreak = false;
  const openChapter = (title: string, implicit = false): ChapterDraft => {
    const c: ChapterDraft = { title, scenes: [], ...(implicit ? { implicit: true } : {}) };
    chapters.push(c);
    sc = null;
    nextByBreak = false;
    return c;
  };
  for (const s of structs) {
    switch (s.t) {
      case 'part':
        part = s.title;
        partCount++;
        ch = null;
        sc = null;
        break;
      case 'chapter':
        ch = openChapter(part ? `${part} · ${s.title}` : s.title);
        break;
      case 'scene':
        if (!ch) ch = openChapter(part || implicitChapterTitle, !part);
        sc = { title: s.title, blocks: [], byBreak: false };
        ch.scenes.push(sc);
        nextByBreak = false;
        break;
      case 'break':
        if (sc) { sc = null; nextByBreak = true; }
        break;
      case 'content':
        if (!ch) ch = openChapter(part || implicitChapterTitle, !part);
        if (!sc) {
          sc = { blocks: [], byBreak: nextByBreak && ch.scenes.length > 0 };
          ch.scenes.push(sc);
          nextByBreak = false;
        }
        sc.blocks.push(s.block);
        break;
    }
  }
  return { chapters, partCount };
}

/**
 * Blocks → chapters and scenes. Structure comes from, in order: heading
 * styles (the storyImport.splitStoryMarkdown level rules), "Chapter One" /
 * "Prologue" / "Part Two" lines, hard page breaks, else one chapter. Inside a
 * chapter, scene breaks (`***`, Scene Break style, `<hr>`, runs of empty
 * paragraphs longer than the document's usual spacing, leftover page breaks)
 * start new scenes.
 */
export function segmentBlocks(
  blocks: RichBlock[],
  opts: {
    fallbackTitle: string;
    titleIsAuthoritative?: boolean;
    /** Every page break is a chapter boundary, however short the pages (ePub spine documents). */
    pageBreaksAreChapters?: boolean;
  },
): { story: ImportStory; warnings: string[] } {
  const warnings: string[] = [];
  const { items: rawItems, titleText } = toItems(blocks);
  const items = resolveEmpties(rawItems);
  const fallbackTitle = opts.fallbackTitle.trim() || 'Untitled';
  let storyTitle = opts.titleIsAuthoritative ? fallbackTitle : (titleText ?? fallbackTitle);
  // Where storyTitle came from. A title page's first line beats only a guess
  // (the file name, or the first chapter heading standing in for a title).
  type TitleSource = 'fallback' | 'titleBlock' | 'titleHeading' | 'firstChapterHeading' | 'authoritative';
  let titleSource: TitleSource = opts.titleIsAuthoritative ? 'authoritative' : titleText !== undefined ? 'titleBlock' : 'fallback';
  const canTakeHeadingTitle = !opts.titleIsAuthoritative && titleText === undefined;
  /** The first text of a title page, when it reads like a book title and only a guess names the book. */
  const titlePageTitle = (texts: Iterable<string>): string | undefined => {
    if (titleSource !== 'fallback' && titleSource !== 'firstChapterHeading') return undefined;
    for (const t of texts) {
      if (!t.trim()) continue;
      return isTitleLikeLine(t) ? tidyTitle(t) : undefined;
    }
    return undefined;
  };
  const implicitTitle = titleText && !opts.titleIsAuthoritative ? titleText : fallbackTitle;

  // ── 1. Heading styles ──
  const structural = items.filter((it): it is Item & { t: 'heading' } => it.t === 'heading' && (it.part || it.level <= 3));
  const levels = new Set(structural.filter((h) => !h.part).map((h) => h.level));
  const h1Count = structural.filter((h) => !h.part && h.level === 1).length;
  // One H1 on top of H2 chapters + H3 scenes is the book's title, not a part
  // (unless it reads "Part One" / "Chapter 1").
  const titleHeading = h1Count === 1 && levels.has(2) && levels.has(3) && structural[0].level === 1 && !structural[0].part
    && !matchChapterMarker(structural[0].text)
    ? structural[0]
    : undefined;
  if (titleHeading) levels.delete(1);
  const h1 = levels.has(1);
  const h2 = levels.has(2);
  const h3 = levels.has(3);
  const role = new Map<number, 'part' | 'chapter' | 'scene'>();
  let firstChapterIsTitle = false;
  // Heading texts can say what the levels mean: "Part One" headings over
  // "Chapter 1" headings are parts over chapters, whatever their levels.
  const sortedLevels = [...levels].sort((a, b) => a - b);
  const textsAt = (level: number) => structural
    .filter((hd) => !hd.part && hd !== titleHeading && hd.level === level)
    .map((hd) => hd.text);
  const mostly = (texts: string[], kinds: readonly string[]) =>
    texts.length > 0 && texts.filter((t) => kinds.includes(matchChapterMarker(t)?.kind ?? '')).length * 2 > texts.length;
  if (sortedLevels.length >= 2 && mostly(textsAt(sortedLevels[0]), ['part']) && mostly(textsAt(sortedLevels[1]), ['chapter', 'front'])) {
    role.set(sortedLevels[0], 'part').set(sortedLevels[1], 'chapter');
    if (sortedLevels.length >= 3) role.set(sortedLevels[2], 'scene');
  } else if (h1 && h2 && h3) {
    role.set(1, 'part').set(2, 'chapter').set(3, 'scene');
  } else if (h1 && h2) {
    role.set(1, 'chapter').set(2, 'scene');
    firstChapterIsTitle = true;
  } else if (h1 && h3) {
    role.set(1, 'chapter').set(3, 'scene');
    firstChapterIsTitle = true;
  } else if (h2 && h3) {
    role.set(2, 'chapter').set(3, 'scene');
    firstChapterIsTitle = !titleHeading;
  } else {
    for (const l of levels) role.set(l, 'chapter');
    firstChapterIsTitle = h1;
  }
  // "Part Two" among chapter headings of the same level (all Heading 1) is a part.
  const isPartText = (t: string) => matchChapterMarker(t)?.kind === 'part';
  const chapterTexts = structural
    .filter((hd) => !hd.part && hd !== titleHeading && role.get(hd.level) === 'chapter')
    .map((hd) => hd.text);
  const partsByText = chapterTexts.some(isPartText) && chapterTexts.some((t) => !isPartText(t));
  const roleOf = (hd: Item & { t: 'heading' }): 'part' | 'chapter' | 'scene' => {
    if (hd.part) return 'part';
    const r = role.get(hd.level) ?? 'chapter';
    return r === 'chapter' && partsByText && isPartText(hd.text) ? 'part' : r;
  };
  const headingChapters = structural.filter((hd) => hd !== titleHeading && roleOf(hd) === 'chapter').length;

  const markers = findMarkers(items);
  const markerChapters = [...markers.values()].filter((m) => m.role === 'chapter').length;

  let structure: StructureSource = 'none';
  const structs: Struct[] = [];

  // Headings win unless "Chapter …" lines outnumber the chapter headings (a
  // manuscript typed in Normal style with a styled title or an "Acknowledgements"
  // heading).
  const useHeadings = structural.length > 0
    && !(markerChapters >= 2 && (headingChapters <= 1 || markerChapters > headingChapters));
  if (useHeadings) {
    structure = 'headings';
    if (titleHeading && canTakeHeadingTitle) {
      storyTitle = titleHeading.text;
      titleSource = 'titleHeading';
    }
    let titleTaken = false;
    for (const it of items) {
      if (it === titleHeading) continue;
      if (it.t === 'heading' && (it.part || it.level <= 3)) {
        const r = roleOf(it);
        if (r === 'chapter' && firstChapterIsTitle && canTakeHeadingTitle && !titleTaken) {
          // "Chapter One" / "Prologue" is never the book's name: keep the file name.
          if (!matchChapterMarker(it.text)) {
            storyTitle = it.text;
            titleSource = 'firstChapterHeading';
          }
          titleTaken = true;
        }
        structs.push({ t: r, title: it.text });
      } else if (it.t === 'heading' || it.t === 'content') {
        structs.push({ t: 'content', block: it.block });
      } else if (it.t === 'scene' || it.t === 'page') {
        structs.push({ t: 'break' });
      }
    }
  } else if (markerChapters >= 2) {
    // ── 2. "Chapter One" / "Prologue" / "Part Two" lines ──
    structure = 'patterns';
    let firstMarker = Infinity;
    for (const k of markers.keys()) firstMarker = Math.min(firstMarker, k);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const marker = markers.get(i);
      if (marker) {
        let title = marker.title;
        if (!marker.hasTail && isSubtitleLine(items[i + 1]) && !markers.has(i + 1)) {
          title = `${title}: ${(items[i + 1] as Item & { t: 'content' }).text}`;
          i++;
        }
        structs.push({ t: marker.role, title });
      } else if (it.t === 'heading') {
        const headingMarker = matchChapterMarker(it.text);
        if (headingMarker) {
          // One chapter styled as a heading among typed "Chapter …" lines.
          structs.push({ t: headingMarker.kind === 'part' ? 'part' : 'chapter', title: headingMarker.title });
        } else if (i < firstMarker && it === structural[0] && canTakeHeadingTitle) {
          // The first heading, above every marker, is the book title.
          storyTitle = it.text;
          titleSource = 'titleHeading';
        } else {
          structs.push({ t: 'content', block: it.block });
        }
      } else if (it.t === 'content') {
        structs.push({ t: 'content', block: it.block });
      } else if (it.t === 'scene' || it.t === 'page') {
        structs.push({ t: 'break' });
      }
    }
  } else {
    // ── 3. Hard page breaks ──
    const chunks: Item[][] = [[]];
    for (const it of items) {
      if (it.t === 'page') chunks.push([]);
      else chunks[chunks.length - 1].push(it);
    }
    const filled = chunks.filter((c) => proseWords(c) > 0 || c.some((it) => it.t === 'heading'));
    const substantial = filled.filter((c) => proseWords(c) >= PAGE_CHUNK_MIN_WORDS).length;
    const pagesAreChapters = opts.pageBreaksAreChapters
      ? filled.length >= 2
      : filled.length >= 3 && substantial >= 2 && substantial * 2 >= filled.length;
    if (pagesAreChapters) {
      structure = 'pagebreaks';
      // A short first page before real chapters is a title page / dedication
      // (unless it opens with a "Chapter …" / "Prologue" line). Short means
      // within FRONT_MATTER_MAX_WORDS and too short to count as a chapter
      // page itself (PAGE_CHUNK_MIN_WORDS): a 200-word first page of prose
      // stays Chapter 1.
      const chunkTexts = (c: Item[]) => c.flatMap((it) => (it.t === 'heading' || it.t === 'content' ? [it.text] : []));
      const firstTexts = chunkTexts(filled[0]);
      const firstWords = firstTexts.reduce((n, t) => n + countWords(t), 0);
      const frontPage = filled.length >= 2
        && firstWords <= FRONT_MATTER_MAX_WORDS
        && firstWords < PAGE_CHUNK_MIN_WORDS
        && filled.slice(1).some((c) => proseWords(c) >= PAGE_CHUNK_MIN_WORDS)
        && !(firstTexts.length > 0 && matchChapterMarker(firstTexts[0]));
      if (frontPage) {
        const named = titlePageTitle(firstTexts);
        if (named) { storyTitle = named; titleSource = 'titleBlock'; }
      }
      filled.forEach((chunk, ci) => {
        const n = frontPage ? ci : ci + 1;
        structs.push({ t: 'chapter', title: n === 0 ? FRONT_MATTER_TITLE : `Chapter ${n}` });
        for (const it of chunk) {
          if (it.t === 'heading' || it.t === 'content') structs.push({ t: 'content', block: it.block });
          else if (it.t === 'scene') structs.push({ t: 'break' });
        }
      });
    } else {
      // ── 4. One chapter ──
      for (const it of items) {
        if (it.t === 'heading' || it.t === 'content') structs.push({ t: 'content', block: it.block });
        else if (it.t === 'scene' || it.t === 'page') structs.push({ t: 'break' });
      }
    }
  }

  const { chapters: drafts, partCount } = walk(structs, structure === 'none' ? storyTitle : implicitTitle);

  // A short run of text before the first real chapter is the title page /
  // dedication of a manuscript typed in Normal style. Keep every word, but as
  // "Front Matter" rather than a chapter named after the file — and when the
  // book has no Title-style line, its first title-like line names the book.
  const front = drafts[0];
  if (structure !== 'none' && front?.implicit && drafts.length > 1 && front.scenes.every((sc) => sc.title === undefined)) {
    const frontBlocks = front.scenes.flatMap((sc) => sc.blocks);
    const frontWords = frontBlocks.reduce((n, b) => n + countWords(blockText(b)), 0);
    if (frontWords <= FRONT_MATTER_MAX_WORDS) {
      front.title = FRONT_MATTER_TITLE;
      // A title-like first line beats the file name or a first chapter
      // heading standing in for the title — never a Title block, a lone
      // title heading or an authoritative title.
      const named = titlePageTitle(frontBlocks.map(blockText));
      if (named) { storyTitle = named; titleSource = 'titleBlock'; }
    }
  }

  // ── Assemble ──
  let chapters: ImportChapter[] = drafts.map((d) => {
    const withProse = d.scenes
      .map((s) => ({ ...s, prose: blocksToProse(s.blocks) }))
      .filter((s) => s.title !== undefined || s.prose !== '');
    const anyBreakScene = withProse.some((s) => s.title === undefined && s.byBreak);
    const scenes: ImportScene[] = withProse.map((s, i) => ({
      title: s.title ?? (i === 0 && !s.byBreak && !anyBreakScene ? d.title : `Scene ${i + 1}`),
      prose: s.prose,
      order: i,
    }));
    return { title: d.title, order: 0, scenes };
  });
  const nonEmpty = chapters.filter((c) => c.scenes.length > 0);
  if (nonEmpty.length > 0) chapters = nonEmpty;
  if (chapters.length === 0) {
    chapters = [{ title: storyTitle, order: 0, scenes: [{ title: storyTitle, prose: '', order: 0 }] }];
  }
  chapters.forEach((c, i) => { c.order = i; });

  // ── Plain-words warnings ──
  const total = chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + countWords(s.prose), 0), 0);
  if (total === 0) {
    warnings.push('This document has no text to import.');
  } else if (structure === 'none' && total >= NO_STRUCTURE_WARN_WORDS) {
    warnings.push(
      'Mythos couldn’t find chapters in this document (no chapter headings, “Chapter …” lines or page breaks), '
      + 'so it will come in as one chapter. You can split it after importing.',
    );
  }
  let bigScenes = 0;
  for (const c of chapters) {
    for (const s of c.scenes) {
      const words = countWords(s.prose);
      if (words < LARGE_SCENE_WORDS) continue;
      if (bigScenes++ < 3) {
        warnings.push(
          `“${c.title}” has a single scene of about ${Math.round(words / 1000) * 1000} words — `
          + 'check that its scene breaks came through.',
        );
      }
    }
  }

  return { story: { title: storyTitle, chapters, partCount, structure }, warnings };
}
