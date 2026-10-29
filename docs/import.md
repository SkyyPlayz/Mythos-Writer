# Import your writing (#1765)

Settings → Vault & Files → **Import your writing** is the one way into Mythos
for writing made somewhere else. Drop a file or folder on the drop zone, or
use **Choose a file…** / **Choose a folder…**. Mythos checks the file is
safe, works out what it is, and shows a **preview** (story chapters and
scenes, notes, characters and places) before anything is saved. Nothing is
written until you press **Import**.

## What it reads

| Source | How to bring it in | What you get |
|---|---|---|
| Word `.docx` (also Google Docs → Download → `.docx`) | file | Chapters and scenes, with bold, italics, underline, strikethrough, centering and line breaks kept |
| Google Docs → Download → Web page (`.html`) | file | Same as Word, read from the export's style sheet |
| Markdown file (`.md`, `.markdown`, `.mdown`, `.mkd`) | file | A manuscript split on `#` / `##` headings and `***` breaks |
| Markdown folder (Obsidian, iA Writer, Ulysses / Bear / Typora / Joplin / Logseq / Zettlr exports, …) | folder | Notes keep their folders; `Characters/`, `Locations/` … or a `type:` field become characters and places; a `Manuscript/` / `Draft/` / numbered-files folder becomes the story |
| Scrivener 2 or 3 (`.scriv` folder or `.scrivx`) | folder or file | The Draft folder as chapters and scenes (with formatting and synopses), Research and character/place folders as notes |
| ePub | file | One chapter per book section; the book's own title |
| Rich Text `.rtf` | file | Chapters and scenes with formatting |
| Plain text `.txt` | file | Chapters found from "Chapter One" lines or page breaks |

### How chapters and scenes are found

In order, the first that fits wins:

1. **Heading styles** — Heading 1 / 2 / 3 (or `#` / `##` / `###`). Two levels
   are chapters and scenes; three are parts, chapters and scenes (part names
   fold into chapter titles: "Part One · The Gate").
2. **"Chapter" lines** — "Chapter One", "CHAPTER 2", "Chapter 3: The Gate",
   "Prologue", "Epilogue", "Part Two" … typed in normal text.
3. **Page breaks** between chapters.
4. Otherwise the whole document is one chapter, and the preview says so.

Inside a chapter, a scene break (`***`, `* * *`, `#`, `⁂`, a Scene Break
style, or an extra blank line in a single-spaced document) starts a new
scene. Manuscripts double-spaced with empty lines are not split on every
line.

A short title page or dedication before the first chapter (250 words or
less) is kept as a **Front Matter** chapter instead of being dropped. If the
book has no Title-style line, that page's first line names the book.

### Where it goes

- The story goes into the open Mythos vault as a new book (a second import
  of the same title gets "(2)"). It appears in the Story Navigator straight
  away.
- Notes go to `Imported/<source name>/…` in the Notes Vault. Characters,
  places, factions and items go to `Characters/`, `Locations/`, `Factions/`
  and `Items/`. Existing notes are never overwritten.
- A **Story Plan** note listing every chapter and scene goes to `Plans/`.

## Safety

Mythos never opens programs, scripts or macro files. These are refused
before any byte is parsed:

- **By extension** (checked on the last extension, so `Chapter 1.docx.exe`
  is refused): programs and installers (`.exe`, `.msi`, `.app`, `.dmg`,
  `.pkg`, `.deb`, `.apk` …), scripts (`.bat`, `.cmd`, `.ps1`, `.vbs`,
  `.js`, `.sh`, `.py` …), shortcuts (`.lnk`, `.url`, `.desktop`), disk
  images (`.iso`, `.img`, `.vhd`), libraries (`.dll`, `.so`, `.dylib`) and
  macro-enabled Office files (`.docm`, `.xlsm`, `.pptm` …). The full list is
  `DENIED_IMPORT_EXTENSIONS` in `electron-main/src/importHub/importSafety.ts`.
- **By content**, whatever the file is called: Windows / Linux / Mac
  programs, `#!` scripts, old `.doc` files (they can carry macros — save as
  `.docx` first), Word files that contain macros, and "zip bombs" (files
  whose contents inflate far beyond what they claim).
- Files over 50 MB, and archives other than `.docx` / `.epub`, are not read.

### Unknown files (owner decision)

The issue asked us to pick one fallback for unknown-but-safe files: a
plain-text note, or "can't read this yet". **We picked "can't read this
yet."** A file whose type Mythos doesn't import, and that passes the safety
check, gets: *"Mythos can't read .xyz files yet. You can import Word
(.docx), Google Docs exports, Markdown, Scrivener, ePub, RTF or plain text."*
Guessing at unknown files as text would turn formats like `.pages` or `.odt`
into pages of garbage scenes.

## Not in this version

- Notion and Plottr (after release).
- World Anvil, Novelcrafter, Campfire and Evernote (on request, later).
- A "Request an import" link (later).
- Images, footnotes, comments and tracked changes inside documents are not
  imported (the preview warns with a count). Lists come in as paragraphs.
