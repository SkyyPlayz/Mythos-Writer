/**
 * LC-2 fidelity guard for Notes rich-mode switching.
 *
 * Rich-mode (TipTap) cannot faithfully round-trip every Markdown feature.
 * Before switching from Source → Rich we check for constructs that TipTap's
 * StarterKit + tiptap-markdown would silently drop or mangle:
 *   - Markdown tables   (pipe-delimited rows)
 *   - Footnotes         ([^id] / [^id]: definitions)
 *   - Raw HTML tags     (<div>, <span>, ...) — except <u>, which the shared
 *     editor core's Underline extension round-trips losslessly (SKY-3204)
 *   - Complex callout blocks (> [!NOTE] shapes beyond the simple form below)
 *
 * M17 (Beta 4): the SIMPLE callout shape is no longer lossy — the Notes rich
 * editor renders it as an editable purple callout card (NoteCalloutExtension)
 * and serializes it back byte-identically. The supported shape is exactly:
 *
 *   > [!Title]
 *   > one single body line          (optional)
 *
 * at column 0, followed by a blank line or EOF. Anything else quoting a
 * `[!…]` marker (fold markers `[!x]-`, multi-line bodies, nesting, lazy
 * continuation, back-to-back callouts without a blank line) keeps the lossy
 * flag, because the round-trip would rewrite it.
 *
 * YAML frontmatter is deliberately NOT flagged: since W0.2 (Beta 4) the Rich
 * editor never sees it — NoteViewer holds the block aside verbatim and
 * re-attaches it on save (lib/frontmatter.ts), so it is lossless in Rich mode
 * and, per FULL-SPEC §6, never rendered there.
 */
export interface LossyFeature {
  key: string;
  label: string;
}

/** `> [!Title]` — exactly one `> ` prefix at column 0, title without `]`. */
export const CALLOUT_TITLE_LINE_RE = /^> \[!([^\]\r\n]+)\]$/;
/**
 * A supported callout body line: `> ` + text with no leading/trailing
 * whitespace (the serializer can only ever re-emit that exact shape).
 */
export const CALLOUT_BODY_LINE_RE = /^> (\S(?:.*\S)?)$/;
/** Any line still inside a blockquote (incl. indented / nested markers). */
const QUOTE_LINE_RE = /^\s*>/;
/** Any quoted line that carries a callout marker, supported or not. */
const CALLOUT_MARKER_RE = /^\s*>\s*\[!/;

/**
 * If `lines[i]` starts a callout the Notes rich editor round-trips
 * byte-identically, return how many lines it spans (1 = title only,
 * 2 = title + single body line). Returns 0 for every other shape.
 *
 * Shared by the fidelity guard and NoteCalloutExtension's markdown-it block
 * rule so "what parses as a card" and "what is safe for Rich mode" can never
 * drift apart.
 */
export function supportedCalloutLineCount(lines: readonly (string | undefined)[], i: number): 0 | 1 | 2 {
  const title = lines[i];
  if (title === undefined || !CALLOUT_TITLE_LINE_RE.test(title)) return 0;
  const next = lines[i + 1];
  if (next === undefined || next.trim() === '') return 1; // blank line / EOF after the title
  if (!QUOTE_LINE_RE.test(next)) return 0; // lazy continuation would be re-written
  if (CALLOUT_TITLE_LINE_RE.test(next)) return 0; // back-to-back callouts need a blank line
  if (!CALLOUT_BODY_LINE_RE.test(next)) return 0; // nested quote / `>` blank / padded body
  const after = lines[i + 2];
  if (after !== undefined && after.trim() !== '') return 0; // multi-line body or lazy continuation
  return 2;
}

/** True when the content quotes a `[!…]` marker in a shape Rich mode would rewrite. */
export function hasUnsupportedCallout(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!CALLOUT_MARKER_RE.test(lines[i])) continue;
    if (supportedCalloutLineCount(lines, i) === 0) return true;
  }
  return false;
}

const CHECKS: Array<{ key: string; label: string; test: (content: string) => boolean }> = [
  { key: 'tables',    label: 'Markdown tables', test: (c) => /^\|.+\|/m.test(c) },
  { key: 'footnotes', label: 'Footnotes',       test: (c) => /\[\^[^\]]+\]/.test(c) },
  { key: 'rawHtml',   label: 'Raw HTML',        test: (c) => /<(?!u>)[a-zA-Z][^>]*>/.test(c) },
  { key: 'callouts',  label: 'Complex callout blocks (> [!...])', test: hasUnsupportedCallout },
];

/**
 * Returns the list of lossy Markdown features found in `content`.
 * Empty array = safe to switch to Rich mode.
 */
export function detectLossyFeatures(content: string): LossyFeature[] {
  return CHECKS
    .filter(({ test }) => test(content))
    .map(({ key, label }) => ({ key, label }));
}
