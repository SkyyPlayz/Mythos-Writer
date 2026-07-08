// GH #631: heading-driven view splitting — pure selectors over a ProseMirror
// document. A "section" is a heading plus everything after it up to the next
// heading of the same or shallower level (Word outline-view semantics). The
// document itself is NEVER mutated or filtered: consumers hide the
// out-of-section blocks with decorations, so saves and scene version backups
// always carry the full document.
import type { Node as PMNode } from '@tiptap/pm/model';

export interface HeadingInfo {
  /** Position of the heading node itself. */
  pos: number;
  level: number;
  text: string;
}

export interface FocusStepState {
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
}

/** Every heading in the document, in document order. */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ pos, level: Number(node.attrs.level), text: node.textContent });
    }
    return true;
  });
  return out;
}

/** Distinct heading levels present in the document, ascending. */
export function levelsPresent(doc: PMNode): number[] {
  return [...new Set(collectHeadings(doc).map((h) => h.level))].sort((a, b) => a - b);
}

export function headingsAtLevel(doc: PMNode, level: number): HeadingInfo[] {
  return collectHeadings(doc).filter((h) => h.level === level);
}

/**
 * [start, end) of the section owned by the `index`-th level-`level` heading:
 * from that heading to the next heading with level <= `level`, or doc end.
 * Returns null when no such heading exists.
 */
export function sectionRange(doc: PMNode, level: number, index: number): { start: number; end: number } | null {
  const all = collectHeadings(doc);
  const atLevel = all.filter((h) => h.level === level);
  const active = atLevel[index];
  if (!active) return null;
  const following = all.find((h) => h.pos > active.pos && h.level <= level);
  return { start: active.pos, end: following ? following.pos : doc.content.size };
}

/**
 * Top-level blocks fully outside the active section — the ranges a consumer
 * should hide. A block that straddles the boundary (e.g. a heading nested in a
 * blockquote) stays visible: visible-but-extra beats hidden-but-lost.
 */
export function hiddenRanges(doc: PMNode, level: number, index: number): Array<{ from: number; to: number }> {
  const section = sectionRange(doc, level, index);
  if (!section) return [];
  const ranges: Array<{ from: number; to: number }> = [];
  doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;
    if (to <= section.start || from >= section.end) {
      ranges.push({ from, to });
    }
  });
  return ranges;
}

/** Keep the focus index valid as the document changes underneath it. */
export function clampIndex(doc: PMNode, level: number, index: number): number {
  const count = headingsAtLevel(doc, level).length;
  if (count === 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/** Bounded prev/next among same-level headings (mirrors stepScene semantics). */
export function stepFocus(doc: PMNode, level: number, index: number, direction: 'prev' | 'next'): FocusStepState {
  const count = headingsAtLevel(doc, level).length;
  const next = clampIndex(doc, level, index + (direction === 'next' ? 1 : -1));
  return { index: next, count, canPrev: next > 0, canNext: next < count - 1 };
}

/** Current step state without moving. */
export function focusState(doc: PMNode, level: number, index: number): FocusStepState {
  const count = headingsAtLevel(doc, level).length;
  const clamped = clampIndex(doc, level, index);
  return { index: clamped, count, canPrev: clamped > 0, canNext: clamped < count - 1 };
}

export interface FocusSelection {
  level: number | null;
  index: number;
}

/**
 * SKY-5902: if the user edits away every heading of the focused level,
 * `levelsPresent` stops reporting it — but the caller's selection state
 * doesn't know that on its own. Snap back to "All" (Word's outline-view
 * behavior) so a level selector never points at an option nothing renders
 * for. Returns the same object (by reference) when no reset is needed.
 */
export function reconcileFocusLevel(selection: FocusSelection, levels: number[]): FocusSelection {
  if (selection.level !== null && !levels.includes(selection.level)) {
    return { level: null, index: 0 };
  }
  return selection;
}
