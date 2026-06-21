// SKY-2971: .docx → Story Vault importer — pure parsing helpers (no Electron imports).
// Uses mammoth.js (pure JS, no native deps, cross-platform).
//
// Convention: H1 = chapter, H2 = scene (matching the heading-driven view spec).
// One .docx becomes one Story in the vault.
//
// mammoth 1.12 exposes convertToHtml (not convertToMarkdown); we convert the HTML
// output to a simple heading-delimited text format that splitDocxMarkdown can parse.

import mammoth from 'mammoth';

/** Absolute cap before we even attempt parsing (saves memory on huge files). */
export const DOCX_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface DocxScene {
  title: string;
  prose: string;
  order: number;
}

export interface DocxChapter {
  title: string;
  order: number;
  scenes: DocxScene[];
}

export interface DocxImportResult {
  title: string;
  chapters: DocxChapter[];
  warnings: string[];
}

/** Strip HTML tags from a string fragment. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

/**
 * Convert mammoth HTML output to a simple line format that splitDocxMarkdown can parse.
 *
 * <h1>Title</h1> → "# Title"
 * <h2>Title</h2> → "## Title"
 * <p>Prose</p>   → "Prose" (tags stripped)
 */
export function htmlToSplittableMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t: string) => `\n# ${stripTags(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t: string) => `\n## ${stripTags(t)}\n`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split mammoth-produced markdown into chapters (H1) and scenes (H2).
 *
 * Fallback cases:
 *   - No headings → one chapter, one scene, all prose.
 *   - H2 before any H1 → implicit chapter named after fallbackTitle.
 *   - Prose between H1 and first H2 → unnamed scene whose title is the chapter title.
 */
export function splitDocxMarkdown(
  markdown: string,
  fallbackTitle = 'Untitled',
): { title: string; chapters: DocxChapter[] } {
  const lines = markdown.split('\n');

  let docTitle = fallbackTitle;
  let docTitleResolved = false;

  const chapters: DocxChapter[] = [];

  let chapterTitle: string | null = null;
  let chapterScenes: DocxScene[] = [];
  let sceneTitle: string | null = null;
  let sceneLines: string[] = [];

  function commitScene(): void {
    const prose = sceneLines.join('\n').trim();
    sceneLines = [];
    if (sceneTitle !== null || prose) {
      chapterScenes.push({
        title: sceneTitle ?? chapterTitle ?? docTitle,
        prose,
        order: chapterScenes.length,
      });
    }
    sceneTitle = null;
  }

  function commitChapter(): void {
    commitScene();
    if (chapterTitle !== null || chapterScenes.length > 0) {
      chapters.push({
        title: chapterTitle ?? docTitle,
        order: chapters.length,
        scenes: chapterScenes,
      });
    }
    chapterTitle = null;
    chapterScenes = [];
    sceneTitle = null;
  }

  for (const line of lines) {
    if (line.startsWith('# ')) {
      commitChapter();
      chapterTitle = line.slice(2).trim();
      if (!docTitleResolved) {
        docTitle = chapterTitle;
        docTitleResolved = true;
      }
    } else if (line.startsWith('## ')) {
      commitScene();
      if (chapterTitle === null) {
        // H2 before any H1: auto-create implicit chapter
        chapterTitle = docTitle;
      }
      sceneTitle = line.slice(3).trim();
    } else {
      sceneLines.push(line);
    }
  }

  commitChapter();

  // If nothing was produced, the document has no headings — single scene.
  if (chapters.length === 0) {
    const prose = lines.join('\n').trim();
    return {
      title: docTitle,
      chapters: [
        {
          title: docTitle,
          order: 0,
          scenes: [{ title: docTitle, prose, order: 0 }],
        },
      ],
    };
  }

  // Drop chapters that ended up with zero scenes (e.g. trailing H1 with no content).
  const nonEmpty = chapters.filter((ch) => ch.scenes.length > 0);
  return {
    title: docTitle,
    chapters: nonEmpty.length > 0 ? nonEmpty : chapters,
  };
}

/**
 * Convert a .docx buffer to a structured import result.
 * Throws on size overrun or mammoth parse failure.
 */
export async function parseDocxBuffer(
  buffer: Buffer,
  fallbackTitle = 'Untitled',
): Promise<DocxImportResult> {
  if (buffer.length > DOCX_MAX_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    throw new Error(`File exceeds the 50 MB size limit (${mb} MB)`);
  }

  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    throw new Error(
      `Failed to parse .docx: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const warnings = result.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message);

  const md = htmlToSplittableMarkdown(result.value);
  const { title, chapters } = splitDocxMarkdown(md, fallbackTitle);
  return { title, chapters, warnings };
}
