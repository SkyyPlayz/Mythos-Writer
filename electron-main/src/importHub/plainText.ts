// #1765 — plain text (.txt) → RichBlocks.
//
// Two shapes of text file are common: paragraphs separated by blank lines
// (hard-wrapped lines inside a paragraph are soft — joined with a space), and
// one paragraph per line with no blank lines at all. Scene-break marker lines
// become sceneBreak blocks, form feeds become page breaks, extra blank lines
// become 'empty' blocks so the segmenter can read a long gap as a scene break.
//
// Pure — no Electron, no fs.

import { isSceneBreakText, matchChapterMarker, type RichBlock } from './blocks.js';

function lineBlock(line: string): RichBlock {
  const text = line.replace(/[\t\u00a0]/g, ' ').replace(/ {2,}/g, ' ').trim();
  return isSceneBreakText(text) ? { kind: 'sceneBreak' } : { kind: 'paragraph', inlines: [{ text }] };
}

function pageToBlocks(page: string, blankLineMode: boolean): RichBlock[] {
  const lines = page.split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: RichBlock[] = [];
  if (!blankLineMode) {
    for (const line of lines) if (line.trim()) out.push(lineBlock(line));
    return out;
  }
  let para: string[] = [];
  let blanks = 0;
  let seenText = false;
  const flush = () => {
    if (para.length) out.push({ kind: 'paragraph', inlines: [{ text: para.join(' ') }] });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/[\t\u00a0]/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (!line) {
      flush();
      blanks++;
      continue;
    }
    // One blank line separates paragraphs; each further blank line is an 'empty'.
    if (seenText) for (let i = 1; i < blanks; i++) out.push({ kind: 'empty' });
    blanks = 0;
    seenText = true;
    // Marker lines stand alone even when the writer didn't leave a blank line around them.
    if (isSceneBreakText(line) || matchChapterMarker(line)) {
      flush();
      out.push(lineBlock(line));
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** Plain text → blocks. Strips a BOM, normalizes CRLF / CR line endings. */
export function plainTextToBlocks(text: string): RichBlock[] {
  const normalized = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  // Blank-line mode when any line between the first and last text line is blank
  // (a line holding a form feed is a page break, not a blank line).
  const lines = normalized.split('\n');
  const first = lines.findIndex((l) => !/^\s*$/.test(l));
  const last = lines.length - 1 - [...lines].reverse().findIndex((l) => !/^\s*$/.test(l));
  const blankLineMode = first !== -1 && lines.slice(first, last + 1).some((l) => /^[ \t\u00a0]*$/.test(l));
  const out: RichBlock[] = [];
  normalized.split('\f').forEach((page, i) => {
    if (i > 0) out.push({ kind: 'pageBreak' });
    out.push(...pageToBlocks(page, blankLineMode));
  });
  return out;
}
