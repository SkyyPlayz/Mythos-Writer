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
//   Part   = Part (M2, SKY-9017) — single untitled part is treated as implicit
//            (no part chrome). Real parts surface part headings and note slots.
//   Chapter (H2) = Chapter
//   Scene   (H3) = Scene
//   Paragraph    = Block (Scene.blocks[n].content)
//
// This module is pure UI-model: it never mutates the Story and owns no
// persistence — callers persist via their own IPC.

import type { Block, Chapter, DraftState, Part, Scene, Story } from '../types';

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
  /** M8: true for the first paragraph of its scene (drop-cap candidate). */
  first: boolean;
}

/** M2 (SKY-9017): part heading block — emitted when parts are NOT simple (multi or titled). */
export interface H1Block {
  kind: 'h1';
  id: string;
  partId: string;
  /** Kicker line, e.g. "PART ONE". */
  label: string;
  title: string;
  note: Block[];
}

/**
 * M2 (SKY-9017): note slot — part epigraph or chapter note.
 * filled (note.length > 0): render epigraph content; empty: render affordance button.
 */
export interface NoteSlotBlock {
  kind: 'note-slot';
  id: string;
  slotKind: 'part' | 'chapter';
  partId?: string;
  chapterId?: string;
  note: Block[];
}

export type ManuscriptBlock = H1Block | H2Block | H3Block | NoteSlotBlock | ParaBlock;

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

export function orderedParts(story: Story): Part[] {
  return [...(story.parts ?? [])].sort((a, b) => a.order - b.order);
}

/**
 * M2: true when the story has no parts or exactly one unnamed part.
 * In that case no part chrome is rendered and chapters are shown at the top level.
 */
export function isSimpleSinglePart(story: Story): boolean {
  return !story.parts || story.parts.length === 0 || (story.parts.length === 1 && story.parts[0].title === '');
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
 * prototype never steps at book zoom). 'part' yields one unit per real part
 * (or the single implicit part when the story is simple).
 *
 * M2 (SKY-9017): for multi-part stories, cursor.chapter is the global chapter
 * index across all parts (matching the globalCi used in buildBlocks).
 */
