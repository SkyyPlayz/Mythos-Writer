// #1765 — Word .docx (also Google Docs "Download → .docx") → RichBlocks.
//
// mammoth turns the document into HTML with an explicit style map so nothing
// a writer relies on is lost: underline (no default mapping), in-run page
// breaks (dropped by default, gluing "before" and "after" together), empty
// paragraphs (dropped by default — needed for blank-line scene breaks),
// Title / Chapter / Part / Scene Break paragraph styles and Emphasis-style
// character styles (mammoth never reads formatting inherited from a style).
// The HTML then goes through the shared htmlToBlocks walker.
//
// Pure — no Electron, no fs.

import mammoth from 'mammoth';
import { segmentBlocks, type RichBlock, type RichInline } from './blocks.js';
import { dropBodyWideAlignment, htmlToBlocks } from './htmlBlocks.js';
import type { ImportStory } from './types.js';

/** Absolute cap before we even attempt parsing (saves memory on huge files). */
export const DOCX_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const DOCX_DAMAGED_MESSAGE = 'This Word file looks damaged or isn\'t really a .docx.';

// Canonical style names the transform below rewrites real-world names to, so
// one style-map line covers "Chapter Title", "Chapter Heading", "ChapterNumber"…
const CHAPTER_STYLE = 'Mythos Chapter';
const PART_STYLE = 'Mythos Part';
const SCENE_BREAK_STYLE = 'Mythos Scene Break';

const CHAPTER_STYLE_RE = /^chapter[\s_-]*(?:title|heading|head|name|number|num|label)?$/i;
const PART_STYLE_RE = /^part[\s_-]*(?:title|heading|head|name|number|num|label)?$/i;
const SCENE_BREAK_STYLE_RE = /^(?:(?:scene|section)[\s_-]*(?:break|separator|divider)|separator|divider|ornament|dinkus)$/i;

const STYLE_MAP = [
  "p[style-name='Title'] => p.mythos-title:fresh",
  "p[style-name='Subtitle'] => p.mythos-subtitle:fresh",
  `p[style-name='${CHAPTER_STYLE}'] => h1:fresh`,
  `p[style-name='${PART_STYLE}'] => h1.mythos-part:fresh`,
  `p[style-name='${SCENE_BREAK_STYLE}'] => hr.mythos-scene:fresh`,
  "r[style-name='Emphasis'] => em",
  "r[style-name='Subtle Emphasis'] => em",
  "r[style-name='Intense Emphasis'] => em",
  "r[style-name='Strong'] => strong",
  "r[style-name='Book Title'] => strong > em",
  "r[style-name='Heading 1 Char'] =>",
  "r[style-name='Heading 2 Char'] =>",
  "r[style-name='Heading 3 Char'] =>",
  "r[style-name='Heading 4 Char'] =>",
  "r[style-name='Heading 5 Char'] =>",
  "r[style-name='Heading 6 Char'] =>",
  "r[style-name='Title Char'] =>",
  "r[style-name='Subtitle Char'] =>",
  'u => u',
  'strike => s',
  "br[type='page'] => hr.mythos-pagebreak",
];

// Paragraph alignment is read by mammoth but has no style-map matcher, so the
// transform prepends a marker the walker can't mistake for text: Unicode
// noncharacters (U+FDD0/U+FDD1), which never appear in interchanged documents.
const ALIGN_MARK_OPEN = '\ufdd0';
const ALIGN_MARK_CLOSE = '\ufdd1';
const ALIGN_MARK_RE = /^\ufdd0([crj])\ufdd1/;
const NONCHARACTERS_RE = /[\ufdd0-\ufdef]/g;
const ALIGN_CODE: Record<string, 'c' | 'r' | 'j'> = { center: 'c', right: 'r', end: 'r', both: 'j', distribute: 'j' };
const ALIGN_OF: Record<'c' | 'r' | 'j', 'center' | 'right' | 'justify'> = { c: 'center', r: 'right', j: 'justify' };

/** mammoth's paragraph element (only the fields this transform reads/writes). */
interface MammothParagraph {
  type: 'paragraph';
  styleName?: string | null;
  alignment?: string | null;
  children: unknown[];
}

function transformParagraph(p: MammothParagraph): MammothParagraph {
  let styleName = p.styleName ?? null;
  const name = (styleName ?? '').trim();
  if (CHAPTER_STYLE_RE.test(name)) styleName = CHAPTER_STYLE;
  else if (PART_STYLE_RE.test(name)) styleName = PART_STYLE;
  else if (SCENE_BREAK_STYLE_RE.test(name)) styleName = SCENE_BREAK_STYLE;
  const code = p.alignment ? ALIGN_CODE[p.alignment] : undefined;
  const children = code
    ? [{ type: 'text', value: `${ALIGN_MARK_OPEN}${code}${ALIGN_MARK_CLOSE}` }, ...p.children]
    : p.children;
  return { ...p, styleName, children };
}

