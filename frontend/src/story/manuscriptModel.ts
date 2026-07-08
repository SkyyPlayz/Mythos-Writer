// Beta 3 M9 — Heading-zoom manuscript model (pure functions, no React).
//
// Port of the Liquid Neon prototype's heading-zoom engine
// (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html":
//  flatUnits 3318–3328, zoomStep 3329–3337, buildBlocks 3339–3389,
//  cycleStatus 3497–3503, breadcrumbs/crumbData 4101–4105)
// mapped onto the repo's real Story → Chapter → Scene → Block hierarchy.
//
// Prototype ⇄ repo mapping:
//   Book   = Story
//   Part   = (none yet) — the app has no Parts, so the model treats the whole
//            Story as ONE implicit part at index 0. 'part' stays in ZoomLevel
//            so real parts slot in later without changing any signature.
//   Chapter (H2) = Chapter
//   Scene   (H3) = Scene
//   Paragraph    = Block (Scene.blocks[n].content)
//
// This module is pure UI-model: it never mutates the Story and owns no
// persistence — callers persist via their own IPC.

import type { Block, Chapter, Scene, Story } from '../types';

// ─── Public types ────────────────────────────────────────────────────────────

export type ZoomLevel = 'book' | 'part' | 'chapter' | 'scene';

/** Prototype scene status vocabulary (dot colors todo/draft/done). */
export type SceneStatus = 'todo' | 'draft' | 'done';

/** Prototype {zoom, pp, cc, ss} — indices into the ordered hierarchy. */
export interface ManuscriptCursor {
  zoom: ZoomLevel;
  /** Part index — always 0 until Parts exist in the data model. */
  part: number;
  /** Chapter index within the (implicit) part, in `order`-sorted order. */
  chapter: number;
  /** Scene index within the chapter, in `order`-sorted order. */
  scene: number;
}

/** One addressable unit at a zoom level (prototype {pp, cc, ss}). */
export interface ManuscriptUnit {
  part: number;
  chapter: number;
  scene: number;
}

export interface H2Block {
  kind: 'h2';
  /** Stable render/virtualization key. */
  id: string;
  chapterId: string;
  /** Kicker line, e.g. "CHAPTER 2" (prototype 'CHAPTER ' + c.n). */
  label: string;
  title: string;
  /** Aggregate of the chapter's scene statuses (all done → done, any progress → draft). */
  status?: SceneStatus;
  folded: boolean;
  /** Direct children hidden while folded — scene count (fold pill "N scenes hidden"). */
  childCount: number;
}

export interface H3Block {
  kind: 'h3';
  id: string;
  sceneId: string;
  chapterId: string;
  title: string;
  status: SceneStatus;
  folded: boolean;
  /** Paragraph blocks hidden while folded. */
  childCount: number;
}

export interface ParaBlock {
  kind: 'para';
  id: string;
  sceneId: string;
  chapterId: string;
  blockId: string;
  content: string;
}

export type ManuscriptBlock = H2Block | H3Block | ParaBlock;

export interface BreadcrumbEntry {
  label: string;
  /** Cursor to navigate to when the crumb is clicked (prototype: sets zoom, keeps indices). */
  cursor: ManuscriptCursor;
}

// ─── Ordering helpers (defensive: manifest arrays are kept sorted, but the
//     model must not depend on that) ─────────────────────────────────────────

export function orderedChapters(story: Story): Chapter[] {
  return [...story.chapters].sort((a, b) => a.order - b.order);
}

export function orderedScenes(chapter: Chapter): Scene[] {
  return [...chapter.scenes].sort((a, b) => a.order - b.order);
}

export function orderedBlocks(scene: Scene): Block[] {
  return [...scene.blocks].sort((a, b) => a.order - b.order);
}

// ─── Status mapping ──────────────────────────────────────────────────────────

/**
 * Map the repo's Scene.draftState onto the prototype's todo/draft/done dots:
 * no draftState → todo, in-progress/review → draft, final → done.
 */
export function sceneStatus(scene: Scene): SceneStatus {
  switch (scene.draftState) {
    case 'final':
      return 'done';
    case 'in-progress':
    case 'review':
      return 'draft';
    default:
      return 'todo';
  }
}

