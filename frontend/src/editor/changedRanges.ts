import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/**
 * Widens [from, to] out to the enclosing textblock(s) so a scoped rescan
 * still sees whole words (a mention can start/end outside the raw changed
 * range, e.g. typing inside an existing word).
 */
export function expandToTextblocks(doc: PMNode, from: number, to: number): { from: number; to: number } {
  const clampedFrom = Math.max(0, Math.min(from, doc.content.size));
  const clampedTo = Math.max(0, Math.min(to, doc.content.size));
  const $from = doc.resolve(clampedFrom);
  const $to = doc.resolve(clampedTo);

  let start = clampedFrom;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).isTextblock) {
      start = $from.before(d);
      break;
    }
  }
  let end = clampedTo;
  for (let d = $to.depth; d > 0; d--) {
    if ($to.node(d).isTextblock) {
      end = $to.after(d);
      break;
    }
  }
  return { from: Math.min(start, end), to: Math.max(start, end) };
}

/** Maps the ranges touched by `tr`'s steps forward into final `tr.doc` coordinates. */
export function changedRanges(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((stepMap, i) => {
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, tr.mapping.slice(i + 1).map(newStart, -1));
      to = Math.max(to, tr.mapping.slice(i + 1).map(newEnd, 1));
    });
  });
  if (from > to) return null;
  return { from, to };
}
