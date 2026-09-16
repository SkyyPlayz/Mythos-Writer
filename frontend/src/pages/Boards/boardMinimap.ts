/**
 * SKY-11191 (Notes Board 8/9): the minimap — the pure half.
 *
 * "Derived from item boxes, nothing to persist." The minimap is a scaled
 * projection of the world the canvas already lays out: every box comes from
 * the same resolved layout the cards render from, and the viewport rectangle
 * comes from the scroll panel's own offsets. There is no minimap state on
 * disk, in Store B, or in app settings — killing the app and reopening the
 * board reconstructs it from the board alone.
 */

export interface MinimapBox {
  key: string;
  kind: 'folder' | 'note';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MinimapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MinimapProjection {
  /** World px → minimap px. */
  scale: number;
  /** Minimap px the projection is inset by, so a non-square world stays centred. */
  offsetX: number;
  offsetY: number;
}

/**
 * Fit `world` inside `frame` without distorting it — one scale for both axes,
 * the leftover centred. A board is usually much wider than it is tall at
 * Home and much taller than wide once it has fifty cards, and stretching
 * either into the frame would make the minimap lie about the board's shape.
 */
export function minimapProjection(
  world: { w: number; h: number },
  frame: { w: number; h: number },
): MinimapProjection {
  const safeW = Math.max(1, world.w);
  const safeH = Math.max(1, world.h);
  const scale = Math.min(frame.w / safeW, frame.h / safeH);
  return {
    scale,
    offsetX: (frame.w - safeW * scale) / 2,
    offsetY: (frame.h - safeH * scale) / 2,
  };
}

/** Project a world rect into minimap coordinates. Sub-pixel boxes are floored to 1px so nothing vanishes. */
export function projectRect(
  rect: { x: number; y: number; w: number; h: number },
  projection: MinimapProjection,
): MinimapRect {
  return {
    left: projection.offsetX + rect.x * projection.scale,
    top: projection.offsetY + rect.y * projection.scale,
    width: Math.max(1, rect.w * projection.scale),
    height: Math.max(1, rect.h * projection.scale),
  };
}

/**
 * The part of the world the scroll panel is showing, in WORLD coordinates.
 *
 * The world element carries `translate(pan) scale(zoom)`, and the panel
 * scrolls over the scaled footprint — so a screen offset of `scrollLeft` sits
 * at `(scrollLeft - panX) / scale` in the world. Same conversion
 * boardLod.visibleWorldRect does for culling; kept separate because the
 * minimap wants the un-expanded rect (no cull margin) and clamps to the world.
 */
export function minimapViewportRect(
  view: { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number },
  pan: { x: number; y: number },
  zoom: number,
  world: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(zoom, 1) / 100;
  const x = (view.scrollLeft - pan.x) / scale;
  const y = (view.scrollTop - pan.y) / scale;
  const w = view.clientWidth / scale;
  const h = view.clientHeight / scale;
  // Clamp into the world so the indicator never floats outside the frame at
  // the scroll extremes (the sizer's rounding can overshoot by a pixel).
  const clampedX = Math.min(Math.max(0, x), Math.max(0, world.w - Math.min(w, world.w)));
  const clampedY = Math.min(Math.max(0, y), Math.max(0, world.h - Math.min(h, world.h)));
  return { x: clampedX, y: clampedY, w: Math.min(w, world.w), h: Math.min(h, world.h) };
}

/**
 * Scroll offsets that CENTRE the world point under a minimap click. Returned
 * rather than applied so the component stays a pure projection and the canvas
 * keeps sole ownership of its scroller.
 */
export function scrollToCentreWorldPoint(
  point: { x: number; y: number },
  view: { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number },
  pan: { x: number; y: number },
  zoom: number,
): { scrollLeft: number; scrollTop: number } {
  const scale = Math.max(zoom, 1) / 100;
  const rawLeft = point.x * scale + pan.x - view.clientWidth / 2;
  const rawTop = point.y * scale + pan.y - view.clientHeight / 2;
  return {
    scrollLeft: Math.min(Math.max(0, rawLeft), Math.max(0, view.scrollWidth - view.clientWidth)),
    scrollTop: Math.min(Math.max(0, rawTop), Math.max(0, view.scrollHeight - view.clientHeight)),
  };
}
