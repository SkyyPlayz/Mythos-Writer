/**
 * SKY-11191 — the minimap projection.
 *
 * Everything here is derived from numbers the canvas already has, which is the
 * ticket's third acceptance criterion in its smallest form: give the same
 * world and the same scroll offsets and you get the same map, with nothing
 * read from or written to disk.
 */
import { describe, it, expect } from 'vitest';
import {
  minimapProjection,
  minimapViewportRect,
  projectRect,
  scrollToCentreWorldPoint,
} from './boardMinimap';

describe('minimapProjection', () => {
  it('fits the world inside the frame with one scale for both axes', () => {
    // A world twice as wide as it is tall, in a frame of the same ratio.
    const p = minimapProjection({ w: 1000, h: 500 }, { w: 200, h: 100 });
    expect(p).toEqual({ scale: 0.2, offsetX: 0, offsetY: 0 });
  });

  it('centres the leftover instead of stretching a tall board to fill the frame', () => {
    const p = minimapProjection({ w: 500, h: 1000 }, { w: 200, h: 100 });
    expect(p.scale).toBe(0.1); // limited by height
    expect(p.offsetX).toBe(75); // (200 − 50) / 2
    expect(p.offsetY).toBe(0);
  });

  it('survives a zero-sized world rather than dividing by zero', () => {
    expect(Number.isFinite(minimapProjection({ w: 0, h: 0 }, { w: 200, h: 100 }).scale)).toBe(true);
  });
});

describe('projectRect', () => {
  it('scales and offsets a world box into the frame', () => {
    const p = minimapProjection({ w: 1000, h: 500 }, { w: 200, h: 100 });
    expect(projectRect({ x: 100, y: 50, w: 200, h: 100 }, p)).toEqual({
      left: 20,
      top: 10,
      width: 40,
      height: 20,
    });
  });

  it('never shrinks a box below one pixel — a card must not vanish from the map', () => {
    const p = minimapProjection({ w: 100000, h: 100000 }, { w: 200, h: 100 });
    const r = projectRect({ x: 0, y: 0, w: 200, h: 100 }, p);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe('minimapViewportRect', () => {
  it('converts scroll offsets into the world slice the panel is showing', () => {
    const rect = minimapViewportRect(
      { scrollLeft: 200, scrollTop: 100, clientWidth: 400, clientHeight: 300 },
      { x: 0, y: 0 },
      50, // 50% zoom → a screen pixel is two world pixels
      { w: 4000, h: 3000 },
    );
    expect(rect).toEqual({ x: 400, y: 200, w: 800, h: 600 });
  });

  it('accounts for the world’s pan translate', () => {
    const rect = minimapViewportRect(
      { scrollLeft: 100, scrollTop: 0, clientWidth: 100, clientHeight: 100 },
      { x: -50, y: 0 },
      100,
      { w: 1000, h: 1000 },
    );
    expect(rect.x).toBe(150);
  });

  it('clamps into the world so the indicator never floats outside the frame', () => {
    const rect = minimapViewportRect(
      { scrollLeft: -40, scrollTop: 99999, clientWidth: 100, clientHeight: 100 },
      { x: 0, y: 0 },
      100,
      { w: 400, h: 400 },
    );
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(300);
  });

  it('never reports a viewport larger than the world it lives in', () => {
    const rect = minimapViewportRect(
      { scrollLeft: 0, scrollTop: 0, clientWidth: 900, clientHeight: 800 },
      { x: 0, y: 0 },
      100,
      { w: 400, h: 300 },
    );
    expect(rect).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe('scrollToCentreWorldPoint', () => {
  it('centres the picked world point in the panel', () => {
    const next = scrollToCentreWorldPoint(
      { x: 1000, y: 500 },
      { clientWidth: 400, clientHeight: 300, scrollWidth: 4000, scrollHeight: 3000 },
      { x: 0, y: 0 },
      100,
    );
    expect(next).toEqual({ scrollLeft: 800, scrollTop: 350 });
  });

  it('clamps to the scrollable range at either end', () => {
    const view = { clientWidth: 400, clientHeight: 300, scrollWidth: 1000, scrollHeight: 800 };
    expect(scrollToCentreWorldPoint({ x: 0, y: 0 }, view, { x: 0, y: 0 }, 100)).toEqual({
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(scrollToCentreWorldPoint({ x: 9999, y: 9999 }, view, { x: 0, y: 0 }, 100)).toEqual({
      scrollLeft: 600,
      scrollTop: 500,
    });
  });
});
