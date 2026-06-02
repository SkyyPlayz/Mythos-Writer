// DOCX writer — one-way manuscript export for editors and beta readers.
// Uses the `docx` npm package (no external Word installation needed).

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';

export interface DocxScene {
  id: string;
  title: string;
  prose: string;
}

export interface DocxChapter {
  id: string;
  title: string;
  scenes: DocxScene[];
}

export interface DocxInput {
  title: string;
  author?: string;
  chapters: DocxChapter[];
}

// ─── Prose → Paragraph list ───

function inlineRuns(line: string): TextRun[] {
  // Very small inline-format parser: **bold** and _italic_ or *italic*.
  // Handles nested pairs in order they appear; not a full markdown parser.
  const runs: TextRun[] = [];
  // Tokenise into alternating plain / bold / italic spans using a single pass.
  const re = /(\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|_(.+?)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: line.slice(last, m.index) }));
    }
    if (m[0].startsWith('**')) {
      runs.push(new TextRun({ text: m[2], bold: true }));
    } else {
      // *…* or _…_ — group 3 captures *italic*, group 4 captures _italic_
      runs.push(new TextRun({ text: m[3] ?? m[4], italics: true }));
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    runs.push(new TextRun({ text: line.slice(last) }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: line })];
}

function proseToParagraphs(prose: string): Paragraph[] {
  const blocks = prose.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return [];
  return blocks.map(
    (block) =>
      new Paragraph({
        children: inlineRuns(block.replace(/\n/g, ' ')),
        spacing: { after: 160 },
      }),
  );
}

// ─── Main export ───

export async function buildDocx(input: DocxInput): Promise<Buffer> {
  const { title, author = 'Unknown', chapters } = input;

  const children: Paragraph[] = [];

  // Title page
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
  );
  if (author) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: author, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
      }),
    );
  }

  if (chapters.length === 0) {
    children.push(new Paragraph({ text: '(empty manuscript)', spacing: { after: 160 } }));
  }

  for (const chapter of chapters) {
    // Chapter heading (Heading 1)
    children.push(
      new Paragraph({
        text: chapter.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
    );

    for (const scene of chapter.scenes) {
      // Scene heading (Heading 2)
      children.push(
        new Paragraph({
          text: scene.title,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
        }),
      );

      const paragraphs = proseToParagraphs(scene.prose);
      children.push(...paragraphs);
    }
  }

  const doc = new Document({
    creator: author,
    title,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
