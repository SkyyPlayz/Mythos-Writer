// #1765 — Renderer-side copies of the import hub's preview/commit contract.
// The frontend cannot import electron-main, so these mirror
// electron-main/src/importHub/types.ts EXACTLY (same names, fields and
// comments). ImportSection.test.tsx compares the two declarations, so any
// drift fails CI — change both files together.
//
// Pure types, no runtime code.

/** Where the content came from (drives labels + the Story Plan note). */
export type ImportSourceKind =
  | 'docx'            // Word .docx (also Google Docs "Download → .docx")
  | 'gdoc-html'       // Google Docs "Download → Web page (.html)"
  | 'html'            // any other .html/.htm document
  | 'markdown'        // one .md / .markdown file
  | 'markdown-folder' // a folder of Markdown (Obsidian, iA Writer, Ulysses, Bear, …)
  | 'scrivener'       // a .scriv project folder or its .scrivx file
  | 'epub'            // ePub book
  | 'rtf'             // a standalone .rtf document
  | 'text';           // plain .txt

/**
 * How chapter/scene boundaries were found — shown in the preview so a writer
 * knows why their book was split the way it was.
 */
export type StructureSource =
  | 'headings'   // Heading 1/2/3 styles (or # / ## / ###)
  | 'patterns'   // "Chapter One", "CHAPTER 2", "Prologue" … lines
  | 'pagebreaks' // hard page breaks between chapters
  | 'binder'     // Scrivener binder folders/documents
  | 'files'      // one file per chapter (Markdown folder)
  | 'none';      // no structure found — one chapter, one scene

/** Entity types a note can carry in its `type:` frontmatter. */
export type ImportEntityType = 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept';

export interface ImportPreviewScene {
  title: string;
  words: number;
}

export interface ImportPreviewChapter {
  title: string;
  words: number;
  scenes: ImportPreviewScene[];
}

export interface ImportPreview {
  /** Opaque, single-use handle for import:commit. Bound to the cached plan. */
  token: string;
  source: { kind: ImportSourceKind; label: string; name: string };
  story: {
    title: string;
    structure: StructureSource;
    partCount: number;
    words: number;
    chapters: ImportPreviewChapter[];
    /** First ~600 chars of the first non-empty scene, editor Markdown, for a formatting check. */
    excerpt: string;
  } | null;
  notes: { title: string; folder: string }[];
  entities: { title: string; type: ImportEntityType }[];
  warnings: string[];
  /** False when there is no open Mythos vault to import into (preview still works). */
  canCommit: boolean;
  /** Why canCommit is false, in plain words. */
  commitBlockedReason?: string;
}

/** import:preview / import:pick result. */
export type ImportPreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; refused: true; reason: string; name?: string } // dangerous type — never parsed
  | { ok: false; refused: false; error: string; name?: string } // unreadable / unsupported / failed
  | { ok: false; cancelled: true };                             // picker dismissed

export interface ImportCommitOptions {
  /** Write the manuscript (default true when the plan has one). */
  story?: boolean;
  /** Write notes + entities (default true when the plan has any). */
  notes?: boolean;
}

export type ImportCommitResult =
  | {
      ok: true;
      storyTitle?: string;
      chapterCount: number;
      sceneCount: number;
      noteCount: number;
      entityCount: number;
      /** Notes-vault-relative path of the Story Plan note, when one was written. */
      planNotePath?: string;
      warnings: string[];
    }
  | { ok: false; error: string };
