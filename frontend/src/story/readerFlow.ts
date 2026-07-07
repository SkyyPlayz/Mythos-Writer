// Beta 3 M13 — TTS reader flow model (pure functions, no React).
//
// Port of the Liquid Neon prototype's reader linearization
// (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html":
//  buildFlow 3633–3656, readerStart fromCursor 3681–3684,
//  readerScene 3697–3702) mapped onto the repo's Story → Chapter → Scene →
// Block hierarchy from manuscriptModel.ts.
//
// A "flow" is the ordered list of utterances the reader speaks. Paragraph
// items carry the Block id as `key` so ManuscriptView can highlight the
// paragraph being read (`msv-para-<blockId>`); headings carry key null (no
// paragraph to highlight while a chapter/scene title is announced).

import type { Story } from '../types';
import {
  orderedBlocks,
  orderedChapters,
  orderedScenes,
  type ManuscriptCursor,
} from './manuscriptModel';

export interface ReaderFlowItem {
  /** Utterance text passed to the TTS engine. */
  text: string;
  /** Paragraph Block id for the moving highlight, or null for headings/selection. */
  key: string | null;
  /** Owning scene id, or null for selection-only flows. */
  sceneId: string | null;
  /** Global scene ordinal (prototype `scene` counter) — drives ±scene skips. */
  sceneOrdinal: number;
}

/**
 * Linearize the manuscript into utterances, scoped exactly like
 * buildBlocks: book/part → everything, chapter → the cursor's chapter,
 * scene → the cursor's scene. Folds are intentionally ignored (prototype
 * buildFlow never checks `collapsed` — listening shouldn't skip prose).
 *
 * Heading announcements follow the prototype: the first scene of a chapter
 * (or any scene at scene zoom) announces "Chapter N. Title. SceneTitle.";
 * later siblings announce just "SceneTitle.". Empty paragraphs are skipped.
 */
export function buildReaderFlow(story: Story, cursor: ManuscriptCursor): ReaderFlowItem[] {
  const flow: ReaderFlowItem[] = [];
  const { zoom } = cursor;
  let ordinal = 0;
  orderedChapters(story).forEach((c, ci) => {
    const inChapter = zoom === 'book' || zoom === 'part' || ci === cursor.chapter;
    orderedScenes(c).forEach((s, si) => {
      const inScope = inChapter && (zoom !== 'scene' || si === cursor.scene);
      if (inScope) {
        const heading =
          si === 0 || zoom === 'scene'
            ? `Chapter ${ci + 1}. ${c.title}. ${s.title}.`
            : `${s.title}.`;
        flow.push({ text: heading, key: null, sceneId: s.id, sceneOrdinal: ordinal });
        orderedBlocks(s).forEach((b) => {
          const text = b.content.trim();
          if (text) flow.push({ text, key: b.id, sceneId: s.id, sceneOrdinal: ordinal });
        });
      }
      ordinal += 1;
    });
  });
  return flow;
}

/**
 * "From cursor" start index (prototype readerStart fromCursor): the first
 * paragraph of the cursor's scene, falling back to the scene's heading,
 * falling back to the top of the flow.
 */
export function flowStartIndex(
  flow: readonly ReaderFlowItem[],
  story: Story,
  cursor: ManuscriptCursor
): number {
  const chapter = orderedChapters(story)[cursor.chapter];
  const scene = chapter ? orderedScenes(chapter)[cursor.scene] : undefined;
  if (!scene) return 0;
  const para = flow.findIndex((f) => f.sceneId === scene.id && f.key !== null);
  if (para > -1) return para;
  const heading = flow.findIndex((f) => f.sceneId === scene.id);
  return heading > -1 ? heading : 0;
}

/**
 * ±scene skip target (prototype readerScene 3697–3702): the first flow item
 * of the adjacent scene ordinal, falling back to a one-utterance skip.
 * Returns -1 for an empty flow.
 */
export function sceneSkipIndex(
  flow: readonly ReaderFlowItem[],
  idx: number,
  dir: 1 | -1
): number {
  if (flow.length === 0) return -1;
  const bounded = Math.max(0, Math.min(idx, flow.length - 1));
  const current = flow[bounded].sceneOrdinal;
  const target = flow.findIndex((f) => f.sceneOrdinal === current + dir);
  if (target > -1) return target;
  return Math.max(0, Math.min(flow.length - 1, bounded + dir));
}

/**
 * Identity of the scope a flow was built for (prototype `reader.sk`) — when
 * it changes, resuming rebuilds the flow instead of reading stale prose.
 * Book/part flows cover the whole story, so chapter/scene cursor moves don't
 * invalidate them.
 */
export function flowScopeKey(story: Story, cursor: ManuscriptCursor): string {
  switch (cursor.zoom) {
    case 'book':
    case 'part':
      return `${story.id}|${cursor.zoom}`;
    case 'chapter':
      return `${story.id}|chapter|${cursor.chapter}`;
    case 'scene':
      return `${story.id}|scene|${cursor.chapter}|${cursor.scene}`;
  }
}
