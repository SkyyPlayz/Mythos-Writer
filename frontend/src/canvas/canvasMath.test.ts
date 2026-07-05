// Beta 3 / M17 — canvasMath unit tests. Exact values from the Liquid Neon
// prototype (zoom lines 4775–4779, drag 3425–3435, resize 3436–3446,
// bezier 4795–4799, add card 4781).

import { describe, it, expect } from 'vitest';
import {
  BUTTON_ZOOM_IN,
  BUTTON_ZOOM_OUT,
  CARD_MIN_H,
  CARD_MIN_W,
  NEW_CARD_H,
  NEW_CARD_W,
  WHEEL_ZOOM_IN,
  WHEEL_ZOOM_OUT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampCardSize,
  clampZoom,
  contentBounds,
  dragCardPosition,
  fitToContent,
  linkPath,
  newCardPosition,
  resizeCardSize,
  wheelZoom,
  zoomAtPoint,
  zoomIn,
  zoomOut,
} from './canvasMath';

describe('zoom clamp', () => {
  it('pins the prototype range constants', () => {
    expect(ZOOM_MIN).toBe(0.4);
    expect(ZOOM_MAX).toBe(2.4);
  });

  it('clamps below .4 and above 2.4, passes values inside through', () => {
    expect(clampZoom(0.39)).toBe(0.4);
    expect(clampZoom(0.4)).toBe(0.4);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.4)).toBe(2.4);
    expect(clampZoom(2.41)).toBe(2.4);
    expect(clampZoom(-5)).toBe(0.4);
  });
});

describe('wheel zoom', () => {
  it('uses the prototype step factors ×1.1 in / ×0.92 out', () => {
    expect(WHEEL_ZOOM_IN).toBe(1.1);
    expect(WHEEL_ZOOM_OUT).toBe(0.92);
    expect(wheelZoom(1, -100)).toBeCloseTo(1.1, 12);
    expect(wheelZoom(1, 100)).toBeCloseTo(0.92, 12);
  });

  it('clamps at both ends of the range', () => {
    expect(wheelZoom(2.3, -100)).toBe(2.4); // 2.53 → 2.4
    expect(wheelZoom(0.42, 100)).toBe(0.4); // 0.3864 → 0.4
  });
});

describe('button zoom', () => {
  it('zooms ×1.15 in and ×0.87 out, clamped', () => {
    expect(BUTTON_ZOOM_IN).toBe(1.15);
    expect(BUTTON_ZOOM_OUT).toBe(0.87);
    expect(zoomIn(1)).toBeCloseTo(1.15, 12);
    expect(zoomIn(2.2)).toBe(2.4); // 2.53 → 2.4
    expect(zoomOut(1)).toBeCloseTo(0.87, 12);
    expect(zoomOut(0.45)).toBe(0.4); // 0.3915 → 0.4
  });
});

describe('zoomAtPoint', () => {
  it('keeps the board point under the anchor stationary', () => {
    const next = zoomAtPoint({ zoom: 1, panX: 0, panY: 0 }, 2, 100, 100);
    expect(next).toEqual({ zoom: 2, panX: -100, panY: -100 });
    // Board point that was under (100,100): (100 - 0) / 1 = 100.
    // After: pan + board × zoom = -100 + 100 × 2 = 100. Still under the anchor.
    expect(next.panX + 100 * next.zoom).toBe(100);
  });

  it('clamps the requested zoom before re-anchoring', () => {
    const next = zoomAtPoint({ zoom: 1, panX: 0, panY: 0 }, 10, 50, 0);
    expect(next.zoom).toBe(2.4);
    expect(next.panX).toBeCloseTo(50 - 50 * 2.4, 12);
    expect(next.panY).toBe(0);
  });
});

