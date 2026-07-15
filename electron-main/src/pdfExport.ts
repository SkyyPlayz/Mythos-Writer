// Beta 4 M14 — PDF export (FULL-SPEC §5.5).
//
// Pure HTML compiler for the print pipeline: the manuscript scope is rendered
// to a self-contained print-styled HTML document, which main.ts loads into a
// hidden BrowserWindow and converts with Chromium's `printToPDF`. No new
// dependencies — Chromium is the PDF engine.
//
// Prototype parity (book compile, "Mythos Writer - Liquid Neon.dc.html"
// 823–850 / buildBook 5533–5560): title page with rule, centered chapter
// kickers ("CHAPTER N"), optional synopsis page, optional "◆ ◆ ◆" scene
// separators, END OF DRAFT footer — printed in black-on-white book styling.

export interface PdfScene {
  title: string;
  prose: string;
}

export interface PdfChapter {
  title: string;
  scenes: PdfScene[];
}

export interface PdfInput {
  title: string;
  synopsis?: string;
  chapters: PdfChapter[];
  options?: {
    includeSynopsis?: boolean;
    sceneSeparators?: boolean;
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Double-newline = paragraph break (same segmentation as the DOCX/EPUB writers). */
function proseToHtml(prose: string): string {
  const paragraphs = prose
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return '';
  return paragraphs
    .map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' '))}</p>`)
    .join('\n');
}

const PRINT_CSS = `
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.7;
    color: #111;
  }
  p { margin: 0 0 0.85em; text-align: justify; }
  .title-page { text-align: center; padding: 220px 0 60px; page-break-after: always; }
  .title-page h1 { font-size: 30pt; font-weight: 600; line-height: 1.25; margin: 0; }
  .title-rule { width: 130px; height: 2px; margin: 24px auto; background: #444; border: 0; }
  .synopsis-page { page-break-after: always; padding-top: 120px; }
  .synopsis-page h2 { text-align: center; font-size: 13pt; letter-spacing: .24em; text-transform: uppercase; font-weight: 600; margin: 0 0 28px; }
  .synopsis-page p { font-style: italic; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: avoid; }
  .chapter-head { text-align: center; margin: 90px 0 40px; }
  .chapter-kicker { font-size: 9pt; font-weight: 600; letter-spacing: .26em; text-transform: uppercase; color: #555; }
  .chapter-title { font-size: 19pt; font-weight: 600; margin-top: 8px; }
  .scene-title { text-align: center; font-size: 9pt; font-weight: 600; letter-spacing: .26em; text-transform: uppercase; color: #777; margin: 26px 0 16px; }
  .scene-sep { text-align: center; letter-spacing: .6em; font-size: 10pt; color: #555; margin: 1.8em 0; }
  .end-mark { text-align: center; letter-spacing: .3em; font-size: 9pt; color: #555; margin-top: 64px; }
`;

/**
 * Compile a manuscript scope into a complete, self-contained HTML document
 * suitable for `webContents.printToPDF`.
 */
export function buildManuscriptHtml(input: PdfInput): string {
  const { title, synopsis, chapters, options } = input;
  const includeSynopsis = options?.includeSynopsis === true;
  const sceneSeparators = options?.sceneSeparators === true;

  const parts: string[] = [];

  parts.push(
    `<div class="title-page"><h1>${escapeHtml(title)}</h1><hr class="title-rule"/></div>`,
  );

  if (includeSynopsis && synopsis && synopsis.trim()) {
    parts.push(
      `<div class="synopsis-page"><h2>Synopsis</h2>${proseToHtml(synopsis)}</div>`,
    );
  }

  chapters.forEach((chapter, ci) => {
    const sceneParts: string[] = [];
    chapter.scenes.forEach((scene, si) => {
      if (si > 0 && sceneSeparators) {
        sceneParts.push('<div class="scene-sep">◆ ◆ ◆</div>');
      }
      sceneParts.push(`<div class="scene-title">${escapeHtml(scene.title)}</div>`);
      sceneParts.push(proseToHtml(scene.prose));
    });
    parts.push(
      `<section class="chapter"><div class="chapter-head"><div class="chapter-kicker">Chapter ${ci + 1}</div><div class="chapter-title">${escapeHtml(chapter.title)}</div></div>${sceneParts.join('\n')}</section>`,
    );
  });

  parts.push('<div class="end-mark">— END OF DRAFT —</div>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}
