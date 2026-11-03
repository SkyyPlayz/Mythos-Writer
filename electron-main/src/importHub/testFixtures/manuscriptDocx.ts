// #1765 — synthetic Word manuscripts for import tests (unit and e2e).
//
// Every fixture is built in memory with the `docx` package — never commit a
// real (or any binary) manuscript. `buildManuscriptDocx` takes a flat list of
// paragraphs; the ready-made manuscripts below cover the shapes real
// writers' files come in: heading styles, "CHAPTER ONE" lines with page
// breaks, page breaks only, and manual double spacing. Each comes with the
// outline the importer should produce, so specs can assert against it.

import {
  AlignmentType,
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  type IStylesOptions,
} from 'docx';

export type FixtureRun =
  | string
  | { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; style?: string }
  /** A hard page break inside the paragraph (Ctrl+Enter mid-line). */
  | { pageBreak: true }
  /** A line break (Shift+Enter). */
  | { lineBreak: true }
  /** A footnote reference; declare the note text in `ManuscriptDocxOptions.footnotes`. */
  | { footnote: number };

export interface FixtureParagraph {
  /** Shorthand for one plain run. */
  text?: string;
  runs?: FixtureRun[];
  heading?: 'title' | 'subtitle' | 1 | 2 | 3 | 4 | 5 | 6;
  /** A paragraph style id (declare custom ones in `ManuscriptDocxOptions.paragraphStyles`). */
  style?: string;
  align?: 'center' | 'right' | 'justify';
  pageBreakBefore?: boolean;
}

export interface ManuscriptDocxOptions {
  paragraphStyles?: Array<{ id: string; name: string; bold?: boolean; italic?: boolean; center?: boolean }>;
  characterStyles?: Array<{ id: string; name: string; bold?: boolean; italic?: boolean; underline?: boolean }>;
  footnotes?: Record<number, string>;
}

export interface FixtureOutline {
  title: string;
  structure: 'headings' | 'patterns' | 'pagebreaks' | 'none';
  chapters: Array<{ title: string; scenes: string[] }>;
}

