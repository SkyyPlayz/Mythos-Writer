/**
 * SKY-11186 (Notes Board 3/9): the pure geometry behind the Boards canvas —
 * spec §6 layout maths, viewport culling and the 3-tier level of detail.
 *
 * BOARDS-SPEC.md v2 §6 "Virtualization / level-of-detail" asks for two
 * independent mechanisms so a board stays smooth as a folder's child count
 * grows unbounded:
 *
 *   - viewport culling — items fully outside the visible canvas rect (plus a
 *     small margin) are not mounted at all, at any zoom level;
 *   - 3-tier LOD, selected by ON-SCREEN size at the current zoom —
 *     1 `preview + image`, 2 `image + title`, 3 `coloured block`.
 *
 * Everything here is a pure function of numbers (no DOM, no React) so the
 * thresholds and the culling rect can be unit-tested exactly, and so the
 * canvas component stays a thin layer of state + event wiring over them.
 */

// ── spec §6 constants ───────────────────────────────────────────────────────

export const CELL_W = 268;
export const CELL_H = 216;
export const ORIGIN_X = 48;
export const ORIGIN_Y = 44;

export const BOARD_DEFAULT_W = 190;
export const BOARD_DEFAULT_H = 138;
export const CARD_DEFAULT_W = 236;
export const CARD_DEFAULT_H = 154;
/** Spec §6: a note card grows to 236 × 272 when it carries a thumbnail. */
export const CARD_THUMB_DEFAULT_H = 272;
/** The height a thumbnail adds to a card — and to any auto-layout row holding one. */
export const CARD_THUMB_EXTRA_H = CARD_THUMB_DEFAULT_H - CARD_DEFAULT_H;

export const RESIZE_MIN_W = 150;
export const RESIZE_MAX_W = 720;
export const RESIZE_MIN_H = 100;
export const RESIZE_MAX_H = 760;
export const GRID_SNAP = 20;
export const ALIGN_THRESHOLD = 7;

export const ZOOM_MAX = 170;
export const ZOOM_WHEEL_DELTA = 8;
export const ZOOM_BTN_DELTA = 10;

/**
 * Owner ruling 4 (SKY-10724): the zoom-out cap is an adjustable, VISIBLE
 * performance setting, not a silent limit. Spec §6's 40% is the default;
 * the other stops let a large vault be surveyed as a map of coloured blocks
 * at the cost of more mounted cards per screen.
 */
export const ZOOM_MIN_OPTIONS = [40, 30, 20, 10] as const;
export type ZoomMinOption = (typeof ZOOM_MIN_OPTIONS)[number];
export const ZOOM_MIN_DEFAULT: ZoomMinOption = 40;

/** Coerce a persisted setting to one of the supported stops (unknown → the spec default). */
export function clampMinZoom(value: unknown): ZoomMinOption {
  return (ZOOM_MIN_OPTIONS as readonly number[]).includes(value as number)
    ? (value as ZoomMinOption)
    : ZOOM_MIN_DEFAULT;
}

// ── Level of detail ─────────────────────────────────────────────────────────

export type LodTier = 1 | 2 | 3;

/**
 * Tier thresholds are on-screen WIDTHS in CSS px — "selected by on-screen
 * size at current zoom" (§6) — so a card the user resized wider keeps its
 * detail longer than a default one, and the same rule serves every zoom
 * floor the setting allows.
 *
 * For the default 236px note card: tier 1 down to 68% zoom (13px title and
 * 11.5px preview still read at ≥ 9px), tier 2 down to 44% (the thumbnail is
 * recognisable where the text is not — owner ruling 5d, "the image should
 * outlive the text"), tier 3 below that. Every tier is reachable inside the
 * spec's default 40–170% range, so the map view is a deliberate stop on the
 * way out, not a fallback that only a lowered floor can expose.
 *
 * The thresholds are scaled by each kind's default width, so a 190px board
 * tile changes tier at the same zoom stops as the 236px note card beside it
 * — on a mixed board every default-sized item is on the same tier at once,
 * instead of the tiles going blank a stop before the cards.
 */
export const LOD_TIER1_MIN_PX = 160;
export const LOD_TIER2_MIN_PX = 104;

export function lodTierForScreenWidth(screenWidthPx: number, kind: BoardItemKind = 'note'): LodTier {
  const relative = defaultSize(kind, false).w / CARD_DEFAULT_W;
  if (screenWidthPx >= LOD_TIER1_MIN_PX * relative) return 1;
  if (screenWidthPx >= LOD_TIER2_MIN_PX * relative) return 2;
  return 3;
}

// ── Sizes ───────────────────────────────────────────────────────────────────

export type BoardItemKind = 'folder' | 'note';

export function defaultSize(kind: BoardItemKind, hasThumb: boolean): { w: number; h: number } {
  if (kind === 'folder') return { w: BOARD_DEFAULT_W, h: BOARD_DEFAULT_H };
  return { w: CARD_DEFAULT_W, h: hasThumb ? CARD_THUMB_DEFAULT_H : CARD_DEFAULT_H };
}