/** Depth-first like mammoth.transforms.paragraph (absent from its typings); mutates in place as mammoth does. */
function transformDocument(element: { type?: string; children?: unknown[] }): unknown {
  if (Array.isArray(element.children)) {
    element.children = element.children.map((c) => transformDocument(c as { type?: string; children?: unknown[] }));
  }
  return element.type === 'paragraph' ? transformParagraph(element as MammothParagraph) : element;
}

function stripMarks(inlines: RichInline[]): { inlines: RichInline[]; align?: 'center' | 'right' | 'justify' } {
  let align: 'center' | 'right' | 'justify' | undefined;
  const out: RichInline[] = [];
  inlines.forEach((r, i) => {
    if (r.hardBreak) {
      out.push(r);
      return;
    }
    let text = r.text;
    if (i === 0) {
      const m = ALIGN_MARK_RE.exec(text);
      if (m) {
        align = ALIGN_OF[m[1] as 'c' | 'r' | 'j'];
        text = text.slice(m[0].length);
      }
    }
    text = text.replace(NONCHARACTERS_RE, '');
    if (out.length === 0) text = text.replace(/^\s+/, '');
    if (text) out.push({ ...r, text });
  });
  while (out.length && out[0].hardBreak) out.shift();
  return { inlines: out, align };
}

/** Turn the transform's alignment markers into `align`, and remove them everywhere else. */
function applyAlignment(blocks: RichBlock[]): RichBlock[] {
  const out: RichBlock[] = [];
  let carry: 'center' | 'right' | 'justify' | undefined;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'paragraph') {
      const { inlines, align: marked } = stripMarks(b.inlines);
      const align = marked ?? carry ?? b.align;
      carry = undefined;
      if (inlines.length === 0) {
        // `<p>⟨mark⟩<hr page-break/>text</p>`: the mark-only half is not a real
        // paragraph — hand its alignment to the text after the break.
        if (blocks[i + 1]?.kind === 'pageBreak') carry = marked;
        else out.push({ kind: 'empty' });
        continue;
      }
      out.push(align ? { kind: 'paragraph', inlines, align } : { kind: 'paragraph', inlines });
    } else if (b.kind === 'heading' || b.kind === 'title') {
      const { inlines } = stripMarks(b.inlines);
      carry = undefined;
      out.push(inlines.length ? { ...b, inlines } : { kind: 'empty' });
    } else {
      if (b.kind !== 'pageBreak') carry = undefined;
      out.push(b);
    }
  }
  return dropBodyWideAlignment(out);
}

/** mammoth messages a writer can't act on (unknown style names, ignored XML, images). */
const NOISE_WARNINGS = [
  /^Unrecognised (?:paragraph|run|table|numbering) style/i,
  /unrecognised element was ignored/i,
  /image/i,
  /style mapping/i,
];

/**
 * A .docx buffer → blocks. Throws a plain-words error for an oversize or
 * damaged file. `title` is not set (the Title paragraph becomes a 'title'
 * block instead; Word's metadata title is usually stale).
 */
export async function docxToBlocks(buffer: Buffer): Promise<{ blocks: RichBlock[]; title?: string; warnings: string[] }> {
  if (buffer.length > DOCX_MAX_BYTES) {
    throw new Error(`This Word file is too large to import (over ${DOCX_MAX_BYTES / (1024 * 1024)} MB).`);
  }
  if (buffer.length === 0) throw new Error(DOCX_DAMAGED_MESSAGE);
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml({ buffer }, {
      styleMap: STYLE_MAP,
      ignoreEmptyParagraphs: false,
      transformDocument,
      // Never read the image bytes: no base64 bloat in scene files.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    });
  } catch {
    throw new Error(DOCX_DAMAGED_MESSAGE);
  }

  const parsed = htmlToBlocks(result.value);
  const mammothWarnings = [...new Set(result.messages
    .map((m) => m.message)
    .filter((msg) => !NOISE_WARNINGS.some((re) => re.test(msg))))]
    .slice(0, 3)
    .map((msg) => `Some of this document couldn’t be read: ${msg}`);

  return { blocks: applyAlignment(parsed.blocks), warnings: [...parsed.warnings, ...mammothWarnings] };
}

/** A .docx buffer → a segmented story (chapters/scenes in editor Markdown). */
export async function parseDocxStory(
  buffer: Buffer,
  fallbackTitle: string,
): Promise<{ story: ImportStory; warnings: string[] }> {
  const { blocks, warnings } = await docxToBlocks(buffer);
  const seg = segmentBlocks(blocks, { fallbackTitle });
  return { story: seg.story, warnings: [...warnings, ...seg.warnings] };
}
