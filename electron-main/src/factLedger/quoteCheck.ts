// Purpose: find an extractor's quote in scene prose by exact UTF-16 code units,
// or drop the fact. Pure: no imports, no fs, no DB, no hashing.

/** Code units of context compared on each side when a quote occurs more than once. */
export const QUOTE_CONTEXT_UNITS = 32;

export interface QuoteSpan {
  /** UTF-16 code-unit offset into prose, inclusive. */
  start: number;
  /** UTF-16 code-unit offset into prose, exclusive. */
  end: number;
}

export interface SplitScene {
  /** The frontmatter block including both fences, or '' when there is none. */
  frontmatter: string;
  /** Everything after the frontmatter. The only text an extractor may see. */
  prose: string;
}

/**
 * Same block the vault reads as frontmatter (vault.ts parseFrontmatter): an
 * opening `---` line, then everything up to the first `\n---` line (only
 * spaces or tabs after it). `...` and a lone `\r` do not close it.
 */
const VAULT_FRONTMATTER = /^---\r?\n[\s\S]*?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split frontmatter off a scene file exactly as the vault does, so nothing the
 * vault treats as frontmatter can reach an extractor. Like the vault, NUL
 * characters are removed first, so `prose` equals the vault's prose. A block
 * after a leading byte-order mark is also removed (stricter than the vault).
 */
export function splitFrontmatter(sceneText: string): SplitScene {
  const text = sceneText.replace(/\x00/g, '');
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const match = VAULT_FRONTMATTER.exec(text.slice(bom));
  if (!match) return { frontmatter: '', prose: text };
  const cut = bom + match[0].length;
  return { frontmatter: text.slice(0, cut), prose: text.slice(cut) };
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** A hit that starts or ends inside a surrogate pair is not a real character match. */
function splitsSurrogatePair(prose: string, start: number, end: number): boolean {
  if (start > 0 && isLow(prose.charCodeAt(start)) && isHigh(prose.charCodeAt(start - 1))) return true;
  if (end < prose.length && isLow(prose.charCodeAt(end)) && isHigh(prose.charCodeAt(end - 1))) return true;
  return false;
}

/**
 * Locate `quote` in `prose` and return its span, or null to drop the fact.
 *
 * - Exact code-unit match only: no trimming, case or whitespace folding,
 *   Unicode normalization, newline normalization or fuzzy matching.
 * - An empty or whitespace-only quote is rejected.
 * - One hit is returned as is. With several hits, the QUOTE_CONTEXT_UNITS code
 *   units on each side must equal `contextBefore` and `contextAfter`; if that
 *   still leaves zero or several hits, the fact is dropped.
 * - `prose` is the scene body (see splitFrontmatter); frontmatter is never searched.
 */
export function locateQuote(
  prose: string,
  quote: string,
  contextBefore: string,
  contextAfter: string,
): QuoteSpan | null {
  if (typeof prose !== 'string' || typeof quote !== 'string') return null;
  if (typeof contextBefore !== 'string' || typeof contextAfter !== 'string') return null;
  if (quote.length === 0 || /^\s*$/u.test(quote)) return null;

  const hits: QuoteSpan[] = [];
  for (let at = prose.indexOf(quote); at !== -1; at = prose.indexOf(quote, at + 1)) {
    const end = at + quote.length;
    if (!splitsSurrogatePair(prose, at, end)) hits.push({ start: at, end });
  }

  let chosen: QuoteSpan | undefined;
  if (hits.length === 1) {
    chosen = hits[0];
  } else if (hits.length > 1) {
    const matching = hits.filter(
      ({ start, end }) =>
        prose.slice(Math.max(0, start - QUOTE_CONTEXT_UNITS), start) === contextBefore &&
        prose.slice(end, end + QUOTE_CONTEXT_UNITS) === contextAfter,
    );
    if (matching.length === 1) chosen = matching[0];
  }

  if (!chosen || prose.slice(chosen.start, chosen.end) !== quote) return null;
  return { start: chosen.start, end: chosen.end };
}
