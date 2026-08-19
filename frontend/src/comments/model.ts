// Beta 3 M11 — pure comment-anchoring functions (no React, no IPC).
//
// Ports of the Liquid Neon prototype logic:
//   segsFor          3601–3615 (anchor underline segmentation)
//   addCommentFromSel 3621–3629 (owning-scene lookup by substring)
// plus document-order sorting for the gutter dock so cards align with the
// order their anchors appear in the manuscript.

import type { Story } from '../types';
import { orderedBlocks, orderedChapters, orderedScenes } from '../story/manuscriptModel';
import type { CommentKind, StoryComment } from './types';

/** One run of paragraph text; `comment` is set on highlighted (anchored) runs. */
export interface AnchorSegment {
  text: string;
  comment?: { id: string; kind: CommentKind };
}

/**
 * Split paragraph `text` into plain/highlighted segments for the given
 * comments (prototype segsFor). Comments whose anchor is not a substring of
 * this paragraph are skipped; overlapping anchors keep the earliest match.
 * Returns null when nothing anchors here (caller renders plain text).
 */
export function segmentsFor(
  text: string,
  comments: readonly StoryComment[]
): AnchorSegment[] | null {
  const marks = comments
    .map((c) => ({ c, i: text.indexOf(c.anchor) }))
    .filter((m) => m.i > -1 && m.c.anchor.length > 0)
    .sort((a, b) => a.i - b.i);
  if (marks.length === 0) return null;

  const segs: AnchorSegment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.i < pos) continue; // overlap — first anchor wins (prototype behavior)
    if (m.i > pos) segs.push({ text: text.slice(pos, m.i) });
    segs.push({ text: m.c.anchor, comment: { id: m.c.id, kind: m.c.kind } });
    pos = m.i + m.c.anchor.length;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos) });
  return segs;
}

/**
 * Find the scene that owns `anchor` — the first scene (in document order)
 * with a paragraph block containing the selection (prototype
 * addCommentFromSel). Returns null when the selection spans paragraphs or
 * isn't manuscript text.
 */
export function findAnchorSceneId(story: Story, anchor: string): string | null {
  if (!anchor) return null;
  for (const chapter of orderedChapters(story)) {
    for (const scene of orderedScenes(chapter)) {
      for (const block of orderedBlocks(scene)) {
        if (block.content.includes(anchor)) return scene.id;
      }
    }
  }
  return null;
}

/**
 * Sort comments by where their anchors appear in the manuscript: scene
 * document order first, then anchor offset within the scene's joined text.
 * Comments on unknown scenes (or with unlocatable anchors) sort last, in
 * creation order, so they never vanish from the gutter.
 */
export function orderCommentsByDocument(
  story: Story,
  comments: readonly StoryComment[]
): StoryComment[] {
  const scenePos = new Map<string, number>();
  const sceneText = new Map<string, string>();
  let pos = 0;
  for (const chapter of orderedChapters(story)) {
    for (const scene of orderedScenes(chapter)) {
      scenePos.set(scene.id, pos++);
      sceneText.set(
        scene.id,
        orderedBlocks(scene)
          .map((b) => b.content)
          .join('\n\n')
      );
    }
  }
  const UNKNOWN = Number.MAX_SAFE_INTEGER;
  return comments
    .map((c, i) => {
      const sp = scenePos.get(c.sceneId) ?? UNKNOWN;
      const text = sceneText.get(c.sceneId);
      const at = text ? text.indexOf(c.anchor) : -1;
      return { c, sp, at: at === -1 ? UNKNOWN : at, i };
    })
    .sort((a, b) => a.sp - b.sp || a.at - b.at || a.i - b.i)
    .map((x) => x.c);
}

/** Ellipsize an anchor for card headers (prototype clips at 34 / 60 chars). */
export function clipAnchor(anchor: string, max: number): string {
  return anchor.length > max ? `${anchor.slice(0, max)}…` : anchor;
}