const HEADING_LEVELS = {
  title: HeadingLevel.TITLE,
  subtitle: undefined,
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

const ALIGN = {
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

function toRun(r: FixtureRun): TextRun | PageBreak | FootnoteReferenceRun {
  if (typeof r === 'string') return new TextRun(r);
  if ('pageBreak' in r) return new PageBreak();
  if ('lineBreak' in r) return new TextRun({ text: '', break: 1 });
  if ('footnote' in r) return new FootnoteReferenceRun(r.footnote);
  return new TextRun({
    text: r.text,
    ...(r.bold ? { bold: true } : {}),
    ...(r.italic ? { italics: true } : {}),
    ...(r.underline ? { underline: {} } : {}),
    ...(r.strike ? { strike: true } : {}),
    ...(r.style ? { style: r.style } : {}),
  });
}

function toParagraph(p: FixtureParagraph): Paragraph {
  const children = (p.runs ?? (p.text !== undefined ? [p.text] : [])).map(toRun);
  const heading = p.heading === undefined ? undefined : HEADING_LEVELS[p.heading];
  return new Paragraph({
    children,
    ...(heading ? { heading } : {}),
    ...(p.heading === 'subtitle' ? { style: 'Subtitle' } : {}),
    ...(p.style ? { style: p.style } : {}),
    ...(p.align ? { alignment: ALIGN[p.align] } : {}),
    ...(p.pageBreakBefore ? { pageBreakBefore: true } : {}),
  });
}

/** Build a .docx from a flat paragraph list. */
export async function buildManuscriptDocx(paragraphs: FixtureParagraph[], opts: ManuscriptDocxOptions = {}): Promise<Buffer> {
  const styles: IStylesOptions = {
    paragraphStyles: [
      { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', run: { italics: true } },
      ...(opts.paragraphStyles ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        basedOn: 'Normal',
        run: { ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italics: true } : {}) },
        ...(s.center ? { paragraph: { alignment: AlignmentType.CENTER } } : {}),
      })),
    ],
    characterStyles: (opts.characterStyles ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      run: {
        ...(s.bold ? { bold: true } : {}),
        ...(s.italic ? { italics: true } : {}),
        ...(s.underline ? { underline: {} } : {}),
      },
    })),
  };
  const footnotes = Object.fromEntries(
    Object.entries(opts.footnotes ?? {}).map(([id, text]) => [id, { children: [new Paragraph(text)] }]),
  );
  const doc = new Document({
    styles,
    ...(opts.footnotes ? { footnotes } : {}),
    sections: [{ children: paragraphs.map(toParagraph) }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── Paragraph helpers ───────────────────────────────────────────────────────

export const para = (...runs: FixtureRun[]): FixtureParagraph => ({ runs });
export const centered = (text: string): FixtureParagraph => ({ text, align: 'center' });
export const emptyPara = (): FixtureParagraph => ({ runs: [] });
/** A paragraph holding only a hard page break (how most writers start a new page). */
export const pageBreakPara = (): FixtureParagraph => ({ runs: [{ pageBreak: true }] });

/** Deterministic filler prose of `words` words (distinct sentences, no markers). */
export function fillerProse(seed: string, words: number): string {
  const vocab = ['the', 'road', 'turned', 'north', 'past', 'quiet', 'farms', 'and', 'rain', 'fell', 'softly', 'over', 'stone', 'walls', 'while', 'crows', 'watched'];
  const out: string[] = [seed];
  for (let i = 1; i < words; i++) out.push(vocab[(i * 7 + seed.length) % vocab.length]);
  return `${out.join(' ')}.`;
}

// ─── Ready-made manuscripts ──────────────────────────────────────────────────

/**
 * Heading-styled manuscript: Title, three Heading 1 chapters, Heading 2 scene
 * titles in chapter one, `* * *` / `#` / in-run page break scene breaks in
 * the others, every inline mark, a centered line.
 */
export const HEADED_MANUSCRIPT: FixtureParagraph[] = [
  { heading: 'title', text: 'The Lantern Road' },
  { heading: 1, text: 'Chapter One: The Gate' },
  { heading: 2, text: 'Arrival' },
  para('Mara reached the ', { text: 'iron gate', bold: true }, ' at dusk, and the ', { text: 'lanterns', italic: true }, ' were already lit.'),
  para('She had ', { text: 'never', underline: true }, ' seen it ', { text: 'closed', strike: true }, ' before.'),
  { heading: 2, text: 'The Keeper' },
  para({ text: 'Who goes there?', bold: true, italic: true }, ' called the keeper.'),
  para(
    'He spoke ', { text: 'slowly', italic: true }, ', ', { text: 'carefully ', bold: true }, 'and ',
    { text: 'with ', bold: true }, { text: 'great', bold: true, italic: true }, { text: ' care', bold: true }, '.',
  ),
  { heading: 1, text: 'Chapter Two' },
  para('The road ran north for three days.'),
  para('Nobody spoke.'),
  centered('* * *'),
  para('On the fourth day the rain came.'),
  para('The fire burned low', { pageBreak: true }, 'and morning came.'),
  { heading: 1, text: 'Chapter Three' },
  centered('Interlude at the Inn'),
  para('The innkeeper counted coins.'),
  para('#'),
  para('Mara slept.'),
  para('Then she dreamed.'),
];

export const HEADED_MANUSCRIPT_OUTLINE: FixtureOutline = {
  title: 'The Lantern Road',
  structure: 'headings',
  chapters: [
    { title: 'Chapter One: The Gate', scenes: ['Arrival', 'The Keeper'] },
    { title: 'Chapter Two', scenes: ['Scene 1', 'Scene 2', 'Scene 3'] },
    { title: 'Chapter Three', scenes: ['Scene 1', 'Scene 2'] },
  ],
};

export const buildHeadedManuscriptDocx = (): Promise<Buffer> => buildManuscriptDocx(HEADED_MANUSCRIPT);

/**
 * The same kind of story with NO heading styles — the usual shape of a
 * manuscript typed in Normal style: "Prologue", "PART ONE", "CHAPTER ONE",
 * "Chapter 2: The Gate", "Part Two", "Chapter 3" + a centered subtitle line,
 * separated by page breaks.
 */
export const PATTERN_MANUSCRIPT: FixtureParagraph[] = [
  centered('Prologue'),
  para('The lanterns were lit long before Mara was born.'),
  pageBreakPara(),
  centered('PART ONE'),
  pageBreakPara(),
  centered('CHAPTER ONE'),
  para('Mara reached the ', { text: 'iron gate', bold: true }, ' at dusk.'),
  centered('* * *'),
  para('The keeper let her in.'),
  pageBreakPara(),
  para('Chapter 2: The Gate'),
  para('Beyond the gate the road ran ', { text: 'north', italic: true }, '.'),
  pageBreakPara(),
  centered('Part Two'),
  centered('Chapter 3'),
  centered('The Inn'),
  para('The innkeeper counted coins.'),
];

export const PATTERN_MANUSCRIPT_OUTLINE: FixtureOutline = {
  title: 'Pattern Manuscript',
  structure: 'patterns',
  chapters: [
    { title: 'Prologue', scenes: ['Prologue'] },
    { title: 'PART ONE · CHAPTER ONE', scenes: ['Scene 1', 'Scene 2'] },
    { title: 'PART ONE · Chapter 2: The Gate', scenes: ['PART ONE · Chapter 2: The Gate'] },
    { title: 'Part Two · Chapter 3: The Inn', scenes: ['Part Two · Chapter 3: The Inn'] },
  ],
};

export const buildPatternManuscriptDocx = (): Promise<Buffer> => buildManuscriptDocx(PATTERN_MANUSCRIPT);

/** Three long untitled sections separated only by hard page breaks. */
export const PAGEBREAK_MANUSCRIPT: FixtureParagraph[] = [
  para(fillerProse('Morning', 180)),
  para(fillerProse('Noon', 40)),
  pageBreakPara(),
  para(fillerProse('Evening', 200)),
  pageBreakPara(),
  para(fillerProse('Night', 170)),
];

export const PAGEBREAK_MANUSCRIPT_OUTLINE: FixtureOutline = {
  title: 'Pagebreak Manuscript',
  structure: 'pagebreaks',
  chapters: [
    { title: 'Chapter 1', scenes: ['Chapter 1'] },
    { title: 'Chapter 2', scenes: ['Chapter 2'] },
    { title: 'Chapter 3', scenes: ['Chapter 3'] },
  ],
};

export const buildPageBreakManuscriptDocx = (): Promise<Buffer> => buildManuscriptDocx(PAGEBREAK_MANUSCRIPT);

/**
 * Manual double spacing: an empty paragraph after EVERY paragraph (very
 * common in real manuscripts). Scene breaks are a longer run of empties.
 */
export function doubleSpacedManuscript(): FixtureParagraph[] {
  const out: FixtureParagraph[] = [];
  const add = (p: FixtureParagraph) => { out.push(p, emptyPara()); };
  add(para('Chapter 1'));
  for (let i = 1; i <= 12; i++) add(para(`Line ${i} of the first scene.`));
  out.push(emptyPara(), emptyPara());
  for (let i = 1; i <= 8; i++) add(para(`Line ${i} of the second scene.`));
  add(para('Chapter 2'));
  for (let i = 1; i <= 10; i++) add(para(`Line ${i} of chapter two.`));
  return out;
}

export const DOUBLE_SPACED_MANUSCRIPT_OUTLINE: FixtureOutline = {
  title: 'Double Spaced',
  structure: 'patterns',
  chapters: [
    { title: 'Chapter 1', scenes: ['Scene 1', 'Scene 2'] },
    { title: 'Chapter 2', scenes: ['Chapter 2'] },
  ],
};

export const buildDoubleSpacedManuscriptDocx = (): Promise<Buffer> => buildManuscriptDocx(doubleSpacedManuscript());
