// Beta 4 M11 — sentence-level reading highlight (§5.1 "highlights the
// sentence being read").
//
// The paragraph being read keeps its M13 block-level wash; on top of it the
// exact sentence is painted via the CSS Custom Highlight API
// (`CSS.highlights` + `::highlight(msv-reading-sentence)` in
// ManuscriptView.css). The API styles arbitrary text ranges WITHOUT touching
// the DOM — critical for the manuscript's contentEditable paragraphs, whose
// children must stay reference-stable (see ParagraphRow's memo contract).
// Electron's Chromium supports it; jsdom does not, so every entry point
// feature-detects and degrades to the block-level wash alone.

export const READING_HIGHLIGHT_NAME = 'msv-reading-sentence';

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): unknown;
  delete(name: string): boolean;
}

type HighlightCtor = new (...ranges: AbstractRange[]) => unknown;

function highlightApi(): { registry: HighlightRegistryLike; Ctor: HighlightCtor } | null {
  try {
    const g = globalThis as {
      CSS?: { highlights?: HighlightRegistryLike };
      Highlight?: HighlightCtor;
    };
    if (!g.CSS?.highlights || typeof g.Highlight !== 'function') return null;
    return { registry: g.CSS.highlights, Ctor: g.Highlight };
  } catch {
    return null;
  }
}

/**
 * Build a DOM Range over the character span [start, end) of `el`'s visible
 * text (which may be split across nested spans — comment anchors, auto-link
 * hints). Returns null when the offsets fall outside the element's text,
 * e.g. mid-edit drift between committed content and the live DOM.
 */
export function sentenceDomRange(el: Element, start: number, end: number): Range | null {
  if (end <= start || start < 0) return null;
  const doc = el.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let offset = 0;
  let haveStart = false;
  let node = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (!haveStart && start < offset + len) {
      range.setStart(node, start - offset);
      haveStart = true;
    }
    if (haveStart && end <= offset + len) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += len;
    node = walker.nextNode();
  }
  return null;
}

/**
 * Paint the reading-sentence highlight over [start, end) of `el`'s text.
 * Clears any previous highlight first. Returns true when the highlight was
 * registered (false = API unavailable / bad range — callers need no fallback
 * handling beyond the block-level wash they already render).
 */
export function setReadingSentenceHighlight(
  el: Element | null | undefined,
  start: number,
  end: number
): boolean {
  const api = highlightApi();
  if (!api) return false;
  if (!el) {
    api.registry.delete(READING_HIGHLIGHT_NAME);
    return false;
  }
  const range = sentenceDomRange(el, start, end);
  if (!range) {
    api.registry.delete(READING_HIGHLIGHT_NAME);
    return false;
  }
  api.registry.set(READING_HIGHLIGHT_NAME, new api.Ctor(range));
  return true;
}

/** Remove the reading-sentence highlight (playback paused/stopped/unmounted). */
export function clearReadingSentenceHighlight(): void {
  highlightApi()?.registry.delete(READING_HIGHLIGHT_NAME);
}
