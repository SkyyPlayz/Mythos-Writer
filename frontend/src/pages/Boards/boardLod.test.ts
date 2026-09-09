/**
 * SKY-11186 — the pure geometry behind culling + LOD (BOARDS-SPEC v2 §6).
 * Every number here is one the spec or the mockup names, so a drift in a
 * constant fails loudly rather than shifting a tier boundary by accident.
 */
import { describe, it, expect } from 'vitest';
import {
  CELL_H,
  CELL_W,
  CARD_DEFAULT_H,
  CARD_THUMB_DEFAULT_H,
  CARD_THUMB_EXTRA_H,
  ORIGIN_X,
  ORIGIN_Y,
  LOD_TIER1_MIN_PX,
  LOD_TIER2_MIN_PX,
  ZOOM_MIN_DEFAULT,
  autoLayoutColumns,
  autoLayoutSlots,
  bucketScroll,
  clampMinZoom,
  defaultSize,
  expandRect,
  lodTierForScreenWidth,
  rectsIntersect,
  shouldMount,
  thumbBlockHeight,
  visibleWorldRect,
} from './boardLod';

describe('lodTierForScreenWidth — 3-tier LOD by on-screen size (§6)', () => {
  it('maps widths to tiers at the documented thresholds', () => {
    expect(lodTierForScreenWidth(LOD_TIER1_MIN_PX)).toBe(1);
    expect(lodTierForScreenWidth(LOD_TIER1_MIN_PX - 0.01)).toBe(2);
    expect(lodTierForScreenWidth(LOD_TIER2_MIN_PX)).toBe(2);
    expect(lodTierForScreenWidth(LOD_TIER2_MIN_PX - 0.01)).toBe(3);
    expect(lodTierForScreenWidth(0)).toBe(3);
  });

  it('a default 236px card passes through all three tiers inside the spec 40–170% range', () => {
    const w = 236;
    expect(lodTierForScreenWidth(w * 1.7)).toBe(1);
    expect(lodTierForScreenWidth(w * 1.0)).toBe(1);
    expect(lodTierForScreenWidth(w * 0.68)).toBe(1); // 160.5px — last tier-1 wheel stop
    expect(lodTierForScreenWidth(w * 0.6)).toBe(2); // 141.6px — first tier-2 wheel stop
    expect(lodTierForScreenWidth(w * 0.5)).toBe(2); // 118px — button stop
    expect(lodTierForScreenWidth(w * 0.45)).toBe(2); // 106.2px — still recognisable
    expect(lodTierForScreenWidth(w * 0.44)).toBe(3); // 103.84px — first wheel stop in the map view
    expect(lodTierForScreenWidth(w * 0.4)).toBe(3); // 94.4px — the default floor is the map view
  });

  it('a card resized wider keeps detail at a zoom where a default card has lost it', () => {
    expect(lodTierForScreenWidth(236 * 0.4)).toBe(3);
    expect(lodTierForScreenWidth(300 * 0.4)).toBe(2);
    expect(lodTierForScreenWidth(420 * 0.4)).toBe(1);
  });

  it('a default 190px board tile changes tier at the same zoom stops as a default note card', () => {
    for (const zoom of [1.7, 1, 0.8, 0.7, 0.68, 0.6, 0.5, 0.45, 0.44, 0.4, 0.1]) {
      expect(lodTierForScreenWidth(190 * zoom, 'folder'), `zoom ${zoom}`).toBe(lodTierForScreenWidth(236 * zoom, 'note'));
    }
    // …and a tile resized wider still keeps detail longer, like a card does.
    expect(lodTierForScreenWidth(190 * 0.5, 'folder')).toBe(2);
    expect(lodTierForScreenWidth(300 * 0.5, 'folder')).toBe(1);
  });
});

describe('clampMinZoom — the visible zoom-out limit setting', () => {
  it('accepts only the supported stops and falls back to the spec default', () => {
    expect(clampMinZoom(40)).toBe(40);
    expect(clampMinZoom(10)).toBe(10);
    expect(clampMinZoom(25)).toBe(ZOOM_MIN_DEFAULT);
    expect(clampMinZoom('20')).toBe(ZOOM_MIN_DEFAULT);
    expect(clampMinZoom(undefined)).toBe(ZOOM_MIN_DEFAULT);
    expect(clampMinZoom(null)).toBe(ZOOM_MIN_DEFAULT);
    expect(ZOOM_MIN_DEFAULT).toBe(40);
  });
});

describe('defaultSize / thumbBlockHeight — spec §6 sizes', () => {
  it('note cards grow from 236×154 to 236×272 when they carry a thumbnail', () => {
    expect(defaultSize('note', false)).toEqual({ w: 236, h: CARD_DEFAULT_H });
    expect(defaultSize('note', true)).toEqual({ w: 236, h: CARD_THUMB_DEFAULT_H });
    expect(CARD_THUMB_DEFAULT_H).toBe(272);
    expect(CARD_THUMB_EXTRA_H).toBe(118);
  });

  it('board tiles are 190×138 regardless of thumbnails', () => {
    expect(defaultSize('folder', true)).toEqual({ w: 190, h: 138 });
  });

  it('the image block is 134px on the default card and never below 90px on a shrunken one', () => {
    expect(thumbBlockHeight(272)).toBe(134);
    expect(thumbBlockHeight(300)).toBe(162);
    expect(thumbBlockHeight(150)).toBe(90);
    expect(thumbBlockHeight(100)).toBe(90);
  });
});