/**
 * Height of the image block inside a thumbnail card (mockup `thumbSt`,
 * owner report script 8086): 134px on the default 272px card, and on a
 * resized card whatever is left after the title/preview chrome, floored at
 * 90px so the image never collapses to a sliver.
 */
export const THUMB_BLOCK_DEFAULT_H = 134;
export const THUMB_BLOCK_MIN_H = 90;
const THUMB_CARD_CHROME_H = CARD_THUMB_DEFAULT_H - THUMB_BLOCK_DEFAULT_H;

export function thumbBlockHeight(cardHeight: number): number {
  return Math.max(THUMB_BLOCK_MIN_H, cardHeight - THUMB_CARD_CHROME_H);
}

// ── Auto-layout (§6) ────────────────────────────────────────────────────────

export interface AutoLayoutEntry {
  /** false when the item has a saved position and only occupies its index slot. */
  auto: boolean;
  hasThumb: boolean;
}

export function autoLayoutColumns(canvasWidth: number): number {
  return Math.max(1, Math.floor((canvasWidth - ORIGIN_X) / CELL_W));
}

/**
 * Spec §6: `x = 48 + (i % cols) * 268`, `y = 44 + row * 216`, `i` = index
 * among the board's children — an item with a saved position keeps its slot
 * (leaving a hole) so the grid never reshuffles when one card is moved.
 *
 * The one refinement: a row holding an auto-laid thumbnail card is
 * `216 + 118` tall, because a 272px card in a 216px row would overlap the
 * row below it. Text-only rows keep the spec's exact pitch, so nothing
 * changes for boards without thumbnails and no persisted data is involved
 * (auto-layout is renderer-side only).
 *
 * Returns one `{x, y}` per entry, `null` where `auto` is false.
 */
export function autoLayoutSlots(
  entries: readonly AutoLayoutEntry[],
  canvasWidth: number,
): Array<{ x: number; y: number } | null> {
  const cols = autoLayoutColumns(canvasWidth);
  const out: Array<{ x: number; y: number } | null> = new Array(entries.length).fill(null);
  let y = ORIGIN_Y;
  for (let start = 0; start < entries.length; start += cols) {
    const end = Math.min(entries.length, start + cols);
    let rowHasThumb = false;
    for (let i = start; i < end; i++) {
      const e = entries[i];
      if (e.auto) {
        out[i] = { x: ORIGIN_X + (i - start) * CELL_W, y };
        if (e.hasThumb) rowHasThumb = true;
      }
    }
    y += CELL_H + (rowHasThumb ? CARD_THUMB_EXTRA_H : 0);
  }
  return out;
}

// ── Viewport culling ────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScrollViewport {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * The part of the WORLD (untransformed canvas coordinates) that is on screen.
 * The world is `translate(pan) scale(zoom/100)` inside a scrolling panel, so a
 * screen point `p` (in the panel's content space) maps back to
 * `(p - pan) / scale`. Pan and scroll are two independent offsets and both
 * move the world — either one alone gives a rect that is wrong by the other.
 */
export function visibleWorldRect(
  viewport: ScrollViewport,
  pan: { x: number; y: number },
  zoom: number,
): Rect {
  const scale = Math.max(0.01, zoom / 100);
  const x = (viewport.scrollLeft - pan.x) / scale;
  const y = (viewport.scrollTop - pan.y) / scale;
  return { x, y, w: viewport.clientWidth / scale, h: viewport.clientHeight / scale };
}

/**
 * Culling margin: one auto-layout cell in every direction. Wide enough that a
 * card scrolled into view is already mounted (no pop-in on a fast wheel), and
 * still bounded — the mounted set is the visible cells plus one ring.
 */
export const CULL_MARGIN_X = CELL_W;
export const CULL_MARGIN_Y = CELL_H;

export function expandRect(r: Rect, mx: number, my: number): Rect {
  return { x: r.x - mx, y: r.y - my, w: r.w + 2 * mx, h: r.h + 2 * my };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Scroll positions are bucketed before they reach React state so a wheel
 * tick that moves the viewport a few pixels does not re-render the board.
 * The bucket is far smaller than the culling margin, so bucketing never
 * lets a visible card go unmounted — it only delays the exact moment a
 * far-away card is mounted or released by at most one bucket.
 */
export const SCROLL_BUCKET_PX = 64;

export function bucketScroll(value: number): number {
  return Math.floor(value / SCROLL_BUCKET_PX) * SCROLL_BUCKET_PX;
}

export interface CullInput {
  rect: Rect;
  /** Never culled: the card under the pointer must not vanish mid-drag. */
  dragging: boolean;
  /** Never culled: focus/selection must survive a scroll (a11y — focus would otherwise jump to <body>). */
  selected: boolean;
}

export function shouldMount(item: CullInput, cullRect: Rect): boolean {
  return item.dragging || item.selected || rectsIntersect(item.rect, cullRect);
}
