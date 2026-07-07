// GH #842 (Beta 3 M10) — pure drag math for the Word-style page ruler.
// px ↔ StoryPagePrefs mapping, clamping, and preset snapping. Kept free of
// React/DOM so the mapping is unit-testable in isolation.

import { STORY_PAGE_PRESET_WIDTHS, type StoryPagePrefs } from './theme';

/** Width bounds match the existing DesktopShell page-edge drag (320–1400). */
export const RULER_WIDTH_MIN = 320;
export const RULER_WIDTH_MAX = 1400;
/** Margin bounds match the PageChromeToolbar margin slider (0–120). */
export const RULER_MARGIN_MIN = 0;
export const RULER_MARGIN_MAX = 120;
/** Snap to a size preset when a drag lands within this many px of it. */
export const RULER_SNAP_PX = 14;

/** Keyboard nudge steps (arrow keys on a focused handle). */
export const WIDTH_NUDGE_PX = 10;
export const MARGIN_NUDGE_PX = 4;

export type RulerSide = -1 | 1; // -1 = left handle, +1 = right handle

export function clampWidth(px: number): number {
  return Math.round(Math.max(RULER_WIDTH_MIN, Math.min(RULER_WIDTH_MAX, px)));
}

export function clampMargin(px: number): number {
  return Math.round(Math.max(RULER_MARGIN_MIN, Math.min(RULER_MARGIN_MAX, px)));
}

/**
 * Width after dragging a page-edge handle. The page is centered, so moving
 * one edge by dx changes the total width by 2·dx, signed per side (dragging
 * the LEFT edge left = wider, the RIGHT edge right = wider).
 */
export function widthFromEdgeDrag(startWidth: number, dxPx: number, side: RulerSide): number {
  return clampWidth(startWidth + dxPx * side * 2);
}

/**
 * Symmetric horizontal margin after dragging a margin handle. Dragging the
 * LEFT handle right (or the RIGHT handle left) grows the margin.
 */
export function marginFromDrag(startMargin: number, dxPx: number, side: RulerSide): number {
  return clampMargin(startMargin + dxPx * -side);
}

export interface SnappedWidth {
  widthPx: number;
  /** The preset the width snapped onto, or null when it stays custom. */
  preset: StoryPagePrefs['sizePreset'] | null;
}

/** Snap a dragged width onto the nearest size preset within RULER_SNAP_PX. */
export function snapWidth(widthPx: number, snapPx: number = RULER_SNAP_PX): SnappedWidth {
  let best: SnappedWidth = { widthPx: clampWidth(widthPx), preset: null };
  let bestDist = snapPx + 1;
  for (const [preset, presetWidth] of Object.entries(STORY_PAGE_PRESET_WIDTHS)) {
    const dist = Math.abs(widthPx - presetWidth);
    if (dist <= snapPx && dist < bestDist) {
      best = { widthPx: presetWidth, preset: preset as StoryPagePrefs['sizePreset'] };
      bestDist = dist;
    }
  }
  return best;
}

/** The width the prefs currently resolve to (mirrors applyStoryPageTokens). */
export function effectiveWidth(prefs: StoryPagePrefs): number {
  return prefs.sizePreset === 'custom' && prefs.customWidthPx != null
    ? prefs.customWidthPx
    : (STORY_PAGE_PRESET_WIDTHS[prefs.sizePreset] ?? STORY_PAGE_PRESET_WIDTHS['letter']);
}

/** Prefs after committing a width drag: snapped preset wins, otherwise custom. */
export function prefsWithWidth(prefs: StoryPagePrefs, snapped: SnappedWidth): StoryPagePrefs {
  return snapped.preset
    ? { ...prefs, sizePreset: snapped.preset, customWidthPx: snapped.widthPx }
    : { ...prefs, sizePreset: 'custom', customWidthPx: snapped.widthPx };
}

/** Prefs after committing a horizontal-margin drag (vertical stays put). */
export function prefsWithMargin(prefs: StoryPagePrefs, marginPx: number): StoryPagePrefs {
  return { ...prefs, marginHorizPx: clampMargin(marginPx) };
}
