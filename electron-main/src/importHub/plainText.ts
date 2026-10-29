// #1765 — plain text (.txt) → RichBlocks.
//
// Two shapes of text file are common: paragraphs separated by blank lines
// (hard-wrapped lines inside a paragraph are soft — joined with a space), and
// one paragraph per line (blank lines, if any, only around titles, chapter
// headings or scene breaks). The shape is read from the whole file's line
// statistics, never from a single blank line. Scene-break marker lines become
// sceneBreak blocks, form feeds become page breaks, blank lines the shape
// doesn't need become 'empty' blocks so the segmenter can read a gap as a
// scene break.
//
// Pure — no Electron, no fs.

import { isSceneBreakText, matchChapterMarker, type RichBlock } from './blocks.js';

/** A line longer than this was never hard-wrapped: it is a whole paragraph. */
const MAX_WRAPPED_LINE = 120;
/** Lines ending like this end a sentence or a quotation — not a wrap point. */
const SENTENCE_END_RE = /[.!?…:;"”’'»)\]*_~—–]$/;

function cleanLine(line: string): string {
  return line.replace(/[\t\u00a0]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function lineBlock(text: string): RichBlock {
  return isSceneBreakText(text) ? { kind: 'sceneBreak' } : { kind: 'paragraph', inlines: [{ text }] };
}

function isMarkerLine(text: string): boolean {
  return isSceneBreakText(text) || matchChapterMarker(text) !== null;
}

/**
 * Blank-line mode (blank lines separate paragraphs, single newlines are
 * soft) when blank lines are frequent — about one per three text lines or
 * more, as in a file whose paragraphs are each one line with a blank between
 * — or when most prose lines look hard-wrapped: not too long and not ending a
 * sentence. Otherwise every line is its own paragraph.
 */
function blankLinesSeparateParagraphs(lines: string[]): boolean {
  let first = -1;
  let last = -1;
  lines.forEach((l, i) => {
    if (l.trim()) {
      if (first === -1) first = i;
      last = i;
    }
  });
  if (first === -1) return false;
  let blanks = 0;
  let prose = 0;
  let wrapped = 0;
  let textLines = 0;
  for (let i = first; i <= last; i++) {
    // A line holding a form feed is a page break, not a blank line.
    if (/^[ \t\u00a0]*$/.test(lines[i])) { blanks++; continue; }
    const text = cleanLine(lines[i]);
    if (!text) continue;
    textLines++;
    if (isMarkerLine(text)) continue;
    prose++;
    if (text.length <= MAX_WRAPPED_LINE && !SENTENCE_END_RE.test(text)) wrapped++;
  }
  if (blanks === 0) return false;
  return blanks * 3 >= textLines || (prose > 0 && wrapped * 2 > prose);
}

function pageToBlocks(page: string, blankLineMode: boolean): RichBlock[] {
  const lines = page.split('\n');
  const out: RichBlock[] = [];
  let para: string[] = [];
  let blanks = 0;
  let seenText = false;
  const flush = () => {
    if (para.length) out.push({ kind: 'paragraph', inlines: [{ text: para.join(' ') }] });
    para = [];
  };
  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) {
      flush();
      blanks++;
      continue;
    }
    // In blank-line mode one blank line separates paragraphs and each further
    // one is an 'empty'; with a paragraph per line every blank line is one.
    if (seenText) for (let i = blankLineMode ? 1 : 0; i < blanks; i++) out.push({ kind: 'empty' });
    blanks = 0;
    seenText = true;
    // Marker lines stand alone even when the writer didn't leave a blank line around them.
    if (!blankLineMode || isMarkerLine(line)) {
      flush();
      out.push(lineBlock(line));
      continue;
    }
    // A line too long to be hard-wrapped ends its paragraph.
    if (para.length && para[para.length - 1].length > MAX_WRAPPED_LINE) flush();
    para.push(line);
  }
  flush();
  return out;
}

/** Plain text → blocks. Strips a BOM, normalizes CRLF / CR line endings. */
export function plainTextToBlocks(text: string): RichBlock[] {
  const normalized = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const blankLineMode = blankLinesSeparateParagraphs(normalized.split('\n'));
  const out: RichBlock[] = [];
  normalized.split('\f').forEach((page, i) => {
    if (i > 0) out.push({ kind: 'pageBreak' });
    out.push(...pageToBlocks(page, blankLineMode));
  });
  return out;
}
