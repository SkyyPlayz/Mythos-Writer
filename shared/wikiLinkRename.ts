// SKY-10712: pure [[wikilink]] retarget transform for note renames — single
// source of truth imported by both electron-main (the on-disk cascade) and
// frontend (patching in-memory manuscript state so open editors converge on
// the rewritten disk content instead of clobbering it on their next save).
//
// Resolution semantics mirror vaultGraph.ts/noteBacklinks.ts: a link targets
// a note by its filename STEM — last path segment, '.md' stripped, matched
// case-insensitively. Folder prefixes ([[chars/Jasper]]), headings
// ([[Jasper#Backstory]]), aliases ([[Jasper|Jay]]), embeds (![[Jasper]]) and
// any combination are all retargeted while the rest of the link is kept.
//
// ONLY text inside a [[...]] span is ever touched. Plain-text occurrences of
// the note name are structurally unreachable by this transform — a rename
// must never become a find-and-replace over prose (owner ruling, SKY-10712).

export type WikiLinkRewriteMode =
  /** Notes vault: bare [[Old]] becomes [[New]] — display text may change
   *  (Obsidian's "Automatically update internal links" behaviour). */
  | 'update-display'
  /** Manuscript/story vault: bare [[Old]] becomes [[New|Old]] — the link is
   *  retargeted but the rendered words are preserved byte-for-byte. Renaming
   *  a note is a metadata action; changing prose is an editorial one. */
  | 'preserve-display';

export interface WikiLinkRewriteResult {
  content: string;
  /** Number of links retargeted. 0 means `content` is the input, unchanged. */
  count: number;
}

// Inner span may not contain brackets or newlines — same grammar the editor's
// markdown-it rule and vaultGraph's extractor accept. The leading `!` of an
// embed sits outside the match and is untouched.
const WIKI_LINK_RE = /\[\[([^\][\n]+)\]\]/g;

/**
 * Retarget every wikilink whose stem matches `oldStem` (case-insensitive) to
 * `newStem`. Links with an explicit alias keep it verbatim in BOTH modes —
 * `[[Jasper|Jay]]` → `[[Jasper Thorne|Jay]]` — the display text "Jay" is
 * the author's and must never change.
 *
 * Stems are note titles without the '.md' extension.
 */
export function rewriteWikiLinksForRename(
  content: string,
  oldStem: string,
  newStem: string,
  mode: WikiLinkRewriteMode,
): WikiLinkRewriteResult {
  const oldKey = oldStem.trim().toLowerCase();
  let count = 0;

  const next = content.replace(WIKI_LINK_RE, (full, inner: string) => {
    const pipeAt = inner.indexOf('|');
    const targetPart = pipeAt < 0 ? inner : inner.slice(0, pipeAt);
    // `[[Old|]]` renders its target (alias falls back to target when empty),
    // so an empty alias is treated as absent — otherwise a preserve-display
    // rewrite to `[[New|]]` would silently change the visible words.
    const rawAlias = pipeAt < 0 ? '' : inner.slice(pipeAt + 1);
    const alias = rawAlias === '' ? null : rawAlias;

    const hashAt = targetPart.indexOf('#');
    const pathPart = hashAt < 0 ? targetPart : targetPart.slice(0, hashAt);
    const headingPart = hashAt < 0 ? '' : targetPart.slice(hashAt);

    const segments = pathPart.split(/[\\/]/);
    const lastSeg = segments[segments.length - 1].trim();
    const hadMdExt = /\.md$/i.test(lastSeg);
    const segStem = hadMdExt ? lastSeg.slice(0, -3) : lastSeg;
    if (segStem.toLowerCase() !== oldKey) return full;

    const prefix = segments.slice(0, -1).join('/');
    const newTarget =
      (prefix ? `${prefix}/` : '') + newStem + (hadMdExt ? '.md' : '') + headingPart;
    count++;

    if (alias !== null) {
      // `[[X|X]]` renders and resolves identically to `[[X]]` — normalize.
      // This also makes the transform its own inverse for undo: the forward
      // pass pins the old target as alias, the reverse pass collapses it.
      return alias === newTarget ? `[[${newTarget}]]` : `[[${newTarget}|${alias}]]`;
    }
    if (mode === 'preserve-display' && targetPart !== newTarget) {
      // The editor renders `alias || target`: pinning the original target
      // text as the alias keeps the visible words byte-identical.
      return `[[${newTarget}|${targetPart}]]`;
    }
    return `[[${newTarget}]]`;
  });

  return count === 0 ? { content, count } : { content: next, count };
}
