import { describe, it, expect } from 'vitest';
import { computeFitCamera } from './VaultGraphView';

describe('computeFitCamera (F3#8)', () => {
  it('returns identity camera for empty graphs', () => {
    expect(computeFitCamera([], 1000, 640)).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });

  it('zooms in when nodes cluster near the center of a large extent', () => {
    const cam = computeFitCamera(
      [
        { x: 480, y: 310, radius: 8 },
        { x: 520, y: 330, radius: 8 },
      ],
      1000,
      640,
    );
    expect(cam.zoom).toBeGreaterThan(1);
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
});
