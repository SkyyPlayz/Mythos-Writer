// #1765 — Import hub: the one contract every importer produces and the one
// commit writer consumes. Pure types, no runtime code.
//
// Flow: a dropped/picked path → importSafety (deny-list + sniff) → detect the
// source kind → the matching importer builds an ImportPlan → the renderer sees
// an ImportPreview (a trimmed, path-free view of the plan) → on confirm the
// cached plan is written exactly as previewed (importCommit.ts).

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

export interface ImportScene {
  title: string;
  /** Prose in the editor's Markdown dialect (see importHub/blocks.ts). */
  prose: string;
  order: number;
  /** Optional one-line synopsis (Scrivener index cards). */
  synopsis?: string;
}

export interface ImportChapter {
  title: string;
  order: number;
  scenes: ImportScene[];
}

export interface ImportStory {
  title: string;
  chapters: ImportChapter[];
  /** Part headings folded into chapter titles ("Part One · The Gate"); 0 = none. */
  partCount: number;
  structure: StructureSource;
}

/** Entity types a note can carry in its `type:` frontmatter. */
export type ImportEntityType = 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept';

export interface ImportNote {
  /** Display title (also the default file name). */
  title: string;
  /**
   * Folder inside the import's notes destination, POSIX separators, no
   * leading/trailing slash, '' for the destination root. Plain notes only —
   * entity notes are routed by `entityType` (importCommit decides the folder).
   */
  folder: string;
  /** Markdown body WITHOUT frontmatter (the writer adds frontmatter). */
  body: string;
  /** Present when this note is a character/location/… entity. */
  entityType?: ImportEntityType;
  /** Extra frontmatter carried from the source (tags, aliases, …). */
  frontmatter?: Record<string, string | string[]>;
}

/** Everything one import would write. Built by an importer, cached by token. */
export interface ImportPlan {
  source: {
    kind: ImportSourceKind;
    /** File or folder basename (no directories — never leak full paths). */
    name: string;
  };
  /** Null when the source has no manuscript (e.g. a notes-only Markdown folder). */
  story: ImportStory | null;
  notes: ImportNote[];
  warnings: string[];
}

// ─── Preview (what the renderer sees) ────────────────────────────────────────

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