/** Aggregate chapter status: all scenes done → done; any non-todo → draft; else todo. */
export function chapterStatus(chapter: Chapter): SceneStatus {
  const statuses = chapter.scenes.map(sceneStatus);
  if (statuses.length > 0 && statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s !== 'todo')) return 'draft';
  return 'todo';
}

/** Prototype cycleStatus (3497–3503): todo → draft → done → todo. */
export function cycleStatus(status: SceneStatus): SceneStatus {
  const order: SceneStatus[] = ['todo', 'draft', 'done'];
  return order[(order.indexOf(status) + 1) % order.length];
}

// ─── flatUnits (prototype 3318–3328) ─────────────────────────────────────────

/**
 * Ordered list of units at a zoom level. 'book' has no siblings → [] (the
 * prototype never steps at book zoom). 'part' yields the single implicit part.
 */
export function flatUnits(story: Story, level: ZoomLevel): ManuscriptUnit[] {
  const out: ManuscriptUnit[] = [];
  // Single implicit part at index 0 — when Parts land, loop over them here.
  if (level === 'part') out.push({ part: 0, chapter: 0, scene: 0 });
  orderedChapters(story).forEach((c, ci) => {
    if (level === 'chapter') out.push({ part: 0, chapter: ci, scene: 0 });
    orderedScenes(c).forEach((_s, si) => {
      if (level === 'scene') out.push({ part: 0, chapter: ci, scene: si });
    });
  });
  return out;
}

// ─── zoomStep (prototype 3329–3337) ──────────────────────────────────────────

/**
 * Next/previous same-level sibling with wrap-around, exactly like the
 * prototype: find the cursor in flatUnits(zoom), then (idx + dir + n) % n.
 * At 'book' zoom (or with nothing to step through) the cursor is unchanged.
 */
export function zoomStep(story: Story, cursor: ManuscriptCursor, dir: 1 | -1): ManuscriptCursor {
  if (cursor.zoom === 'book') return cursor;
  const units = flatUnits(story, cursor.zoom);
  if (units.length === 0) return cursor;
  let idx = units.findIndex(
    (u) =>
      u.part === cursor.part &&
      (cursor.zoom === 'part' || u.chapter === cursor.chapter) &&
      (cursor.zoom !== 'scene' || u.scene === cursor.scene)
  );
  idx = (idx + dir + units.length) % units.length;
  const u = units[idx];
  return { zoom: cursor.zoom, part: u.part, chapter: u.chapter, scene: u.scene };
}

// ─── buildBlocks (prototype 3339–3389) ───────────────────────────────────────

/**
 * Ordered block list scoped to the cursor's zoom:
 *   book/part → every chapter (one implicit part), chapter → the cursor's
 *   chapter (H2 + children), scene → the cursor's scene only (H3 + paragraphs,
 *   no H2 — prototype emits H2 only when zoom !== 'scene').
 * Children of folded headings (id ∈ collapsedIds) are skipped; the heading
 * block carries folded + childCount so the view can render the fold pill.
 */
export function buildBlocks(
  story: Story,
  cursor: ManuscriptCursor,
  collapsedIds: ReadonlySet<string>
): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  const { zoom } = cursor;
  orderedChapters(story).forEach((c, ci) => {
    if ((zoom === 'chapter' || zoom === 'scene') && ci !== cursor.chapter) return;
    const scenes = orderedScenes(c);
    const cFolded = collapsedIds.has(c.id);
    if (zoom !== 'scene') {
      blocks.push({
        kind: 'h2',
        id: `h2-${c.id}`,
        chapterId: c.id,
        label: `CHAPTER ${ci + 1}`,
        title: c.title,
        status: chapterStatus(c),
        folded: cFolded,
        childCount: scenes.length,
      });
      if (cFolded) return;
    }
    scenes.forEach((s, si) => {
      if (zoom === 'scene' && si !== cursor.scene) return;
      const paras = orderedBlocks(s);
      const sFolded = collapsedIds.has(s.id);
      blocks.push({
        kind: 'h3',
        id: `h3-${s.id}`,
        sceneId: s.id,
        chapterId: c.id,
        title: s.title,
        status: sceneStatus(s),
        folded: sFolded,
        childCount: paras.length,
      });
      if (sFolded) return;
      paras.forEach((b) => {
        blocks.push({
          kind: 'para',
          id: `p-${b.id}`,
          sceneId: s.id,
          chapterId: c.id,
          blockId: b.id,
          content: b.content,
        });
      });
    });
  });
  return blocks;
}

