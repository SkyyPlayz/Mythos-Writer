// #1765 — Rich Text (.rtf) → RichBlocks, and the standalone .rtf importer.
//
// A real RTF reader, not a tag stripper: a group stack carries the character
// state (\b \i \ul \strike \v, the current font) and paragraph properties
// (\qc \qr \qj, \outlinelevel, \pagebb) so `}` restores them; \par / Cocoa's
// `\`+newline end paragraphs, \page / \sect are page breaks, \line is a hard
// break. Text is decoded with the document codepage (\ansicpg, default
// Windows-1252 — so \'93 \'94 are smart quotes, not C1 controls) or a font's
// \fcharset, \uN honours the \ucN fallback count. Metadata destinations
// (fonttbl, colortbl, stylesheet, info, pictures, objects, headers/footers,
// field instructions, every {\* …}) are skipped; a field's \fldrslt text is
// kept. Footnotes, annotations and Scrivener inline notes/footnotes are
// dropped and counted so the importer can say so.
//
// Mac Scrivener / TextEdit (Cocoa) RTF often says italic by switching to an
// "…-Italic" font, so a font whose name says Bold/Italic/Oblique implies the
// mark.
//
// parseRtf / rtfToBlocks are pure (they throw ImportUserError on a damaged
// file). rtfFileToPlan reads one file.

import fs from 'fs';
import { isSceneBreakText, segmentBlocks, type RichBlock, type RichInline } from './blocks.js';
import type { ImportPlan } from './types.js';
import { ImportUserError } from './importErrors.js';

/** Upstream (importSafety) caps sources at 50 MB; re-checked before reading. */
export const RTF_FILE_MAX_BYTES = 50 * 1024 * 1024;
/** Real documents nest a handful of groups; past this the file is damaged (or hostile). */
export const MAX_RTF_GROUP_DEPTH = 1000;

export { ImportUserError } from './importErrors.js';

export const RTF_DAMAGED_MESSAGE = 'This RTF file is damaged — Mythos can\'t read it. Re-save it from your word processor and try again.';

export interface RtfParseResult {
  blocks: RichBlock[];
  /** Footnotes / endnotes whose text was left out. */
  droppedFootnotes: number;
  /** Comments, annotations and Scrivener inline annotations left out. */
  droppedAnnotations: number;
  /** Embedded pictures / objects left out. */
  droppedImages: number;
}

type Align = 'center' | 'right' | 'justify';

interface GroupState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** \v hidden text and \deleted revisions — never shown, never imported. */
  hidden: boolean;
  font: number | null;
  /** \ucN — how many fallback characters follow each \uN. */
  uc: number;
  align: Align | undefined;
  /** \outlinelevelN (0-based) — Word writes it on heading-style paragraphs. */
  outline: number | undefined;
  /** \sN — the paragraph style; its stylesheet entry may make it a heading. */
  style: number | undefined;
  /** \pagebb — "page break before" on this paragraph. */
  pageBreakBefore: boolean;
  /** Inside a destination that is skipped entirely. */
  skip: boolean;
  /** Inside the font table (font names are read, not shown). */
  fontTable: boolean;
  /** Inside the stylesheet (style names and outline levels are read, not shown). */
  styleSheet: boolean;
}

interface FontInfo {
  bold: boolean;
  italic: boolean;
  /** Codepage from \fcharset, when it differs from the document's. */
  codepage?: number;
}

