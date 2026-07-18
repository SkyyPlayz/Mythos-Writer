import { describe, it, expect } from 'vitest';
import {
  ZOOM_X_MIN,
  ZOOM_X_MAX,
  applyWheelZoom,
  effectiveCanvasWidth,
  canvasMinWidth,
  ZOOM_SEG_MIN_WIDTH,
} from './zoom';

describe('applyWheelZoom (prototype tlAxisWheel)', () => {
  it('zooms in ×1.13 on scroll up, out ×0.88 on scroll down', () => {
    expect(applyWheelZoom(1, -100)).toBeCloseTo(1.13, 10);
    expect(applyWheelZoom(1, 100)).toBeCloseTo(0.88, 10);
  });

  it('clamps to ×0.55–×44', () => {
    expect(applyWheelZoom(0.56, 100)).toBe(ZOOM_X_MIN);
    expect(applyWheelZoom(43, -1)).toBe(ZOOM_X_MAX);
    expect(ZOOM_X_MIN).toBe(0.55);
    expect(ZOOM_X_MAX).toBe(44);
  });

  it('reaches half-day zoom (×44) through repeated wheel-ins', () => {
    let x = 1;
    for (let i = 0; i < 60; i++) x = applyWheelZoom(x, -1);
    expect(x).toBe(44);
  });

  it('guards NaN zoom state', () => {
    expect(applyWheelZoom(NaN, -1)).toBeCloseTo(1.13, 10);
  });
});

describe('canvas min-width growth (prototype tlZoomWL / tlZoomEff)', () => {
  it('uses the prototype per-segment width floors', () => {
    expect(ZOOM_SEG_MIN_WIDTH).toEqual({ Year: 0, Quarter: 1600, Month: 2400, Week: 3600, Day: 5400 });
  });

  it('effective width = round(max(floor, 1100) × zoomX)', () => {
    expect(effectiveCanvasWidth('Year', 1)).toBe(1100);
    expect(effectiveCanvasWidth('Quarter', 1)).toBe(1600);
    expect(effectiveCanvasWidth('Day', 2)).toBe(10800);
    expect(effectiveCanvasWidth('Year', 1.13)).toBe(1243);
  });

  it('Year at ×1 gets no min-width (canvas fits the container)', () => {
    expect(canvasMinWidth('Year', 1)).toBeNull();
  });

  it('segments with a floor get their min-width', () => {
    expect(canvasMinWidth('Quarter', 1)).toBe(1600);
    expect(canvasMinWidth('Day', 1)).toBe(5400);
  });

  it('continuous zoom alone grows the canvas once past 1150px', () => {
    expect(canvasMinWidth('Year', 1.02)).toBeNull(); // 1122 ≤ 1150
    expect(canvasMinWidth('Year', 1.13)).toBe(1243);
  });

  it('zooming out below the threshold removes the min-width', () => {
    expect(canvasMinWidth('Quarter', 0.55)).toBeNull(); // 880 ≤ 1150
  });
});
