/**
 * LC-2 fidelity guard for Notes rich-mode switching.
 *
 * Rich-mode (TipTap) cannot faithfully round-trip every Markdown feature.
 * Before switching from Source → Rich we check for constructs that TipTap's
 * StarterKit + tiptap-markdown would silently drop or mangle:
 *   - YAML frontmatter  (--- block at the top)
 *   - Markdown tables   (pipe-delimited rows)
 *   - Footnotes         ([^id] / [^id]: definitions)
 *   - Raw HTML tags     (<div>, <span>, ...) — except <u>, which the shared
 *     editor core's Underline extension round-trips losslessly (SKY-3204)
 *   - Callout blocks    (> [!NOTE] / > [!WARNING] Obsidian-style)
 */
export interface LossyFeature {
  key: string;
  label: string;
}

const CHECKS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'frontmatter', label: 'YAML frontmatter (--- block)', pattern: /^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/ },
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
