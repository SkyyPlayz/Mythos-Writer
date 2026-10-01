import { describe, it, expect } from 'vitest';
import { computeFitCamera, GRAPH_INSPECTOR_RESERVE_PX, isNodeInViewport } from './VaultGraphView';

describe('computeFitCamera (F3#8 / Probe B)', () => {
  it('returns identity camera for empty graphs', () => {
    expect(computeFitCamera([], 1000, 640)).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });

  it('never zooms past 100% even when nodes cluster tightly', () => {
    const cam = computeFitCamera(
      [
        { x: 480, y: 310, radius: 8 },
        { x: 520, y: 330, radius: 8 },
      ],
      1000,
      640,
    );
    expect(cam.zoom).toBeLessThanOrEqual(1);
    expect(cam.zoom).toBeGreaterThan(0);
  });

  it('clamps zoom to the graph min when content is huge', () => {
    const cam = computeFitCamera(
      [
        { x: 0, y: 0, radius: 20 },
        { x: 5000, y: 4000, radius: 20 },
      ],
      1000,
      640,
    );
    expect(cam.zoom).toBeGreaterThanOrEqual(0.45);
    expect(cam.zoom).toBeLessThanOrEqual(1);
  });

  it('leaves the selected node uncovered by the inspector reserve', () => {
    const extentW = 1000;
    const extentH = 640;
    const node = { x: 500, y: 320, radius: 12 };
    const cam = computeFitCamera([node], extentW, extentH);
    expect(cam.zoom).toBeLessThanOrEqual(1);
    // Screen X of node centre after fit — must sit left of the inspector band.
    const sx = extentW * (1 - cam.zoom) / 2 + cam.pan.x + node.x * cam.zoom;
    expect(sx).toBeLessThan(extentW - GRAPH_INSPECTOR_RESERVE_PX);
    expect(isNodeInViewport(node, cam.pan, cam.zoom, extentW, extentH)).toBe(true);
  });
});
