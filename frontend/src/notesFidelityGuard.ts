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
 *   - Callout blocks    (> [!NOTE] / > [!WARNING] Obsidian-style)
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

const CHECKS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'tables',      label: 'Markdown tables',               pattern: /^\|.+\|/m },
  { key: 'footnotes',   label: 'Footnotes',                     pattern: /\[\^[^\]]+\]/ },
  { key: 'rawHtml',     label: 'Raw HTML',                      pattern: /<(?!u>)[a-zA-Z][^>]*>/ },
  { key: 'callouts',    label: 'Callout blocks (> [!...])',      pattern: /^>\s*\[!/m },
];

/**
 * Returns the list of lossy Markdown features found in `content`.
 * Empty array = safe to switch to Rich mode.
 */
export function detectLossyFeatures(content: string): LossyFeature[] {
  return CHECKS
    .filter(({ pattern }) => pattern.test(content))
    .map(({ key, label }) => ({ key, label }));
}