/** Destinations whose text is never prose. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'info', 'pict', 'object', 'objdata', 'shp', 'shpinst',
  'shppict', 'nonshppict', 'nextgraphic', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl',
  'footerr', 'footerf', 'footnote', 'annotation', 'atnid', 'atnauthor', 'atndate', 'atnicn', 'atnref',
  'atntime', 'atrfstart', 'atrfend', 'comment', 'fldinst', 'themedata', 'colorschememapping', 'listtable',
  'listoverridetable', 'latentstyles', 'datastore', 'xmlnstbl', 'rsidtbl', 'generator', 'operator',
  'wgrffmtfilter', 'filetbl', 'revtbl', 'pgdsctbl', 'docvar', 'xe', 'tc', 'tcn', 'txe', 'bkmkstart',
  'bkmkend', 'userprops', 'template', 'private', 'fchars', 'lchars', 'pnseclvl', 'mmathpr', 'blipuid',
  'picprop', 'expandedcolortbl', 'passwordhash', 'protusertbl', 'ftnsep', 'ftnsepc', 'ftncn', 'aftnsep',
  'aftnsepc', 'aftncn',
]);
const IMAGE_DESTINATIONS = new Set(['pict', 'shppict', 'object', 'nextgraphic']);
const ANNOTATION_DESTINATIONS = new Set(['annotation', 'comment']);

/** Control words that turn underline on (\ulN with N = 0 turns it off). */
const UNDERLINE_WORDS = new Set([
  'ul', 'uld', 'uldash', 'uldashd', 'uldashdd', 'uldb', 'ulhwave', 'ulldash', 'ulth', 'ulthd', 'ulthdash',
  'ulthdashd', 'ulthdashdd', 'ulthldash', 'ululdbwave', 'ulw', 'ulwave',
]);

/** Symbol control words → their character. */
const SYMBOL_WORDS: Record<string, string> = {
  emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•',
  emspace: ' ', enspace: ' ', qmspace: ' ', tab: ' ', cell: ' ', nestcell: ' ',
};

/** Windows-1252 0x80–0x9F (the rest of the byte range is Latin-1). '' = undefined byte. */
const CP1252_HIGH = [
  '€', '', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '',
  '', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ',
];

/** \fcharsetN → Windows/Mac codepage. 0/1 (ANSI/default) use the document's. */
const CHARSET_CODEPAGES: Record<number, number> = {
  77: 10000, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255,
  178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250,
};

/** Codepage → WHATWG encoding label for TextDecoder. */
function encodingLabel(cp: number): string | null {
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  switch (cp) {
    case 874: return 'windows-874';
    case 932: return 'shift_jis';
    case 936: return 'gbk';
    case 949: return 'euc-kr';
    case 950: return 'big5';
    case 10000: return 'macintosh';
    case 65001: return 'utf-8';
    default: return null;
  }
}

function decodeCp1252(bytes: number[]): string {
  let s = '';
  for (const b of bytes) s += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return s;
}

const decoderCache = new Map<string, TextDecoder | null>();

function decodeBytes(bytes: number[], cp: number): string {
  const label = cp === 1252 ? null : encodingLabel(cp);
  if (!label) return decodeCp1252(bytes);
  let dec = decoderCache.get(label);
  if (dec === undefined) {
    try {
      dec = new TextDecoder(label);
    } catch {
      dec = null; // runtime without that encoding (small-ICU builds)
    }
    decoderCache.set(label, dec);
  }
  return dec ? dec.decode(Uint8Array.from(bytes)) : decodeCp1252(bytes);
}

function fontInfoFromName(name: string, codepage: number | undefined): FontInfo {
  return { bold: /bold/i.test(name), italic: /italic|oblique/i.test(name), ...(codepage ? { codepage } : {}) };
}

function sameMarks(a: RichInline, b: RichInline): boolean {
  return !a.hardBreak && !b.hardBreak && !!a.bold === !!b.bold && !!a.italic === !!b.italic
    && !!a.underline === !!b.underline && !!a.strike === !!b.strike;
}

