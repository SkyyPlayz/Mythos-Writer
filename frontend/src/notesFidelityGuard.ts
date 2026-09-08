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
 *
 * SKY-11443: the checks are Markdown-context aware. Code (fenced blocks and
 * inline spans) is masked before they run, because its contents are literal
 * text that round-trips as a code block — a ```` ```html ```` sample or a pipe
 * table pasted into a fence is not lossy. Masking preserves line count, line
 * length and blank/non-blank-ness so block structure (callouts) is unchanged.
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

/** Opening fence: up to 3 leading spaces, then 3+ backticks or tildes. */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Replace every character of `line` with a filler, keeping its length. */
function blank(line: string): string {
  return 'x'.repeat(line.length);
}

/**
 * Mask inline code spans in a single line.
 *
 * CommonMark: a run of N backticks opens a span that the next run of exactly N
 * backticks closes. Unpaired runs are literal text and stay visible.
 */
function maskInlineCode(line: string): string {
  const runs: Array<{ start: number; len: number }> = [];
  for (const m of line.matchAll(/`+/g)) runs.push({ start: m.index ?? 0, len: m[0].length });

  let out = line;
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((r, j) => j > i && r.len === runs[i].len);
    if (close === -1) continue;
    const from = runs[i].start;
    const to = runs[close].start + runs[close].len;
    out = out.slice(0, from) + blank(out.slice(from, to)) + out.slice(to);
    i = close; // everything up to the closing run is consumed
  }
  return out;
}

/**
 * Return `content` with all code regions replaced by filler characters.
 *
 * Line count, line lengths and which lines are blank are all preserved, so the
 * structural (callout) check sees exactly the same block layout as the raw
 * body — masking can only remove false positives, never create false negatives.
 *
 * Out of scope: 4-space indented code blocks, and fences nested inside a
 * blockquote — neither appears in the reported false positives and both need a
 * real block parser to detect safely.
 */
function maskCode(content: string): string {
  const lines = content.split('\n');
  let fence: { marker: string; len: number } | null = null;

  return lines
    .map((line) => {
      const text = line.replace(/\r$/, '');
      if (fence) {
        // `marker` is only ever a backtick or a tilde — neither needs escaping.
        const closes = new RegExp(`^ {0,3}${fence.marker}{${fence.len},}\\s*$`).test(text);
        if (closes) fence = null;
        return blank(line);
      }
      const open = FENCE_OPEN_RE.exec(text);
      // A backtick fence's info string may not contain a backtick.
      if (open && !(open[1].startsWith('`') && open[2].includes('`'))) {
        fence = { marker: open[1][0], len: open[1].length };
        return blank(line);
      }
      return maskInlineCode(line);
    })
    .join('\n');
}

/**
 * Tag-shaped raw HTML: `<name …>` or `</name>`, optionally self-closing.
 *
 * Deliberately narrow so Markdown autolinks stay clean — `<https://example.com>`
 * and `<ed@example.com>` fail the "name then whitespace-or-`>`" shape, because
 * `:` and `@` are neither.
 */
const HTML_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/g;

/** True when the content carries raw HTML other than `<u>` (SKY-3204). */
function hasRawHtml(content: string): boolean {
  for (const m of content.matchAll(HTML_TAG_RE)) {
    // The Underline exception is case-insensitive and attribute-tolerant:
    // `<U>`, `<u class="x">` and `</u>` all round-trip losslessly.
    if (m[1].toLowerCase() !== 'u') return true;
  }
  return false;
}

const CHECKS: Array<{ key: string; label: string; test: (content: string) => boolean }> = [
  { key: 'tables',    label: 'Markdown tables', test: (c) => /^\|.+\|/m.test(c) },
  { key: 'footnotes', label: 'Footnotes',       test: (c) => /\[\^[^\]]+\]/.test(c) },
  { key: 'rawHtml',   label: 'Raw HTML',        test: hasRawHtml },
  { key: 'callouts',  label: 'Complex callout blocks (> [!...])', test: hasUnsupportedCallout },
];

/**
 * Returns the list of lossy Markdown features found in `content`.
 * Empty array = safe to switch to Rich mode.
 */
export function detectLossyFeatures(content: string): LossyFeature[] {
  const masked = maskCode(content);
  return CHECKS
    .filter(({ test }) => test(masked))
    .map(({ key, label }) => ({ key, label }));
}
