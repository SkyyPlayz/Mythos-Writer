// SKY-5705 (GH #642): shared document mark/format schema — the persistence
// contract between Story (BlockEditor) and Notes (NoteViewer). Both surfaces
// mount the same `useRichEditor` extension base (see useRichEditor.ts), so
// every entry below round-trips through `getEditorMarkdown()` identically
// regardless of which editor produced or reopens the document.
//
// This is a documentation/contract artifact, not new runtime behaviour: it
// names what the shared core already supports so "the schema" has one place
// to read and one place to extend. `RichTextEditor.test.tsx` pins every entry
// with a Story-vs-Notes parity assertion.

export type RichTextMarkKind = 'mark' | 'node';

export interface RichTextMarkDef {
  /** Tiptap/ProseMirror schema name (matches `editor.isActive(name)`). */
  name: string;
  kind: RichTextMarkKind;
  /** Human-readable label for changelogs/docs. */
  label: string;
  /** Markdown syntax the mark round-trips through (informational). */
  markdownSyntax: string;
}

/**
 * The full set of formatting marks/nodes guaranteed to round-trip
 * byte-identically between Story and Notes via the shared Markdown
 * serializer (`getEditorMarkdown` / `tiptap-markdown`).
 *
 * Sourced from StarterKit (bold/italic/strike/underline/headings/lists/
 * blockquote/code/codeBlock) plus WikiLink, the app's custom inline node.
 *
 * NOT included: text alignment. It round-trips (paragraph/heading only) via
 * AlignedParagraph/AlignedHeading's custom markdown-serialize storage
 * (alignedBlocks.ts) plus the mounted TextAlign extension — see
 * sharedRichTextSchema.test.ts and RichTextEditor.test.tsx for its contract
 * tests (SKY-5705/SKY-7073, GH #642). It's left out of this array because it
 * isn't a `mark` or `node` in the ProseMirror sense — it's an attribute on
 * the existing paragraph/heading nodes above — so it doesn't fit this list's
 * name/kind/markdownSyntax shape.
 */
export const RICH_TEXT_SCHEMA: readonly RichTextMarkDef[] = [
  { name: 'bold', kind: 'mark', label: 'Bold', markdownSyntax: '**text**' },
  { name: 'italic', kind: 'mark', label: 'Italic', markdownSyntax: '*text*' },
  { name: 'underline', kind: 'mark', label: 'Underline', markdownSyntax: '<u>text</u>' },
  { name: 'strike', kind: 'mark', label: 'Strikethrough', markdownSyntax: '~~text~~' },
  { name: 'code', kind: 'mark', label: 'Inline code', markdownSyntax: '`text`' },
  { name: 'heading', kind: 'node', label: 'Heading (H1–H6)', markdownSyntax: '# .. ###### ' },
  { name: 'bulletList', kind: 'node', label: 'Bullet list', markdownSyntax: '- item' },
  { name: 'orderedList', kind: 'node', label: 'Ordered list', markdownSyntax: '1. item' },
  { name: 'blockquote', kind: 'node', label: 'Blockquote', markdownSyntax: '> text' },
  { name: 'codeBlock', kind: 'node', label: 'Code block', markdownSyntax: '```\ncode\n```' },
  { name: 'wikiLink', kind: 'node', label: 'Wiki link', markdownSyntax: '[[target]]' },
] as const;

export const RICH_TEXT_SCHEMA_NAMES: readonly string[] = RICH_TEXT_SCHEMA.map((m) => m.name);