/** Collapse whitespace runs, trim the paragraph's ends, drop edge hard breaks. */
function tidyInlines(runs: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  for (const r of runs) {
    if (r.hardBreak) {
      out.push(r);
      continue;
    }
    const prev = out[out.length - 1];
    let text = r.text.replace(/[ \t]+/g, ' ');
    if ((!prev || prev.hardBreak || prev.text.endsWith(' ')) && text.startsWith(' ')) text = text.slice(1);
    if (!text) continue;
    if (prev && sameMarks(prev, r)) prev.text += text;
    else out.push({ ...r, text });
  }
  while (out.length && out[0].hardBreak) out.shift();
  while (out.length && out[out.length - 1].hardBreak) out.pop();
  const last = out[out.length - 1];
  if (last) {
    last.text = last.text.replace(/ +$/, '');
    if (!last.text) out.pop();
  }
  return out;
}

const PLAIN_TEXT_RUN = /[^\\{}\r\n\t\x80-\xff]+/y;
const CONTROL_WORD = /([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;
const SCRIVENER_MARKER = /(end_)?Scrv_([A-Za-z]+)[^\\{}\s]*/y;
/** Scrivener inline notes whose text runs to their \end_ marker. Other Scrv_ markers (styles …) carry no text. */
const SCRIVENER_NOTE_MARKERS = new Set(['annot', 'fn']);
/** A stylesheet name Word / LibreOffice give their heading styles. */
const HEADING_STYLE_NAME = /^heading\s*([1-6])$/i;

/**
 * Parse RTF. Pass the file as a UTF-8 string when it decodes as one, else as
 * a latin1 ("binary") string: raw bytes 0x80–0xFF are codepage bytes, as RTF
 * defines them; characters above U+00FF are taken literally.
 */
export function parseRtf(rtf: string): RtfParseResult {
  const blocks: RichBlock[] = [];
  const result: RtfParseResult = { blocks, droppedFootnotes: 0, droppedAnnotations: 0, droppedImages: 0 };
  let st: GroupState = {
    bold: false, italic: false, underline: false, strike: false, hidden: false, font: null, uc: 1,
    align: undefined, outline: undefined, style: undefined, pageBreakBefore: false, skip: false, fontTable: false,
    styleSheet: false,
  };
  const stack: GroupState[] = [];
  const fonts = new Map<number, FontInfo>();
  let defaultFont: number | null = null;
  let docCodepage = 1252;
  let fontEntry: { num: number; name: string; codepage?: number } | null = null;
  /** \sN → heading level index (0-based), from the stylesheet. */
  const styleOutline = new Map<number, number>();
  let styleEntry: { num: number; name: string; outline?: number } | null = null;

  let inlines: RichInline[] = [];
  let pendingBytes: number[] = [];
  let pendingCodepage = docCodepage;
  /** Fallback characters still to skip after a \uN. */
  let ucSkip = 0;
  /** The next control word names an ignorable destination (`{\* …`). */
  let ignorable = false;
  /** An empty paragraph right after a page break is the break's own paragraph. */
  let swallowEmpty = false;
  /** Inside a Scrivener inline annotation / footnote: the marker that ends it. */
  let scrivenerEnd: string | null = null;
  /** Group depth the annotation opened at: it never outlives that group (or, at top level, its paragraph). */
  let scrivenerDepth = 0;
  /** A \sect waits for the next section's \sbkN: \sbknone (continuous) / \sbkcol are not page breaks. */
  let pendingSect = false;
  /** Drop the attachment placeholder character that follows a Cocoa {\NeXTGraphic}. */
  let dropAttachmentChar = false;

  const fontInfo = (): FontInfo | undefined => (st.font === null ? undefined : fonts.get(st.font));
  const currentCodepage = (): number => fontInfo()?.codepage ?? docCodepage;
  const suppressed = (): boolean => st.skip || st.hidden || scrivenerEnd !== null;

  const appendText = (text: string): void => {
    if (!text) return;
    if (st.fontTable && !st.skip) {
      if (fontEntry) fontEntry.name += text;
      return;
    }
    if (st.styleSheet && !st.skip) {
      if (styleEntry) styleEntry.name += text;
      return;
    }
    if (suppressed()) return;
    if (pendingSect && /\S/.test(text)) commitSect();
    if (dropAttachmentChar) {
      dropAttachmentChar = false;
      text = text.replace(/^[¬\ufffc]/, '');
      if (!text) return;
    }
    text = text.replace(/\ufffc/g, '');
    if (!text) return;
    const fi = fontInfo();
    const run: RichInline = { text };
    if (st.bold || fi?.bold) run.bold = true;
    if (st.italic || fi?.italic) run.italic = true;
    if (st.underline) run.underline = true;
    if (st.strike) run.strike = true;
    const last = inlines[inlines.length - 1];
    if (last && sameMarks(last, run)) last.text += text;
    else inlines.push(run);
  };

  const flushBytes = (): void => {
    if (pendingBytes.length === 0) return;
    const bytes = pendingBytes;
    pendingBytes = [];
    appendText(decodeBytes(bytes, pendingCodepage));
  };

  const pushByte = (b: number): void => {
    if (suppressed() && !st.fontTable) return;
    const cp = currentCodepage();
    if (pendingBytes.length && cp !== pendingCodepage) flushBytes();
    pendingCodepage = cp;
    pendingBytes.push(b);
  };

  const storeStyleEntry = (): void => {
    if (!styleEntry) return;
    const name = styleEntry.name.replace(/;\s*$/, '').trim();
    const level = styleEntry.outline ?? (HEADING_STYLE_NAME.test(name) ? Number(HEADING_STYLE_NAME.exec(name)![1]) - 1 : undefined);
    if (level !== undefined) styleOutline.set(styleEntry.num, level);
    styleEntry = null;
  };

  const storeFontEntry = (): void => {
    if (!fontEntry) return;
    fonts.set(fontEntry.num, fontInfoFromName(fontEntry.name.replace(/;\s*$/, '').trim(), fontEntry.codepage));
    fontEntry = null;
  };

  const endParagraph = (): void => {
    commitSect();
    flushBytes();
    const runs = tidyInlines(inlines);
    inlines = [];
    const text = runs.map((r) => (r.hardBreak ? ' ' : r.text)).join('');
    if (!/\S/.test(text)) {
      if (!swallowEmpty) blocks.push({ kind: 'empty' });
      swallowEmpty = false;
      return;
    }
    swallowEmpty = false;
    if (st.pageBreakBefore) blocks.push({ kind: 'pageBreak' });
    const outline = st.outline ?? (st.style === undefined ? undefined : styleOutline.get(st.style));
    if (outline !== undefined && outline >= 0 && outline <= 5) {
      blocks.push({ kind: 'heading', level: (outline + 1) as 1 | 2 | 3 | 4 | 5 | 6, inlines: runs });
    } else if (isSceneBreakText(text)) {
      blocks.push({ kind: 'sceneBreak' });
    } else {
      blocks.push(st.align ? { kind: 'paragraph', inlines: runs, align: st.align } : { kind: 'paragraph', inlines: runs });
    }
  };

  const pageBreak = (): void => {
    pendingSect = false;
    flushBytes();
    if (tidyInlines(inlines.slice()).length > 0) endParagraph();
    else inlines = [];
    blocks.push({ kind: 'pageBreak' });
    swallowEmpty = true;
  };

  /** The pending \sect turned out to start a new page. */
  function commitSect(): void {
    if (!pendingSect) return;
    pendingSect = false;
    pageBreak();
  }

  const sectionBreak = (): void => {
    flushBytes();
    if (tidyInlines(inlines.slice()).length > 0) endParagraph();
    else inlines = [];
    pendingSect = true;
  };

  /** \line, and U+2028 (how Cocoa writes a soft return). */
  const lineBreak = (): void => {
    if (suppressed() || st.hidden || (st.fontTable && !st.skip) || (st.styleSheet && !st.skip)) return;
    flushBytes();
    inlines.push({ text: '', hardBreak: true });
  };

  /** Text that may hold U+2028 (line separator → hard break) / U+2029 (paragraph separator). */
  const emitText = (text: string): void => {
    if (!/[\u2028\u2029]/.test(text)) {
      appendText(text);
      return;
    }
    for (const piece of text.split(/([\u2028\u2029])/)) {
      if (piece === '\u2028') lineBreak();
      else if (piece === '\u2029') {
        if (!suppressed() && !st.hidden && !st.fontTable && !st.styleSheet) endParagraph();
      } else appendText(piece);
    }
  };

  const resetCharacter = (): void => {
    st.bold = false;
    st.italic = false;
    st.underline = false;
    st.strike = false;
    st.hidden = false;
    st.font = defaultFont;
  };

  const enterSkippedDestination = (word: string): void => {
    if (!st.skip && scrivenerEnd === null) {
      if (word === 'footnote') result.droppedFootnotes++;
      else if (ANNOTATION_DESTINATIONS.has(word)) result.droppedAnnotations++;
      else if (IMAGE_DESTINATIONS.has(word)) result.droppedImages++;
      if (word === 'nextgraphic') dropAttachmentChar = true;
    }
    st.skip = true;
  };

  const controlWord = (word: string, param: number | undefined): void => {
    const on = param === undefined || param !== 0;
    if (ignorable) {
      // `{\*\dest …}` — skipped whatever it is; counted when it is a note or picture.
      ignorable = false;
      enterSkippedDestination(word);
      return;
    }
    if (st.fontTable && !st.skip) {
      if (word === 'f' && param !== undefined) {
        storeFontEntry();
        fontEntry = { num: param, name: '' };
      } else if (word === 'fcharset' && param !== undefined && fontEntry) {
        fontEntry.codepage = CHARSET_CODEPAGES[param];
      } else if (word === 'cpg' && param !== undefined && fontEntry) {
        fontEntry.codepage = param;
      }
      return;
    }
    if (st.styleSheet && !st.skip) {
      if (word === 's' && param !== undefined) {
        storeStyleEntry();
        styleEntry = { num: param, name: '' };
      } else if (word === 'outlinelevel' && param !== undefined && styleEntry) {
        styleEntry.outline = param;
      }
      return;
    }
    if (word === 'fonttbl') {
      st.fontTable = true;
      return;
    }
    if (word === 'stylesheet') {
      st.styleSheet = true;
      return;
    }
    if (SKIP_DESTINATIONS.has(word)) {
      enterSkippedDestination(word);
      return;
    }
    // Document-level settings apply wherever they appear.
    switch (word) {
      case 'ansicpg': if (param !== undefined && param > 0) docCodepage = param; return;
      case 'mac': docCodepage = 10000; return;
      case 'deff': if (param !== undefined) { defaultFont = param; if (st.font === null) st.font = param; } return;
      case 'uc': if (param !== undefined && param >= 0) st.uc = param; return;
      default: break;
    }
    // An annotation opened outside any group of its own ends with its paragraph.
    if (word === 'par' && scrivenerEnd !== null && scrivenerDepth <= 1 && !st.skip) scrivenerEnd = null;
    if (st.skip || scrivenerEnd !== null) return;
    switch (word) {
      case 'b': st.bold = on; return;
      case 'i': st.italic = on; return;
      case 'strike': st.strike = on; return;
      case 'striked': st.strike = on; return;
      case 'ulnone': st.underline = false; return;
      case 'v': st.hidden = on; return;
      case 'deleted': st.hidden = on; return;
      case 'plain': resetCharacter(); return;
      case 'f': if (param !== undefined) st.font = param; return;
      case 'pard':
        st.align = undefined;
        st.outline = undefined;
        st.style = undefined;
        st.pageBreakBefore = false;
        return;
      case 's': st.style = param; return;
      case 'ql': st.align = undefined; return;
      case 'qc': st.align = 'center'; return;
      case 'qr': st.align = 'right'; return;
      case 'qj': case 'qd': st.align = 'justify'; return;
      case 'outlinelevel': st.outline = param; return;
      case 'pagebb': st.pageBreakBefore = on; return;
      case 'par': case 'row': if (!st.hidden) endParagraph(); return;
      case 'page': if (!st.hidden) pageBreak(); return;
      case 'sect': if (!st.hidden) sectionBreak(); return;
      case 'sbknone': case 'sbkcol': pendingSect = false; return;
      case 'line': lineBreak(); return;
      case 'u': {
        if (param === undefined) return;
        flushBytes();
        emitText(String.fromCharCode(((param % 65536) + 65536) % 65536));
        ucSkip = st.uc;
        return;
      }
      default: break;
    }
    if (UNDERLINE_WORDS.has(word)) {
      st.underline = on;
      return;
    }
    const sym = SYMBOL_WORDS[word];
    if (sym !== undefined) {
      flushBytes();
      appendText(sym);
    }
  };

  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') {
      flushBytes();
      ucSkip = 0;
      if (stack.length >= MAX_RTF_GROUP_DEPTH) throw new ImportUserError(RTF_DAMAGED_MESSAGE);
      stack.push({ ...st });
      i++;
      continue;
    }
    if (ch === '}') {
      flushBytes();
      ucSkip = 0;
      ignorable = false;
      if (st.fontTable && !st.skip) storeFontEntry();
      if (st.styleSheet && !st.skip) storeStyleEntry();
      if (scrivenerEnd !== null && stack.length <= scrivenerDepth) scrivenerEnd = null;
      const prev = stack.pop();
      if (prev) st = prev;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === undefined) break;
      // A fallback character after \uN is skipped, whatever its form.
      if (ucSkip > 0 && next !== '\\' && next !== '{' && next !== '}' && next !== "'" && !/[a-zA-Z]/.test(next)) {
        ucSkip--;
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        i += /^[0-9a-fA-F]{2}$/.test(hex) ? 4 : 2;
        if (ucSkip > 0) {
          ucSkip--;
          continue;
        }
        if (/^[0-9a-fA-F]{2}$/.test(hex)) pushByte(parseInt(hex, 16));
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        SCRIVENER_MARKER.lastIndex = i + 1;
        const sm = SCRIVENER_MARKER.exec(rtf);
        if (sm) {
          // Scrivener inline annotations / footnotes: {\Scrv_annot … \end_Scrv_annot}.
          // Any other Scrv_ marker (paragraph styles …) is a plain ignored word.
          flushBytes();
          i = SCRIVENER_MARKER.lastIndex;
          const marker = sm[2].toLowerCase();
          if (ignorable) {
            ignorable = false;
            enterSkippedDestination(marker);
          } else if (sm[1]) {
            if (scrivenerEnd === marker) scrivenerEnd = null;
          } else if (scrivenerEnd === null && !st.skip && SCRIVENER_NOTE_MARKERS.has(marker)) {
            scrivenerEnd = marker;
            scrivenerDepth = stack.length;
            if (marker === 'fn') result.droppedFootnotes++;
            else result.droppedAnnotations++;
          }
          continue;
        }
        CONTROL_WORD.lastIndex = i + 1;
        const m = CONTROL_WORD.exec(rtf);
        if (!m) {
          i += 2;
          continue;
        }
        i = CONTROL_WORD.lastIndex;
        const word = m[1].toLowerCase();
        const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
        if (word === 'bin') {
          // Raw binary data: skip it unread.
          i += Math.max(0, param ?? 0);
          continue;
        }
        if (ucSkip > 0 && word !== 'u') {
          ucSkip--;
          continue;
        }
        if (word !== 'u') flushBytes();
        controlWord(word, param);
        continue;
      }
      i += 2;
      switch (next) {
        case '\\': case '{': case '}':
          if (ucSkip > 0) { ucSkip--; break; }
          flushBytes();
          appendText(next);
          break;
        case '~': flushBytes(); appendText('\u00a0'); break;
        case '_': flushBytes(); appendText('-'); break;
        case '*': ignorable = true; break;
        case '\n': case '\r':
          // Cocoa (TextEdit, Mac Scrivener) ends paragraphs with `\` + newline.
          if (scrivenerEnd !== null && scrivenerDepth <= 1 && !st.skip) scrivenerEnd = null;
          if (!st.skip && !st.hidden && scrivenerEnd === null) endParagraph();
          break;
        default: break; // \- optional hyphen, \| \: index marks …
      }
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++; // raw newlines are not text in RTF
      continue;
    }
    if (ch === '\t') {
      i++;
      if (ucSkip > 0) { ucSkip--; continue; }
      flushBytes();
      appendText(' ');
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x80 && code <= 0xff) {
      i++;
      if (ucSkip > 0) { ucSkip--; continue; }
      pushByte(code);
      continue;
    }
    PLAIN_TEXT_RUN.lastIndex = i;
    const m = PLAIN_TEXT_RUN.exec(rtf);
    let text = m ? m[0] : ch;
    i += text.length;
    if (ucSkip > 0) {
      const skip = Math.min(ucSkip, text.length);
      ucSkip -= skip;
      text = text.slice(skip);
    }
    if (!text) continue;
    flushBytes();
    // Control characters other than tab/newline are never text.
    // eslint-disable-next-line no-control-regex
    emitText(text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''));
  }
  flushBytes();
  if (tidyInlines(inlines.slice()).length > 0) endParagraph();

  // Leading/trailing empties and page breaks carry no structure.
  const edge = (b: RichBlock) => b.kind === 'empty' || b.kind === 'pageBreak';
  while (blocks.length && edge(blocks[0])) blocks.shift();
  while (blocks.length && edge(blocks[blocks.length - 1])) blocks.pop();
  return result;
}