describe('card drag', () => {
  it('divides screen deltas by zoom (prototype line 3431)', () => {
    expect(dragCardPosition(100, 50, 30, 10, 2)).toEqual({ x: 115, y: 55 });
    expect(dragCardPosition(100, 50, 30, 10, 0.5)).toEqual({ x: 160, y: 70 });
  });

  it('clamps to the positive quadrant', () => {
    expect(dragCardPosition(100, 50, -300, -200, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('card resize', () => {
  it('enforces the 130×60 minimum', () => {
    expect(CARD_MIN_W).toBe(130);
    expect(CARD_MIN_H).toBe(60);
    expect(clampCardSize(100, 40)).toEqual({ w: 130, h: 60 });
    expect(clampCardSize(130, 60)).toEqual({ w: 130, h: 60 });
    expect(clampCardSize(300, 90)).toEqual({ w: 300, h: 90 });
  });

  it('scales deltas by zoom and clamps (prototype line 3442)', () => {
    expect(resizeCardSize(200, 86, 40, 20, 2)).toEqual({ w: 220, h: 96 });
    expect(resizeCardSize(200, 86, -500, -500, 1)).toEqual({ w: 130, h: 60 });
  });
});

describe('newCardPosition', () => {
  it('maps viewport (240, 180) back into board space (prototype line 4781)', () => {
    expect(newCardPosition({ zoom: 1, panX: 0, panY: 0 })).toEqual({ x: 240, y: 180 });
    expect(newCardPosition({ zoom: 1.2, panX: 48, panY: -36 })).toEqual({ x: 200, y: 210 });
  });

  it('pins the prototype default card size', () => {
    expect(NEW_CARD_W).toBe(190);
    expect(NEW_CARD_H).toBe(80);
  });
});

describe('linkPath', () => {
  it('emits the prototype cubic bezier between card centers', () => {
    const a = { x: 0, y: 0, w: 100, h: 50 };
    const z = { x: 200, y: 100, w: 100, h: 50 };
    expect(linkPath(a, z)).toBe('M50,25 C150,25 150,125 250,125');
  });

  it('matches the prototype for a real draftBoard pair (cards 0 → 1)', () => {
    const beats = { x: 440, y: 40, w: 280, h: 120 };
    const mira = { x: 130, y: 80, w: 200, h: 86 };
    expect(linkPath(beats, mira)).toBe('M580,100 C405,100 405,123 230,123');
  });
});

describe('contentBounds', () => {
  it('returns null for an empty board', () => {
    expect(contentBounds([])).toBeNull();
  });

  it('returns the bounding rect of all cards', () => {
    const cards = [
      { x: 100, y: 40, w: 200, h: 80 },
      { x: 400, y: 200, w: 150, h: 100 },
    ];
    expect(contentBounds(cards)).toEqual({ x: 100, y: 40, w: 450, h: 260 });
  });
});

describe('fitToContent', () => {
  it('resets to the prototype Fit state for an empty board', () => {
    expect(fitToContent([], 1000, 600)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('resets for a degenerate viewport (pre-layout)', () => {
    expect(fitToContent([{ x: 0, y: 0, w: 100, h: 100 }], 0, 0)).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it('centers content and clamps the zoom to 2.4 when it would overshoot', () => {
    // Bounds 200×100 into 1000×600 with 60px padding → min(4.4, 4.8) → clamp 2.4.
    const view = fitToContent([{ x: 100, y: 100, w: 200, h: 100 }], 1000, 600, 60);
    expect(view.zoom).toBe(2.4);
    expect(view.panX).toBeCloseTo((1000 - 200 * 2.4) / 2 - 100 * 2.4, 12); // 20
    expect(view.panY).toBeCloseTo((600 - 100 * 2.4) / 2 - 100 * 2.4, 12); // -60
  });

  it('zooms out (clamped at .4) to fit oversized content', () => {
    const cards = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 1660, y: 0, w: 100, h: 100 },
    ];
    // Bounds 1760×100 into 1000×600 with 60px padding → 880 / 1760 = 0.5.
    const view = fitToContent(cards, 1000, 600, 60);
    expect(view.zoom).toBe(0.5);
    expect(view.panX).toBeCloseTo((1000 - 1760 * 0.5) / 2, 12); // 60
    expect(view.panY).toBeCloseTo((600 - 100 * 0.5) / 2, 12); // 275
  });
});
