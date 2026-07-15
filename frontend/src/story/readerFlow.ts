// Beta 3 M13 / Beta 4 M11 — TTS reader flow model (pure functions, no React).
//
// Port of the Liquid Neon prototype's reader linearization
// (design-handoff/v2/prototype/"Mythos Writer - Liquid Neon.dc.html":
//  buildFlow 4960–4983, readerStart fromCursor 5005–5010,
//  readerScene 5024–5028) mapped onto the repo's Story → Chapter → Scene →
// Block hierarchy from manuscriptModel.ts.
//
// A "flow" is the ordered list of utterances the reader speaks. M11 refines
// the granularity from paragraphs to SENTENCES (§5.1 "highlights the sentence
// being read"): each paragraph is split into sentence spans, one utterance
// per sentence, carrying the Block id as `key` plus the sentence's [start,end)
// character offsets inside that block's content so the view can paint a
// sentence-level highlight. Headings carry key null (nothing to highlight
// while a chapter/scene title is announced).

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
  /** Sentence start offset in the block's content (0 when key is null). */
  start: number;
  /** Sentence end offset (exclusive) in the block's content (0 when key is null). */
  end: number;
}

// ── M11 sentence splitting ───────────────────────────────────────────────────

export interface SentenceSpan {
  /** The sentence text — exactly `source.slice(start, end)`. */
  text: string;
  start: number;
  end: number;
}

/** Sentence terminators; runs of them ("?!", "...") end one sentence. */
const TERMINATORS = new Set(['.', '!', '?', '…']);
/** Closing quotes/brackets that stay attached to the sentence they end. */
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);
/**
 * Words whose trailing period does not end a sentence. Deliberately small —
 * prose false-positives here only make the highlight/utterance a touch
 * longer, never wrong.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'sgt', 'capt', 'lt', 'col', 'gen',
  'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'no',
]);

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/** The word immediately before index `i` (exclusive), lowercased. */
function wordBefore(text: string, i: number): string {
  let s = i;
  while (s > 0 && !isWhitespace(text[s - 1])) s -= 1;
  return text
    .slice(s, i)
    .replace(/^["'“‘([«]+/, '')
    .toLowerCase();
}

/**
 * Split prose into sentence spans with exact source offsets. A sentence ends
 * at a run of terminators (plus attached closing quotes/brackets) followed by
 * whitespace or end-of-text — except after initials ("J.") and a short list
 * of abbreviations ("Mr.", "e.g."). Text without terminators is one span.
 * Only whitespace is dropped between spans; offsets always index the source.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && isWhitespace(text[s])) s += 1;
    while (e > s && isWhitespace(text[e - 1])) e -= 1;
    if (e > s) spans.push({ text: text.slice(s, e), start: s, end: e });
  };

  let segStart = 0;
  let i = 0;
  while (i < text.length) {
    if (!TERMINATORS.has(text[i])) {
      i += 1;
      continue;
    }
    const runStart = i;
    let onlyPeriods = true;
    while (i < text.length && TERMINATORS.has(text[i])) {
      if (text[i] !== '.') onlyPeriods = false;
      i += 1;
    }
    const singlePeriod = onlyPeriods && i - runStart === 1;
    while (i < text.length && CLOSERS.has(text[i])) i += 1;
    const atBoundary = i >= text.length || isWhitespace(text[i]);
    if (!atBoundary) continue;
    if (singlePeriod) {
      // "J. K. Rowling", "Mr. Smith", "e.g. this" — not sentence ends.
      const word = wordBefore(text, runStart);
      if (/^[a-z]$/i.test(word) || ABBREVIATIONS.has(word)) continue;
    }
    push(segStart, i);
    segStart = i;
  }
  push(segStart, text.length);
  return spans;
}

// ── M11 time-based skip (the ±10s transport buttons) ────────────────────────

/**
 * Speech pacing estimate — the prototype's speakIdx fallback timer
 * (words / (3.2 × rate) seconds). Neither playback path reports real
 * durations, so ±10s walks sentence word counts at this pace.
 */
export const READER_WORDS_PER_SECOND = 3.2;
/** The transport buttons' skip distance. */
export const READER_SKIP_SECONDS = 10;

function itemSeconds(text: string, rate: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / (READER_WORDS_PER_SECOND * Math.max(0.1, rate));
}

/**
 * Target index for a ±`seconds` skip from `idx` at playback `rate`:
 * accumulate estimated sentence durations in `dir` until the requested
 * seconds are covered (always moving at least one item when not at an edge).
 * Returns -1 for an empty flow.
 */
export function timeSkipIndex(
  flow: readonly ReaderFlowItem[],
  idx: number,
  dir: 1 | -1,
  seconds: number,
  rate: number
): number {
  if (flow.length === 0) return -1;
  let j = Math.max(0, Math.min(idx, flow.length - 1));
  let acc = 0;
  while (acc < seconds) {
    const next = j + dir;
    if (next < 0 || next >= flow.length) break;
    // Forward skips step over the current item; backward skips step over the
    // item being backed onto.
    acc += itemSeconds(dir > 0 ? flow[j].text : flow[next].text, rate);
    j = next;
  }
  return j;
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
 * M11: paragraphs emit one item per sentence (splitSentences) so the moving
 * highlight tracks sentences, not whole paragraphs.
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
        flow.push({ text: heading, key: null, sceneId: s.id, sceneOrdinal: ordinal, start: 0, end: 0 });
        orderedBlocks(s).forEach((b) => {
          for (const span of splitSentences(b.content)) {
            flow.push({
              text: span.text,
              key: b.id,
              sceneId: s.id,
              sceneOrdinal: ordinal,
              start: span.start,
              end: span.end,
            });
          }
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