export function flatUnits(story: Story, level: ZoomLevel): ManuscriptUnit[] {
  const out: ManuscriptUnit[] = [];
  if (isSimpleSinglePart(story)) {
    // Single implicit part at index 0.
    if (level === 'part') out.push({ part: 0, chapter: 0, scene: 0 });
    orderedChapters(story).forEach((c, ci) => {
      if (level === 'chapter') out.push({ part: 0, chapter: ci, scene: 0 });
      orderedScenes(c).forEach((_s, si) => {
        if (level === 'scene') out.push({ part: 0, chapter: ci, scene: si });
      });
    });
    return out;
  }
  // Multi-part: enumerate real parts. chapter index is global across all parts.
  let gci = 0;
  orderedParts(story).forEach((p, pi) => {
    if (level === 'part') out.push({ part: pi, chapter: 0, scene: 0 });
    [...p.chapters].sort((a, b) => a.order - b.order).forEach((c) => {
      const ci = gci++;
      if (level === 'chapter') out.push({ part: pi, chapter: ci, scene: 0 });
      orderedScenes(c).forEach((_s, si) => {
        if (level === 'scene') out.push({ part: pi, chapter: ci, scene: si });
      });
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
 *   book/part → all chapters (grouped into parts when applicable), chapter →
 *   the cursor's chapter (H2 + children), scene → the cursor's scene only
 *   (H3 + paragraphs, no H2 — prototype emits H2 only when zoom !== 'scene').
 * Children of folded headings (id ∈ collapsedIds) are skipped; the heading
 * block carries folded + childCount so the view can render the fold pill.
 *
 * M2 (SKY-9017): when the story has real parts (not simple/untitled), emits
 * H1Block + NoteSlotBlock (part note) before each part's chapters, and
 * NoteSlotBlock (chapter note) after each H2 at book/part/chapter depth
 * (SKY-11356: heading first, note beneath — matching Book view).
 */
export function buildBlocks(
  story: Story,
  cursor: ManuscriptCursor,
  collapsedIds: ReadonlySet<string>
): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  const { zoom } = cursor;
  const simple = isSimpleSinglePart(story);

  // Build a flat list of { chapter, globalChapterIndex, partId? } respecting parts order
  interface ChapterSlot { chapter: Chapter; globalCi: number; partId?: string; partIdx?: number }
  const chapterSlots: ChapterSlot[] = [];
  if (simple) {
    orderedChapters(story).forEach((c, ci) => chapterSlots.push({ chapter: c, globalCi: ci }));
  } else {
    let gci = 0;
    orderedParts(story).forEach((p, pi) => {
      [...p.chapters].sort((a, b) => a.order - b.order).forEach((c) => {
        chapterSlots.push({ chapter: c, globalCi: gci++, partId: p.id, partIdx: pi });
      });
    });
  }

  // When not simple, track the last-emitted part to know when to emit H1+part-note
  let lastPartId: string | undefined;

  chapterSlots.forEach(({ chapter: c, globalCi: ci, partId, partIdx }) => {
    if ((zoom === 'chapter' || zoom === 'scene') && ci !== cursor.chapter) return;

    // M2: emit H1 + part-note-slot when we enter a new part (book/part depth only)
    if (!simple && partId && partId !== lastPartId && zoom !== 'chapter' && zoom !== 'scene') {
      const part = story.parts!.find((p) => p.id === partId);
      if (part) {
        blocks.push({
          kind: 'h1',
          id: `h1-${part.id}`,
          partId: part.id,
          label: partLabel(partIdx ?? 0),
          title: part.title,
          note: part.note,
        });
        blocks.push({
          kind: 'note-slot',
          id: `note-part-${part.id}`,
          slotKind: 'part',
          partId: part.id,
          note: part.note,
        });
      }
      lastPartId = partId;
    }

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
      // SKY-11356: chapter note follows its H2 (matches the part note above and
      // Book view's heading→epigraph order); still shown when the chapter is folded.
      blocks.push({
        kind: 'note-slot',
        id: `note-chapter-${c.id}`,
        slotKind: 'chapter',
        chapterId: c.id,
        note: c.note ?? [],
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
      paras.forEach((b, bi) => {
        blocks.push({
          kind: 'para',
          id: `p-${b.id}`,
          sceneId: s.id,
          chapterId: c.id,
          blockId: b.id,
          content: b.content,
          first: bi === 0,
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

// ─── M8: split / merge / empty-removal / inline renames ──────────────────────
// Prototype references (v2 "Mythos Writer - Liquid Neon.dc.html"):
//   paraKey 5107–5133 (Enter split + Backspace-at-start merge),
//   editPara 5095–5106 (empty paragraph removed on blur, min 1 per scene),
//   editTitle 5134–5146 (inline heading renames; provisional commit).

/** Find a scene by id (order-agnostic). */
function findScene(story: Story, sceneId: string): Scene | undefined {
  for (const ch of story.chapters) {
    for (const sc of ch.scenes) {
      if (sc.id === sceneId) return sc;
    }
  }
  return undefined;
}

/** Immutably replace one scene's block list (orders renumbered 0..n-1). */
function withSceneBlocks(story: Story, sceneId: string, blocks: Block[]): Story {
  const renumbered = blocks.map((b, i) => (b.order === i ? b : { ...b, order: i }));
  return {
    ...story,
    chapters: story.chapters.map((ch) =>
      ch.scenes.some((sc) => sc.id === sceneId)
        ? {
            ...ch,
            scenes: ch.scenes.map((sc) => (sc.id === sceneId ? { ...sc, blocks: renumbered } : sc)),
          }
        : ch
    ),
  };
}

/**
 * Prototype paraKey Enter (5111–5115): both halves of a caret split are
 * trimmed; an empty half becomes a single space so the paragraph keeps a
 * line box (the prototype's `|| ' '`).
 */
export function splitParagraphText(
  text: string,
  offset: number
): { before: string; after: string } {
  const at = Math.max(0, Math.min(offset, text.length));
  return {
    before: text.slice(0, at).trim() || ' ',
    after: text.slice(at).trim() || ' ',
  };
}

/** Prototype paraKey Backspace (5126): join with a space, collapse runs, trim. */
export function mergeParagraphText(previous: string, current: string): string {
  return `${previous} ${current}`.replace(/\s+/g, ' ').trim();
}

/** Prototype editTitle (5136): inline renames collapse newlines and trim. */
export function normalizeInlineTitle(raw: string): string {
  return raw.replace(/\n+/g, ' ').trim();
}

export interface SplitParagraphResult {
  story: Story;
  sceneId: string;
  /** Id of the block created to hold the text after the caret. */
  newBlockId: string;
}

/**
 * Enter at the caret: the source block keeps `before`, a new block holding
 * `after` lands immediately after it (same block type). Pass the halves
 * through splitParagraphText first — this function stores them verbatim.
 */
export function splitParagraph(
  story: Story,
  at: ParagraphRef,
  before: string,
  after: string,
  opts?: { makeId?: () => string; now?: string }
): SplitParagraphResult | null {
  const scene = findScene(story, at.sceneId);
  if (!scene) return null;
  const blocks = orderedBlocks(scene);
  const idx = blocks.findIndex((b) => b.id === at.blockId);
  if (idx === -1) return null;
  const newBlock: Block = {
    id: (opts?.makeId ?? (() => crypto.randomUUID()))(),
    type: blocks[idx].type,
    content: after,
    order: idx + 1,
    updatedAt: opts?.now ?? new Date().toISOString(),
  };
  const next = [
    ...blocks.slice(0, idx),
    { ...blocks[idx], content: before },
    newBlock,
    ...blocks.slice(idx + 1),
  ];
  return { story: withSceneBlocks(story, scene.id, next), sceneId: scene.id, newBlockId: newBlock.id };
}

export interface MergeParagraphResult {
  story: Story;
  sceneId: string;
  /** The previous sibling that received the merged text. */
  mergedBlockId: string;
  mergedText: string;
}

/**
 * Backspace at paragraph start: merge the block's (possibly uncommitted)
 * text into its previous sibling and remove it. The first block of a scene
 * never merges — the prototype does not cross scene boundaries (ti > 0).
 */
export function mergeParagraphUp(
  story: Story,
  at: ParagraphRef,
  currentText: string
): MergeParagraphResult | null {
  const scene = findScene(story, at.sceneId);
  if (!scene) return null;
  const blocks = orderedBlocks(scene);
  const idx = blocks.findIndex((b) => b.id === at.blockId);
  if (idx <= 0) return null;
  const prev = blocks[idx - 1];
  const mergedText = mergeParagraphText(prev.content, currentText);
  const next = blocks
    .filter((_b, i) => i !== idx)
    .map((b) => (b.id === prev.id ? { ...b, content: mergedText } : b));
  return {
    story: withSceneBlocks(story, scene.id, next),
    sceneId: scene.id,
    mergedBlockId: prev.id,
    mergedText,
  };
}

export interface RemoveParagraphResult {
  story: Story;
  sceneId: string;
}

/**
 * A paragraph emptied on blur is removed — unless it is the scene's only
 * block (min 1 per scene, prototype editPara `paras.length > 1`).
 */
export function removeEmptyParagraph(story: Story, at: ParagraphRef): RemoveParagraphResult | null {
  const scene = findScene(story, at.sceneId);
  if (!scene) return null;
  const blocks = orderedBlocks(scene);
  if (blocks.length <= 1) return null;
  const idx = blocks.findIndex((b) => b.id === at.blockId);
  if (idx === -1) return null;
  return {
    story: withSceneBlocks(story, scene.id, blocks.filter((_b, i) => i !== idx)),
    sceneId: scene.id,
  };
}

/**
 * Inline scene-heading rename (prototype editTitle). Returns null when the
 * scene is unknown or the normalized title is empty/unchanged — callers
 * revert the heading instead of persisting. `now` stamps scene.updatedAt.
 */
export function renameScene(
  story: Story,
  sceneId: string,
  title: string,
  now?: string
): Story | null {
  const t = normalizeInlineTitle(title);
  if (!t) return null;
  const scene = findScene(story, sceneId);
  if (!scene || scene.title === t) return null;
  return {
    ...story,
    chapters: story.chapters.map((ch) =>
      ch.scenes.some((sc) => sc.id === sceneId)
        ? {
            ...ch,
            scenes: ch.scenes.map((sc) =>
              sc.id === sceneId ? { ...sc, title: t, updatedAt: now ?? sc.updatedAt } : sc
            ),
          }
        : ch
    ),
  };
}

/** Inline chapter-heading rename — same normalize/revert contract as renameScene. */
export function renameChapter(
  story: Story,
  chapterId: string,
  title: string,
  now?: string
): Story | null {
  const t = normalizeInlineTitle(title);
  if (!t) return null;
  const chapter = story.chapters.find((ch) => ch.id === chapterId);
  if (!chapter || chapter.title === t) return null;
  return {
    ...story,
    chapters: story.chapters.map((ch) =>
      ch.id === chapterId ? { ...ch, title: t, updatedAt: now ?? ch.updatedAt } : ch
    ),
  };
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

// ─── M1 title row (SKY-9013 — prototype doc header 897–948) ──────────────────

const PART_ORDINALS = [
  'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
];

/** "PART ONE" … "PART TEN", numeric past that (prototype part.label style). */
export function partLabel(index: number): string {
  return `PART ${PART_ORDINALS[index] ?? String(index + 1)}`;
}

/** The cursor's current chapter, `order`-sorted. */
export function cursorChapter(story: Story, cursor: ManuscriptCursor): Chapter | null {
  return orderedChapters(story)[cursor.chapter] ?? null;
}

/** The cursor's current scene — the status chip's target at every depth. */
export function cursorScene(story: Story, cursor: ManuscriptCursor): Scene | null {
  const chapter = cursorChapter(story, cursor);
  return chapter ? orderedScenes(chapter)[cursor.scene] ?? null : null;
}

/**
 * M6 (SKY-9022): the scene the editor actually shows for a bare story
 * selection — the manuscript cursor clamps a null selection to chapter 0 /
 * scene 0, so this resolves the order-sorted first chapter's order-sorted
 * first scene (parts enumerated the same way buildBlocks does). Null when
 * the story has no chapters or its first chapter has no scenes, so empty
 * stories keep their empty states.
 */
export function cursorDefaultScene(story: Story): { chapter: Chapter; scene: Scene } | null {
  const chapters = isSimpleSinglePart(story)
    ? orderedChapters(story)
    : orderedParts(story).flatMap((p) => [...p.chapters].sort((a, b) => a.order - b.order));
  const chapter = chapters[0];
  if (!chapter) return null;
  const scene = orderedScenes(chapter)[0];
  return scene ? { chapter, scene } : null;
}

/**
 * Row-3 depth chip (prototype sceneChip 5948): book → none, part → "PART ONE",
 * chapter → "CHAPTER N", scene → "SCENE N".
 */
export function titleChip(cursor: ManuscriptCursor): string | null {
  switch (cursor.zoom) {
    case 'book':
      return null;
    case 'part':
      return partLabel(cursor.part);
    case 'chapter':
      return `CHAPTER ${cursor.chapter + 1}`;
    case 'scene':
      return `SCENE ${cursor.scene + 1}`;
  }
}

/**
 * Row-3 scope title (prototype scopeTitle 5949). The single implicit part is
 * untitled until M2 (SKY-9017), so part depth shows the story title.
 */
export function scopeTitle(story: Story, cursor: ManuscriptCursor): string {
  switch (cursor.zoom) {
    case 'book':
    case 'part':
      return story.title;
    case 'chapter':
      return cursorChapter(story, cursor)?.title ?? story.title;
    case 'scene':
      return cursorScene(story, cursor)?.title ?? story.title;
  }
}

/** Every scene inside the cursor's scope (book/part → all, chapter → one chapter's, scene → one). */
export function scopeScenes(story: Story, cursor: ManuscriptCursor): Scene[] {
  switch (cursor.zoom) {
    case 'book':
    case 'part':
      return orderedChapters(story).flatMap(orderedScenes);
    case 'chapter': {
      const chapter = cursorChapter(story, cursor);
      return chapter ? orderedScenes(chapter) : [];
    }
    case 'scene': {
      const scene = cursorScene(story, cursor);
      return scene ? [scene] : [];
    }
  }
}

// ─── M1 scene-status chip (full draftState vocabulary) ───────────────────────

/**
 * Status-chip cycle over the STORED vocabulary, so cycling never destroys
 * 'review' (the old todo/draft/done round-trip collapsed review into draft):
 * unset (Planned) → in-progress → review → final → unset.
 */
export function cycleDraftState(state: DraftState | undefined): DraftState | undefined {
  switch (state) {
    case undefined:
      return 'in-progress';
    case 'in-progress':
      return 'review';
    case 'review':
      return 'final';
    case 'final':
      return undefined;
  }
}

/** Chip / toast labels (prototype toast vocabulary + 'In review'). */
export function draftStateLabel(state: DraftState | undefined): string {
  switch (state) {
    case 'in-progress':
      return 'Drafting';
    case 'review':
      return 'In review';
    case 'final':
      return 'Complete';
    default:
      return 'Planned';
  }
}
