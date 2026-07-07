// Beta 3 M23 — auto-[[link]]ing for the heading-zoom manuscript (plain-text).
//
// The archive auto-linker exists since SKY-192 as a TipTap plugin
// (AutoLinkerExtension.ts) and still runs in the scene-depth BlockEditor.
// The M9 ManuscriptView renders paragraphs as contentEditable plain text, so
// this module ports the same matching (REUSING the extension's exported pure
// helpers `buildEntityTerms` / `findEntityMentions`) onto plain strings:
//
//   - findAutoLinkHints  — entity mentions not already inside a [[wiki link]]
//   - applyAutoLinkHint  — replace one mention with [[Canonical]] /
//                          [[Canonical|anchor]] (Obsidian alias convention)
//   - applyAllAutoLinkHints — 'auto' mode: link every mention on commit
//   - splitRunByHints    — sub-segment a rendered text run around its hints
//                          (composes with the M11 comment-anchor segments)

import {
  findEntityMentions,
  type EntityMatch,
  type EntityTerm,
} from '../AutoLinkerExtension';

export type { EntityMatch, EntityTerm };

/** Character spans (inclusive start, exclusive end) of `[[...]]` tokens. */
export function wikiLinkSpans(text: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  const re = /\[\[[^[\]]+\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ from: m.index, to: m.index + m[0].length });
  }
  return spans;
}

/**
 * Entity mentions in `text` that are NOT already inside a `[[...]]` token,
 * sorted by position. Same matching rules as the TipTap plugin (word
 * boundaries, longest-term-first, non-overlapping).
 */
export function findAutoLinkHints(text: string, terms: EntityTerm[]): EntityMatch[] {
  if (terms.length === 0 || !text) return [];
  const linked = wikiLinkSpans(text);
  return findEntityMentions(text, terms)
    .filter((match) => !linked.some((s) => match.from < s.to && match.to > s.from))
    .sort((a, b) => a.from - b.from);
}

/** The wiki-link token for a hint: `[[Name]]`, or `[[Name|anchor]]` when the
 *  matched prose differs from the canonical name (alias / case difference). */
export function wikiLinkFor(hint: Pick<EntityMatch, 'anchorText' | 'canonicalName'>): string {
  return hint.anchorText === hint.canonicalName
    ? `[[${hint.canonicalName}]]`
    : `[[${hint.canonicalName}|${hint.anchorText}]]`;
}

/** Replace one matched mention with its wiki-link token. */
export function applyAutoLinkHint(text: string, hint: EntityMatch): string {
  return text.slice(0, hint.from) + wikiLinkFor(hint) + text.slice(hint.to);
}

/** 'auto' mode: link every current mention (applied right-to-left so earlier
 *  offsets stay valid). Returns `text` unchanged when nothing matches. */
export function applyAllAutoLinkHints(text: string, terms: EntityTerm[]): string {
  const hints = findAutoLinkHints(text, terms);
  let out = text;
  for (let i = hints.length - 1; i >= 0; i--) {
    out = applyAutoLinkHint(out, hints[i]);
  }
  return out;
}

/** One run of a rendered paragraph: plain text, or a clickable hint. */
export interface HintRun {
  text: string;
  /** Set on hint runs — the match re-based onto the FULL paragraph text. */
  hint?: EntityMatch;
}

/**
 * Sub-segment a text run (which starts at `runStart` within the paragraph)
 * around the paragraph-level hints it fully contains. The concatenated run
 * text always equals the input, so contentEditable textContent commits are
 * unaffected. Returns null when no hint lands in this run.
 */
export function splitRunByHints(
  runText: string,
  runStart: number,
  hints: readonly EntityMatch[],
): HintRun[] | null {
  const runEnd = runStart + runText.length;
  const inside = hints.filter((h) => h.from >= runStart && h.to <= runEnd);
  if (inside.length === 0) return null;

  const runs: HintRun[] = [];
  let pos = runStart;
  for (const h of inside) {
    if (h.from > pos) runs.push({ text: runText.slice(pos - runStart, h.from - runStart) });
    runs.push({ text: runText.slice(h.from - runStart, h.to - runStart), hint: h });
    pos = h.to;
  }
  if (pos < runEnd) runs.push({ text: runText.slice(pos - runStart) });
  return runs;
}