// ─── moveParagraph (prototype paraDown/paraOver/paraDrop 3705–3719) ──────────

export interface ParagraphRef {
  sceneId: string;
  blockId: string;
}

export interface MoveParagraphResult {
  story: Story;
  /** Scenes whose block lists changed (1 for same-scene moves, 2 across scenes). */
  changedSceneIds: string[];
}

/**
 * Move a paragraph block so it lands immediately BEFORE the target block,
 * exactly like the prototype's grip drag (paraDrop 3708–3719): dropping a
 * block onto position `ti` re-inserts it at `ti`, adjusted by −1 when the
 * source sat earlier in the same list. Returns null for no-ops (unknown ids,
 * dropping a block onto itself or onto its own next sibling). Pure — block
 * `order` fields are renumbered 0..n-1; nothing else on the Story changes.
 */
export function moveParagraph(
  story: Story,
  from: ParagraphRef,
  to: ParagraphRef
): MoveParagraphResult | null {
  if (from.sceneId === to.sceneId && from.blockId === to.blockId) return null;
  let fromScene: Scene | undefined;
  let toScene: Scene | undefined;
  for (const ch of story.chapters) {
    for (const sc of ch.scenes) {
      if (sc.id === from.sceneId) fromScene = sc;
      if (sc.id === to.sceneId) toScene = sc;
    }
  }
  if (!fromScene || !toScene) return null;

  const src = orderedBlocks(fromScene);
  const srcIdx = src.findIndex((b) => b.id === from.blockId);
  if (srcIdx === -1) return null;
  const sameScene = fromScene.id === toScene.id;
  const dst = sameScene ? src : orderedBlocks(toScene);
  const dstIdx = dst.findIndex((b) => b.id === to.blockId);
  if (dstIdx === -1) return null;

  const moved = src.splice(srcIdx, 1)[0];
  // Prototype adjustment: removing an earlier sibling shifts the target left.
  let target = dstIdx;
  if (sameScene && srcIdx < dstIdx) target = dstIdx - 1;
  dst.splice(Math.min(target, dst.length), 0, moved);
  if (sameScene && target === srcIdx) return null; // landed where it started

  const renumber = (blocks: Block[]): Block[] => blocks.map((b, i) => ({ ...b, order: i }));
  const nextBlocks = new Map<string, Block[]>();
  nextBlocks.set(fromScene.id, renumber(src));
  if (!sameScene) nextBlocks.set(toScene.id, renumber(dst));

  const updated: Story = {
    ...story,
    chapters: story.chapters.map((ch) =>
      ch.scenes.some((sc) => nextBlocks.has(sc.id))
        ? {
            ...ch,
            scenes: ch.scenes.map((sc) =>
              nextBlocks.has(sc.id) ? { ...sc, blocks: nextBlocks.get(sc.id)! } : sc
            ),
          }
        : ch
    ),
  };
  return { story: updated, changedSceneIds: [...nextBlocks.keys()] };
}

// ─── breadcrumbs (prototype crumbData 4101–4105) ─────────────────────────────

/**
 * Trail for the current zoom. Prototype: book title → part → "Ch. N: title" →
 * scene title, each crumb jumping to its zoom while keeping indices. The part
 * crumb is omitted until Parts exist (it would duplicate the book title);
 * when they land it slots in between book and chapter.
 */
export function breadcrumbs(story: Story, cursor: ManuscriptCursor): BreadcrumbEntry[] {
  const at = (zoom: ZoomLevel): ManuscriptCursor => ({ ...cursor, zoom });
  const trail: BreadcrumbEntry[] = [{ label: story.title, cursor: at('book') }];
  if (cursor.zoom === 'chapter' || cursor.zoom === 'scene') {
    const chapters = orderedChapters(story);
    const chapter = chapters[cursor.chapter];
    if (!chapter) return trail;
    trail.push({ label: `Ch. ${cursor.chapter + 1}: ${chapter.title}`, cursor: at('chapter') });
    if (cursor.zoom === 'scene') {
      const scene = orderedScenes(chapter)[cursor.scene];
      if (scene) trail.push({ label: scene.title, cursor: at('scene') });
    }
  }
  return trail;
}