/** RTF → blocks (see parseRtf). */
export function rtfToBlocks(rtf: string): RichBlock[] {
  return parseRtf(rtf).blocks;
}

/** Bytes of an .rtf file → the string parseRtf expects (UTF-8 when valid, else one char per byte). */
export function decodeRtfBytes(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\ufeff/, '');
  } catch {
    return buf.toString('latin1');
  }
}

/** Warnings for the content parseRtf left out. */
export function rtfDropWarnings(parsed: Pick<RtfParseResult, 'droppedFootnotes' | 'droppedAnnotations' | 'droppedImages'>): string[] {
  const warnings: string[] = [];
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (parsed.droppedFootnotes > 0) {
    warnings.push(`${plural(parsed.droppedFootnotes, 'footnote was', 'footnotes were')} left out — Mythos imports the main text only.`);
  }
  if (parsed.droppedAnnotations > 0) {
    warnings.push(`${plural(parsed.droppedAnnotations, 'comment or annotation was', 'comments or annotations were')} left out.`);
  }
  if (parsed.droppedImages > 0) {
    warnings.push(`${plural(parsed.droppedImages, 'image was', 'images were')} not imported.`);
  }
  return warnings;
}

/** File name without its final extension — the fallback story title. */
function baseTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Imported Story';
}

/** A standalone .rtf manuscript → an ImportPlan (chapters from headings / "Chapter One" lines / page breaks). */
export async function rtfFileToPlan(absPath: string, name: string): Promise<ImportPlan> {
  const stat = await fs.promises.stat(absPath);
  if (!stat.isFile()) throw new ImportUserError('This RTF source is not a file.');
  if (stat.size > RTF_FILE_MAX_BYTES) throw new ImportUserError('This RTF file is larger than 50 MB.');
  const parsed = parseRtf(decodeRtfBytes(await fs.promises.readFile(absPath)));
  const seg = segmentBlocks(parsed.blocks, { fallbackTitle: baseTitle(name) });
  return {
    source: { kind: 'rtf', name },
    story: seg.story,
    notes: [],
    warnings: [...rtfDropWarnings(parsed), ...seg.warnings],
  };
}
