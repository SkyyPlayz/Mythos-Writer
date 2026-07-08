// GH #842 (Beta 3 M10) — page ruler drag math: px↔pref mapping, clamping, snap.

import { describe, it, expect } from 'vitest';
import { STORY_PAGE_DEFAULTS, STORY_PAGE_PRESET_WIDTHS } from './theme';
import {
  RULER_MARGIN_MAX,
  RULER_WIDTH_MAX,
  RULER_WIDTH_MIN,
  clampMargin,
  clampWidth,
  effectiveWidth,
  marginFromDrag,
  prefsWithMargin,
  prefsWithWidth,
  snapWidth,
  widthFromEdgeDrag,
} from './pageRulerMath';

describe('widthFromEdgeDrag', () => {
  it('moves the width by twice the pointer delta, signed per side', () => {
    expect(widthFromEdgeDrag(680, 50, 1)).toBe(780); // right edge → right
    expect(widthFromEdgeDrag(680, -50, 1)).toBe(580); // right edge → left
    expect(widthFromEdgeDrag(680, -50, -1)).toBe(780); // left edge → left (wider)
    expect(widthFromEdgeDrag(680, 50, -1)).toBe(580); // left edge → right (narrower)
  });

  it('clamps to the 320–1400 bounds', () => {
    expect(widthFromEdgeDrag(680, 10000, 1)).toBe(RULER_WIDTH_MAX);
    expect(widthFromEdgeDrag(680, -10000, 1)).toBe(RULER_WIDTH_MIN);
    expect(clampWidth(1)).toBe(RULER_WIDTH_MIN);
    expect(clampWidth(9999)).toBe(RULER_WIDTH_MAX);
  });
});

describe('marginFromDrag', () => {
  it('dragging the left handle right (or right handle left) grows the margin', () => {
    expect(marginFromDrag(56, -20, -1)).toBe(36); // left handle dragged left → shrink
    expect(marginFromDrag(56, 20, -1)).toBe(76); // left handle dragged right → grow
    expect(marginFromDrag(56, -20, 1)).toBe(76); // right handle dragged left → grow
    expect(marginFromDrag(56, 20, 1)).toBe(36); // right handle dragged right → shrink
  });

  it('clamps to 0–120', () => {
    expect(marginFromDrag(56, 500, -1)).toBe(RULER_MARGIN_MAX);
    expect(marginFromDrag(56, -500, -1)).toBe(0);
    expect(clampMargin(-5)).toBe(0);
    expect(clampMargin(500)).toBe(RULER_MARGIN_MAX);
  });
});

describe('snapWidth', () => {
  it('snaps onto a preset within the threshold and reports which one', () => {
    expect(snapWidth(STORY_PAGE_PRESET_WIDTHS['a4'] + 8)).toEqual({
      widthPx: STORY_PAGE_PRESET_WIDTHS['a4'],
      preset: 'a4',
    });
    expect(snapWidth(STORY_PAGE_PRESET_WIDTHS['letter'] - 10)).toEqual({
      widthPx: STORY_PAGE_PRESET_WIDTHS['letter'],
      preset: 'letter',
    });
  });

  it('stays custom outside the threshold', () => {
    expect(snapWidth(900)).toEqual({ widthPx: 900, preset: null });
    expect(snapWidth(STORY_PAGE_PRESET_WIDTHS['a4'] + 30)).toEqual({
      widthPx: STORY_PAGE_PRESET_WIDTHS['a4'] + 30,
      preset: null,
    });
  });

  it('picks the closest preset when two are within reach', () => {
    // letter 680 vs manuscript 640 — 668 is 12 from letter, 28 from manuscript.
    expect(snapWidth(668, 30)).toEqual({ widthPx: 680, preset: 'letter' });
  });
});

describe('pref mapping', () => {
  it('effectiveWidth resolves presets and custom widths like applyStoryPageTokens', () => {
    expect(effectiveWidth(STORY_PAGE_DEFAULTS)).toBe(STORY_PAGE_PRESET_WIDTHS['letter']);
    expect(effectiveWidth({ ...STORY_PAGE_DEFAULTS, sizePreset: 'a5' })).toBe(
      STORY_PAGE_PRESET_WIDTHS['a5']
    );
    expect(
      effectiveWidth({ ...STORY_PAGE_DEFAULTS, sizePreset: 'custom', customWidthPx: 999 })
    ).toBe(999);
  });

  it('prefsWithWidth commits a snapped preset, otherwise custom', () => {
    const snapped = prefsWithWidth(STORY_PAGE_DEFAULTS, { widthPx: 720, preset: 'a4' });
    expect(snapped.sizePreset).toBe('a4');
    expect(snapped.customWidthPx).toBe(720);
    const custom = prefsWithWidth(STORY_PAGE_DEFAULTS, { widthPx: 900, preset: null });
    expect(custom.sizePreset).toBe('custom');
    expect(custom.customWidthPx).toBe(900);
  });

  it('prefsWithMargin writes only the horizontal margin', () => {
    const next = prefsWithMargin(STORY_PAGE_DEFAULTS, 88);
    expect(next.marginHorizPx).toBe(88);
    expect(next.marginVertPx).toBe(STORY_PAGE_DEFAULTS.marginVertPx);
  });
});