describe('autoLayoutSlots — §6 grid with the thumbnail-row refinement', () => {
  it('derives columns from the canvas width, never fewer than one', () => {
    expect(autoLayoutColumns(48 + 268 * 4)).toBe(4);
    expect(autoLayoutColumns(48 + 268 * 4 - 1)).toBe(3);
    expect(autoLayoutColumns(0)).toBe(1);
  });

  it('places text-only children at the spec coordinates with a 216px row pitch', () => {
    const entries = Array.from({ length: 5 }, () => ({ auto: true, hasThumb: false }));
    const slots = autoLayoutSlots(entries, 48 + 268 * 3);
    expect(slots[0]).toEqual({ x: ORIGIN_X, y: ORIGIN_Y });
    expect(slots[1]).toEqual({ x: ORIGIN_X + CELL_W, y: ORIGIN_Y });
    expect(slots[2]).toEqual({ x: ORIGIN_X + 2 * CELL_W, y: ORIGIN_Y });
    expect(slots[3]).toEqual({ x: ORIGIN_X, y: ORIGIN_Y + CELL_H });
    expect(slots[4]).toEqual({ x: ORIGIN_X + CELL_W, y: ORIGIN_Y + CELL_H });
  });

  it('a saved item keeps its index slot (a hole), so the grid never reshuffles', () => {
    const entries = [
      { auto: true, hasThumb: false },
      { auto: false, hasThumb: false },
      { auto: true, hasThumb: false },
    ];
    const slots = autoLayoutSlots(entries, 48 + 268 * 3);
    expect(slots[1]).toBeNull();
    expect(slots[2]).toEqual({ x: ORIGIN_X + 2 * CELL_W, y: ORIGIN_Y });
  });

  it('a row holding an auto-laid thumbnail card is 118px taller so 272px cards never overlap', () => {
    const entries = [
      { auto: true, hasThumb: false },
      { auto: true, hasThumb: true },
      { auto: true, hasThumb: false }, // row 2
      { auto: true, hasThumb: false }, // row 2
      { auto: true, hasThumb: false }, // row 3
    ];
    const slots = autoLayoutSlots(entries, 48 + 268 * 2);
    expect(slots[2]!.y).toBe(ORIGIN_Y + CELL_H + CARD_THUMB_EXTRA_H);
    expect(slots[3]!.y).toBe(ORIGIN_Y + CELL_H + CARD_THUMB_EXTRA_H);
    // Row 2 had no thumbnail: back to the spec pitch.
    expect(slots[4]!.y).toBe(ORIGIN_Y + 2 * CELL_H + CARD_THUMB_EXTRA_H);
    // The 272px card in row 1 ends above row 2's origin.
    expect(slots[1]!.y + CARD_THUMB_DEFAULT_H).toBeLessThanOrEqual(slots[2]!.y);
  });

  it('a SAVED thumbnail card does not stretch the row it merely indexes into', () => {
    const entries = [
      { auto: true, hasThumb: false },
      { auto: false, hasThumb: true },
      { auto: true, hasThumb: false },
    ];
    const slots = autoLayoutSlots(entries, 48 + 268 * 2);
    expect(slots[2]!.y).toBe(ORIGIN_Y + CELL_H);
  });
});

describe('visibleWorldRect — screen → world through scroll, pan and zoom', () => {
  const viewport = { scrollLeft: 0, scrollTop: 0, clientWidth: 1200, clientHeight: 800 };

  it('is the viewport itself at 100% with no pan or scroll', () => {
    expect(visibleWorldRect(viewport, { x: 0, y: 0 }, 100)).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
  });

  it('grows the world window as the user zooms out', () => {
    const r = visibleWorldRect(viewport, { x: 0, y: 0 }, 40);
    expect(r.w).toBeCloseTo(3000);
    expect(r.h).toBeCloseTo(2000);
  });

  it('accounts for scroll AND pan — either alone is wrong by the other', () => {
    const r = visibleWorldRect(
      { ...viewport, scrollLeft: 300, scrollTop: 100 },
      { x: -50, y: -20 },
      50,
    );
    expect(r.x).toBeCloseTo((300 + 50) / 0.5);
    expect(r.y).toBeCloseTo((100 + 20) / 0.5);
    expect(r.w).toBeCloseTo(2400);
  });
});

describe('culling predicates', () => {
  const cull = expandRect({ x: 0, y: 0, w: 1000, h: 600 }, CELL_W, CELL_H);

  it('expandRect widens by the margin on every side', () => {
    expect(cull).toEqual({ x: -CELL_W, y: -CELL_H, w: 1000 + 2 * CELL_W, h: 600 + 2 * CELL_H });
  });

  it('rectsIntersect is strict on touching edges', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });

  it('mounts items inside the margin and releases items beyond it', () => {
    const inside = { rect: { x: 900, y: 500, w: 236, h: 154 }, dragging: false, selected: false };
    const justOutside = { rect: { x: 1000 + CELL_W + 1, y: 0, w: 236, h: 154 }, dragging: false, selected: false };
    const farBelow = { rect: { x: 48, y: 5000, w: 236, h: 154 }, dragging: false, selected: false };
    expect(shouldMount(inside, cull)).toBe(true);
    expect(shouldMount(justOutside, cull)).toBe(false);
    expect(shouldMount(farBelow, cull)).toBe(false);
  });

  it('never culls the dragged or the selected item', () => {
    const far = { x: 48, y: 5000, w: 236, h: 154 };
    expect(shouldMount({ rect: far, dragging: true, selected: false }, cull)).toBe(true);
    expect(shouldMount({ rect: far, dragging: false, selected: true }, cull)).toBe(true);
  });

  it('bucketScroll quantises so tiny wheel ticks do not re-render', () => {
    expect(bucketScroll(0)).toBe(0);
    expect(bucketScroll(63)).toBe(0);
    expect(bucketScroll(64)).toBe(64);
    expect(bucketScroll(199)).toBe(192);
  });
});
