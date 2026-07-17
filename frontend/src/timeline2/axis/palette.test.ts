import { describe, it, expect } from 'vitest';
import { LANE_PALETTE, laneColor, hexA } from './palette';

describe('laneColor', () => {
  it('cycles the prototype palette', () => {
    expect(laneColor(0)).toBe('#00f0ff');
    expect(laneColor(1)).toBe('#9b5fff');
    expect(laneColor(LANE_PALETTE.length)).toBe('#00f0ff');
  });

  it('handles negative and invalid indices', () => {
    expect(laneColor(-1)).toBe(LANE_PALETTE[LANE_PALETTE.length - 1]);
    expect(laneColor(null)).toBe('#00f0ff');
    expect(laneColor(NaN)).toBe('#00f0ff');
  });
});

describe('hexA', () => {
  it('converts hex to rgba with clamped alpha', () => {
    expect(hexA('#00f0ff', 0.5)).toBe('rgba(0,240,255,0.500)');
    expect(hexA('#ffffff', 2)).toBe('rgba(255,255,255,1.000)');
    expect(hexA('#000000', -1)).toBe('rgba(0,0,0,0.000)');
  });

  it('degrades gracefully on malformed hex', () => {
    expect(hexA('', 0.4)).toBe('rgba(255,255,255,0.400)');
  });
});
